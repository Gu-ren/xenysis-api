import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { FounderUnderstanding, UnderstandingCategory, BlueprintMode } from '../../lib/contracts/founder-understanding.ts'
import type { OpportunityAssessmentContent } from '../../lib/contracts/opportunity-assessment.ts'
import type { Startup } from '../../lib/db/schema/startups.ts'
import {
  UNDERSTANDING_CATEGORIES,
  CATEGORY_DISPLAY,
  EVIDENCE_STRENGTH_LEVELS,
} from '../../lib/contracts/founder-understanding.ts'

// Maps each understanding category to the blueprint fields that derive from it.
// Used by buildSystemPrompt to give specific field-level labeling instructions
// for categories the founder explicitly confirmed as unvalidated (gapsInBlueprint).
export const GAP_TO_BLUEPRINT_FIELDS: Partial<Record<UnderstandingCategory, string[]>> = {
  problem:     ['problem.statement', 'problem.painPoints', 'problem.whyNow'],
  customer:    ['customer.icp', 'customer.segments', 'personas.personas'],
  solution:    ['solution.productDescription', 'solution.coreCapabilities', 'solution.differentiators'],
  market:      ['overview.targetMarketSummary'],
  pricing:     ['businessModel.revenueStreams'],
  competition: ['problem.currentAlternatives', 'solution.unfairAdvantage'],
  risks:       ['risks.risks'],
  founder_fit: ['personas.personas (background / expertise claims)'],
}

export const PROMPT_VERSION = 'blueprint-v1.0' as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars - 1) + '…'
}

function strengthLabel(strength: number): string {
  return EVIDENCE_STRENGTH_LEVELS[strength as keyof typeof EVIDENCE_STRENGTH_LEVELS] ?? 'Unknown'
}

// Map OA UnderstandingCategory → Blueprint risk category.
// Used in the system prompt to instruct risk translation, and in the user message
// to label each OA risk's effective blueprint category for the model.
const OA_TO_BLUEPRINT_RISK_CATEGORY: Record<UnderstandingCategory, string> = {
  problem:     'product',
  customer:    'customer_adoption',
  solution:    'technical',
  market:      'market',
  pricing:     'financial',
  competition: 'competition',
  risks:       'product',
  founder_fit: 'team',
  supply_side: 'market',  // v2.2 PR3: supply-side acquisition risk maps to market risk
}

