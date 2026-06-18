import { eq } from 'drizzle-orm'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { DB } from '../lib/db/index.ts'
import {
  generationJobs,
  opportunityAssessments,
} from '../lib/db/schema/index.ts'
import { BusinessRuleError } from '../middleware/errors.ts'
import { runAgent } from '../agents/base/runner.ts'
import { formatSSE, errorEvent } from '../agents/base/events.ts'
import { BlueprintAgent } from '../agents/blueprint-agent/index.ts'
import { buildBlueprintContext } from '../agents/blueprint-agent/context-builder.ts'
import { PROMPT_VERSION } from '../agents/blueprint-agent/prompt.ts'

// ── BlueprintGenerationService ────────────────────────────────────────────────
// Orchestrates blueprint generation:
//   1. Validates that an opportunity assessment exists for the startup.
//   2. Creates a generation_jobs row for tracking and token usage.
//   3. Assembles the agent input via context-builder.
//   4. Runs the BlueprintAgent via the shared runner, returning an SSE ReadableStream.
//
// SSE stream contract (inherited from GenerationEvent):
//   { type: 'stage',    data: { stageId, label, sublabel, state } }
//   { type: 'progress', data: { percent } }
//   { type: 'complete', data: { artifactId, versionId, artifactType: 'blueprint' } }
//   { type: 'error',    data: { code, message, retryable } }
//
// Callers: blueprint route handler (not yet implemented). The service owns no HTTP
// concerns — headers and streaming are the route's responsibility.
export class BlueprintGenerationService {
  constructor(
    private readonly db:        DB,
    private readonly anthropic: Anthropic,
    private readonly openai:    OpenAI,
  ) {}

  // ── generateStream ──────────────────────────────────────────────────────────
  // Prerequisite: an opportunity assessment must exist for startupId.
  // Throws BusinessRuleError if not — callers should surface this as 422.
  async generateStream(startupId: string, userId: string): Promise<ReadableStream> {
    await this.assertAssessmentExists(startupId)

    const job = await this.createJob(startupId, userId)
    const input = await buildBlueprintContext(this.db, startupId, userId, job.id)

    const { db, anthropic, openai } = this

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const emit    = (data: string) => controller.enqueue(encoder.encode(data))

        try {
          for await (const event of runAgent(new BlueprintAgent(), input, db, anthropic, openai)) {
            emit(formatSSE(event))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Blueprint generation failed'
          emit(formatSSE(errorEvent('GENERATION_FAILED', msg, false)))
        } finally {
          controller.close()
        }
      },
    })
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async assertAssessmentExists(startupId: string): Promise<void> {
    const assessment = await this.db.query.opportunityAssessments.findFirst({
      where: eq(opportunityAssessments.startupId, startupId),
      columns: { id: true },
    })
    if (!assessment) {
      throw new BusinessRuleError(
        'No opportunity assessment found. Generate an opportunity assessment before creating a blueprint.',
      )
    }
  }

  private async createJob(startupId: string, userId: string) {
    const [job] = await this.db
      .insert(generationJobs)
      .values({
        userId,
        startupId,
        type:          'blueprint',
        status:        'pending',
        model:         'claude-sonnet-4-6',
        provider:      'anthropic',
        promptVersion: PROMPT_VERSION,
      })
      .returning()
    return job
  }
}
