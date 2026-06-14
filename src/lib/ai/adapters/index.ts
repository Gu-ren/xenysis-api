import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { AIProvider, StructuredOutputAdapter } from './types.ts'
import { OpenAIStructuredAdapter }    from './openai.ts'
import { AnthropicStructuredAdapter } from './anthropic.ts'

export type { AIProvider, StructuredOutputAdapter, StructuredOutputSchema, StructuredCompletionParams, StructuredCompletionResult } from './types.ts'

// Factory: selects the adapter for the given provider.
// Adding a new provider requires: a new adapter file + one new case here.
export function getAdapter(
  provider:  AIProvider,
  openai:    OpenAI,
  anthropic: Anthropic,
): StructuredOutputAdapter {
  switch (provider) {
    case 'openai':    return new OpenAIStructuredAdapter(openai)
    case 'anthropic': return new AnthropicStructuredAdapter(anthropic)
    default: {
      const _exhaustive: never = provider
      throw new Error(`UNSUPPORTED_PROVIDER: ${_exhaustive}`)
    }
  }
}
