import { eq, max } from 'drizzle-orm'
import type OpenAI from 'openai'
import type { DB } from '../lib/db/index.ts'
import { blueprints, blueprintVersions } from '../lib/db/schema/artifacts.ts'
import { BlueprintContentSchema } from '../lib/contracts/blueprint.ts'
import type { BlueprintContent } from '../lib/contracts/blueprint.ts'
import { requireStartupOwner } from '../lib/db/startup-queries.ts'
import {
  chatThinkingEvent,
  chatPatchEvent,
  chatCompleteEvent,
  chatErrorEvent,
  formatChatSSE,
} from '../agents/base/events.ts'

// ── BlueprintChatService ──────────────────────────────────────────────────────
// Handles AI-powered blueprint editing via natural language chat.
//
// SSE stream contract:
//   { type: 'chat_thinking', data: { message } }   — AI is working
//   { type: 'chat_patch',    data: { path, value } } — field updated (top-level section key)
//   { type: 'chat_complete', data: { content } }    — final blueprint content
//   { type: 'chat_error',    data: { message } }    — error
export class BlueprintChatService {
  constructor(
    private readonly db:     DB,
    private readonly openai: OpenAI,
  ) {}

  async chatStream(
    startupId:      string,
    userId:         string,
    message:        string,
    currentContent: BlueprintContent,
  ): Promise<ReadableStream> {
    await requireStartupOwner(startupId, userId)

    const { db, openai } = this

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const emit    = (data: string) => controller.enqueue(encoder.encode(data))

        try {
          emit(formatChatSSE(chatThinkingEvent('Analysing your request…')))

          const systemPrompt = `You are an expert startup blueprint editor. The user will give you an instruction to modify their startup blueprint.

Your task:
1. Understand what the user wants to change.
2. Return ONLY the modified sections as a valid JSON object — a partial blueprint containing only the top-level keys that changed (e.g. { "overview": { ... } }).
3. Do NOT include sections that were not changed.
4. Preserve all existing data in unchanged fields within a changed section.
5. Ensure all string values respect their field's purpose (tagline ≤ 160 chars, positionStatement ≤ 500 chars, etc.).
6. Return ONLY valid JSON. No explanation, no markdown, no code fences.

Current blueprint content:
${JSON.stringify(currentContent)}`

          emit(formatChatSSE(chatThinkingEvent('Generating changes…')))

          // Use OpenAI with json_object mode for reliable structured output.
          // Consistent with the rest of the generation pipeline (gpt-4o / OpenAI).
          const response = await openai.chat.completions.create({
            model:           'gpt-4o',
            response_format: { type: 'json_object' },
            max_tokens:      4096,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: message },
            ],
          })

          const accumulated = response.choices[0]?.message?.content ?? ''

          // Parse the JSON patch returned by the model
          let patch: Partial<BlueprintContent>
          try {
            patch = JSON.parse(accumulated) as Partial<BlueprintContent>
          } catch {
            emit(formatChatSSE(chatErrorEvent('AI returned malformed JSON. Please try again.')))
            controller.close()
            return
          }

          // Deep merge the patch into the current content
          const merged: BlueprintContent = {
            ...currentContent,
            ...patch,
            // Preserve _schemaVersion
            _schemaVersion: currentContent._schemaVersion,
          }

          // Validate against the full schema
          const validated = BlueprintContentSchema.safeParse(merged)
          if (!validated.success) {
            emit(formatChatSSE(chatErrorEvent('The resulting blueprint failed validation. Your change may conflict with required fields.')))
            controller.close()
            return
          }

          const finalContent = validated.data

          // Emit patch events for each changed top-level section
          for (const key of Object.keys(patch) as (keyof BlueprintContent)[]) {
            if (key === '_schemaVersion') continue
            emit(formatChatSSE(chatPatchEvent(key, finalContent[key])))
          }

          // Persist as a new blueprint version
          try {
            const blueprint = await db.query.blueprints.findFirst({
              where: eq(blueprints.startupId, startupId),
              columns: { id: true },
            })

            if (blueprint) {
              const [maxRow] = await db
                .select({ maxVer: max(blueprintVersions.versionNumber) })
                .from(blueprintVersions)
                .where(eq(blueprintVersions.blueprintId, blueprint.id))

              const nextVersion = (maxRow.maxVer ?? 0) + 1

              await db
                .update(blueprintVersions)
                .set({ isCurrent: false })
                .where(eq(blueprintVersions.blueprintId, blueprint.id))

              await db
                .insert(blueprintVersions)
                .values({
                  blueprintId:   blueprint.id,
                  versionNumber: nextVersion,
                  content:       finalContent,
                  isCurrent:     true,
                })
            }
          } catch (persistErr) {
            // Persist failure is non-fatal — UI already has updated content
            console.error('[BlueprintChatService] persist failed', persistErr)
          }

          emit(formatChatSSE(chatCompleteEvent(finalContent)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Chat edit failed'
          emit(formatChatSSE(chatErrorEvent(msg)))
        } finally {
          controller.close()
        }
      },
    })
  }
}
