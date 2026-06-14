import {
  UNDERSTANDING_CATEGORIES,
  REQUIRED_CATEGORIES,
  CATEGORY_DISPLAY,
  EVIDENCE_STRENGTH_LEVELS,
  type FounderUnderstanding,
  type UnderstandingCategory,
  type EvidenceStrength,
} from '../contracts/founder-understanding.ts'
import type { ValidationGap, ValidationGapSummary } from '../contracts/opportunity-assessment.ts'

// ── Gap priority ──────────────────────────────────────────────────────────────
// Lower number = higher urgency.
//   1: gap (no hypothesis) in a required category    → investor-blocking
//   2: assumption_based in a required category       → high risk
//   3: gap in a supporting category                  → medium risk
//   4: assumption_based in a supporting category     → lower risk
//   5: unknown (never discussed)                     → informational
function gapPriority(cat: UnderstandingCategory, tier: string): number | null {
  const isRequired = (REQUIRED_CATEGORIES as readonly UnderstandingCategory[]).includes(cat)

  if (tier === 'validated') return null   // no gap

  if (tier === 'gap')              return isRequired ? 1 : 3
  if (tier === 'assumption_based') return isRequired ? 2 : 4
  if (tier === 'unknown')          return 5

  return null
}

// ── Static gap templates ──────────────────────────────────────────────────────
// Human-readable descriptions and suggested actions keyed by category and tier.

function gapDescription(cat: UnderstandingCategory, tier: string): string {
  const label = CATEGORY_DISPLAY[cat].label

  if (tier === 'gap') {
    const descriptions: Partial<Record<UnderstandingCategory, string>> = {
      problem:     'No clear articulation of the problem exists — the core pain point is undefined.',
      customer:    'Target customer is unknown — no segment, persona, or buyer has been identified.',
      solution:    'No solution approach defined — value proposition is absent.',
      market:      'Market size is unresearched — no TAM, SAM, or SOM estimate exists.',
      pricing:     'Pricing model is undefined — no revenue structure has been considered.',
      competition: 'Competitive landscape is unexplored — no alternatives or substitutes identified.',
      risks:       'Key risks are unacknowledged — no execution or market risks have been considered.',
      founder_fit: 'Founder fit is unassessed — domain expertise and execution ability are unknown.',
    }
    return descriptions[cat] ?? `${label} has not been defined or discussed.`
  }

  if (tier === 'assumption_based') {
    const descriptions: Partial<Record<UnderstandingCategory, string>> = {
      problem:     'Problem is founder-stated assumption — no customer validation or external signal.',
      customer:    'Customer segment is hypothesized — no interviews, conversations, or real user signal.',
      solution:    'Solution is conceptual — no prototype, feedback, or external validation.',
      market:      'Market sizing is estimated without external data — TAM figures are unverified.',
      pricing:     'Pricing is assumed — no willingness-to-pay signal or competitive benchmarking.',
      competition: 'Competitive analysis is informal — based on founder perception, not structured research.',
      risks:       'Risks are self-identified assumptions — no external stress testing has occurred.',
      founder_fit: 'Founder fit is self-assessed — domain expertise claims are unverified externally.',
    }
    return descriptions[cat] ?? `${label} is based on founder assumptions with no external validation.`
  }

  return `${label} has not been discussed yet.`
}

function riskIfUnfilled(cat: UnderstandingCategory, tier: string): string {
  const prefix =
    tier === 'gap'             ? 'No hypothesis exists. ' :
    tier === 'assumption_based' ? 'Hypothesis exists but is unvalidated. ' :
    ''

  const risks: Partial<Record<UnderstandingCategory, string>> = {
    problem:     'Building a solution to a problem that does not exist or is not urgent enough to pay for.',
    customer:    'Targeting the wrong segment — wasted GTM spend and inability to close early customers.',
    solution:    'Shipping a product that does not match what the market needs or expects.',
    market:      'Misallocation of resources if the market is too small to support a venture-scale outcome.',
    pricing:     'Revenue model failure — pricing too high to convert or too low to sustain the business.',
    competition: 'Entering a market blind — missing established players or incumbents with distribution advantage.',
    risks:       'Unacknowledged execution risks can derail the company at a critical juncture.',
    founder_fit: 'Founders without domain expertise may lack the credibility, network, or judgment to execute.',
  }
  const base = risks[cat] ?? `Unresolved ${CATEGORY_DISPLAY[cat].label.toLowerCase()} creates material execution risk.`
  return `${prefix}${base}`
}

