import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { FounderUnderstanding, UnderstandingCategory } from '../../lib/contracts/founder-understanding.ts'
import type { SessionSummary } from '../../lib/contracts/session-summary.ts'
import type { EvidenceRecordRow } from '../../lib/db/schema/understanding.ts'
import type { Startup } from '../../lib/db/schema/startups.ts'
import {
  UNDERSTANDING_CATEGORIES,
  CATEGORY_DISPLAY,
  EVIDENCE_STRENGTH_LEVELS,
  REQUIRED_CATEGORIES,
} from '../../lib/contracts/founder-understanding.ts'

export const PROMPT_VERSION = 'opportunity-v1.0' as const

// ── Constants ─────────────────────────────────────────────────────────────────
const PER_CATEGORY_CAP = 3
const TOTAL_CAP        = 30

// ── truncate ──────────────────────────────────────────────────────────────────
// Enforces a character budget on any string injected into the prompt.
// Appends '…' so readers know the value was cut, not missing.
function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars - 1) + '…'
}

// ── strengthLabel ─────────────────────────────────────────────────────────────
// Safe lookup into EVIDENCE_STRENGTH_LEVELS for a raw number from EvidenceRecordRow.
function strengthLabel(strength: number): string {
  return EVIDENCE_STRENGTH_LEVELS[strength as keyof typeof EVIDENCE_STRENGTH_LEVELS] ?? 'Unknown'
}

// ── collapseRepetitiveRecords ─────────────────────────────────────────────────
// Within a single-category bucket, clusters records by normalized evidence text.
// Clusters of size > 1 are collapsed into a single synthetic record:
//   evidence = "N independent signals: <original text>"
//   evidenceStrength = max of the cluster
//   noveltySignal = 'new'  (collapsed signal is no longer repetitive noise)
// Single records pass through unchanged.
// Repeated evidence is a validation signal — collapse, do not discard.
function collapseRepetitiveRecords(bucket: EvidenceRecordRow[]): EvidenceRecordRow[] {
  const clusters = new Map<string, EvidenceRecordRow[]>()

  for (const r of bucket) {
    const key = r.evidence.toLowerCase().replace(/\s+/g, ' ').trim()
    const cluster = clusters.get(key) ?? []
    cluster.push(r)
    clusters.set(key, cluster)
  }

  const result: EvidenceRecordRow[] = []

  for (const [, cluster] of clusters) {
    if (cluster.length === 1) {
      result.push(cluster[0])
      continue
    }

    const representative   = cluster[0]
    const maxStrength      = cluster.reduce((m, r) => Math.max(m, r.evidenceStrength), 1)
    const maxImpact        = cluster.reduce((m, r) => Math.max(m, r.confidenceImpact), 0)

    result.push({
      ...representative,
      evidence:         `${cluster.length} independent signals: ${representative.evidence}`,
      evidenceStrength: maxStrength,
      confidenceImpact: maxImpact,
      noveltySignal:    'new',
    })
  }

  return result
}

// ── trimEvidenceRecords ───────────────────────────────────────────────────────
// Token-budget protection for evidence_records injected into the prompt.
//
// Strategy:
//   1. Group records by category.
//   2. Collapse near-duplicate records within each category (repeated = signal, not noise).
//   3. Sort by evidenceStrength DESC, then confidenceImpact DESC.
//   4. Keep top PER_CATEGORY_CAP per category.
//   5. Hard cap total at TOTAL_CAP, strongest records first across all categories.
export function trimEvidenceRecords(records: EvidenceRecordRow[]): EvidenceRecordRow[] {
  const byCategory = new Map<string, EvidenceRecordRow[]>()
  for (const r of records) {
    const bucket = byCategory.get(r.category) ?? []
    bucket.push(r)
    byCategory.set(r.category, bucket)
  }

  const output: EvidenceRecordRow[] = []

  for (const [, bucket] of byCategory) {
    const collapsed = collapseRepetitiveRecords(bucket)

    const sorted = [...collapsed].sort((a, b) => {
      if (b.evidenceStrength !== a.evidenceStrength) return b.evidenceStrength - a.evidenceStrength
      return b.confidenceImpact - a.confidenceImpact
    })

    output.push(...sorted.slice(0, PER_CATEGORY_CAP))
  }

  return output
    .sort((a, b) => b.evidenceStrength - a.evidenceStrength)
    .slice(0, TOTAL_CAP)
}

