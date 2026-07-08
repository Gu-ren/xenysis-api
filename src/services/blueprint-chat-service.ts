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

// ── Helpers ───────────────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Recursively merges `patch` into `base`.
 * - Plain objects are merged key-by-key (deep).
 * - Arrays REPLACE — section arrays (risks, scope, milestones…) are ordered
 *   structured data; appending blindly would create duplicates.
 * - All other values (strings, numbers, booleans, null) are taken from `patch`.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const result: PlainObject = { ...base }
  for (const key of Object.keys(patch)) {
    result[key] = isPlainObject(base[key]) && isPlainObject(patch[key])
      ? deepMerge(base[key], patch[key])
      : patch[key]
  }
  return result
}

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
2. Return ONLY the top-level section keys that changed (e.g. { "overview": { ... } }). Do NOT include unchanged sections.
3. CRITICAL: For every section you include, return the COMPLETE section object with ALL its fields — even fields you are not changing. Never return a partial section with only the changed field.
4. Preserve enum values exactly as they appear in the current content. Valid examples:
   - priority: "must_have" | "should_have" | "nice_to_have" | "wont_have"
   - severity: "low" | "medium" | "high" | "critical"
   - gtmMotion: "product_led" | "sales_led" | "community_led" | "partnership_led" | "marketing_led"
   - techSavviness: "low" | "medium" | "high"
   - buyerVsUser: "same" | "different" | "both"
   - problemSeverity / rating: "low" | "medium" | "high" | "very_high"
   - emotion: "frustrated" | "confused" | "neutral" | "interested" | "satisfied" | "delighted"
5. Respect field length limits (tagline ≤ 160 chars, positionStatement ≤ 500 chars, etc.).
6. Return ONLY the raw JSON object. No explanation, no markdown, no code fences.

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

          // Deep-merge the patch into the current content section-by-section.
          // Shallow spread (`...patch`) would replace an entire section object
          // with whatever the model returned — losing required fields the model
          // omitted. Deep merge fills those gaps from currentContent.
          const mergedUnknown = deepMerge(currentContent, {
            ...patch,
            _schemaVersion: currentContent._schemaVersion,
          })
          const merged = mergedUnknown as BlueprintContent

          // Validate against the full schema
          const validated = BlueprintContentSchema.safeParse(merged)
          if (!validated.success) {
            console.error('[BlueprintChatService] validation failed', JSON.stringify(validated.error.format(), null, 2))
            emit(formatChatSSE(chatErrorEvent('The resulting blueprint failed validation. Please try rephrasing your request.')))
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
