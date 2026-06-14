import type OpenAI from 'openai'
import type { StructuredOutputAdapter, StructuredCompletionParams, StructuredCompletionResult } from './types.ts'

export class OpenAIStructuredAdapter implements StructuredOutputAdapter {
  readonly provider = 'openai' as const

  constructor(private readonly client: OpenAI) {}

  async complete(params: StructuredCompletionParams): Promise<StructuredCompletionResult> {
    const response = await this.client.chat.completions.create({
      model: params.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name:   params.schema.name,
          strict: true,
          schema: params.schema.jsonSchema,
        },
      },
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user',   content: params.userMessage  },
      ],
    })

    const choice = response.choices[0]
    if (!choice) throw new Error('OPENAI_NO_CHOICE: empty choices array in response')

    if (choice.finish_reason === 'content_filter') {
      throw new Error('CONTENT_FILTER: model refused the request — do not retry')
    }

    return {
      rawContent:   choice.message.content ?? '',
      inputTokens:  response.usage?.prompt_tokens     ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model:        response.model,
    }
  }
}
