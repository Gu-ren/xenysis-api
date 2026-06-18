import { BlueprintContentSchema } from '../../lib/contracts/blueprint.ts'
import type { StructuredOutputSchema } from '../../lib/ai/adapters/index.ts'

// Provider-agnostic schema bundle for BlueprintAgent — v1.0.
//
// jsonSchema: JSON Schema Draft 7 object consumed directly by both adapters:
//   - OpenAIStructuredAdapter  → response_format.json_schema.schema
//   - AnthropicStructuredAdapter → tool.input_schema
// zodSchema: used for runtime validation after the model responds.
//
// ALL objects use additionalProperties: false — required for OpenAI strict mode.
// ALL required arrays are exhaustive — no optional fields in the JSON schema.
// The Zod zodSchema (blueprint.ts) is the read contract (used for validation of
// existing DB rows). This JSON schema is the write contract (enforces v1.0 shape).

// ── Shared enum constants ─────────────────────────────────────────────────────

const RATING_ENUM = ['low', 'medium', 'high', 'very_high'] as const
const RISK_SEVERITY_ENUM = ['low', 'medium', 'high', 'critical'] as const
const MOSCOW_ENUM = ['must_have', 'should_have', 'nice_to_have', 'wont_have'] as const
const EMOTION_ENUM = ['frustrated', 'confused', 'neutral', 'interested', 'satisfied', 'delighted'] as const

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const SCOPE_ITEM_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['feature', 'rationale', 'priority'],
  properties: {
    feature:   { type: 'string' as const },
    rationale: { type: 'string' as const },
    priority:  { type: 'string' as const, enum: MOSCOW_ENUM },
  },
}

const REQUIREMENT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['id', 'type', 'category', 'description', 'priority', 'acceptanceCriteria'],
  properties: {
    id:                 { type: 'string' as const },
    type:               { type: 'string' as const, enum: ['functional', 'non_functional'] },
    category:           { type: 'string' as const },
    description:        { type: 'string' as const },
    priority:           { type: 'string' as const, enum: MOSCOW_ENUM },
    acceptanceCriteria: { type: 'string' as const },
  },
}

const CUSTOMER_SEGMENT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['name', 'description', 'characteristics', 'estimatedSize', 'isPrimaryBuyer'],
  properties: {
    name:             { type: 'string' as const },
    description:      { type: 'string' as const },
    characteristics:  { type: 'array' as const, items: { type: 'string' as const }, minItems: 2, maxItems: 6 },
    estimatedSize:    { type: 'string' as const },
    isPrimaryBuyer:   { type: 'boolean' as const },
  },
}

const REVENUE_STREAM_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['type', 'description', 'pricingHypothesis', 'isPrimary'],
  properties: {
    type:              { type: 'string' as const, enum: ['subscription', 'usage', 'one_time', 'freemium', 'marketplace', 'enterprise', 'other'] },
    description:       { type: 'string' as const },
    pricingHypothesis: { type: 'string' as const },
    isPrimary:         { type: 'boolean' as const },
  },
}

const JOURNEY_STAGE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['stage', 'action', 'emotion', 'painPoint', 'opportunity'],
  properties: {
    stage:       { type: 'string' as const },
    action:      { type: 'string' as const },
    emotion:     { type: 'string' as const, enum: EMOTION_ENUM },
    painPoint:   { type: ['string', 'null'] as const },
    opportunity: { type: ['string', 'null'] as const },
  },
}

const PERSONA_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['name', 'role', 'demographics', 'goals', 'frustrations', 'behaviors', 'techSavviness', 'isPrimary'],
  properties: {
    name:          { type: 'string' as const },
    role:          { type: 'string' as const },
    demographics:  { type: 'string' as const },
    goals:         { type: 'array' as const, items: { type: 'string' as const }, minItems: 2, maxItems: 4 },
    frustrations:  { type: 'array' as const, items: { type: 'string' as const }, minItems: 2, maxItems: 4 },
    behaviors:     { type: 'array' as const, items: { type: 'string' as const }, minItems: 1, maxItems: 4 },
    techSavviness: { type: 'string' as const, enum: ['low', 'medium', 'high'] },
    isPrimary:     { type: 'boolean' as const },
  },
}

