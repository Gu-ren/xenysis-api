import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  GAP_TO_BLUEPRINT_FIELDS,
} from '../../src/agents/blueprint-agent/prompt.ts'
import type { UnderstandingCategory } from '../../src/lib/contracts/founder-understanding.ts'

// ── buildSystemPrompt — mode and gap behavior (F5) ───────────────────────────

describe('buildSystemPrompt — mode behavior', () => {
  it('contains no hypothesis or fabrication preamble when validated + no gaps', () => {
    const prompt = buildSystemPrompt('validated', [])
    expect(prompt).not.toContain('HYPOTHESIS BLUEPRINT MODE')
    expect(prompt).not.toContain('FABRICATION PREVENTION')
    expect(prompt).not.toContain('[HYPOTHESIS — not founder-validated]')
  })

  it('includes the hypothesis preamble when blueprintMode is hypothesis', () => {
    const prompt = buildSystemPrompt('hypothesis', [])
    expect(prompt).toContain('HYPOTHESIS BLUEPRINT MODE')
    expect(prompt).toContain('idea-stage threshold')
    expect(prompt).not.toContain('FABRICATION PREVENTION')
  })

  it('includes fabrication prevention when gaps are present, even in validated mode', () => {
    const prompt = buildSystemPrompt('validated', ['pricing'])
    expect(prompt).not.toContain('HYPOTHESIS BLUEPRINT MODE')
    expect(prompt).toContain('FABRICATION PREVENTION')
    expect(prompt).toContain('[HYPOTHESIS — not founder-validated]')
  })

  it('includes both preamble and fabrication prevention when hypothesis + gaps', () => {
    const prompt = buildSystemPrompt('hypothesis', ['customer', 'pricing'])
    expect(prompt).toContain('HYPOTHESIS BLUEPRINT MODE')
    expect(prompt).toContain('FABRICATION PREVENTION')
  })

  it('defaults to validated + no gaps when called with no arguments', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).not.toContain('HYPOTHESIS BLUEPRINT MODE')
    expect(prompt).not.toContain('FABRICATION PREVENTION')
  })

  it('always includes the core system prompt sections regardless of mode', () => {
    for (const mode of ['validated', 'hypothesis'] as const) {
      const prompt = buildSystemPrompt(mode, [])
      expect(prompt).toContain('TWO-MODE GENERATION')
      expect(prompt).toContain('ASSEMBLY RULES')
      expect(prompt).toContain('GENERATION RULES')
      expect(prompt).toContain('OUTPUT FORMAT')
    }
  })
})

describe('buildSystemPrompt — gap-to-field mapping', () => {
  it('maps pricing gap to businessModel.revenueStreams', () => {
    const prompt = buildSystemPrompt('validated', ['pricing'])
    expect(prompt).toContain('businessModel.revenueStreams')
  })

  it('maps customer gap to customer.icp and customer.segments and personas', () => {
    const prompt = buildSystemPrompt('validated', ['customer'])
    expect(prompt).toContain('customer.icp')
    expect(prompt).toContain('customer.segments')
    expect(prompt).toContain('personas.personas')
  })

  it('maps solution gap to solution fields', () => {
    const prompt = buildSystemPrompt('validated', ['solution'])
    expect(prompt).toContain('solution.productDescription')
    expect(prompt).toContain('solution.coreCapabilities')
  })

  it('maps market gap to overview.targetMarketSummary', () => {
    const prompt = buildSystemPrompt('validated', ['market'])
    expect(prompt).toContain('overview.targetMarketSummary')
  })

  it('maps competition gap to problem.currentAlternatives and solution.unfairAdvantage', () => {
    const prompt = buildSystemPrompt('validated', ['competition'])
    expect(prompt).toContain('problem.currentAlternatives')
    expect(prompt).toContain('solution.unfairAdvantage')
  })

  it('maps risks gap to risks.risks', () => {
    const prompt = buildSystemPrompt('validated', ['risks'])
    expect(prompt).toContain('risks.risks')
  })

  it('maps problem gap to problem.statement and problem.painPoints', () => {
    const prompt = buildSystemPrompt('validated', ['problem'])
    expect(prompt).toContain('problem.statement')
    expect(prompt).toContain('problem.painPoints')
  })

  it('includes all mapped fields when multiple gaps are present', () => {
    const prompt = buildSystemPrompt('validated', ['pricing', 'customer', 'market'])
    expect(prompt).toContain('businessModel.revenueStreams')
    expect(prompt).toContain('customer.icp')
    expect(prompt).toContain('overview.targetMarketSummary')
  })

  it('prefix rule instructions are present when gaps exist', () => {
    const prompt = buildSystemPrompt('validated', ['pricing'])
    expect(prompt).toContain('START of the string value')
    expect(prompt).toContain('Do NOT omit or restructure the field')
    expect(prompt).toContain('Do NOT apply the prefix to fields NOT listed')
  })
})

// ── GAP_TO_BLUEPRINT_FIELDS — coverage check ─────────────────────────────────

describe('GAP_TO_BLUEPRINT_FIELDS', () => {
  const mappedCategories = Object.keys(GAP_TO_BLUEPRINT_FIELDS) as UnderstandingCategory[]

  it('has at least one field mapped for each key category', () => {
    for (const cat of mappedCategories) {
      const fields = GAP_TO_BLUEPRINT_FIELDS[cat]
      expect(fields, `${cat} should have at least one field`).toBeDefined()
      expect(fields!.length, `${cat} should have at least one field`).toBeGreaterThan(0)
    }
  })

  it('covers all eight understanding categories', () => {
    const expectedCategories: UnderstandingCategory[] = [
      'problem', 'customer', 'solution', 'market', 'pricing',
      'competition', 'risks', 'founder_fit',
    ]
    for (const cat of expectedCategories) {
      expect(mappedCategories, `${cat} should be in the mapping`).toContain(cat)
    }
  })

  it('all mapped field paths are non-empty strings', () => {
    for (const [cat, fields] of Object.entries(GAP_TO_BLUEPRINT_FIELDS) as [UnderstandingCategory, string[]][]) {
      for (const field of fields) {
        expect(typeof field, `${cat} field should be a string`).toBe('string')
        expect(field.trim().length, `${cat} field should not be empty`).toBeGreaterThan(0)
      }
    }
  })
})