// ── System prompt ─────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  blueprintMode: BlueprintMode = 'validated',
  gapsInBlueprint: UnderstandingCategory[] = [],
): string {
  const preambleLines: string[] = []

  // Hypothesis mode preamble — fires only for idea-stage sessions below THRESHOLD_COMPLETE.
  if (blueprintMode === 'hypothesis') {
    preambleLines.push(
      '=== HYPOTHESIS BLUEPRINT MODE ===',
      '',
      'This session completed at the idea-stage threshold (60% confidence on required categories).',
      'The founder has NOT yet validated their thesis with customers.',
      'Frame the entire blueprint as a thinking tool, not a validated spec.',
      '',
    )
  }

  // Fabrication prevention — fires for any session with explicitly_unvalidated categories,
  // regardless of blueprintMode. A building-stage founder can also complete with gaps.
  if (gapsInBlueprint.length > 0) {
    const fieldLines: string[] = []
    for (const cat of gapsInBlueprint) {
      const fields = GAP_TO_BLUEPRINT_FIELDS[cat] ?? []
      const catLabel = CATEGORY_DISPLAY[cat]?.label ?? cat
      for (const field of fields) {
        fieldLines.push(`  - ${field}  (source: ${catLabel} — founder confirmed no validation)`)
      }
    }

    preambleLines.push(
      '=== FABRICATION PREVENTION ===',
      '',
      'The following categories were EXPLICITLY confirmed as having NO external founder validation.',
      'For each listed blueprint field, you MUST prefix the content with "[HYPOTHESIS — not founder-validated]".',
      '',
      ...fieldLines,
      '',
      'Prefix rules:',
      '  - The label MUST appear at the START of the string value for that field.',
      '  - Do NOT omit or restructure the field — generate it normally, then prepend the label.',
      '  - Do NOT apply the prefix to fields NOT listed above.',
      '  - Do NOT apply the prefix to fields derived solely from validated or evidence-backed categories.',
      '',
    )
  }

  return [
    ...preambleLines,
    'You are a senior product strategist who specializes in translating early-stage startup intelligence into structured product blueprints.',
    'Your task is to produce a BlueprintContent v1.0 JSON from the startup, founder memory, and opportunity assessment data provided.',
    '',
    '=== TWO-MODE GENERATION ===',
    '',
    'ASSEMBLE (faithfully derive from provided data — do not add facts not in the input):',
    '  overview     — tagline, positionStatement, coreValueProposition, targetMarketSummary',
    '  problem      — statement, painPoints, currentAlternatives, whyNow, problemSeverity',
    '  risks        — translate OA keyRisks to blueprint risk format; supplement if < 3 risks',
    '  metrics      — northStar and KPIs from OA validationPlan and marketPotential',
    '',
    'GENERATE (AI synthesis — create structure, product thinking, and specificity):',
    '  customer      — ICP definition, 1-4 customer segments',
    '  solution      — product description, core capabilities, differentiators',
    '  businessModel — revenue streams, GTM motion, key channels',
    '  personas      — 1-3 personas, exactly 1 isPrimary=true',
    '  userJourneys  — 1-2 journeys, each tied to a persona',
    '  mvpScope      — hypothesis, MoSCoW scope items, outOfScope, build time estimate',
    '  requirements  — F-001/NF-001 style with acceptance criteria',
    '  roadmap       — 2-5 phases from MVP to platform',
    '',
    '=== ASSEMBLY RULES ===',
    '',
    'overview.tagline:',
    '  Distill one_sentence_pitch into a punchy ≤160-char hook. Never copy verbatim.',
    '  Format: active verb + core benefit + key differentiator.',
    '',
    'overview.positionStatement:',
    '  Use this template exactly: "For [target customer], [product] is a [category] that [key benefit],',
    '  unlike [named alternative], we [differentiator]."',
    '  Source: ICP from customer memory, named_competitors, competitive_advantages.',
    '',
    'overview.coreValueProposition:',
    '  Synthesize from OA executiveSummary + problem statement. State the cost saved or outcome gained.',
    '',
    'overview.targetMarketSummary:',
    '  Source: OA marketPotential.narrative + customer description. Include geography and company stage.',
    '',
    'problem.statement:',
    '  Refine from founderMemory.problem. Max 600 chars. State the pain, not the solution.',
    '',
    'problem.painPoints:',
    '  Source: understanding.categories.problem.evidence + founderMemory.key_insights.',
    '  Write as user-facing impact statements. Order by severity descending.',
    '',
    'problem.currentAlternatives:',
    '  Source: founderMemory.named_competitors + understanding.categories.competition.evidence.',
    '  Format: "ToolName (limitation)" or "Behavior (why it fails)".',
    '',
    'problem.whyNow:',
    '  Source: founderMemory.market_signals. Synthesize into a single timing argument (≤400 chars).',
    '  If market_signals is empty, derive from OA marketPotential.narrative.',
    '',
    'problem.problemSeverity:',
    '  Map from OA keyRisks severity distribution:',
    '    any critical risk → "high"',
    '    majority high risks → "high"',
    '    majority medium risks → "medium"',
    '    otherwise → "low"',
    '',
    'risks.risks (3-8 items):',
    '  Translate each OA keyRisk using this category mapping:',
    '    problem     → product',
    '    customer    → customer_adoption',
    '    solution    → technical',
    '    market      → market',
    '    pricing     → financial',
    '    competition → competition',
    '    risks       → product',
    '    founder_fit → team',
    '  Keep OA title, description, severity, mitigation — rewrite only to fit blueprint phrasing.',
    '  Assign phase:',
    '    severity=critical → phase 1',
    '    severity=high     → phase 1 or 2 (based on whether it is a build or launch risk)',
    '    severity=medium   → phase 2 or 3',
    '    severity=low      → null',
    '  If OA has fewer than 3 risks: add execution risks (team, financial) grounded in the startup context.',
    '',
    'metrics.northStar:',
    '  The single metric that best represents value delivered to the primary customer.',
    '  Derive from OA recommendation.nextSteps, marketPotential, and the core product loop.',
    '  target: human-readable string with no false precision ("500 weekly events at 60 days post-launch").',
    '  rationale: explain why this metric, not a vanity alternative.',
    '',
    'metrics.metrics (3-12 KPIs):',
    '  Map OA validationPlan steps to measurable KPIs — each step implies a thing to measure.',
    '  Categorize using AARRR: acquisition / activation / retention / revenue / referral / engagement / operational.',
    '  REQUIRED: include at least 1 metric with category="activation" — this measures the user\'s path to first value.',
    '  phase: the roadmap phase where this metric becomes the primary tracking focus.',
    '',
    '=== GENERATION RULES ===',
    '',
    'customer.icp:',
    '  title: descriptive handle ("Head of Operations at 20–50 person SaaS", not a persona name).',
    '  jobToBeDone: JTBD framing — "When [situation], I want to [motivation] so I can [outcome]."',
    '  buyerVsUser: "same" (one person buys and uses), "different" (enterprise top-down), "both" (PLG).',
    '',
    'customer.segments:',
    '  1-4 segments. Mark isPrimaryBuyer=true on exactly 1. Remaining segments are secondary buyers or user groups.',
    '  estimatedSize: human-readable estimate with units ("~80K ops leads at growth-stage SaaS in US").',
    '',
    'solution.unfairAdvantage:',
    '  Structural advantage that is hard to copy. Null is acceptable for pre-product startups.',
    '  Source: founderMemory.competitive_advantages + OA competitiveAdvantage.moat.',
    '',
    'businessModel.revenueStreams:',
    '  PRESERVATION RULE: If founderMemory.pricing_model or founderMemory.business_model is non-empty,',
    '  the FIRST revenue stream MUST reflect the founder-stated model.',
    '  Set pricingHypothesis to the founder\'s exact words, appended with "(founder hypothesis — not validated)".',
    '  Do NOT replace a founder-stated monetization model with an invented alternative as the primary stream.',
    '  Example: founder says "15% commission per booking" →',
    '    { type: "marketplace", pricingHypothesis: "15% commission per booking (founder hypothesis — not validated)", isPrimary: true }',
    '  You MAY add 1 additional future revenue stream after the primary, but ONLY if labeled:',
    '    pricingHypothesis: "OPTIONAL FUTURE EXPERIMENT — [describe the idea]"',
    '  If founderMemory.pricing_model is empty, synthesize the most logical primary stream from context.',
    '',
    'businessModel.gtmMotion:',
    '  product_led: product drives acquisition (free tier, viral loops)',
    '  sales_led: human-driven outreach and demos (enterprise)',
    '  community_led: community network drives growth',
    '  partnership_led: channel partners or integrations drive distribution',
    '  marketing_led: content, SEO, or paid demand generation',
    '',
    'personas:',
    '  Exactly 1 persona must have isPrimary=true.',
    '  Primary = the person who experiences the pain most acutely (not necessarily the budget owner).',
    '  Name format: "FirstName — Descriptive Role Tag" (e.g. "Priya — The Overwhelmed Ops Lead").',
    '  demographics: age range, years of experience, company stage, geography — qualitative, not a data table.',
    '',
    'userJourneys:',
    '  journeys[*].personaName MUST exactly match a persona.name from the personas section.',
    '  At least 1 journey for the primary persona.',
    '  stages: 3-7 per journey. Include at least 1 stage with emotion=frustrated.',
    '  painPoint: null only when the stage is already working well (positive experience).',
    '  keyInsight: must drive a specific product decision (not a general observation).',
    '',
    'mvpScope.hypothesis:',
    '  Falsifiable. "If we give [actor] a [feature], they will [behavior] within [timeframe]."',
    '',
    'mvpScope.scope:',
    '  3-12 items. Include at least 1 wont_have to demonstrate deliberate exclusion.',
    '  must_have → ships before launch. should_have → ships weeks 2-4. nice_to_have → Phase 2.',
    '',
    'requirements:',
    '  Functional IDs: F-001, F-002, … (sequential, no gaps, no duplicates).',
    '  Non-functional IDs: NF-001, NF-002, …',
    '  acceptanceCriteria: concrete and testable. No "should", only "must", "does", or specific numbers.',
    '  Tie each must_have functional req to a must_have scope item.',
    '',
    'roadmap.milestones:',
    '  Phase numbers: sequential integers starting at 1.',
    '  Phase 1 = MVP (scope matches mvpScope). Phase 2 = public launch / PLG. Phase 3+ = expansion.',
    '  dependencies: reference prior phase names verbatim (e.g. "Phase 1 — MVP").',
    '  successMetric: single measurable signal that proves this phase succeeded.',
    '',
    'roadmap.criticalPath:',
    '  Name the specific feature or milestone where delay is fatal. Explain why.',
    '',
    '=== OUTPUT FORMAT ===',
    '  _schemaVersion must be exactly "1.0".',
    '  Return a single JSON object — no markdown fencing, no prose outside the JSON.',
    '  All required fields must be present. Nulls only where the schema marks a field nullable.',
    '  Array lengths must satisfy schema min/max (e.g. personas: 1-3, journeys: 1-2).',
  ].join('\n')
}