const MILESTONE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['phase', 'name', 'description', 'deliverables', 'successMetric', 'estimatedDuration', 'dependencies'],
  properties: {
    phase:              { type: 'integer' as const, minimum: 1, maximum: 5 },
    name:               { type: 'string' as const },
    description:        { type: 'string' as const },
    deliverables:       { type: 'array' as const, items: { type: 'string' as const }, minItems: 1, maxItems: 6 },
    successMetric:      { type: 'string' as const },
    estimatedDuration:  { type: 'string' as const },
    dependencies:       { type: 'array' as const, items: { type: 'string' as const } },
  },
}

const BLUEPRINT_RISK_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['category', 'title', 'description', 'severity', 'mitigation', 'phase'],
  properties: {
    category:    { type: 'string' as const, enum: ['product', 'market', 'technical', 'customer_adoption', 'competition', 'regulatory', 'team', 'financial'] },
    title:       { type: 'string' as const },
    description: { type: 'string' as const },
    severity:    { type: 'string' as const, enum: RISK_SEVERITY_ENUM },
    mitigation:  { type: 'string' as const },
    // Integer or null — OpenAI strict mode requires both types in the enum.
    phase:       { type: ['integer', 'null'] as const, minimum: 1, maximum: 5 },
  },
}

const METRIC_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['name', 'category', 'description', 'target', 'measurementMethod', 'phase'],
  properties: {
    name:              { type: 'string' as const },
    category:          { type: 'string' as const, enum: ['acquisition', 'activation', 'retention', 'revenue', 'referral', 'engagement', 'operational'] },
    description:       { type: 'string' as const },
    target:            { type: 'string' as const },
    measurementMethod: { type: 'string' as const },
    phase:             { type: 'integer' as const, minimum: 1, maximum: 5 },
  },
}

// ── Root JSON schema ──────────────────────────────────────────────────────────

