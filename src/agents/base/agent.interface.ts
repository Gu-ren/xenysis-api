import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { DB } from '../../lib/db/index.ts'
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
}

export interface Agent<TInput extends AgentInput, TOutput> {
  readonly name:          string
  readonly promptVersion: string
  execute(ctx: AgentContext<TInput>): AsyncGenerator<GenerationEvent, TOutput>
}
