import type Anthropic from '@anthropic-ai/sdk'
import type { StructuredOutputAdapter, StructuredCompletionParams, StructuredCompletionResult } from './types.ts'

export class AnthropicStructuredAdapter implements StructuredOutputAdapter {
  readonly provider = 'anthropic' as const

  constructor(private readonly client: Anthropic) {}

  async complete(params: StructuredCompletionParams): Promise<StructuredCompletionResult> {
    const response = await this.client.messages.create({
      model:      params.model,
      max_tokens: 4096,
      system:     params.systemPrompt,
      tools: [{
        name:        params.schema.name,
        description: `Generate a structured ${params.schema.name} output`,
        // Tool.InputSchema accepts [k: string]: unknown — jsonSchema spreads cleanly.
        input_schema: {
          type: 'object' as const,
          ...params.schema.jsonSchema,
        },
      }],
      tool_choice: { type: 'tool', name: params.schema.name },
      messages:    [{ role: 'user', content: params.userMessage }],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('ANTHROPIC_NO_TOOL_USE: expected tool_use block in response')
    }

    return {
      rawContent:   JSON.stringify(toolBlock.input),
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model:        response.model,
    }
  }
}
