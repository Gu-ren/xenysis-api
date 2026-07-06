const CHOICES_OPEN = '<answer_choices>'
const CHOICES_CLOSE = '</answer_choices>'
const MAX_CHOICES = 3
const MAX_LABEL_LENGTH = 60

export interface AnswerChoice {
  label: string
  text: string
}

export const ANSWER_CHOICES_SCHEMA = {
  name: 'answer_choices',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      choices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            text:  { type: 'string' },
          },
          required: ['label', 'text'],
          additionalProperties: false,
        },
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ['choices'],
    additionalProperties: false,
  },
} as const

function truncateLabel(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_LABEL_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
}

export function normalizeAnswerChoices(raw: unknown[]): AnswerChoice[] {
  const choices: AnswerChoice[] = []

  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (!text) continue
      choices.push({ label: truncateLabel(text), text })
      continue
    }

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      if (!text) continue
      const label =
        typeof record.label === 'string' && record.label.trim()
          ? record.label.trim()
          : truncateLabel(text)
      choices.push({ label: truncateLabel(label), text })
    }
  }

  return choices.slice(0, MAX_CHOICES)
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function removeTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1')
}

/** Try multiple strategies to extract a JSON array from raw choices content. */
export function extractChoicesJson(raw: string): unknown[] | null {
  const cleaned = stripMarkdownFences(raw.trim())

  const attempts = [
    cleaned,
    removeTrailingCommas(cleaned),
  ]

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      if (Array.isArray(parsed)) return parsed
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as Record<string, unknown>).choices)
      ) {
        return (parsed as Record<string, unknown>).choices as unknown[]
      }
    } catch {
      // try next strategy
    }
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    for (const attempt of [arrayMatch[0], removeTrailingCommas(arrayMatch[0])]) {
      try {
        const parsed = JSON.parse(attempt) as unknown
        if (Array.isArray(parsed)) return parsed
      } catch {
        // try next
      }
    }
  }

  return null
}

/** Strip a complete or in-progress answer_choices block from streamed text. */
export function stripAnswerChoicesBlock(text: string): string {
  const withoutComplete = text.replace(
    new RegExp(`${CHOICES_OPEN}[\\s\\S]*?${CHOICES_CLOSE}`, 'gi'),
    '',
  )
  const openIdx = withoutComplete.indexOf(CHOICES_OPEN)
  if (openIdx !== -1) return withoutComplete.slice(0, openIdx).trimEnd()
  return withoutComplete.trimEnd()
}

/** Parse answer choices from a completed AI response. */
export function parseAnswerChoices(content: string): { text: string; choices: AnswerChoice[] } {
  const match = content.match(
    new RegExp(`${CHOICES_OPEN}\\s*([\\s\\S]*?)\\s*${CHOICES_CLOSE}`, 'i'),
  )
  const text = stripAnswerChoicesBlock(content).trim()

  if (!match) return { text, choices: [] }

  const raw = match[1].trim()
  const extracted = extractChoicesJson(raw)
  if (extracted) {
    return { text, choices: normalizeAnswerChoices(extracted) }
  }

  const bulletItems = raw
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)

  return { text, choices: normalizeAnswerChoices(bulletItems) }
}
