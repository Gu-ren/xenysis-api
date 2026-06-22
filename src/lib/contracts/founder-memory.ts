import { z } from 'zod'
import type { UnderstandingCategory, EvidenceStrength } from './founder-understanding.ts'
import { UNDERSTANDING_CATEGORIES, AbsenceSignalSchema } from './founder-understanding.ts'

export const FOUNDER_MEMORY_SCHEMA_VERSION = '1.1' as const

// Per-category confidence sub-schema — 8 categories including founder_fit (Revision 2).
const CategoryConfidenceSchema = z.object({
  problem:      z.number().int().min(0).max(100),
  customer:     z.number().int().min(0).max(100),
  solution:     z.number().int().min(0).max(100),
  market:       z.number().int().min(0).max(100),
  pricing:      z.number().int().min(0).max(100),
  competition:  z.number().int().min(0).max(100),
  risks:        z.number().int().min(0).max(100),
  founder_fit:  z.number().int().min(0).max(100),
  supply_side:  z.number().int().min(0).max(100).default(0),  // v2.2 PR3
})
export type CategoryConfidence = z.infer<typeof CategoryConfidenceSchema>

// Per-category evidence sub-schema — max 3 items per category per extraction turn.
const CategoryEvidenceSchema = z.object({
  problem:      z.array(z.string().max(200)).max(3),
  customer:     z.array(z.string().max(200)).max(3),
  solution:     z.array(z.string().max(200)).max(3),
  market:       z.array(z.string().max(200)).max(3),
  pricing:      z.array(z.string().max(200)).max(3),
  competition:  z.array(z.string().max(200)).max(3),
  risks:        z.array(z.string().max(200)).max(3),
  founder_fit:  z.array(z.string().max(200)).max(3),
  supply_side:  z.array(z.string().max(200)).max(3).default([]),  // v2.2 PR3
})
export type CategoryEvidence = z.infer<typeof CategoryEvidenceSchema>

// Revision 3: per-category evidence strength (1-6 scale).
// Tracks the QUALITY of evidence behind each confidence score — not just the score itself.
// 1 = founder assumption, 2 = anecdotal, 3 = customer conversations,
// 4 = customer interviews, 5 = paying customers, 6 = usage/revenue data.
// GPT-4o may return 0 for categories with no evidence discussed (e.g. the first turn only
// covers problem/customer and leaves market/pricing/competition at 0). Treat 0 as 1 — the
// minimum "founder assumption" level — so Zod validation never blocks the full pipeline.
const CategoryEvidenceStrengthSchema = z.object({
  problem:      z.number().int().min(0).max(6).catch(1),
  customer:     z.number().int().min(0).max(6).catch(1),
  solution:     z.number().int().min(0).max(6).catch(1),
  market:       z.number().int().min(0).max(6).catch(1),
  pricing:      z.number().int().min(0).max(6).catch(1),
  competition:  z.number().int().min(0).max(6).catch(1),
  risks:        z.number().int().min(0).max(6).catch(1),
  founder_fit:  z.number().int().min(0).max(6).catch(1),
  supply_side:  z.number().int().min(0).max(6).catch(1),  // v2.2 PR3
})
export type CategoryEvidenceStrength = z.infer<typeof CategoryEvidenceStrengthSchema>

// Per-category absence signals — replace-with-latest per turn (not accumulated).
// 'none' = no absence stated; 'weak' = hedged; 'strong' = unambiguous total absence.
// Accumulation of 'weak' signals happens in FounderUnderstanding.categories[cat].weakAbsenceCount,
// not here. This field carries only the current turn's extraction output.
const CategoryAbsenceSignalsSchema = z.object({
  problem:     AbsenceSignalSchema.default('none'),
  customer:    AbsenceSignalSchema.default('none'),
  solution:    AbsenceSignalSchema.default('none'),
  market:      AbsenceSignalSchema.default('none'),
  pricing:     AbsenceSignalSchema.default('none'),
  competition: AbsenceSignalSchema.default('none'),
  risks:       AbsenceSignalSchema.default('none'),
  founder_fit: AbsenceSignalSchema.default('none'),
  supply_side: AbsenceSignalSchema.default('none'),  // v2.2 PR3
})
export type CategoryAbsenceSignals = z.infer<typeof CategoryAbsenceSignalsSchema>