// ── renderEvidenceSection ─────────────────────────────────────────────────────
// Formats the trimmed evidence records into a grouped, readable prompt block.
// Records are rendered in UNDERSTANDING_CATEGORIES order for consistency.
function renderEvidenceSection(records: EvidenceRecordRow[]): string[] {
  if (records.length === 0) return []

  const grouped = new Map<string, EvidenceRecordRow[]>()
  for (const r of records) {
    const bucket = grouped.get(r.category) ?? []
    bucket.push(r)
    grouped.set(r.category, bucket)
  }

  const lines: string[] = ['=== EVIDENCE RECORDS (curated — highest quality first per category) ===']

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const bucket = grouped.get(cat)
    if (!bucket || bucket.length === 0) continue

    lines.push(`  ${CATEGORY_DISPLAY[cat].label}:`)
    for (const r of bucket) {
      lines.push(`    [${strengthLabel(r.evidenceStrength)}] ${truncate(r.evidence, 200)}`)
    }
  }

  lines.push('')
  return lines
}

// ── buildEvidenceQualitySummary ───────────────────────────────────────────────
// Derives confidence calibration guidance from raw EvidenceRecordRow[] data.
// Anchored to what was literally extracted from conversation — not the
// interpretation layer in FounderUnderstanding.category_evidence_strength.
function buildEvidenceQualitySummary(records: EvidenceRecordRow[]): string[] {
  const lines: string[] = ['=== EVIDENCE QUALITY SUMMARY (primary confidence calibration anchor) ===']

  if (records.length === 0) {
    lines.push('No evidence records available. All signals are founder-stated assumptions.')
    lines.push('Confidence generally should not exceed 25 given the complete absence of extracted evidence.')
    lines.push('')
    return lines
  }

  // Per-category max strength derived from raw records.
  const maxStrengthByCategory = new Map<string, number>()
  for (const r of records) {
    const current = maxStrengthByCategory.get(r.category) ?? 0
    if (r.evidenceStrength > current) maxStrengthByCategory.set(r.category, r.evidenceStrength)
  }

  const requiredCats         = REQUIRED_CATEGORIES as readonly UnderstandingCategory[]
  const requiredStrengths    = requiredCats.map((cat) => maxStrengthByCategory.get(cat) ?? 1)
  const maxRequiredStrength  = requiredStrengths.reduce((m, s) => Math.max(m, s), 1)
  const allStrengths         = Array.from(maxStrengthByCategory.values())
  const maxOverallStrength   = allStrengths.reduce((m, s) => Math.max(m, s), 1)
  const requiredAllWeak      = requiredStrengths.every((s) => s <= 2)
  const highQualityCount     = records.filter((r) => r.evidenceStrength >= 3).length

  lines.push(`Evidence records (after trimming): ${records.length}`)
  lines.push(`High-quality records (strength ≥ 3, customer conversations or better): ${highQualityCount} of ${records.length}`)
  lines.push(`Highest strength — required categories (problem/customer/solution): ${maxRequiredStrength}/6 (${strengthLabel(maxRequiredStrength)})`)
  lines.push(`Highest strength — all categories: ${maxOverallStrength}/6 (${strengthLabel(maxOverallStrength)})`)
  lines.push('')
  lines.push('Soft confidence ceilings (calibration guidance — apply judgment, not hard arithmetic):')

  if (maxOverallStrength <= 1) {
    lines.push('  All evidence is founder assumption. Confidence generally should not exceed 25.')
    lines.push('  No external signal exists to anchor the assessment.')
  } else if (maxOverallStrength === 2) {
    lines.push('  Strongest evidence is anecdotal observation. Confidence generally should not exceed 40.')
    lines.push('  Pattern recognition is present but no structured validation has occurred.')
  } else if (maxOverallStrength === 3) {
    lines.push('  Founder has held customer conversations. Confidence generally should not exceed 60.')
    lines.push('  Signals are directional but not yet systematically tested.')
  } else if (maxOverallStrength === 4) {
    lines.push('  Structured customer interviews conducted. Confidence generally should not exceed 78.')
  } else if (maxOverallStrength === 5) {
    lines.push('  Paying customers present. Confidence can reach 90+ if evidence is broad and consistent.')
  } else {
    lines.push('  Usage or revenue data available. High confidence is warranted when evidence is consistent.')
  }

  if (requiredAllWeak) {
    lines.push('')
    lines.push('  IMPORTANT: Required categories (problem/customer/solution) have only assumption-level')
    lines.push('  or anecdotal evidence from the record set. Consider reducing confidence by ~15 points.')
    lines.push('  The core thesis has not been tested against external reality.')
  }

  lines.push('')
  return lines
}

