import { z } from 'zod'

export const OPPORTUNITY_ASSESSMENT_SCHEMA_VERSION = '2.0' as const

// ── Rating scale ──────────────────────────────────────────────────────────────
// Qualitative labels for sub-dimension ratings.
// LLMs produce more reliable structured output with discrete labels than with
// raw numbers in sub-objects — opportunityScore/confidenceScore carry numeric precision.
export const RatingSchema = z.enum(['low', 'medium', 'high', 'very_high'])
export type Rating = z.infer<typeof RatingSchema>

// ── Recommendation action ─────────────────────────────────────────────────────
// 'validate_first' is the most common output for early-stage founders.
// 'pass' is reserved for fundamentally weak opportunities or poor founder fit.
export const RecommendationActionSchema = z.enum([
  'proceed',
  'proceed_with_caution',
  'validate_first',
  'pivot',
  'pass',
])
export type RecommendationAction = z.infer<typeof RecommendationActionSchema>

// ── Risk severity ─────────────────────────────────────────────────────────────
export const RiskSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>

// ── Assessment tier ───────────────────────────────────────────────────────────
// Mirrors AssessmentTierSchema from founder-understanding.ts but defined here
// so the assessment contract is self-contained (no cross-contract imports at runtime).
export const AssessmentTierSchema = z.enum(['unknown', 'gap', 'assumption_based', 'validated'])
export type AssessmentTier = z.infer<typeof AssessmentTierSchema>

// ── Understanding categories (for evidence breakdown references) ───────────────
export const UNDERSTANDING_CATEGORY_ENUM = z.enum([
  'problem', 'customer', 'solution', 'market',
  'pricing', 'competition', 'risks', 'founder_fit',
])
export type UnderstandingCategory = z.infer<typeof UNDERSTANDING_CATEGORY_ENUM>

// ── Sub-objects (existing, unchanged) ────────────────────────────────────────

export const MarketPotentialSchema = z.object({
  size:      RatingSchema,
  growth:    RatingSchema,
  // Lets Blueprint agent weight market vs. execution independently.
  score:     z.number().int().min(0).max(100),
  narrative: z.string().min(1).max(600),
})
export type MarketPotential = z.infer<typeof MarketPotentialSchema>

export const FounderFitSchema = z.object({
  domainExpertise:     RatingSchema,
  customerAccess:      RatingSchema,
  executionCapability: RatingSchema,
  // Mirrors CategoryState.confidence for founder_fit from FounderUnderstanding.
  score:               z.number().int().min(0).max(100),
  narrative:           z.string().min(1).max(600),
})
export type FounderFit = z.infer<typeof FounderFitSchema>

export const CompetitiveAdvantageSchema = z.object({
  // Nullable rather than optional: strict output requires every field present;
  // null forces the model to explicitly state when no moat exists.
  moat:            z.string().max(300).nullable(),
  differentiators: z.array(z.string().max(200)).min(1).max(5),
  defensibility:   RatingSchema,
  narrative:       z.string().min(1).max(600),
})
export type CompetitiveAdvantage = z.infer<typeof CompetitiveAdvantageSchema>

// ── Key risks ─────────────────────────────────────────────────────────────────
// category ties each risk back to an UnderstandingCategory so the UI can join
// risks to the category confidence/validation state without inference.
export const KeyRiskSchema = z.object({
  category:    UNDERSTANDING_CATEGORY_ENUM,
  title:       z.string().max(120),
  description: z.string().max(400),
  severity:    RiskSeveritySchema,
  // Required — surfacing risks without a mitigation path is not useful output.
  mitigation:  z.string().max(300),
})
export type KeyRisk = z.infer<typeof KeyRiskSchema>

// ── Validation plan ───────────────────────────────────────────────────────────
// Steps are ordered by priority and tied to FounderUnderstanding.validationGaps.
export const ValidationStepSchema = z.object({
  priority:        z.number().int().min(1).max(5),
  category:        UNDERSTANDING_CATEGORY_ENUM,
  action:          z.string().max(300),
  successCriteria: z.string().max(300),
  effort:          z.enum(['low', 'medium', 'high']),
  // String keeps the model from producing false precision ("1.5 weeks").
  timeline:        z.string().max(80),
})
export type ValidationStep = z.infer<typeof ValidationStepSchema>

// ── Recommendation ────────────────────────────────────────────────────────────
export const RecommendationSchema = z.object({
  action:    RecommendationActionSchema,
  rationale: z.string().min(1).max(600),
  // 3–5 ordered tactical next steps, consumed by the UI "What to do next" panel.
  nextSteps: z.array(z.string().max(200)).min(3).max(5),
})
export type Recommendation = z.infer<typeof RecommendationSchema>

// ── v2.0: Score Breakdown ─────────────────────────────────────────────────────
// Sub-dimensions that compose opportunityScore. Weights sum to 100.
// The LLM outputs each dimension score; opportunityScore must equal the weighted sum.

