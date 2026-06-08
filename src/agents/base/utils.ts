import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { DB } from '../../lib/db/index.ts'
import { activityLog, aiUsageLog } from '../../lib/db/schema/index.ts'
import type { AiPurpose } from '../../lib/db/schema/enums.ts'

// ── Usage tracking ────────────────────────────────────────────────────────────

interface UsageRecord {
  model:        string
  inputTokens:  number
  outputTokens: number
}

// Pricing constants — update when either provider changes rates.
// Anthropic Claude Sonnet 4.6: $3.00 / $15.00 per 1M tokens (input / output)
// OpenAI GPT-4o: $2.50 / $10.00 per 1M tokens (input / output)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'gpt-4o':            { input: 2.50, output: 10.00 },
}

export function fromAnthropic(res: Anthropic.Message): UsageRecord {
  return {
    model:        res.model,
    inputTokens:  res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  }
}

export function fromOpenAI(res: OpenAI.Chat.ChatCompletion): UsageRecord {
  return {
    model:        res.model,
    inputTokens:  res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  }
}

export async function trackUsage(
  db: DB,
  params: {
    userId:           string
    startupId?:       string
    generationJobId?: string
    usage:            UsageRecord
    purpose:          AiPurpose
  },
): Promise<void> {
  const rates    = PRICING[params.usage.model] ?? { input: 3.00, output: 15.00 }
  const costUsd  = (
    (params.usage.inputTokens  / 1_000_000) * rates.input +
    (params.usage.outputTokens / 1_000_000) * rates.output
  ).toFixed(6)

  await db.insert(aiUsageLog).values({
    userId:          params.userId,
    startupId:       params.startupId,
    generationJobId: params.generationJobId,
    model:           params.usage.model,
    inputTokens:     params.usage.inputTokens,
    outputTokens:    params.usage.outputTokens,
    costUsd,
    purpose:         params.purpose,
  })
}

// ── Activity logging ──────────────────────────────────────────────────────────

export async function logActivity(
  db: DB,
  params: {
    userId:      string
    startupId?:  string
    type:        string
    description: string
    meta?:       Record<string, unknown>
  },
): Promise<void> {
  await db.insert(activityLog).values({
    userId:      params.userId,
    startupId:   params.startupId,
    type:        params.type,
    description: params.description,
    meta:        params.meta,
  })
}

// ── Token estimation (rough — used for adaptive summary trigger) ──────────────

export function estimateTokens(text: string): number {
  // ~4 characters per token is a reasonable approximation for English text
  return Math.ceil(text.length / 4)
}
