import {
  findSimilarQuestion,
  isDuplicateQuestion,
  questionSimilarity,
  type QuestionHistoryEntry,
  type PlannedTopic,
} from '../../lib/contracts/interview-coverage.ts'
import { planNextQuestion, slotKey, type PlanNextQuestionParams } from '../../services/interview-planner.ts'
import { buildRecentlyAskedPromptLines } from './chat-prompt.ts'

export interface GenerateQuestionResult {
  raw: string
  inputTokens: number
  outputTokens: number
  model: string
}

export type GenerateQuestionFn = (args: {
  systemPrompt: string
  /** Extra system suffix (anti-duplicate instructions). */
  antiDuplicateSuffix?: string
}) => Promise<GenerateQuestionResult>

export interface ResolveUniqueQuestionParams {
  history: QuestionHistoryEntry[]
  initialSystemPrompt: string
  plannedTopic: PlannedTopic | null
  planParams: PlanNextQuestionParams
  buildSystemPrompt: (planned: PlannedTopic | null) => string
  generate: GenerateQuestionFn
  parseCleanText: (raw: string) => string
  onStatus?: (phase: 'rephrasing' | 'replanning') => void
  onDuplicateBlocked?: (meta: {
    attempt: 'first' | 'regenerate' | 'replan'
    candidate: string
    matched: QuestionHistoryEntry
    similarity: number
  }) => void | Promise<void>
}

export interface ResolveUniqueQuestionResult {
  raw: string
  cleanText: string
  plannedTopic: PlannedTopic | null
  inputTokens: number
  outputTokens: number
  model: string
  attempts: number
  replanned: boolean
}

function antiDuplicateSuffix(
  history: QuestionHistoryEntry[],
  matched: QuestionHistoryEntry | null,
): string {
  const lines = [
    ...buildRecentlyAskedPromptLines(history),
    '',
    'CRITICAL: Your previous draft was too similar to a question already asked.',
    'Ask a meaningfully DIFFERENT question for the planned topic slot.',
    'Do NOT paraphrase or re-ask any recently asked question.',
  ]
  if (matched) {
    lines.push(`Closest prior question to avoid: "${matched.text}"`)
  }
  return lines.join('\n')
}

/**
 * Generate a question, regenerate once if duplicate, then replan+generate once more.
 * First generation is buffered (caller should not stream until this resolves).
 */
export async function resolveUniqueQuestion(
  params: ResolveUniqueQuestionParams,
): Promise<ResolveUniqueQuestionResult> {
  const {
    history,
    initialSystemPrompt,
    plannedTopic: initialTopic,
    planParams,
    buildSystemPrompt,
    generate,
    parseCleanText,
    onStatus,
    onDuplicateBlocked,
  } = params

  let plannedTopic = initialTopic
  let inputTokens = 0
  let outputTokens = 0
  let model = 'gpt-4o'
  let attempts = 0
  let replanned = false

  const runGenerate = async (systemPrompt: string, suffix?: string) => {
    attempts += 1
    const result = await generate({ systemPrompt, antiDuplicateSuffix: suffix })
    inputTokens += result.inputTokens
    outputTokens += result.outputTokens
    model = result.model
    return result
  }

  // ── Attempt 1 ──────────────────────────────────────────────────────────────
  let result = await runGenerate(initialSystemPrompt)
  let cleanText = parseCleanText(result.raw)

  if (!isDuplicateQuestion(cleanText, history)) {
    return {
      raw: result.raw,
      cleanText,
      plannedTopic,
      inputTokens,
      outputTokens,
      model,
      attempts,
      replanned,
    }
  }

  const firstMatch = findSimilarQuestion(cleanText, history)!
  await onDuplicateBlocked?.({
    attempt: 'first',
    candidate: cleanText,
    matched: firstMatch,
    similarity: questionSimilarity(cleanText, firstMatch.text),
  })

  // ── Attempt 2: regenerate with anti-duplicate instructions ─────────────────
  onStatus?.('rephrasing')
  result = await runGenerate(initialSystemPrompt, antiDuplicateSuffix(history, firstMatch))
  cleanText = parseCleanText(result.raw)

  if (!isDuplicateQuestion(cleanText, history)) {
    return {
      raw: result.raw,
      cleanText,
      plannedTopic,
      inputTokens,
      outputTokens,
      model,
      attempts,
      replanned,
    }
  }

  const secondMatch = findSimilarQuestion(cleanText, history)!
  await onDuplicateBlocked?.({
    attempt: 'regenerate',
    candidate: cleanText,
    matched: secondMatch,
    similarity: questionSimilarity(cleanText, secondMatch.text),
  })

  // ── Attempt 3: replan to a different slot, generate once ───────────────────
  onStatus?.('replanning')
  const skipped = new Set<string>(planParams.skippedSlots ? [...planParams.skippedSlots] : [])
  if (plannedTopic) {
    skipped.add(slotKey(plannedTopic.category, plannedTopic.topicSlot))
  }

  const nextTopic = planNextQuestion({
    ...planParams,
    skippedSlots: skipped,
  })
  plannedTopic = nextTopic
  replanned = true

  if (!nextTopic) {
    // No alternate slot — return last draft rather than looping forever.
    return {
      raw: result.raw,
      cleanText,
      plannedTopic: null,
      inputTokens,
      outputTokens,
      model,
      attempts,
      replanned,
    }
  }

  const replanPrompt = buildSystemPrompt(nextTopic)
  result = await runGenerate(replanPrompt, antiDuplicateSuffix(history, secondMatch))
  cleanText = parseCleanText(result.raw)

  if (isDuplicateQuestion(cleanText, history)) {
    const thirdMatch = findSimilarQuestion(cleanText, history)!
    await onDuplicateBlocked?.({
      attempt: 'replan',
      candidate: cleanText,
      matched: thirdMatch,
      similarity: questionSimilarity(cleanText, thirdMatch.text),
    })
  }

  return {
    raw: result.raw,
    cleanText,
    plannedTopic,
    inputTokens,
    outputTokens,
    model,
    attempts,
    replanned,
  }
}