// v2.2 PR3 — external-contact separation.
// Per-turn boolean per category: true only when founder explicitly stated direct external contact
// this turn. Stickiness (one-way latch) is enforced in the understanding engine via OR with
// the existing value — memory always carries the current turn's raw LLM output.
const CategoryHasExternalContactSchema = z.object({
  problem:     z.boolean().default(false),
  customer:    z.boolean().default(false),
  solution:    z.boolean().default(false),
  market:      z.boolean().default(false),
  pricing:     z.boolean().default(false),
  competition: z.boolean().default(false),
  risks:       z.boolean().default(false),
  founder_fit: z.boolean().default(false),
  supply_side: z.boolean().default(false),
})
export type CategoryHasExternalContact = z.infer<typeof CategoryHasExternalContactSchema>

// Incrementally merged startup intelligence — the primary input for OpportunityAgent (Sprint 3).
// Fields are extracted from conversation and merged (not overwritten) after each AI exchange.
//
// Revision 2: adds founder_fit to per-category fields.
// Revision 3: adds category_evidence_strength.
// Revision 1 applied to merge semantics: confidence is replace-with-latest (not max merge).
export const FounderMemorySchema = z.object({
  startup_name:           z.string().max(120).default(''),
  one_sentence_pitch:     z.string().max(280).default(''),

  problem:                z.string().max(500).default(''),
  customer:               z.string().max(300).default(''),
  industry:               z.string().max(100).default(''),

  business_model:         z.string().max(200).default(''),
  pricing_model:          z.string().max(200).default(''),

  market_signals:         z.array(z.string().max(200)).max(8).default([]),
  competitive_advantages: z.array(z.string().max(200)).max(6).default([]),

  assumptions:            z.array(z.string().max(200)).max(10).default([]),
  risks:                  z.array(z.string().max(200)).max(8).default([]),

  key_insights:           z.array(z.string().max(300)).max(10).default([]),

  // Named competitors extracted from the conversation — populated by Sprint 2.5 extraction.
  // Feeds OpportunityAssessment.alternatives. Max 6 to match the output cap.
  named_competitors:      z.array(z.string().max(100)).max(6).default([]),

  // Single overall confidence (Sprint 2, unchanged — OpportunityAgent reads this).
  confidence_score: z.number().int().min(0).max(100).default(0),

  // Per-category confidence — GPT-4o's fresh assessment each turn.
  // Revision 1: replace-with-latest merge semantics (not max merge).
  category_confidence: CategoryConfidenceSchema.default({
    problem:     0,
    customer:    0,
    solution:    0,
    market:      0,
    pricing:     0,
    competition: 0,
    risks:       0,
    founder_fit: 0,
    supply_side: 0,
  }),

  // Per-category evidence statements — cumulative (append-unique across turns).
  category_evidence: CategoryEvidenceSchema.default({
    problem:     [],
    customer:    [],
    solution:    [],
    market:      [],
    pricing:     [],
    competition: [],
    risks:       [],
    founder_fit: [],
    supply_side: [],
  }),

  // Revision 3: evidence strength per category — replace-with-latest (living assessment).
  category_evidence_strength: CategoryEvidenceStrengthSchema.default({
    problem:     1,
    customer:    1,
    solution:    1,
    market:      1,
    pricing:     1,
    competition: 1,
    risks:       1,
    founder_fit: 1,
    supply_side: 1,
  }),

  // This revision: per-turn absence signal per category — replace-with-latest.
  // Carries only the current extraction turn's signal; accumulation is in FounderUnderstanding.
  category_absence_signals: CategoryAbsenceSignalsSchema.default({
    problem:     'none',
    customer:    'none',
    solution:    'none',
    market:      'none',
    pricing:     'none',
    competition: 'none',
    risks:       'none',
    founder_fit: 'none',
    supply_side: 'none',
  }),

  // v2.2 PR3: per-turn boolean per category — replace-with-latest.
  // True only when the founder explicitly stated direct external contact THIS TURN.
  // Stickiness is enforced in the understanding engine (existingContact || thisContact).
  category_has_external_contact: CategoryHasExternalContactSchema.default({
    problem:     false,
    customer:    false,
    solution:    false,
    market:      false,
    pricing:     false,
    competition: false,
    risks:       false,
    founder_fit: false,
    supply_side: false,
  }),

  // v2.1 F3: replace-with-latest per turn. True only for genuine two-sided marketplaces
  // or dual-segment businesses with meaningfully different pricing/service models.
  // Once true in FounderUnderstanding, it stays true (stickiness is in the engine, not here).
  multi_icp_detected: z.boolean().default(false),

  // v2.2 PR2: replace-with-latest per turn. True for genuine two-sided platforms where
  // distinct supply-side participants create value consumed by distinct demand-side participants
  // (Airbnb/hosts+guests, Uber/drivers+riders, Etsy/sellers+buyers).
  // More specific than multi_icp_detected — gates supply_side discovery in PR3.
  // Stickiness enforced in the engine, not here.
  marketplace_detected: z.boolean().default(false),

  // v2.1 F4: replace-with-latest per turn. True on the specific turn where a genuine
  // mid-session pivot is detected. Does NOT trigger confidence merge bypass (v2.2).
  pivot_detected: z.boolean().default(false),
})