// ── User message ──────────────────────────────────────────────────────────────

export function buildUserMessage(params: {
  startup:       Startup
  founderMemory: FounderMemory
  understanding: FounderUnderstanding
  assessment:    OpportunityAssessmentContent
}): string {
  const { startup, founderMemory, understanding, assessment } = params
  const lines: string[] = []

  // ── Startup context ───────────────────────────────────────────────────────
  lines.push('=== STARTUP CONTEXT ===')
  lines.push(`Name: ${truncate(startup.name, 120)}`)
  if (startup.description)    lines.push(`Description: ${truncate(startup.description, 300)}`)
  if (startup.category)       lines.push(`Industry: ${startup.category}`)
  if (startup.lifecycleStage) lines.push(`Stage: ${startup.lifecycleStage}`)
  lines.push('')

  // ── Founder memory ────────────────────────────────────────────────────────
  lines.push('=== FOUNDER MEMORY ===')

  if (founderMemory.one_sentence_pitch) {
    lines.push(`Pitch: ${truncate(founderMemory.one_sentence_pitch, 280)}`)
  }
  if (founderMemory.problem) {
    lines.push(`Problem: ${truncate(founderMemory.problem, 500)}`)
  }
  if (founderMemory.customer) {
    lines.push(`Customer: ${truncate(founderMemory.customer, 300)}`)
  }
  if (founderMemory.business_model) {
    lines.push(`Business model: ${truncate(founderMemory.business_model, 200)}`)
  }
  if (founderMemory.pricing_model) {
    lines.push(`Pricing model: ${truncate(founderMemory.pricing_model, 200)}`)
  }
  if (founderMemory.industry) {
    lines.push(`Industry (extracted): ${truncate(founderMemory.industry, 100)}`)
  }

  if (founderMemory.market_signals.length > 0) {
    lines.push('Market signals:')
    founderMemory.market_signals.forEach((s) => lines.push(`  - ${truncate(s, 200)}`))
  }

  if (founderMemory.competitive_advantages.length > 0) {
    lines.push('Competitive advantages (founder-stated):')
    founderMemory.competitive_advantages.forEach((a) => lines.push(`  - ${truncate(a, 200)}`))
  }

  if (founderMemory.named_competitors.length > 0) {
    lines.push(`Named competitors: ${founderMemory.named_competitors.map((c) => truncate(c, 80)).join(', ')}`)
  }

  if (founderMemory.assumptions.length > 0) {
    lines.push('Key assumptions:')
    founderMemory.assumptions.forEach((a) => lines.push(`  - ${truncate(a, 200)}`))
  }

  if (founderMemory.risks.length > 0) {
    lines.push('Stated risks:')
    founderMemory.risks.forEach((r) => lines.push(`  - ${truncate(r, 200)}`))
  }

  if (founderMemory.key_insights.length > 0) {
    lines.push('Key insights:')
    founderMemory.key_insights.forEach((i) => lines.push(`  - ${truncate(i, 300)}`))
  }

  lines.push('')

  // ── Understanding state ───────────────────────────────────────────────────
  lines.push('=== UNDERSTANDING STATE ===')
  lines.push(`Overall confidence: ${understanding.overallConfidence}%`)
  lines.push('')

  for (const cat of UNDERSTANDING_CATEGORIES as readonly UnderstandingCategory[]) {
    const state   = understanding.categories[cat]
    const display = CATEGORY_DISPLAY[cat]
    const gapTag  = state.validationStatus === 'explicitly_unvalidated'
      ? ' *** VALIDATION GAP ***'
      : ''

    lines.push(`  ${display.label}${gapTag}`)
    lines.push(
      `    Confidence: ${state.confidence}%  |  ` +
      `Strength: ${state.evidenceStrength}/6 (${strengthLabel(state.evidenceStrength)})  |  ` +
      `Tier: ${state.assessmentTier}`,
    )

    if (state.evidence.length > 0) {
      state.evidence.forEach((e) => lines.push(`    • ${truncate(e, 200)}`))
    }
  }

  lines.push('')

  // ── Opportunity assessment ────────────────────────────────────────────────
  lines.push('=== OPPORTUNITY ASSESSMENT (source for ASSEMBLE sections) ===')
  lines.push(`Executive Summary: ${truncate(assessment.executiveSummary, 1000)}`)
  lines.push(`Opportunity Score: ${assessment.opportunityScore}/100`)
  lines.push(`Confidence Score: ${assessment.confidenceScore}/100`)
  lines.push(`Recommendation: ${assessment.recommendation.action}`)
  lines.push(`Recommendation Rationale: ${truncate(assessment.recommendation.rationale, 600)}`)
  lines.push('')

  lines.push('Recommendation — Next Steps:')
  assessment.recommendation.nextSteps.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${truncate(s, 200)}`)
  })
  lines.push('')

  lines.push(`Market Potential:`)
  lines.push(`  Size: ${assessment.marketPotential.size}  |  Growth: ${assessment.marketPotential.growth}`)
  lines.push(`  Narrative: ${truncate(assessment.marketPotential.narrative, 600)}`)
  lines.push('')

  lines.push(`Founder Fit:`)
  lines.push(
    `  Domain Expertise: ${assessment.founderFit.domainExpertise}  |  ` +
    `Customer Access: ${assessment.founderFit.customerAccess}  |  ` +
    `Execution: ${assessment.founderFit.executionCapability}`,
  )
  lines.push(`  Narrative: ${truncate(assessment.founderFit.narrative, 600)}`)
  lines.push('')

  lines.push('Competitive Advantage:')
  if (assessment.competitiveAdvantage.moat) {
    lines.push(`  Moat: ${truncate(assessment.competitiveAdvantage.moat, 300)}`)
  }
  lines.push(`  Defensibility: ${assessment.competitiveAdvantage.defensibility}`)
  lines.push(`  Differentiators:`)
  assessment.competitiveAdvantage.differentiators.forEach((d) => {
    lines.push(`    - ${truncate(d, 200)}`)
  })
  lines.push(`  Narrative: ${truncate(assessment.competitiveAdvantage.narrative, 600)}`)
  lines.push('')

  lines.push(`Key Risks (translate these into blueprint.risks — category mapping in system prompt):`)
  assessment.keyRisks.forEach((r, i) => {
    const blueprintCat = OA_TO_BLUEPRINT_RISK_CATEGORY[r.category as UnderstandingCategory] ?? 'product'
    lines.push(
      `  ${i + 1}. [${r.severity}] ${r.category} → ${blueprintCat} | ${truncate(r.title, 120)}`,
    )
    lines.push(`     Description: ${truncate(r.description, 400)}`)
    lines.push(`     Mitigation: ${truncate(r.mitigation, 300)}`)
  })
  lines.push('')

  lines.push('Validation Plan (use these as the source for metrics.metrics KPIs):')
  assessment.validationPlan.forEach((step) => {
    lines.push(
      `  P${step.priority} [${step.category}] ${truncate(step.action, 300)}`,
    )
    lines.push(`     Success: ${truncate(step.successCriteria, 300)}`)
    lines.push(`     Effort: ${step.effort}  |  Timeline: ${truncate(step.timeline, 80)}`)
  })
  lines.push('')

  lines.push('Now produce the BlueprintContent v1.0 JSON.')

  return lines.join('\n')
}
