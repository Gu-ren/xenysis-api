import { eq } from 'drizzle-orm'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { DB } from '../../lib/db/index.ts'
import { generationJobs } from '../../lib/db/schema/index.ts'
import type { AIProvider } from '../../lib/ai/adapters/index.ts'
import type { Agent, AgentInput } from './agent.interface.ts'
import { type GenerationEvent, errorEvent, logEvent } from './events.ts'

// Syncs stage/progress events back to generation_jobs.stages JSONB.
// Only this file touches job state columns — spec Rule 12.
async function syncJobProgress(
  db: DB,
  jobId: string,
  event: GenerationEvent,
): Promise<void> {
  if (event.type === 'progress') {
    await db
      .update(generationJobs)
      .set({ progress: event.data.percent })
      .where(eq(generationJobs.id, jobId))
    return
  }

  if (event.type === 'stage') {
    const job = await db.query.generationJobs.findFirst({
      where: eq(generationJobs.id, jobId),
      columns: { stages: true },
    })
    if (!job) return

    const stages = (job.stages as GenerationEvent['data'][]) ?? []
    const idx = (stages as Array<{ stageId?: string }>).findIndex(
      (s) => s.stageId === event.data.stageId,
    )
    if (idx >= 0) {
      stages[idx] = event.data
    } else {
      stages.push(event.data)
    }

    await db
      .update(generationJobs)
      .set({ stages })
      .where(eq(generationJobs.id, jobId))
  }
}

export async function* runAgent<TInput extends AgentInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  input: TInput,
  db: DB,
  anthropic: Anthropic,
  openai: OpenAI,
): AsyncGenerator<GenerationEvent, TOutput> {
  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, input.jobId),
  })
  if (!job) throw new Error(`Job ${input.jobId} not found`)

  await db
    .update(generationJobs)
    .set({ status: 'active', startedAt: new Date() })
    .where(eq(generationJobs.id, job.id))

  // provider is stored explicitly on the job row — never inferred from model name.
  const provider = job.provider as AIProvider

  let lastError: unknown

  for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
    try {
      const gen = agent.execute({ input, db, anthropic, openai, model: job.model, provider })

      for await (const event of gen) {
        if (event.type === 'stage' || event.type === 'progress') {
          await syncJobProgress(db, job.id, event)
        }
        yield event
      }

      await db
        .update(generationJobs)
        .set({ status: 'done', progress: 100, completedAt: new Date() })
        .where(eq(generationJobs.id, job.id))

      return undefined as unknown as TOutput
    } catch (err) {
      lastError = err
      if (attempt < job.maxAttempts) {
        yield logEvent(`Attempt ${attempt} failed, retrying…`, 'warn')
        await db
          .update(generationJobs)
          .set({ attemptNumber: attempt + 1 })
          .where(eq(generationJobs.id, job.id))
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown error'
  await db
    .update(generationJobs)
    .set({ status: 'failed', error: message, completedAt: new Date() })
    .where(eq(generationJobs.id, job.id))

  yield errorEvent('MAX_RETRIES_EXCEEDED', message, false)
  throw lastError
}
