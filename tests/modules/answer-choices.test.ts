import { describe, it, expect } from 'vitest'
import { parseAnswerChoices, stripAnswerChoicesBlock } from '../../src/modules/founder-sessions/answer-choices.ts'

describe('parseAnswerChoices', () => {
  it('extracts JSON choices and strips the block from text', () => {
    const input = `Who is your primary customer?

<answer_choices>
["SMB finance teams", "Enterprise CFOs", "Freelance accountants"]
</answer_choices>`

    const { text, choices } = parseAnswerChoices(input)
    expect(text).toBe('Who is your primary customer?')
    expect(choices).toEqual(['SMB finance teams', 'Enterprise CFOs', 'Freelance accountants'])
  })

  it('falls back to bullet parsing when JSON is invalid', () => {
    const input = `What problem are you solving?

<answer_choices>
- Manual invoice tracking
- Late payment follow-ups
</answer_choices>`

    const { text, choices } = parseAnswerChoices(input)
    expect(text).toBe('What problem are you solving?')
    expect(choices).toEqual(['Manual invoice tracking', 'Late payment follow-ups'])
  })

  it('returns empty choices when block is absent', () => {
    const { text, choices } = parseAnswerChoices('Just a question with no choices.')
    expect(text).toBe('Just a question with no choices.')
    expect(choices).toEqual([])
  })
})

describe('stripAnswerChoicesBlock', () => {
  it('removes an incomplete choices block during streaming', () => {
    const partial = 'Question here?\n\n<answer_choices>\n["Option A"'
    expect(stripAnswerChoicesBlock(partial)).toBe('Question here?')
  })
})
