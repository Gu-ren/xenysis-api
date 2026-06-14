import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { FounderUnderstanding, UnderstandingCategory } from '../../lib/contracts/founder-understanding.ts'
import type { SessionSummary } from '../../lib/contracts/session-summary.ts'
import type { ConfidenceBreakdown, ValidationGapSummary } from '../../lib/contracts/opportunity-assessment.ts'
import type { EvidenceRecordRow } from '../../lib/db/schema/understanding.ts'
import type { Startup } from '../../lib/db/schema/startups.ts'
import {
  UNDERSTANDING_CATEGORIES,
  CATEGORY_DISPLAY,
  EVIDENCE_STRENGTH_LEVELS,
  REQUIRED_CATEGORIES,
} from '../../lib/contracts/founder-understanding.ts'
import {
  renderConfidenceBreakdownPromptBlock,
} from '../../lib/evidence/confidence.ts'
import {
  renderValidationGapsPromptBlock,
} from '../../lib/evidence/gaps.ts'

export const PROMPT_VERSION = 'opportunity-v2.0' as const

// ── Constants ─────────────────────────────────────────────────────────────────
const PER_CATEGORY_CAP = 3
const TOTAL_CAP        = 30

// ── truncate ──────────────────────────────────────────────────────────────────
function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars - 1) + '…'
}

// ── strengthLabel ─────────────────────────────────────────────────────────────
function strengthLabel(strength: number): string {
  return EVIDENCE_STRENGTH_LEVELS[strength as keyof typeof EVIDENCE_STRENGTH_LEVELS] ?? 'Unknown'
}

