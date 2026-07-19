import type OpenAI from 'openai'
import type { DB } from '../lib/db/index.ts'
import { BlueprintContentSchema } from '../lib/contracts/blueprint.ts'
import type { BlueprintContent } from '../lib/contracts/blueprint.ts'
import { requireStartupOwner } from '../lib/db/startup-queries.ts'
import {
  chatThinkingEvent,
  chatSuggestionEvent,
  chatErrorEvent,
  chatClarifyEvent,
  formatChatSSE,
} from '../agents/base/events.ts'
import { deepMerge } from './blueprint-merge.ts'

type ModelResponse = {
  action?:   string
  patch?:    Partial<BlueprintContent>
  question?: string
  choices?:  string[]
  summary?:  string
  rationale?: string
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

    const { openai } = this

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const emit    = (data: string) => controller.enqueue(encoder.encode(data))

        try {
          emit(formatChatSSE(chatThinkingEvent('Analysing your request…')))

          const systemPrompt = `You are an expert startup blueprint editor. The user will give you an instruction to modify their startup blueprint.

Always return a JSON object with exactly one of these two shapes:

Shape A — when you have enough context to propose a change:
{ "action": "edit", "summary": "short summary", "rationale": "why this helps", "patch": { ...only the top-level section keys that changed... } }

Shape B — when the request is vague:
{ "action": "clarify", "question": "A concise question (1 sentence)", "choices": ["Option 1", "Option 2", "Option 3"] }

Rules for "edit":
1. Include ONLY top-level section keys that changed. Do NOT include unchanged sections.
2. CRITICAL: For every section in patch, return the COMPLETE section object with ALL its fields — even unchanged ones.
3. Preserve enum values exactly. You may edit customSections and customBlocks.
4. Speak in CEO/product language — do not invent tech stack details.
5. Do NOT persist — the client will ask the user to Apply or Keep.

Return ONLY the raw JSON object.

Current blueprint content:
${JSON.stringify(currentContent)}`

          emit(formatChatSSE(chatThinkingEvent('Generating suggestion…')))

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

          let result: ModelResponse
          try {
            result = JSON.parse(accumulated) as ModelResponse
          } catch {
            emit(formatChatSSE(chatErrorEvent('AI returned malformed JSON. Please try again.')))
            controller.close()
            return
          }

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

          const patch = (result.patch ?? result) as Partial<BlueprintContent>
          const mergedUnknown = deepMerge(currentContent, {
            ...patch,
            _schemaVersion: currentContent._schemaVersion,
          })
          const merged = mergedUnknown as BlueprintContent

          const validated = BlueprintContentSchema.safeParse(merged)
          if (!validated.success) {
            console.error('[BlueprintChatService] validation failed', JSON.stringify(validated.error.format(), null, 2))
            emit(formatChatSSE(chatErrorEvent('The resulting blueprint failed validation. Please try rephrasing your request.')))
            controller.close()
            return
          }

          const summary = typeof result.summary === 'string' && result.summary
            ? result.summary
            : 'Suggested updates to your blueprint.'
          const rationale = typeof result.rationale === 'string' ? result.rationale : ''

          // Propose only — client persists after Apply.
          emit(formatChatSSE(chatSuggestionEvent(summary, rationale, patch, validated.data)))
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