export const ScoreDimensionSchema = z.object({
  score:     z.number().int().min(0).max(100),
  weight:    z.number().int().min(1).max(40),    // % contribution to opportunityScore
  rationale: z.string().max(300),                 // why this dimension scored this way
  tier:      AssessmentTierSchema,                // evidence quality backing this dimension
})
export type ScoreDimension = z.infer<typeof ScoreDimensionSchema>

export const ScoreBreakdownSchema = z.object({
  problemStrength:      ScoreDimensionSchema,   // weight: 25
  customerClarity:      ScoreDimensionSchema,   // weight: 25
  marketPotential:      ScoreDimensionSchema,   // weight: 20
  competitiveAdvantage: ScoreDimensionSchema,   // weight: 15
  founderFit:           ScoreDimensionSchema,   // weight: 15
})
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>

// ── v2.0: Confidence Breakdown ────────────────────────────────────────────────
// Per-category evidence quality that drives the confidence score.
// Pre-computed deterministically; LLM receives computedScore as anchor.

export const CategoryEvidenceQualitySchema = z.object({
  category:         UNDERSTANDING_CATEGORY_ENUM,
  tier:             AssessmentTierSchema,
  evidenceStrength: z.number().int().min(1).max(6),
  confidence:       z.number().int().min(0).max(100),
  // Effective quality: min(confidence, strengthCeiling) with gap penalty applied
  qualityScore:     z.number().int().min(0).max(100),
  // Human-readable: "Strong — externally validated", "Assumption — founder theory only", etc.
  label:            z.string().max(120),
})
export type CategoryEvidenceQuality = z.infer<typeof CategoryEvidenceQualitySchema>

export const ConfidenceBreakdownSchema = z.object({
  categories:           z.array(CategoryEvidenceQualitySchema),
  strongCategories:     z.array(UNDERSTANDING_CATEGORY_ENUM),
  weakCategories:       z.array(UNDERSTANDING_CATEGORY_ENUM),
  missingCategories:    z.array(UNDERSTANDING_CATEGORY_ENUM),
  // Deterministic score computed before the LLM call — the anchor.
  computedScore:        z.number().int().min(0).max(100),
  // Present when the LLM's final confidenceScore deviates > 10 pts from computedScore.
  adjustmentRationale:  z.string().max(400).nullable().optional(),
})
export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>

// ── v2.0: Validation Gap Summary ─────────────────────────────────────────────
// Structured output of what evidence is missing, pre-computed before the LLM call.
// The LLM outputs this verbatim (it was assembled from founder_understanding data).

export const ValidationGapSchema = z.object({
  category:        UNDERSTANDING_CATEGORY_ENUM,
  tier:            AssessmentTierSchema,
  gapDescription:  z.string().max(300),
  riskIfUnfilled:  z.string().max(300),
  priority:        z.number().int().min(1).max(5),
  suggestedAction: z.string().max(300),
})
export type ValidationGap = z.infer<typeof ValidationGapSchema>

export const ValidationGapSummarySchema = z.object({
  gaps:             z.array(ValidationGapSchema).max(8),
  evidenceStrength: z.string().max(60),   // human label, e.g. "Founder assumption only (1/6)"
  overallGapRisk:   z.enum(['low', 'medium', 'high', 'critical']),
})
export type ValidationGapSummary = z.infer<typeof ValidationGapSummarySchema>

// ── Root schema ───────────────────────────────────────────────────────────────
// _schemaVersion union allows backward-compatible reads of v1.0 rows.
// New generations always produce v2.0 (enforced by the JSON schema in schemas.ts).
// All v2.0 fields are optional so v1.0 rows parse without error — the Zod contract
// is a read contract; the write contract (JSON schema) enforces v2.0 at generation time.

export const OpportunityAssessmentContentSchema = z.object({
  _schemaVersion: z.union([z.literal('1.0'), z.literal('2.0')]),

  // Rendered as the top-of-report summary card.
  executiveSummary: z.string().min(1).max(1000),

  // LLM judgment of the opportunity quality — independent of evidence quality.
  // A strong opportunity with thin evidence scores high here but low on confidenceScore.
  opportunityScore: z.number().int().min(0).max(100),

  // LLM's epistemic confidence, bounded by the pre-computed evidence quality.
  // In v2.0 this should stay within ±15 of confidenceBreakdown.computedScore.
  confidenceScore: z.number().int().min(0).max(100),

  marketPotential:      MarketPotentialSchema,
  founderFit:           FounderFitSchema,
  competitiveAdvantage: CompetitiveAdvantageSchema,

  // 3–6 risks ordered by severity descending.
  keyRisks: z.array(KeyRiskSchema).min(3).max(6),

  // 3–5 validation steps ordered by priority ascending.
  validationPlan: z.array(ValidationStepSchema).min(3).max(5),

  recommendation: RecommendationSchema,

  // v2.0 explainability fields — optional for backward compat with existing v1.0 rows.
  scoreBreakdown:       ScoreBreakdownSchema.optional(),
  confidenceBreakdown:  ConfidenceBreakdownSchema.optional(),
  validationGapSummary: ValidationGapSummarySchema.optional(),
})
export type OpportunityAssessmentContent = z.infer<typeof OpportunityAssessmentContentSchema>