export const BLUEPRINT_SCHEMA: StructuredOutputSchema = {
  name:      'blueprint_content',
  zodSchema: BlueprintContentSchema,
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      '_schemaVersion',
      'overview',
      'problem',
      'customer',
      'solution',
      'businessModel',
      'personas',
      'userJourneys',
      'mvpScope',
      'requirements',
      'roadmap',
      'risks',
      'metrics',
    ],
    properties: {
      _schemaVersion: { type: 'string', enum: ['1.0'] },

      // ── Overview ────────────────────────────────────────────────────────────
      overview: {
        type: 'object',
        additionalProperties: false,
        required: ['tagline', 'positionStatement', 'coreValueProposition', 'targetMarketSummary'],
        properties: {
          tagline:              { type: 'string' },
          positionStatement:    { type: 'string' },
          coreValueProposition: { type: 'string' },
          targetMarketSummary:  { type: 'string' },
        },
      },

      // ── Problem ─────────────────────────────────────────────────────────────
      problem: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'painPoints', 'currentAlternatives', 'whyNow', 'problemSeverity'],
        properties: {
          statement:           { type: 'string' },
          painPoints:          { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
          currentAlternatives: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          whyNow:              { type: 'string' },
          problemSeverity:     { type: 'string', enum: RATING_ENUM },
        },
      },

      // ── Customer ────────────────────────────────────────────────────────────
      customer: {
        type: 'object',
        additionalProperties: false,
        required: ['icp', 'segments'],
        properties: {
          icp: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'description', 'jobToBeDone', 'buyerVsUser'],
            properties: {
              title:       { type: 'string' },
              description: { type: 'string' },
              jobToBeDone: { type: 'string' },
              buyerVsUser: { type: 'string', enum: ['same', 'different', 'both'] },
            },
          },
          segments: {
            type: 'array',
            items: CUSTOMER_SEGMENT_SCHEMA,
            minItems: 1,
            maxItems: 4,
          },
        },
      },

      // ── Solution ────────────────────────────────────────────────────────────
      solution: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'coreCapabilities', 'differentiators', 'unfairAdvantage', 'technologyApproach'],
        properties: {
          description:        { type: 'string' },
          coreCapabilities:   { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
          differentiators:    { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          unfairAdvantage:    { type: ['string', 'null'] },
          technologyApproach: { type: ['string', 'null'] },
        },
      },

      // ── Business Model ───────────────────────────────────────────────────────
      businessModel: {
        type: 'object',
        additionalProperties: false,
        required: ['revenueStreams', 'unitEconomicsHypothesis', 'goToMarketSummary', 'gtmMotion', 'keyChannels'],
        properties: {
          revenueStreams:           { type: 'array', items: REVENUE_STREAM_SCHEMA, minItems: 1, maxItems: 4 },
          unitEconomicsHypothesis:  { type: 'string' },
          goToMarketSummary:        { type: 'string' },
          gtmMotion:                { type: 'string', enum: ['product_led', 'sales_led', 'community_led', 'partnership_led', 'marketing_led'] },
          keyChannels:              { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
        },
      },

      // ── Personas ────────────────────────────────────────────────────────────
      personas: {
        type: 'object',
        additionalProperties: false,
        required: ['personas'],
        properties: {
          personas: { type: 'array', items: PERSONA_SCHEMA, minItems: 1, maxItems: 3 },
        },
      },

      // ── User Journeys ────────────────────────────────────────────────────────
      userJourneys: {
        type: 'object',
        additionalProperties: false,
        required: ['journeys'],
        properties: {
          journeys: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['personaName', 'scenario', 'stages', 'keyInsight'],
              properties: {
                personaName: { type: 'string' },
                scenario:    { type: 'string' },
                stages:      { type: 'array', items: JOURNEY_STAGE_SCHEMA, minItems: 3, maxItems: 7 },
                keyInsight:  { type: 'string' },
              },
            },
          },
        },
      },

      // ── MVP Scope ────────────────────────────────────────────────────────────
      mvpScope: {
        type: 'object',
        additionalProperties: false,
        required: ['hypothesis', 'successCriteria', 'scope', 'outOfScope', 'estimatedBuildTime'],
        properties: {
          hypothesis:         { type: 'string' },
          successCriteria:    { type: 'string' },
          scope:              { type: 'array', items: SCOPE_ITEM_SCHEMA, minItems: 3, maxItems: 12 },
          outOfScope:         { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
          estimatedBuildTime: { type: 'string' },
        },
      },

      // ── Requirements ─────────────────────────────────────────────────────────
      requirements: {
        type: 'object',
        additionalProperties: false,
        required: ['functional', 'nonFunctional'],
        properties: {
          functional:    { type: 'array', items: REQUIREMENT_SCHEMA, minItems: 3, maxItems: 15 },
          nonFunctional: { type: 'array', items: REQUIREMENT_SCHEMA, minItems: 2, maxItems: 8 },
        },
      },

      // ── Roadmap ──────────────────────────────────────────────────────────────
      roadmap: {
        type: 'object',
        additionalProperties: false,
        required: ['milestones', 'totalEstimatedTimeline', 'criticalPath'],
        properties: {
          milestones:             { type: 'array', items: MILESTONE_SCHEMA, minItems: 2, maxItems: 5 },
          totalEstimatedTimeline: { type: 'string' },
          criticalPath:           { type: 'string' },
        },
      },

      // ── Risks ────────────────────────────────────────────────────────────────
      risks: {
        type: 'object',
        additionalProperties: false,
        required: ['risks'],
        properties: {
          risks: { type: 'array', items: BLUEPRINT_RISK_SCHEMA, minItems: 3, maxItems: 8 },
        },
      },

      // ── Metrics ──────────────────────────────────────────────────────────────
      metrics: {
        type: 'object',
        additionalProperties: false,
        required: ['northStar', 'metrics'],
        properties: {
          northStar: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'description', 'rationale', 'target'],
            properties: {
              name:        { type: 'string' },
              description: { type: 'string' },
              rationale:   { type: 'string' },
              target:      { type: 'string' },
            },
          },
          metrics: { type: 'array', items: METRIC_SCHEMA, minItems: 3, maxItems: 12 },
        },
      },
    },
  },
}
