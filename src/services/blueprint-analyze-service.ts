import type OpenAI from 'openai'
import { BlueprintContentSchema } from '../lib/contracts/blueprint.ts'
import type { BlueprintContent } from '../lib/contracts/blueprint.ts'
import { deepMerge } from './blueprint-merge.ts'

export interface AnalyzeChangesResult {
  summary: string
  rationale: string
  suggestion: Partial<BlueprintContent> | null
  previewContent: BlueprintContent | null
}

export async function analyzeBlueprintChanges(
  openai: OpenAI,
  previous: BlueprintContent,
  draft: BlueprintContent,
): Promise<AnalyzeChangesResult> {
  const response = await openai.chat.completions.create({
    model:           'gpt-4o',
    response_format: { type: 'json_object' },
    max_tokens:      4096,
    messages: [
      {
        role: 'system',
        content: `You are a product-minded startup advisor reviewing founder edits to a startup blueprint.
Compare previous vs draft. Return JSON:
{
  "summary": "1-2 sentence summary of what changed",
  "rationale": "why your suggestion improves clarity/consistency (CEO language, no tech stack)",
  "suggestion": { ...only top-level section keys to improve, each a COMPLETE section object... } | null
}
If the draft is already strong, set suggestion to null.
Preserve enums and field limits. Include customSections/customBlocks when they changed.
Return ONLY JSON.`,
      },
      {
        role: 'user',
        content: JSON.stringify({ previous, draft }),
      },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  let parsed: { summary?: string; rationale?: string; suggestion?: Partial<BlueprintContent> | null }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return {
      summary: 'Could not analyze changes.',
      rationale: 'The model returned an unreadable response. You can still save your edits.',
      suggestion: null,
      previewContent: null,
    }
  }

  const suggestion = parsed.suggestion ?? null
  let previewContent: BlueprintContent | null = null
  if (suggestion && typeof suggestion === 'object') {
    const merged = deepMerge(draft, {
      ...suggestion,
      _schemaVersion: draft._schemaVersion,
    }) as BlueprintContent
    const validated = BlueprintContentSchema.safeParse(merged)
    if (validated.success) {
      previewContent = validated.data
    }
  }

  return {
    summary:   typeof parsed.summary === 'string' ? parsed.summary : 'Reviewed your edits.',
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    suggestion: previewContent ? suggestion : null,
    previewContent,
  }
}
