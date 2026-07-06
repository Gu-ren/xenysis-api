import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { AppError } from '../../middleware/errors.ts'

// BlueprintAgent, WorkspaceAgent — tool_use + tool_choice pattern
// Reads ANTHROPIC_API_KEY from env automatically
export const anthropic = new Anthropic()

// OpportunityAgent, Founder Session interactions — chat completions + JSON schema mode
// Lazy init: OpenAI throws at construction when OPENAI_API_KEY is missing, which
// would crash the server at import time before /health can respond.
let openaiClient: OpenAI | undefined

function createOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'OpenAI is not configured (OPENAI_API_KEY missing)',
      503,
    )
  }
  return new OpenAI({ apiKey })
}

export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    if (!openaiClient) openaiClient = createOpenAI()
    const value = Reflect.get(openaiClient, prop, receiver)
    return typeof value === 'function' ? value.bind(openaiClient) : value
  },
})
