import type { z } from 'zod'
import type { AIProvider } from '../../db/schema/enums.ts'

// Re-export so callers import AIProvider from one place.
export type { AIProvider }

// Provider-agnostic schema definition.
// Both OpenAI (response_format json_schema) and Anthropic (tool_use input_schema)
// accept JSON Schema Draft 7 objects — the same jsonSchema field is consumed by
// both adapters without transformation.
export interface StructuredOutputSchema {
  name:       string
  jsonSchema: Record<string, unknown>
  zodSchema:  z.ZodType
}

export interface StructuredCompletionParams {
  model:        string
  systemPrompt: string
  userMessage:  string
  schema:       StructuredOutputSchema
}

export interface StructuredCompletionResult {
  rawContent:   string   // unparsed JSON string returned by the model
  inputTokens:  number
  outputTokens: number
  model:        string   // actual model identifier returned by the provider
}

export interface StructuredOutputAdapter {
  readonly provider: AIProvider
  complete(params: StructuredCompletionParams): Promise<StructuredCompletionResult>
}