// ── collapseRepetitiveRecords ─────────────────────────────────────────────────
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

    const representative = cluster[0]
    const maxStrength    = cluster.reduce((m, r) => Math.max(m, r.evidenceStrength), 1)
    const maxImpact      = cluster.reduce((m, r) => Math.max(m, r.confidenceImpact), 0)

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
function buildEvidenceQualitySummary(records: EvidenceRecordRow[]): string[] {
  const lines: string[] = ['=== EVIDENCE QUALITY SUMMARY (primary confidence calibration anchor) ===']

  if (records.length === 0) {
    lines.push('No evidence records available. All signals are founder-stated assumptions.')
    lines.push('Confidence generally should not exceed 25 given the complete absence of extracted evidence.')
    lines.push('')
    return lines
  }

  const maxStrengthByCategory = new Map<string, number>()
  for (const r of records) {
    const current = maxStrengthByCategory.get(r.category) ?? 0
    if (r.evidenceStrength > current) maxStrengthByCategory.set(r.category, r.evidenceStrength)
  }

  const requiredCats        = REQUIRED_CATEGORIES as readonly UnderstandingCategory[]
  const requiredStrengths   = requiredCats.map((cat) => maxStrengthByCategory.get(cat) ?? 1)
  const maxRequiredStrength = requiredStrengths.reduce((m, s) => Math.max(m, s), 1)
  const allStrengths        = Array.from(maxStrengthByCategory.values())
  const maxOverallStrength  = allStrengths.reduce((m, s) => Math.max(m, s), 1)
  const requiredAllWeak     = requiredStrengths.every((s) => s <= 2)
  const highQualityCount    = records.filter((r) => r.evidenceStrength >= 3).length

  lines.push(`Evidence records (after trimming): ${records.length}`)
  lines.push(`High-quality records (strength ≥ 3, customer conversations or better): ${highQualityCount} of ${records.length}`)
  lines.push(`Highest strength — required categories (problem/customer/solution): ${maxRequiredStrength}/6 (${strengthLabel(maxRequiredStrength)})`)
  lines.push(`Highest strength — all categories: ${maxOverallStrength}/6 (${strengthLabel(maxOverallStrength)})`)
  lines.push('')

  if (requiredAllWeak) {
    lines.push('  IMPORTANT: Required categories (problem/customer/solution) have only assumption-level')
    lines.push('  or anecdotal evidence. Consider reducing confidence by ~15 points.')
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
    '  - Pre-computed a deterministic confidence breakdown and validation gap list (see user message)',
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
    '  This is bounded by the quality of extracted evidence.',
    '  A great opportunity backed only by founder assumptions must score low here.',
    '  Anchor: use the computedScore in the PRE-COMPUTED CONFIDENCE BREAKDOWN section.',
    '  You may adjust by up to ±15 points using your synthesis judgment.',
    '  If you deviate by more than 10 points from computedScore, set adjustmentRationale in confidenceBreakdown.',
    '',
    'SCORE INDEPENDENCE — THIS IS CRITICAL:',
    '  A low confidenceScore MUST NOT automatically reduce opportunityScore.',
    '  opportunityScore evaluates the startup\'s potential if the thesis is correct.',
    '  confidenceScore evaluates how much evidence supports that thesis.',
    '',
    '  Valid and expected combinations:',
    '    opportunityScore: 90, confidenceScore: 20  — breakthrough idea, entirely unvalidated',
    '    opportunityScore: 35, confidenceScore: 85  — well-validated but fundamentally weak opportunity',
    '    opportunityScore: 70, confidenceScore: 70  — solid opportunity with good evidence',
    '',
    '=== SCORE BREAKDOWN (v2.0 REQUIRED) ===',
    '',
    'You must output scoreBreakdown with exactly these 5 sub-dimensions:',
    '',
    '  problemStrength      weight: 25  — severity and urgency of the problem',
    '  customerClarity      weight: 25  — specificity and reachability of target customer',
    '  marketPotential      weight: 20  — addressable market size and growth trajectory',
    '  competitiveAdvantage weight: 15  — moat, differentiation, and defensibility',
    '  founderFit           weight: 15  — domain expertise, network, and execution capability',
    '',
    'ARITHMETIC CONSTRAINT — CRITICAL:',
    '  opportunityScore MUST equal the weighted sum of scoreBreakdown dimensions (rounded to integer).',
    '  Formula: round( (problemStrength.score × 0.25) + (customerClarity.score × 0.25)',
    '                + (marketPotential.score × 0.20) + (competitiveAdvantage.score × 0.15)',
    '                + (founderFit.score × 0.15) )',
    '  Verify this before outputting. Adjust sub-dimension scores if needed to match.',
    '',
    'For each sub-dimension, assign:',
    '  score:     0-100 (your judgment for this dimension)',
    '  weight:    the fixed weight above (25/25/20/15/15)',
    '  rationale: 1-2 sentences explaining why this dimension scored this way',
    '  tier:      the assessmentTier of the primary category driving this dimension:',
    '             "validated" | "assumption_based" | "gap" | "unknown"',
    '',
    '=== CONFIDENCE BREAKDOWN (v2.0 REQUIRED) ===',
    '',
    'Output confidenceBreakdown using the pre-computed data from the user message:',
    '  categories:        copy the full per-category array from PRE-COMPUTED CONFIDENCE BREAKDOWN',
    '  strongCategories:  copy from pre-computed data',
    '  weakCategories:    copy from pre-computed data',
    '  missingCategories: copy from pre-computed data',
    '  computedScore:     copy the computedScore from pre-computed data',
    '  adjustmentRationale: include ONLY if your confidenceScore deviates > 10 pts from computedScore',
    '',
    '=== VALIDATION GAP SUMMARY (v2.0 REQUIRED) ===',
    '',
    'Output validationGapSummary verbatim from the PRE-COMPUTED VALIDATION GAPS section.',
    'Do not rewrite or omit any gaps. Copy gaps[], evidenceStrength, and overallGapRisk exactly.',
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
    'Schema version must be "2.0". No markdown fencing. No prose outside the JSON.',
    'executiveSummary: 2-4 sentences covering the core opportunity, biggest risk, and recommended action.',
  ].join('\n')
}

// ── buildUserMessage ──────────────────────────────────────────────────────────
export function buildUserMessage(params: {
  startup:              Startup
  founderMemory:        FounderMemory
  understanding:        FounderUnderstanding
  evidenceRecords:      EvidenceRecordRow[]
  preComputedConfidence: ConfidenceBreakdown
  preComputedGaps:      ValidationGapSummary
  latestSummary?:       SessionSummary
}): string {
  const {
    startup, founderMemory, understanding, evidenceRecords,
    preComputedConfidence, preComputedGaps, latestSummary,
  } = params
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
    const state   = understanding.categories[cat]
    const display = CATEGORY_DISPLAY[cat]
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

  // ── Validation gaps from understanding ───────────────────────────────────
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
  lines.push(...buildEvidenceQualitySummary(evidenceRecords))

  // ── Pre-computed confidence breakdown (v2.0 anchor) ──────────────────────
  lines.push(...renderConfidenceBreakdownPromptBlock(preComputedConfidence))

  // ── Pre-computed validation gaps (v2.0 — output verbatim) ────────────────
  lines.push(...renderValidationGapsPromptBlock(preComputedGaps))

  lines.push('Now produce the Opportunity Assessment JSON (schema version "2.0").')

  return lines.join('\n')
}
