import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import type { StructuredOutputSchema } from '../../lib/ai/adapters/index.ts'

// Provider-agnostic schema bundle for OpportunityAgent — v2.0.
//
// jsonSchema: JSON Schema Draft 7 object consumed directly by both adapters:
//   - OpenAIStructuredAdapter  → response_format.json_schema.schema
//   - AnthropicStructuredAdapter → tool.input_schema
// zodSchema: used for runtime validation after the model responds, regardless of provider.
//
// v2.0 adds scoreBreakdown, confidenceBreakdown, and validationGapSummary as required fields.
// The Zod zodSchema (opportunity-assessment.ts) keeps new fields optional for backward-compat
// reads of existing v1.0 rows; this JSON schema enforces v2.0 on all new generations.

const UNDERSTANDING_CATEGORY_ENUM = [
  'problem', 'customer', 'solution', 'market',
  'pricing', 'competition', 'risks', 'founder_fit',
]

const ASSESSMENT_TIER_ENUM = ['unknown', 'gap', 'assumption_based', 'validated']

const SCORE_DIMENSION_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['score', 'weight', 'rationale', 'tier'],
  properties: {
    score:     { type: 'integer' as const, minimum: 0, maximum: 100 },
    weight:    { type: 'integer' as const, minimum: 1, maximum: 40 },
    rationale: { type: 'string' as const },
    tier:      { type: 'string' as const, enum: ASSESSMENT_TIER_ENUM },
  },
}

const CATEGORY_EVIDENCE_QUALITY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['category', 'tier', 'evidenceStrength', 'confidence', 'qualityScore', 'label'],
  properties: {
    category:         { type: 'string' as const, enum: UNDERSTANDING_CATEGORY_ENUM },
    tier:             { type: 'string' as const, enum: ASSESSMENT_TIER_ENUM },
    evidenceStrength: { type: 'integer' as const, minimum: 1, maximum: 6 },
    confidence:       { type: 'integer' as const, minimum: 0, maximum: 100 },
    qualityScore:     { type: 'integer' as const, minimum: 0, maximum: 100 },
    label:            { type: 'string' as const },
  },
}

const VALIDATION_GAP_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['category', 'tier', 'gapDescription', 'riskIfUnfilled', 'priority', 'suggestedAction'],
  properties: {
    category:        { type: 'string' as const, enum: UNDERSTANDING_CATEGORY_ENUM },
    tier:            { type: 'string' as const, enum: ASSESSMENT_TIER_ENUM },
    gapDescription:  { type: 'string' as const },
    riskIfUnfilled:  { type: 'string' as const },
    priority:        { type: 'integer' as const, minimum: 1, maximum: 5 },
    suggestedAction: { type: 'string' as const },
  },
}

export const OPPORTUNITY_ASSESSMENT_SCHEMA: StructuredOutputSchema = {
  name:      'opportunity_assessment',
  zodSchema: OpportunityAssessmentContentSchema,
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      '_schemaVersion',
      'executiveSummary',
      'opportunityScore',
      'confidenceScore',
      'marketPotential',
      'founderFit',
      'competitiveAdvantage',
      'keyRisks',
      'validationPlan',
      'recommendation',
      'scoreBreakdown',
      'confidenceBreakdown',
      'validationGapSummary',
    ],
    properties: {
      _schemaVersion:   { type: 'string', enum: ['2.0'] },
      executiveSummary: { type: 'string' },
      opportunityScore: { type: 'integer', minimum: 0, maximum: 100 },
      confidenceScore:  { type: 'integer', minimum: 0, maximum: 100 },

      marketPotential: {
        type: 'object',
        additionalProperties: false,
        required: ['size', 'growth', 'score', 'narrative'],
        properties: {
          size:      { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          growth:    { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          score:     { type: 'integer', minimum: 0, maximum: 100 },
          narrative: { type: 'string' },
        },
      },

      founderFit: {
        type: 'object',
        additionalProperties: false,
        required: ['domainExpertise', 'customerAccess', 'executionCapability', 'score', 'narrative'],
        properties: {
          domainExpertise:     { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          customerAccess:      { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          executionCapability: { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          score:               { type: 'integer', minimum: 0, maximum: 100 },
          narrative:           { type: 'string' },
        },
      },

      competitiveAdvantage: {
        type: 'object',
        additionalProperties: false,
        required: ['moat', 'differentiators', 'defensibility', 'narrative'],
        properties: {
          moat:            { type: ['string', 'null'] },
          differentiators: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
          defensibility:   { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
          narrative:       { type: 'string' },
        },
      },

      keyRisks: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'title', 'description', 'severity', 'mitigation'],
          properties: {
            category:    { type: 'string', enum: UNDERSTANDING_CATEGORY_ENUM },
            title:       { type: 'string' },
            description: { type: 'string' },
            severity:    { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            mitigation:  { type: 'string' },
          },
        },
      },

      validationPlan: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priority', 'category', 'action', 'successCriteria', 'effort', 'timeline'],
          properties: {
            priority:        { type: 'integer', minimum: 1, maximum: 5 },
            category:        { type: 'string', enum: UNDERSTANDING_CATEGORY_ENUM },
            action:          { type: 'string' },
            successCriteria: { type: 'string' },
            effort:          { type: 'string', enum: ['low', 'medium', 'high'] },
            timeline:        { type: 'string' },
          },
        },
      },

      recommendation: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'rationale', 'nextSteps'],
        properties: {
          action:    { type: 'string', enum: ['proceed', 'proceed_with_caution', 'validate_first', 'pivot', 'pass'] },
          rationale: { type: 'string' },
          nextSteps: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
        },
      },

      // ── v2.0: Score Breakdown ───────────────────────────────────────────────
      scoreBreakdown: {
        type: 'object',
        additionalProperties: false,
        required: ['problemStrength', 'customerClarity', 'marketPotential', 'competitiveAdvantage', 'founderFit'],
        properties: {
          problemStrength:      SCORE_DIMENSION_SCHEMA,
          customerClarity:      SCORE_DIMENSION_SCHEMA,
          marketPotential:      SCORE_DIMENSION_SCHEMA,
          competitiveAdvantage: SCORE_DIMENSION_SCHEMA,
          founderFit:           SCORE_DIMENSION_SCHEMA,
        },
      },

      // ── v2.0: Confidence Breakdown ──────────────────────────────────────────
      confidenceBreakdown: {
        type: 'object',
        additionalProperties: false,
        required: ['categories', 'strongCategories', 'weakCategories', 'missingCategories', 'computedScore', 'adjustmentRationale'],
        properties: {
          categories:          { type: 'array', items: CATEGORY_EVIDENCE_QUALITY_SCHEMA },
          strongCategories:    { type: 'array', items: { type: 'string', enum: UNDERSTANDING_CATEGORY_ENUM } },
          weakCategories:      { type: 'array', items: { type: 'string', enum: UNDERSTANDING_CATEGORY_ENUM } },
          missingCategories:   { type: 'array', items: { type: 'string', enum: UNDERSTANDING_CATEGORY_ENUM } },
          computedScore:       { type: 'integer', minimum: 0, maximum: 100 },
          adjustmentRationale: { type: ['string', 'null'] },
        },
      },

      // ── v2.0: Validation Gap Summary ────────────────────────────────────────
      validationGapSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['gaps', 'evidenceStrength', 'overallGapRisk'],
        properties: {
          gaps:             { type: 'array', items: VALIDATION_GAP_SCHEMA, maxItems: 8 },
          evidenceStrength: { type: 'string' },
          overallGapRisk:   { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        },
      },
    },
  },
}
