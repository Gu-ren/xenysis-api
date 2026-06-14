import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import type { StructuredOutputSchema } from '../../lib/ai/adapters/index.ts'

// Provider-agnostic schema bundle for OpportunityAgent.
//
// jsonSchema: JSON Schema Draft 7 object consumed directly by both adapters:
//   - OpenAIStructuredAdapter  → response_format.json_schema.schema
//   - AnthropicStructuredAdapter → tool.input_schema
// zodSchema: used for runtime validation after the model responds, regardless of provider.
//
// No SDK imports here. This file is data, not behavior.
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
    ],
    properties: {
      _schemaVersion:   { type: 'string', enum: ['1.0'] },
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
            category:    { type: 'string', enum: ['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit'] },
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
            category:        { type: 'string', enum: ['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit'] },
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
    },
  },
}
