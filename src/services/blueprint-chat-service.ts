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
  chatClarifyEvent,
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
//   { type: 'chat_thinking', data: { message } }           — AI is working
//   { type: 'chat_patch',    data: { path, value } }       — field updated
//   { type: 'chat_complete', data: { content } }           — final blueprint
//   { type: 'chat_error',    data: { message } }           — error
//   { type: 'chat_clarify',  data: { question, choices } } — needs more context

type ModelResponse = {
  action?:   string
  patch?:    Partial<BlueprintContent>
  question?: string
  choices?:  string[]
}
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
    history:        Array<{ role: 'user' | 'assistant'; content: string }> = [],
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

Always return a JSON object with exactly one of these two shapes:

Shape A — when you have enough context to make the change:
{ "action": "edit", "patch": { ...only the top-level section keys that changed... } }

Shape B — when the request is vague, has multiple valid interpretations, or the direction strongly affects the outcome:
{ "action": "clarify", "question": "A concise question (1 sentence)", "choices": ["Option 1", "Option 2", "Option 3"] }

Rules for "edit":
1. Include ONLY top-level section keys that changed. Do NOT include unchanged sections.
2. CRITICAL: For every section in patch, return the COMPLETE section object with ALL its fields — even unchanged ones. Never return a partial section.
3. Preserve enum values exactly as they appear. Valid values:
   - priority: "must_have" | "should_have" | "nice_to_have" | "wont_have"
   - severity: "low" | "medium" | "high" | "critical"
   - gtmMotion: "product_led" | "sales_led" | "community_led" | "partnership_led" | "marketing_led"
   - techSavviness / rating / problemSeverity: "low" | "medium" | "high" | "very_high"
   - buyerVsUser: "same" | "different" | "both"
   - emotion: "frustrated" | "confused" | "neutral" | "interested" | "satisfied" | "delighted"
4. Respect field length limits (tagline ≤ 160 chars, positionStatement ≤ 500 chars, etc.).

Rules for "clarify":
- Trigger when: too vague ("make it better"), direction strongly affects outcome, 2+ equally valid interpretations.
- Do NOT clarify if the conversation history already answers the question.
- Provide 3–5 short, distinct, mutually exclusive choices (≤ 8 words each).

Return ONLY the raw JSON object. No explanation, no markdown, no code fences.

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
              ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
              { role: 'user',   content: message },
            ],
          })

          const accumulated = response.choices[0]?.message?.content ?? ''

          // Parse the discriminated union returned by the model:
          //   { action: "edit",    patch: {...} }
          //   { action: "clarify", question: "...", choices: [...] }
          let result: ModelResponse
          try {
            result = JSON.parse(accumulated) as ModelResponse
          } catch {
            emit(formatChatSSE(chatErrorEvent('AI returned malformed JSON. Please try again.')))
            controller.close()
            return
          }

          // Handle clarify — send question + choices, do not modify the blueprint
          if (result.action === 'clarify') {
            const question = typeof result.question === 'string'
              ? result.question
              : 'Could you clarify your request?'
            const choices = Array.isArray(result.choices)
              ? (result.choices as unknown[]).filter((c): c is string => typeof c === 'string')
              : []
            emit(formatChatSSE(chatClarifyEvent(question, choices)))
            controller.close()
            return
          }

          // Handle edit — extract patch (support both { action:"edit", patch:{} } and direct-patch fallback)
          const patch = (result.patch ?? result) as Partial<BlueprintContent>

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
