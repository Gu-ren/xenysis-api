/**
 * Verify FounderUnderstanding output for a session where:
 *   - Founder has a strong, coherent customer narrative (high extracted confidence)
 *   - BUT has only mentioned relationships / future interviews — no actual external contact
 *   - Customer discovery has NOT happened (absenceSignal = strong for customer)
 *
 * Checks:
 *   1. customer.validationStatus is NOT 'validated'
 *   2. customer.hasExternalContact remains false
 *   3. gapsInBlueprint includes 'customer' when session completes
 *   4. OA confidence (GAP_PENALTY_CEILING) would cap customer correctly
 */
import {
  buildUnderstanding,
  type EvidenceStrength,
  type UnderstandingCategory,
  type ValidationStatus,
  type AbsenceSignalStrength,
} from '../src/lib/contracts/founder-understanding.ts'

// ── Scenario setup ─────────────────────────────────────────────────────────────
// Simulate: founder gave a detailed, coherent customer description.
// LLM extracted confidence=82 for customer (above completion threshold).
// But hasExternalContact = false — they only said "I have industry relationships"
// and "I plan to interview SMB owners next week."
// absenceSignal for customer = 'strong' — they confirmed no actual contact yet.

const confidence: Record<UnderstandingCategory, number> = {
  problem:      85,
  customer:     82,  // high narrative confidence, but no real contact
  solution:     80,
  market:       55,
  pricing:      45,
  competition:  50,
  risks:        40,
  founder_fit:  65,
  supply_side:   0,
}

const strength: Record<UnderstandingCategory, EvidenceStrength> = {
  problem:      2,   // anecdotal observation
  customer:     1,   // pure assumption — no external contact
  solution:     2,
  market:       2,
  pricing:      1,
  competition:  2,
  risks:        1,
  founder_fit:  2,
  supply_side:  1,
}

const evidence: Record<UnderstandingCategory, string[]> = {
  problem:      ['SMBs waste hours on manual invoicing'],
  customer:     ['SMB owners, 10-50 employees', 'finance-adjacent decision makers', 'recurring billing pain'],
  solution:     ['AI-automated invoicing with QuickBooks sync'],
  market:       ['$4B invoice automation market'],
  pricing:      [],
  competition:  ['FreshBooks, Xero'],
  risks:        [],
  founder_fit:  ['10 years in fintech'],
  supply_side:  [],
}

// This-turn absence signals: customer had a STRONG absence signal
// (founder said "I haven't spoken to any customers yet, just planning interviews")
const absenceSignals: Record<UnderstandingCategory, AbsenceSignalStrength> = {
  problem:      'none',
  customer:     'strong',  // ← key signal: no actual external contact confirmed
  solution:     'none',
  market:       'none',
  pricing:      'weak',
  competition:  'none',
  risks:        'weak',
  founder_fit:  'none',
  supply_side:  'none',
}

// No external contact for any category this turn or previously
const hasExternalContactThisTurn: Record<UnderstandingCategory, boolean> = {
  problem:      false,
  customer:     false,  // ← "relationships" and "future interviews" are NOT external contact
  solution:     false,
  market:       false,
  pricing:      false,
  competition:  false,
  risks:        false,
  founder_fit:  false,
  supply_side:  false,
}

const existingHasExternalContact: Record<UnderstandingCategory, boolean> = {
  problem:      false,
  customer:     false,
  solution:     false,
  market:       false,
  pricing:      false,
  competition:  false,
  risks:        false,
  founder_fit:  false,
  supply_side:  false,
}

// Existing validation status: customer was 'unknown' before this turn
const existingValidationStatus: Record<UnderstandingCategory, ValidationStatus> = {
  problem:      'unknown',
  customer:     'unknown',
  solution:     'unknown',
  market:       'unknown',
  pricing:      'unknown',
  competition:  'unknown',
  risks:        'unknown',
  founder_fit:  'unknown',
  supply_side:  'unknown',
}

