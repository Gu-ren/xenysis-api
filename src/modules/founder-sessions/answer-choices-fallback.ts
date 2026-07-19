import { openai } from '../../lib/ai/client.ts'
import { CATEGORY_DISPLAY } from '../../lib/contracts/founder-understanding.ts'
import type { UnderstandingCategory } from '../../lib/contracts/founder-understanding.ts'
import type { SessionSummary } from '../../lib/contracts/session-summary.ts'
import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { PlannedTopic } from '../../lib/contracts/interview-coverage.ts'
import {
  ANSWER_CHOICES_SCHEMA,
  normalizeAnswerChoices,
  type AnswerChoice,
} from './answer-choices.ts'

export interface GenerateAnswerChoicesParams {
  questionText: string
  startupName: string
  startupDescription?: string
  weakestCategory: UnderstandingCategory | null
  sessionSummary: SessionSummary | null
  founderMemory: FounderMemory | null
  recentExchanges: Array<{ question: string; answer: string }>
  /** Planned topic for this turn — choices must stay on this slot. */
  plannedTopic?: PlannedTopic | null
  /** Founder's latest message that triggered this turn. */
  latestFounderMessage?: string | null
}

export interface GenerateAnswerChoicesResult {
  choices: AnswerChoice[]
  model: string
  inputTokens: number
  outputTokens: number
}

/** Pure context builder — exported for unit tests. */
export function buildContextBlocks(params: GenerateAnswerChoicesParams): string[] {
  const lines: string[] = [
    `Startup: ${params.startupName}`,
  ]

  if (params.startupDescription) {
    lines.push(`Description: ${params.startupDescription}`)
  }

  if (params.plannedTopic) {
    lines.push(
      '',
      'Planned topic (choices MUST answer this slot only):',
      `Category: ${CATEGORY_DISPLAY[params.plannedTopic.category].label}`,
      `Topic slot: ${params.plannedTopic.topicSlot}`,
      `Must elicit: ${params.plannedTopic.mustElicit}`,
      `Depth: ${params.plannedTopic.depth}`,
    )
  } else {
    const focusHint = params.weakestCategory
      ? CATEGORY_DISPLAY[params.weakestCategory].label
      : 'the current discovery topic'
    lines.push(`Focus area: ${focusHint}`)
  }

  if (params.latestFounderMessage) {
    lines.push(
      '',
      'Founder\'s latest answer (reuse their names, numbers, and phrases):',
      params.latestFounderMessage,
    )
  }

  if (params.sessionSummary) {
    lines.push(
      '',
      'Session summary:',
      params.sessionSummary.problem         ? `Problem: ${params.sessionSummary.problem}` : '',
      params.sessionSummary.target_customer ? `Customer: ${params.sessionSummary.target_customer}` : '',
      params.sessionSummary.business_model  ? `Business model: ${params.sessionSummary.business_model}` : '',
    )
  }

  if (params.founderMemory) {
    lines.push(
      '',
      'Founder memory:',
      params.founderMemory.one_sentence_pitch ? `Pitch: ${params.founderMemory.one_sentence_pitch}` : '',
      params.founderMemory.problem            ? `Problem: ${params.founderMemory.problem}` : '',
      params.founderMemory.customer           ? `Customer: ${params.founderMemory.customer}` : '',
      params.founderMemory.business_model     ? `Business model: ${params.founderMemory.business_model}` : '',
    )
  }

  if (params.recentExchanges.length > 0) {
    lines.push('', 'Recent exchanges:')
    for (const ex of params.recentExchanges.slice(-5)) {
      lines.push(`Q: ${ex.question}`)
      lines.push(`A: ${ex.answer}`)
      lines.push('')
    }
  }

  lines.push('', 'Current question:', params.questionText)

  return lines.filter((l) => l !== undefined && l !== '')
}

const CHOICES_SYSTEM_PROMPT = [
  'Generate exactly 3 suggested answer choices for a founder/CEO discovery question.',
  'Each choice must have a short "label" (max 60 chars) and a "text" field with a 2–3 sentence grounded draft.',
  'HARD RULES:',
  '- All 3 drafts MUST answer THIS question and stay on the planned topic slot when provided — not three unrelated categories.',
  '- Reuse names, numbers, phrases, and contexts from the founder\'s latest answer and memory whenever present.',
  '- Distinct directions that still stay on-topic (e.g. different customer examples of the same pain).',
  '- CEO / product language only: pain, customers, features, outcomes, pricing, competitors.',
  '- NEVER mention tech stack, frameworks, databases, APIs, scalability, architecture, or deployment.',
  '- Prefer drafts with: (1) a specific persona or concrete example, (2) a trigger or situation, (3) a quantified or bounded claim when it fits.',
  'Use labels that signal depth when useful: "With numbers", "With customer quote", "Hypothesis — needs validation".',
].join(' ')

export async function generateAnswerChoices(
  params: GenerateAnswerChoicesParams,
): Promise<GenerateAnswerChoicesResult> {
  const res = await openai.chat.completions.create({
    model:           'gpt-4o-mini',
    response_format: { type: 'json_schema', json_schema: ANSWER_CHOICES_SCHEMA },
    messages: [
      {
        role:    'system',
        content: CHOICES_SYSTEM_PROMPT,
      },
      {
        role:    'user',
        content: buildContextBlocks(params).join('\n'),
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
    console.error('[generate-answer-choices] failed to parse response')
  }

  return {
    choices,
    model:        res.model ?? 'gpt-4o-mini',
    inputTokens:  res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  }
}

/** @deprecated Use generateAnswerChoices — kept for chat-stream fallback compatibility. */
export async function generateAnswerChoicesFallback(
  params: Pick<GenerateAnswerChoicesParams, 'questionText' | 'startupName' | 'weakestCategory'>,
): Promise<GenerateAnswerChoicesResult> {
  return generateAnswerChoices({
    ...params,
    sessionSummary:        null,
    founderMemory:         null,
    recentExchanges:       [],
    plannedTopic:          null,
    latestFounderMessage:  null,
  })
}