export type FounderMemory = z.infer<typeof FounderMemorySchema>

export const EMPTY_FOUNDER_MEMORY: FounderMemory = FounderMemorySchema.parse({})

// ── Merge semantics ───────────────────────────────────────────────────────────
// String fields:    replace only when newer value is longer (more specific).
// Array fields:     append unique items, respect schema max lengths.
// confidence_score: replace with latest.
//
// Revision 1 — category_confidence: replace entirely with latest extraction.
//   Confidence is GPT-4o's current assessment of the full conversation.
//   Contradictory evidence must be able to reduce a score.
//
// category_evidence: append unique items, cap at 3 per category (cumulative).
//
// Revision 3 — category_evidence_strength: replace with latest.
//   Evidence strength is a current assessment, not a running maximum.
export function mergeFounderMemory(
  existing: FounderMemory,
  extracted: Partial<FounderMemory>,
): FounderMemory {
  const stringFields = [
    'startup_name',
    'one_sentence_pitch',
    'problem',
    'customer',
    'industry',
    'business_model',
    'pricing_model',
  ] as const

  const arrayFields = [
    'market_signals',
    'competitive_advantages',
    'assumptions',
    'risks',
    'key_insights',
    'named_competitors',
  ] as const

  const arrayMaxLengths: Record<typeof arrayFields[number], number> = {
    market_signals:         8,
    competitive_advantages: 6,
    assumptions:            10,
    risks:                   8,
    key_insights:           10,
    named_competitors:       6,
  }

  const merged: FounderMemory = { ...existing }

  for (const field of stringFields) {
    const newVal = extracted[field]
    if (newVal && newVal.length > (existing[field]?.length ?? 0)) {
      merged[field] = newVal
    }
  }

  for (const field of arrayFields) {
    const newItems      = extracted[field] ?? []
    const existingItems = existing[field] ?? []
    const combined      = [...existingItems]
    for (const item of newItems) {
      if (!combined.includes(item)) combined.push(item)
    }
    merged[field] = combined.slice(0, arrayMaxLengths[field]) as string[]
  }

  if (typeof extracted.confidence_score === 'number') {
    merged.confidence_score = extracted.confidence_score
  }

  // Revision 1: confidence is a living score that can decrease on contradiction.
  // Evidence-gated: only update category_confidence[cat] when new evidence was extracted
  // for that category this turn. This prevents artificial confidence decay caused by
  // context-window truncation — if a topic wasn't discussed this turn, its established
  // score is preserved. Categories with new evidence (regardless of direction) are updated.
  if (extracted.category_confidence && extracted.category_evidence) {
    const updatedConfidence = { ...existing.category_confidence }
    for (const cat of UNDERSTANDING_CATEGORIES as readonly UnderstandingCategory[]) {
      const hasNewEvidence = (extracted.category_evidence[cat]?.length ?? 0) > 0
      if (hasNewEvidence) {
        updatedConfidence[cat] = extracted.category_confidence[cat] ?? updatedConfidence[cat]
      }
      // No new evidence → preserve existing confidence (window-truncation is not a signal)
    }
    merged.category_confidence = updatedConfidence
  } else if (extracted.category_confidence) {
    // Evidence not present in extraction — fall back to full replace (shouldn't occur in practice
    // since the schema requires both fields, but keeps the merge safe if schema evolves).
    merged.category_confidence = { ...existing.category_confidence, ...extracted.category_confidence }
  }

  // Per-category evidence: append unique items, cap at 3 per category.
  // Evidence items accumulate across turns — we never lose discovered facts.
  if (extracted.category_evidence) {
    const newEvidence: CategoryEvidence = { ...merged.category_evidence }
    for (const cat of UNDERSTANDING_CATEGORIES as readonly UnderstandingCategory[]) {
      const existingItems = newEvidence[cat] ?? []
      const incomingItems = extracted.category_evidence[cat] ?? []
      const combined      = [...existingItems]
      for (const item of incomingItems) {
        if (!combined.includes(item)) combined.push(item)
      }
      newEvidence[cat] = combined.slice(0, 3)
    }
    merged.category_evidence = newEvidence
  }

  // Revision 3: replace evidence strength with the latest assessment.
  // Strength can increase (founder reveals paying customers) or decrease
  // (founder clarifies a previous claim was speculative).
  if (extracted.category_evidence_strength) {
    merged.category_evidence_strength = {
      ...existing.category_evidence_strength,
      ...extracted.category_evidence_strength,
    }
  }

  // This revision: replace absence signals with the current turn's values.
  // These are per-turn signals — the 'weak' accumulation counter lives in FounderUnderstanding,
  // not in memory. Spreading new over existing so undiscussed categories stay 'none'.
  if (extracted.category_absence_signals) {
    merged.category_absence_signals = {
      ...existing.category_absence_signals,
      ...extracted.category_absence_signals,
    }
  }

  // v2.2 PR3: replace-with-latest per-turn boolean. Stickiness is enforced in the understanding
  // engine — here we simply carry the current turn's LLM output, spreading so that categories
  // not mentioned this turn retain their prior value.
  if (extracted.category_has_external_contact) {
    merged.category_has_external_contact = {
      ...existing.category_has_external_contact,
      ...extracted.category_has_external_contact,
    }
  }

  // v2.1 F3: replace-with-latest. Stickiness (once-true-stays-true) is enforced in the
  // understanding engine, not here — memory always reflects the current turn's LLM output.
  if (typeof extracted.multi_icp_detected === 'boolean') {
    merged.multi_icp_detected = extracted.multi_icp_detected
  }

  // v2.2 PR2: replace-with-latest. Stickiness enforced in the engine.
  if (typeof extracted.marketplace_detected === 'boolean') {
    merged.marketplace_detected = extracted.marketplace_detected
  }

  // v2.1 F4: replace-with-latest per turn. True only on the turn the pivot is detected.
  // No confidence merge bypass — that is v2.2.
  if (typeof extracted.pivot_detected === 'boolean') {
    merged.pivot_detected = extracted.pivot_detected
  }

  return merged
}
