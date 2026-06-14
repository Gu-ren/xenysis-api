import type { Agent, AgentContext } from '../base/agent.interface.ts'
import {
  stageEvent,
  progressEvent,
  completeEvent,
  type GenerationEvent,
} from '../base/events.ts'
import { trackUsage } from '../base/utils.ts'
import { getAdapter } from '../../lib/ai/adapters/index.ts'
import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import type { OpportunityAssessmentContent } from '../../lib/contracts/opportunity-assessment.ts'
import {
  buildSystemPrompt,
  buildUserMessage,
  trimEvidenceRecords,
  PROMPT_VERSION,
} from './prompt.ts'
import { OPPORTUNITY_ASSESSMENT_SCHEMA } from './schemas.ts'
import { persistAssessment } from './persist.ts'
import type { OpportunityAgentInput } from './input-contract.ts'
import type { OpportunityAgentOutput } from './types.ts'

// ── OpportunityAgent ──────────────────────────────────────────────────────────
// Implements Agent<OpportunityAgentInput, OpportunityAgentOutput>.
// Receives a fully-assembled context from context-builder.ts via the route handler.
//
// Execution stages (SSE-visible) — named for actual system work, not startup concepts:
//   collecting-context    — trim evidence records, build system prompt + user message
//   generating-assessment — single structured-output LLM call
//   validating-results    — JSON.parse + OpportunityAssessmentContentSchema.parse
//   persisting-results    — trackUsage + persistAssessment (DB writes)
//
// Failure behavior for malformed model output:
//   adapter.complete() → invalid JSON → JSON.parse() throws → Error re-thrown with context
//   The thrown Error propagates out of execute() into runner.ts, which catches it,
//   increments the attempt counter, and retries up to job.maxAttempts times before
//   marking the job failed and emitting an error SSE event. The agent itself has no
//   retry logic — that responsibility belongs entirely to the runner.
export class OpportunityAgent implements Agent<OpportunityAgentInput, OpportunityAgentOutput> {
  readonly name          = 'OpportunityAgent'
  readonly promptVersion = PROMPT_VERSION

  async *execute(
    ctx: AgentContext<OpportunityAgentInput>,
  ): AsyncGenerator<GenerationEvent, OpportunityAgentOutput> {
    const { input, db, anthropic, openai, model, provider } = ctx

    // ── Stage 1: collecting-context ──────────────────────────────────────────
    // Trim evidence records to fit token budget, then build both prompt messages.
    yield stageEvent('collecting-context', 'Collecting context', 'Reading founder memory and evidence records', 'active')

    const trimmedEvidence = trimEvidenceRecords(input.evidenceRecords)

    const systemPrompt = buildSystemPrompt()
    const userMessage  = buildUserMessage({
      startup:         input.startup,
      founderMemory:   input.founderMemory,
      understanding:   input.understanding,
      evidenceRecords: trimmedEvidence,
      latestSummary:   input.latestSummary,
    })

    yield stageEvent('collecting-context', 'Collecting context', 'Reading founder memory and evidence records', 'done')
    yield progressEvent(10)

    // ── Stage 2: generating-assessment ──────────────────────────────────────
    // Single structured-output completion. All scoring, risk identification,
    // and recommendation logic runs inside this one model call.
    yield stageEvent('generating-assessment', 'Generating assessment', 'Running opportunity analysis model', 'active')

    const adapter = getAdapter(provider, openai, anthropic)
    const result  = await adapter.complete({
      model,
      systemPrompt,
      userMessage,
      schema: OPPORTUNITY_ASSESSMENT_SCHEMA,
    })

    yield stageEvent('generating-assessment', 'Generating assessment', 'Running opportunity analysis model', 'done')
    yield progressEvent(75)

    // ── Stage 3: validating-results ──────────────────────────────────────────
    // Parse the raw JSON string, then validate the object against the contract schema.
    // Failures here throw and propagate to the runner — no local recovery.
    yield stageEvent('validating-results', 'Validating results', 'Parsing and validating model output', 'active')

    let rawParsed: unknown
    try {
      rawParsed = JSON.parse(result.rawContent)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Opportunity assessment response was not valid JSON: ${message}`)
    }

    let content: OpportunityAssessmentContent
    try {
      content = OpportunityAssessmentContentSchema.parse(rawParsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Opportunity assessment failed schema validation: ${message}`)
    }

    yield stageEvent('validating-results', 'Validating results', 'Parsing and validating model output', 'done')
    yield progressEvent(85)

    // ── Stage 4: persisting-results ──────────────────────────────────────────
    // Record token usage and write the validated assessment to the database.
    yield stageEvent('persisting-results', 'Persisting results', 'Saving assessment to database', 'active')

    await trackUsage(db, {
      userId:          input.userId,
      startupId:       input.startupId,
      generationJobId: input.jobId,
      usage: {
        model:        result.model,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
      },
      purpose: 'opportunity_gen',
    })

    const persisted = await persistAssessment({
      db,
      userId:    input.userId,
      startupId: input.startupId,
      sessionId: input.sessionId,
      jobId:     input.jobId,
      content,
    })

    yield stageEvent('persisting-results', 'Persisting results', 'Saving assessment to database', 'done')
    yield progressEvent(100)
    yield completeEvent(persisted.assessmentId, persisted.versionId, 'opportunity_assessment')

    return {
      assessmentId:  persisted.assessmentId,
      versionId:     persisted.versionId,
      versionNumber: persisted.versionNumber,
      content,
    }
  }
}
