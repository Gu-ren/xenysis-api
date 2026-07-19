import { describe, it, expect } from 'vitest'
import { requiresAnswerChoices } from '../../src/modules/founder-sessions/chat-prompt.ts'
import { EMPTY_UNDERSTANDING } from '../../src/lib/contracts/founder-understanding.ts'
import {
  parseAnswerChoices,
  stripAnswerChoicesBlock,
  normalizeAnswerChoices,
  extractChoicesJson,
} from '../../src/modules/founder-sessions/answer-choices.ts'
import { buildContextBlocks } from '../../src/modules/founder-sessions/answer-choices-fallback.ts'

describe('requiresAnswerChoices', () => {
  it('returns true when session is not complete', () => {
    expect(requiresAnswerChoices(EMPTY_UNDERSTANDING)).toBe(true)
  })

  it('returns false when session is complete', () => {
    expect(requiresAnswerChoices({ ...EMPTY_UNDERSTANDING, isComplete: true })).toBe(false)
  })
})

describe('buildContextBlocks grounding', () => {
  it('includes planned topic and latest founder message when provided', () => {
    const blocks = buildContextBlocks({
      questionText: 'What must-have features should the product deliver first?',
      startupName: 'Acme',
      weakestCategory: 'solution',
      sessionSummary: null,
      founderMemory: null,
      recentExchanges: [],
      plannedTopic: {
        category: 'solution',
        topicSlot: 'mechanism',
        depth: 'discover',
        mustElicit: 'what the product lets the user do — must-have features and outcomes',
        reason: 'test',
      },
      latestFounderMessage: 'Finance leads waste 5 days closing books in spreadsheets every month.',
    })
    const text = blocks.join('\n')
    expect(text).toContain('Planned topic')
    expect(text).toContain('Topic slot: mechanism')
    expect(text).toContain('must-have features and outcomes')
    expect(text).toContain('Finance leads waste 5 days')
    expect(text).toContain('Current question:')
  })

  it('falls back to focus area when planned topic is absent', () => {
    const blocks = buildContextBlocks({
      questionText: 'Who is the buyer?',
      startupName: 'Acme',
      weakestCategory: 'customer',
      sessionSummary: null,
      founderMemory: null,
      recentExchanges: [],
    })
    const text = blocks.join('\n')
    expect(text).toContain('Focus area:')
    expect(text).not.toContain('Planned topic')
  })
})

describe('extractChoicesJson', () => {
  it('parses markdown-fenced JSON array', () => {
    const raw = '```json\n[{"label":"A","text":"Answer A"}]\n```'
    const result = extractChoicesJson(raw)
    expect(result).toHaveLength(1)
  })

  it('parses JSON with trailing commas', () => {
    const raw = '[{"label":"A","text":"Answer A",},{"label":"B","text":"Answer B",},]'
    const result = extractChoicesJson(raw)
    expect(result).toHaveLength(2)
  })

  it('extracts choices from wrapper object', () => {
    const raw = '{"choices":[{"label":"A","text":"Answer A"},{"label":"B","text":"Answer B"},{"label":"C","text":"Answer C"}]}'
    const result = extractChoicesJson(raw)
    expect(result).toHaveLength(3)
  })
})