// ── buildSystemPrompt ─────────────────────────────────────────────────────────
export function buildSystemPrompt(): string {
  return [
    'You are a senior startup investment analyst with deep expertise in early-stage ventures.',
    'Your task is to produce a structured Opportunity Assessment from a founder conversation pipeline.',
    '',
    '=== YOUR ROLE ===',
    'You receive pre-processed signals — not raw transcripts. The pipeline has already:',
    '  - Extracted and merged narrative memory across all conversation turns',
    '  - Scored per-category confidence (0-100) and evidence strength (1-6)',
    '  - Identified validation gaps (categories the founder confirmed have no external evidence)',
    '  - Curated and collapsed evidence records by quality and novelty',
    '',
    'Your job is synthesis, not extraction. Judge the opportunity using all available signals.',
    '',
    '=== TWO-SCORE MODEL ===',
    '',
    'OPPORTUNITY SCORE (0-100):',
    '  Measures the inherent quality of this market + problem + solution.',
    '  Judge potential independently of how much the founder has validated.',
    '  A breakthrough idea with zero validation can score 85 here.',
    '  Drivers: problem severity, market size, solution differentiation, competitive defensibility.',
    '  Core question: "If this thesis is correct, how large and valuable is the opportunity?"',
    '',
    'CONFIDENCE SCORE (0-100):',
    '  Measures epistemic trust in the assessment — how much to believe the opportunityScore.',
    '  This is not a quality score. It is bounded by the quality of extracted evidence.',
    '  A great opportunity backed only by founder assumptions must score low here.',
    '  Drivers: strength of extracted evidence records, breadth of validated categories,',
    '    presence of external signals (customer conversations, paying customers, revenue data).',
    '  Core question: "How much should I trust this assessment given the evidence?"',
    '',
    'SCORE INDEPENDENCE — THIS IS CRITICAL:',
    '  A low confidenceScore MUST NOT automatically reduce opportunityScore.',
    '  opportunityScore evaluates the startup\'s potential if the thesis is correct.',
    '  confidenceScore evaluates how much evidence supports that thesis.',
    '  Both scores carry real independent information. Do not collapse them into one signal.',
    '',
    '  Valid and expected combinations:',
    '    opportunityScore: 90, confidenceScore: 20  — breakthrough idea, entirely unvalidated',
    '    opportunityScore: 35, confidenceScore: 85  — well-validated but fundamentally weak opportunity',
    '    opportunityScore: 70, confidenceScore: 70  — solid opportunity with good evidence',
    '',
    'CONFIDENCE CALIBRATION (soft guidance — apply judgment, not hard arithmetic):',
    '  All evidence is founder assumption (strength ≤ 1)  → confidence generally should not exceed 25',
    '  Strongest evidence is anecdotal (strength 2)       → confidence generally should not exceed 40',
    '  Strongest evidence is customer conversations (3)   → confidence generally should not exceed 60',
    '  Strongest evidence is structured interviews (4)    → confidence generally should not exceed 78',
    '  Paying customers present (strength 5)              → confidence can reach 90+',
    '  Usage or revenue data (strength 6)                 → high confidence is warranted',
    '',
    '  If required categories (problem/customer/solution) are all assumption or anecdotal,',
    '  consider reducing confidence by a further ~15 points — core thesis is untested.',
    '',
    '  Use the Evidence Quality Summary at the bottom of the user message as your',
    '  primary calibration anchor. It is derived from raw evidence records, not interpretations.',
    '',
    '=== SUB-DIMENSION SCORING ===',
    '',
    'marketPotential.score: Addressable market size and growth trajectory.',
    '  Use market_signals, industry, and any TAM/SAM/SOM data in the founder memory.',
    '',
    'founderFit.score: How well-positioned is this founder to execute and win?',
    '  Use domain expertise signals, customer relationships, and execution track record.',
    '',
    'competitiveAdvantage: What is the moat and how defensible is it?',
    '  Use competitive_advantages, named_competitors, and solution differentiation signals.',
    '',
    '=== VALIDATION PLAN RULES ===',
    'Each step MUST target a specific gap or weak category — no generic steps.',
    'Assign priority 1-2 steps to validation gaps (categories with no external evidence).',
    'Every step needs: a concrete action, a measurable successCriteria, realistic timeline.',
    '',
    '=== KEY RISKS RULES ===',
    'Every risk MUST include a mitigation. Risk without guidance is not useful output.',
    'Tie each risk to an UnderstandingCategory so the UI can link it to confidence state.',
    'Order by severity descending. Validation gaps are high-probability risks — include them.',
    '',
    '=== RECOMMENDATION LOGIC ===',
    '  proceed:               Strong opportunity + validated across required categories.',
    '  proceed_with_caution:  Good opportunity but material risks need active management.',
    '  validate_first:        Promising thesis but critical assumptions are unvalidated.',
    '                         Default for early-stage. Prefer over "proceed" when uncertain.',
    '  pivot:                 Core thesis is questionable; directional change is advisable.',
    '  pass:                  Fundamental weakness in opportunity or severe founder-fit mismatch.',
    '',
    '=== OUTPUT ===',
    'Return a single JSON object matching the provided schema. All fields required.',
    'No markdown fencing. No prose outside the JSON.',
    'executiveSummary: 2-4 sentences covering the core opportunity, biggest risk, and recommended action.',
  ].join('\n')
}

