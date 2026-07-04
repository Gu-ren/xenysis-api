import { openai } from '../../lib/ai/client.ts'
import { CATEGORY_DISPLAY } from '../../lib/contracts/founder-understanding.ts'
import type { UnderstandingCategory } from '../../lib/contracts/founder-understanding.ts'
import {
  ANSWER_CHOICES_SCHEMA,
  normalizeAnswerChoices,
  type AnswerChoice,
} from './answer-choices.ts'

export interface GenerateAnswerChoicesFallbackParams {
  questionText: string
  startupName: string
  weakestCategory: UnderstandingCategory | null
}

export interface GenerateAnswerChoicesFallbackResult {
  choices: AnswerChoice[]
  model: string
  inputTokens: number
  outputTokens: number
}

export async function generateAnswerChoicesFallback(
  params: GenerateAnswerChoicesFallbackParams,
): Promise<GenerateAnswerChoicesFallbackResult> {
  const focusHint = params.weakestCategory
    ? CATEGORY_DISPLAY[params.weakestCategory].label
    : 'the current discovery topic'

  const res = await openai.chat.completions.create({
    model:           'gpt-4o-mini',
    response_format: { type: 'json_schema', json_schema: ANSWER_CHOICES_SCHEMA },
    messages: [
      {
        role:    'system',
        content: [
          'Generate exactly 3 suggested answer choices for a founder discovery session question.',
          'Each choice must have a short "label" (max 60 chars) and a "text" field with a 2–3 sentence',
          'grounded draft answer the founder can select and refine.',
          'Base drafts on the question context — distinct plausible directions, not generic placeholders.',
        ].join(' '),
      },
      {
        role:    'user',
        content: [
          `Startup: ${params.startupName}`,
          `Focus area: ${focusHint}`,
          '',
          'Question:',
          params.questionText,
        ].join('\n'),
      },
    ],
  })

  const content = res.choices[0]?.message?.content ?? '{}'
  let choices: AnswerChoice[] = []

  try {
    const parsed = JSON.parse(content) as { choices?: unknown[] }
    if (Array.isArray(parsed.choices)) {
      choices = normalizeAnswerChoices(parsed.choices)
    }
  } catch {
    console.error('[answer-choices-fallback] failed to parse fallback response')
  }

  return {
    choices,
    model:        res.model ?? 'gpt-4o-mini',
    inputTokens:  res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  }
}
