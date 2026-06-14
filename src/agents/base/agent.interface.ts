import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { DB } from '../../lib/db/index.ts'
import type { AIProvider } from '../../lib/ai/adapters/index.ts'
import type { GenerationEvent } from './events.ts'

export interface AgentInput {
  userId:    string
  startupId: string
  jobId:     string
}

export interface AgentContext<TInput extends AgentInput> {
  input:     TInput
  db:        DB
  anthropic: Anthropic
  openai:    OpenAI
  // Injected by runner.ts from the generation_jobs row.
  // Agents use these to select the correct provider adapter — never hardcode a provider.
  model:     string
  provider:  AIProvider
}

export interface Agent<TInput extends AgentInput, TOutput> {
  readonly name:          string
  readonly promptVersion: string
  execute(ctx: AgentContext<TInput>): AsyncGenerator<GenerationEvent, TOutput>
}