// ── Run ────────────────────────────────────────────────────────────────────────
const result = buildUnderstanding({
  categoryConfidence:          confidence,
  categoryEvidence:            evidence,
  categoryStrength:            strength,
  existingEvidence:            { problem: [], customer: [], solution: [], market: [], pricing: [], competition: [], risks: [], founder_fit: [], supply_side: [] },
  absenceSignals,
  existingValidationStatus,
  existingWeakAbsenceCounts:   { problem: 0, customer: 0, solution: 0, market: 0, pricing: 0, competition: 0, risks: 0, founder_fit: 0, supply_side: 0 },
  existingSaturationCounts:    { problem: 0, customer: 0, solution: 0, market: 0, pricing: 0, competition: 0, risks: 0, founder_fit: 0, supply_side: 0 },
  existingLastFocusConfidence: { problem: 0, customer: 0, solution: 0, market: 0, pricing: 0, competition: 0, risks: 0, founder_fit: 0, supply_side: 0 },
  existingHasExternalContact,
  hasExternalContactThisTurn,
  founderStage:        'building',
  maxEvidenceStrength: 2,         // anecdotal — no interviews done
  marketplaceDetected: false,
})

// ── Print full JSON ────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════')
console.log('  FOUNDER UNDERSTANDING — VERIFICATION RUN')
console.log('═══════════════════════════════════════════════\n')
console.log(JSON.stringify(result, null, 2))

// ── Assertions ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════')
console.log('  ASSERTION CHECK')
console.log('═══════════════════════════════════════════════\n')

const customerState = result.categories.customer
const checks = [
  {
    label:    '1. customer.validationStatus is NOT validated',
    expected: 'explicitly_unvalidated',
    got:      customerState.validationStatus,
    pass:     customerState.validationStatus === 'explicitly_unvalidated',
  },
  {
    label:    '2. customer.hasExternalContact remains false',
    expected: false,
    got:      customerState.hasExternalContact,
    pass:     customerState.hasExternalContact === false,
  },
  {
    label:    '3. gapsInBlueprint includes customer (when isComplete=true)',
    expected: true,
    got:      result.isComplete ? result.gapsInBlueprint.includes('customer') : '(session not complete yet)',
    pass:     result.isComplete ? result.gapsInBlueprint.includes('customer') : null,
  },
  {
    label:    '4. customer.assessmentTier reflects gap or assumption_based (not validated)',
    expected: 'assumption_based or gap',
    got:      customerState.assessmentTier,
    pass:     customerState.assessmentTier !== 'validated',
  },
]

// GAP_PENALTY_CEILING check (from confidence.ts)
const GAP_PENALTY_CEILING = 40
const wouldOAPenaltyApply = customerState.validationStatus === 'explicitly_unvalidated' && customerState.confidence > GAP_PENALTY_CEILING
checks.push({
  label:    `5. OA penalty applies: customer confidence (${customerState.confidence}) would be capped to ${GAP_PENALTY_CEILING}`,
  expected: true,
  got:      wouldOAPenaltyApply,
  pass:     wouldOAPenaltyApply,
})

let allPass = true
for (const c of checks) {
  const icon = c.pass === null ? '⚠ ' : c.pass ? '✓' : '✗'
  const note = c.pass === null ? '(session not complete — check gapsInBlueprint manually)' : ''
  console.log(`${icon}  ${c.label}`)
  if (!c.pass && c.pass !== null) {
    console.log(`      expected: ${JSON.stringify(c.expected)}`)
    console.log(`      got:      ${JSON.stringify(c.got)}`)
    allPass = false
  }
  if (note) console.log(`      ${note}`)
}

console.log('\n' + (allPass ? '✓ All checks passed.' : '✗ One or more checks FAILED.') + '\n')
console.log('isComplete:', result.isComplete)
console.log('gapsInBlueprint:', result.gapsInBlueprint)
console.log('validationGaps:', result.validationGaps)
console.log('customer.validationStatus:', customerState.validationStatus)
console.log('customer.hasExternalContact:', customerState.hasExternalContact)
console.log('customer.assessmentTier:', customerState.assessmentTier)
console.log('customer.confidence (raw):', customerState.confidence)
console.log(`customer.confidence after OA GAP_PENALTY_CEILING (${GAP_PENALTY_CEILING}):`, Math.min(customerState.confidence, GAP_PENALTY_CEILING))
