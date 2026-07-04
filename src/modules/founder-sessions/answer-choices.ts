const CHOICES_OPEN = '<answer_choices>'
const CHOICES_CLOSE = '</answer_choices>'

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
export function parseAnswerChoices(content: string): { text: string; choices: string[] } {
  const match = content.match(
    new RegExp(`${CHOICES_OPEN}\\s*([\\s\\S]*?)\\s*${CHOICES_CLOSE}`, 'i'),
  )
  const text = stripAnswerChoicesBlock(content).trim()

  if (!match) return { text, choices: [] }

  const raw = match[1].trim()

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const choices = parsed
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, 4)
      return { text, choices }
    }
  } catch {
    // fall through to bullet parsing
  }

  const choices = raw
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4)

  return { text, choices }
}
