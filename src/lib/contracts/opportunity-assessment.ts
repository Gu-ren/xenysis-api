import { z } from 'zod'

export const OPPORTUNITY_ASSESSMENT_SCHEMA_VERSION = '1.0' as const

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

// ── Sub-objects ───────────────────────────────────────────────────────────────

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
export const UNDERSTANDING_CATEGORY_ENUM = z.enum([
  'problem', 'customer', 'solution', 'market',
  'pricing', 'competition', 'risks', 'founder_fit',
])

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

// ── Root schema ───────────────────────────────────────────────────────────────

export const OpportunityAssessmentContentSchema = z.object({
  _schemaVersion: z.literal('1.0').default('1.0'),

  // Rendered as the top-of-report summary card.
  executiveSummary: z.string().min(1).max(1000),

  // LLM judgment of the opportunity quality — independent of evidence quality.
  // A strong opportunity with thin evidence scores high here but low on confidenceScore.
  opportunityScore: z.number().int().min(0).max(100),

  // LLM's epistemic confidence in the assessment, bounded by evidence quality.
  // Surfaces a "low confidence" warning in the UI when < 50.
  confidenceScore: z.number().int().min(0).max(100),

  marketPotential:      MarketPotentialSchema,
  founderFit:           FounderFitSchema,
  competitiveAdvantage: CompetitiveAdvantageSchema,

  // 3–6 risks ordered by severity descending.
  keyRisks: z.array(KeyRiskSchema).min(3).max(6),

  // 3–5 validation steps ordered by priority ascending.
  validationPlan: z.array(ValidationStepSchema).min(3).max(5),

  recommendation: RecommendationSchema,
})
export type OpportunityAssessmentContent = z.infer<typeof OpportunityAssessmentContentSchema>