describe('normalizeAnswerChoices', () => {
  it('normalizes structured objects with label and text', () => {
    const choices = normalizeAnswerChoices([
      {
        label: 'SMB finance teams',
        text: 'Our primary buyer is a finance lead at a 20–100 person company still reconciling invoices in spreadsheets.',
      },
      {
        label: 'Enterprise CFOs',
        text: 'We target CFOs at mid-market firms with multi-entity accounting who need real-time visibility.',
      },
    ])

    expect(choices).toHaveLength(2)
    expect(choices[0]).toEqual({
      label: 'SMB finance teams',
      text: 'Our primary buyer is a finance lead at a 20–100 person company still reconciling invoices in spreadsheets.',
    })
  })

  it('falls back plain strings to label + text', () => {
    const choices = normalizeAnswerChoices([
      'Small business owners managing invoices manually',
    ])

    expect(choices).toHaveLength(1)
    expect(choices[0].text).toBe('Small business owners managing invoices manually')
    expect(choices[0].label).toBe('Small business owners managing invoices manually')
  })

  it('caps at 3 choices', () => {
    const choices = normalizeAnswerChoices([
      { label: 'A', text: 'Answer A' },
      { label: 'B', text: 'Answer B' },
      { label: 'C', text: 'Answer C' },
      { label: 'D', text: 'Answer D' },
    ])

    expect(choices).toHaveLength(3)
  })

  it('preserves long multi-sentence text in full', () => {
    const longText =
      'Our primary buyer is a finance lead at a 20–100 person company still reconciling invoices in spreadsheets. They feel the pain when month-end close takes 5+ days and errors create audit risk. The buying trigger is usually a failed audit or a new CFO mandate.'

    const choices = normalizeAnswerChoices([{ label: 'SMB finance teams', text: longText }])
    expect(choices[0].text).toBe(longText)
  })

  it('normalizes fallback schema wrapper with exactly 3 choices', () => {
    const raw = extractChoicesJson(
      '{"choices":[{"label":"A","text":"Draft A"},{"label":"B","text":"Draft B"},{"label":"C","text":"Draft C"}]}',
    )
    expect(raw).not.toBeNull()
    const choices = normalizeAnswerChoices(raw!)
    expect(choices).toHaveLength(3)
    expect(choices[2].label).toBe('C')
  })
})

describe('parseAnswerChoices', () => {
  it('extracts structured choices and strips the block from text', () => {
    const input = `Who is your primary customer?

<answer_choices>
[
  {
    "label": "SMB finance teams",
    "text": "Our primary buyer is a finance lead at a 20–100 person company still reconciling invoices in spreadsheets."
  },
  {
    "label": "Enterprise CFOs",
    "text": "We target CFOs at mid-market firms with multi-entity accounting who need real-time visibility."
  }
]
</answer_choices>`

    const { text, choices } = parseAnswerChoices(input)
    expect(text).toBe('Who is your primary customer?')
    expect(choices).toHaveLength(2)
    expect(choices[0].label).toBe('SMB finance teams')
    expect(choices[1].label).toBe('Enterprise CFOs')
  })

  it('recovers markdown-fenced JSON inside answer_choices block', () => {
    const input = `What is your revenue model?

<answer_choices>
\`\`\`json
[
  {"label": "SaaS subscription", "text": "We charge $99/month per seat for finance teams who need automated reconciliation."},
  {"label": "Usage-based", "text": "We bill per invoice processed at $0.50 each for high-volume AP teams."},
  {"label": "Enterprise license", "text": "Annual contracts starting at $50k for mid-market firms with multi-entity needs."}
]
\`\`\`
</answer_choices>`

    const { text, choices } = parseAnswerChoices(input)
    expect(text).toBe('What is your revenue model?')
    expect(choices).toHaveLength(3)
    expect(choices[0].label).toBe('SaaS subscription')
  })

  it('falls back to bullet parsing when JSON is invalid', () => {
    const input = `What problem are you solving?

<answer_choices>
- Manual invoice tracking
- Late payment follow-ups
</answer_choices>`

    const { text, choices } = parseAnswerChoices(input)
    expect(text).toBe('What problem are you solving?')
    expect(choices).toHaveLength(2)
    expect(choices[0].text).toBe('Manual invoice tracking')
  })

  it('returns empty choices when block is absent', () => {
    const { text, choices } = parseAnswerChoices('Just a question with no choices.')
    expect(text).toBe('Just a question with no choices.')
    expect(choices).toEqual([])
  })
})

describe('stripAnswerChoicesBlock', () => {
  it('removes an incomplete choices block during streaming', () => {
    const partial = 'Question here?\n\n<answer_choices>\n[{"label":"Option A"'
    expect(stripAnswerChoicesBlock(partial)).toBe('Question here?')
  })
})