function suggestedAction(cat: UnderstandingCategory, tier: string): string {
  if (tier === 'gap') {
    const actions: Partial<Record<UnderstandingCategory, string>> = {
      problem:     'Run 5–10 discovery interviews with target users to articulate the problem in their own words.',
      customer:    'Define an ICP hypothesis and identify 10 potential early adopters by job title, company size, and pain.',
      solution:    'Build a 3-slide "napkin pitch" describing the solution and validate comprehension with 5 prospects.',
      market:      'Research TAM using 2–3 third-party industry reports and calculate a bottom-up SAM estimate.',
      pricing:     'Conduct willingness-to-pay interviews asking: "What would you pay to solve this?"',
      competition: 'Map alternatives: list every way your customer currently solves this problem, including doing nothing.',
      risks:       'Create a top-5 risk register with a rated likelihood and a mitigation plan for each.',
      founder_fit: 'Document domain credibility: years in market, relevant network, past wins, and access to early customers.',
    }
    return actions[cat] ?? `Define and validate ${CATEGORY_DISPLAY[cat].label.toLowerCase()} with external input.`
  }

  if (tier === 'assumption_based') {
    const actions: Partial<Record<UnderstandingCategory, string>> = {
      problem:     'Move beyond assumption: run structured interviews to confirm urgency and willingness to pay.',
      customer:    'Validate ICP: interview 10 real prospects and track which ones lean in vs. opt out.',
      solution:    'Get external signal: demo a mockup or landing page and measure conversion or sign-up intent.',
      market:      'Validate market size: cite at least two independent industry reports with matching estimates.',
      pricing:     'Test pricing: set up a pricing page and measure drop-off at each price tier.',
      competition: 'Run a win/loss analysis: ask 5 prospects which alternatives they considered and why.',
      risks:       'Stress-test your risk register with a neutral third party (advisor, investor, or peer founder).',
      founder_fit: 'Validate credibility signals: secure a reference from a domain expert or early customer.',
    }
    return actions[cat] ?? `Validate ${CATEGORY_DISPLAY[cat].label.toLowerCase()} with external evidence.`
  }

  return `Begin a structured exploration of ${CATEGORY_DISPLAY[cat].label.toLowerCase()} in the next founder session.`
}

// ── computeValidationGaps ─────────────────────────────────────────────────────
// Pure function. Derives structured validation gaps from the FounderUnderstanding
// assessmentTier per category. No DB calls — all state is in the understanding object.
export function computeValidationGaps(understanding: FounderUnderstanding): ValidationGapSummary {
  const gaps: ValidationGap[] = []

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const state = understanding.categories[cat]
    const tier  = state.assessmentTier

    const priority = gapPriority(cat, tier)
    if (priority === null) continue   // validated — not a gap

    gaps.push({
      category:        cat,
      tier,
      gapDescription:  gapDescription(cat, tier),
      riskIfUnfilled:  riskIfUnfilled(cat, tier),
      priority,
      suggestedAction: suggestedAction(cat, tier),
    })
  }

  // Sort by priority ascending (1 = most critical)
  gaps.sort((a, b) => a.priority - b.priority)

  // Overall risk from the highest-priority gap
  let overallGapRisk: ValidationGapSummary['overallGapRisk'] = 'low'
  if (gaps.some((g) => g.priority === 1)) overallGapRisk = 'critical'
  else if (gaps.some((g) => g.priority === 2)) overallGapRisk = 'high'
  else if (gaps.some((g) => g.priority <= 4)) overallGapRisk = 'medium'

  // Evidence strength label from the overall understanding state
  const rawStrength = understanding.categories.problem.evidenceStrength   // representative
  const maxStrength = Math.max(
    ...UNDERSTANDING_CATEGORIES.map((c) => understanding.categories[c].evidenceStrength ?? 1),
  ) as EvidenceStrength
  const strengthLabel =
    EVIDENCE_STRENGTH_LEVELS[maxStrength as keyof typeof EVIDENCE_STRENGTH_LEVELS] ??
    EVIDENCE_STRENGTH_LEVELS[1]

  return {
    gaps,
    evidenceStrength: `${strengthLabel} (${maxStrength}/6)`,
    overallGapRisk,
  }
}

// ── renderValidationGapsPromptBlock ───────────────────────────────────────────
// Serialises the pre-computed gap summary into the prompt format used by prompt.ts.
export function renderValidationGapsPromptBlock(summary: ValidationGapSummary): string[] {
  if (summary.gaps.length === 0) {
    return [
      '=== PRE-COMPUTED VALIDATION GAPS ===',
      'No validation gaps identified — all key categories have external evidence.',
      'Output validationGapSummary with an empty gaps array.',
      '',
    ]
  }

  const lines: string[] = [
    `=== PRE-COMPUTED VALIDATION GAPS (${summary.gaps.length} identified — overall risk: ${summary.overallGapRisk.toUpperCase()}) ===`,
    `Strongest evidence available: ${summary.evidenceStrength}`,
    '',
    'Output these gaps verbatim in validationGapSummary.gaps — do not rewrite them.',
    '',
  ]

  for (const gap of summary.gaps) {
    const priorityLabel = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'][gap.priority] ?? 'INFO'
    lines.push(`${gap.priority}. [${priorityLabel}] ${CATEGORY_DISPLAY[gap.category].label} (tier: ${gap.tier})`)
    lines.push(`   Gap: ${gap.gapDescription}`)
    lines.push(`   Risk: ${gap.riskIfUnfilled}`)
    lines.push(`   Action: ${gap.suggestedAction}`)
    lines.push('')
  }

  return lines
}