// ── buildUserMessage ──────────────────────────────────────────────────────────
// Character budgets are enforced on every string field via truncate().
// Evidence records are expected pre-trimmed by trimEvidenceRecords().
export function buildUserMessage(params: {
  startup:         Startup
  founderMemory:   FounderMemory
  understanding:   FounderUnderstanding
  evidenceRecords: EvidenceRecordRow[]
  latestSummary?:  SessionSummary
}): string {
  const { startup, founderMemory, understanding, evidenceRecords, latestSummary } = params
  const lines: string[] = []

  // ── Startup context ───────────────────────────────────────────────────────
  lines.push('=== STARTUP CONTEXT ===')
  lines.push(`Name: ${truncate(startup.name, 120)}`)
  if (startup.description)    lines.push(`Description: ${truncate(startup.description, 300)}`)
  if (startup.category)       lines.push(`Industry: ${truncate(startup.category, 80)}`)
  if (startup.lifecycleStage) lines.push(`Stage: ${startup.lifecycleStage}`)
  lines.push('')

  // ── Founder memory (narrative) ────────────────────────────────────────────
  lines.push('=== FOUNDER MEMORY (extracted and merged from full conversation) ===')

  if (founderMemory.one_sentence_pitch) {
    lines.push(`Pitch: ${truncate(founderMemory.one_sentence_pitch, 250)}`)
  }
  if (founderMemory.problem) {
    lines.push(`Problem: ${truncate(founderMemory.problem, 400)}`)
  }
  if (founderMemory.customer) {
    lines.push(`Customer: ${truncate(founderMemory.customer, 250)}`)
  }
  if (founderMemory.business_model) {
    lines.push(`Business model: ${truncate(founderMemory.business_model, 180)}`)
  }
  if (founderMemory.pricing_model) {
    lines.push(`Pricing model: ${truncate(founderMemory.pricing_model, 180)}`)
  }
  if (founderMemory.industry) {
    lines.push(`Industry (extracted): ${truncate(founderMemory.industry, 80)}`)
  }

  if (founderMemory.market_signals.length > 0) {
    lines.push('Market signals:')
    founderMemory.market_signals.forEach((s) => lines.push(`  - ${truncate(s, 160)}`))
  }

  if (founderMemory.competitive_advantages.length > 0) {
    lines.push('Competitive advantages:')
    founderMemory.competitive_advantages.forEach((a) => lines.push(`  - ${truncate(a, 160)}`))
  }

  if (founderMemory.named_competitors.length > 0) {
    const competitorList = founderMemory.named_competitors
      .map((c) => truncate(c, 80))
      .join(', ')
    lines.push(`Named competitors: ${competitorList}`)
  }

  if (founderMemory.assumptions.length > 0) {
    lines.push('Key assumptions:')
    founderMemory.assumptions.forEach((a) => lines.push(`  - ${truncate(a, 160)}`))
  }

  if (founderMemory.risks.length > 0) {
    lines.push('Stated risks:')
    founderMemory.risks.forEach((r) => lines.push(`  - ${truncate(r, 160)}`))
  }

  if (founderMemory.key_insights.length > 0) {
    lines.push('Key insights:')
    founderMemory.key_insights.forEach((i) => lines.push(`  - ${truncate(i, 250)}`))
  }

  lines.push('')

  // ── Session summary (supplemental) ───────────────────────────────────────
  // Carries context that may have been compressed out of the memory pipeline.
  if (latestSummary) {
    lines.push('=== SESSION SUMMARY (supplemental context) ===')

    if (latestSummary.problem) {
      lines.push(`Problem (summary): ${truncate(latestSummary.problem, 300)}`)
    }
    if (latestSummary.target_customer) {
      lines.push(`Customer (summary): ${truncate(latestSummary.target_customer, 250)}`)
    }
    if (latestSummary.business_model) {
      lines.push(`Business model (summary): ${truncate(latestSummary.business_model, 180)}`)
    }

    if (latestSummary.assumptions.length > 0) {
      lines.push('Assumptions (summary):')
      latestSummary.assumptions.forEach((a) => lines.push(`  - ${truncate(a, 160)}`))
    }

    if (latestSummary.risks.length > 0) {
      lines.push('Risks (summary):')
      latestSummary.risks.forEach((r) => lines.push(`  - ${truncate(r, 160)}`))
    }

    if (latestSummary.open_questions.length > 0) {
      lines.push('Open questions:')
      latestSummary.open_questions.forEach((q) => lines.push(`  - ${truncate(q, 160)}`))
    }

    lines.push('')
  }

  // ── FounderUnderstanding per-category state ───────────────────────────────
  lines.push('=== UNDERSTANDING STATE ===')
  lines.push(`Overall confidence: ${understanding.overallConfidence}%`)
  lines.push(`Session complete: ${understanding.isComplete}`)
  lines.push('')

  for (const cat of UNDERSTANDING_CATEGORIES as readonly UnderstandingCategory[]) {
    const state    = understanding.categories[cat]
    const display  = CATEGORY_DISPLAY[cat]
    const required = display.required ? ' [REQUIRED]' : ''
    const gapTag   = state.validationStatus === 'explicitly_unvalidated'
      ? ' *** VALIDATION GAP ***'
      : ''

    lines.push(`  ${display.label}${required}${gapTag}`)
    lines.push(
      `    Confidence: ${state.confidence}%  |  ` +
      `Strength: ${state.evidenceStrength}/6 (${strengthLabel(state.evidenceStrength)})  |  ` +
      `Tier: ${state.assessmentTier}`,
    )

    if (state.evidence.length > 0) {
      state.evidence.forEach((e) => lines.push(`    • ${truncate(e, 160)}`))
    }
  }

  lines.push('')

  // ── Validation gaps ───────────────────────────────────────────────────────
  const validationGaps = understanding.validationGaps ?? []
  if (validationGaps.length > 0) {
    lines.push('=== VALIDATION GAPS (founder confirmed no external evidence) ===')
    lines.push('Assign the highest-priority validationPlan steps to these categories.')
    validationGaps.forEach((cat) => {
      const display = CATEGORY_DISPLAY[cat]
      const conf    = understanding.categories[cat].confidence
      lines.push(`  - ${display.label} (${conf}% confidence) — ${display.description}`)
    })
    lines.push('')
  }

  // ── Completion warnings (weak supporting categories) ──────────────────────
  if (understanding.warnings.length > 0) {
    lines.push('=== LOW-CONFIDENCE SUPPORTING AREAS (generate risks for these) ===')
    understanding.warnings.forEach((w) => {
      lines.push(
        `  - ${CATEGORY_DISPLAY[w.category].label}: ${w.confidence}% ` +
        `(${strengthLabel(w.evidenceStrength)})`,
      )
    })
    lines.push('')
  }

  // ── Evidence records (pre-trimmed) ────────────────────────────────────────
  lines.push(...renderEvidenceSection(evidenceRecords))

  // ── Evidence quality summary (confidence calibration anchor) ─────────────
  // Derived from raw EvidenceRecordRow[] — not the interpretation layer.
  lines.push(...buildEvidenceQualitySummary(evidenceRecords))

  lines.push('Now produce the Opportunity Assessment JSON.')

  return lines.join('\n')
}
