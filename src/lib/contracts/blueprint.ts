import { z } from 'zod'

export const BLUEPRINT_SCHEMA_VERSION = '1.0' as const

// ── Shared primitives ─────────────────────────────────────────────────────────

export const MoSCoWPrioritySchema = z.enum(['must_have', 'should_have', 'nice_to_have', 'wont_have'])
export type MoSCoWPriority = z.infer<typeof MoSCoWPrioritySchema>

export const EffortLevelSchema = z.enum(['low', 'medium', 'high', 'very_high'])
export type EffortLevel = z.infer<typeof EffortLevelSchema>

export const EmotionSchema = z.enum([
  'frustrated', 'confused', 'neutral', 'interested', 'satisfied', 'delighted',
])
export type Emotion = z.infer<typeof EmotionSchema>

export const RatingSchema = z.enum(['low', 'medium', 'high', 'very_high'])
export type Rating = z.infer<typeof RatingSchema>

export const RiskSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>

// ── Section: Overview ─────────────────────────────────────────────────────────
// Maps to the Blueprint header card and positioning summary panel.

export const BlueprintOverviewSchema = z.object({
  // Punchy one-liner for the product — used in UI header and Workspace preview.
  tagline: z.string().min(1).max(160),
  // Classic positioning statement: "For [target], [product] is a [category] that [key benefit],
  // unlike [alternative], we [differentiator]."
  positionStatement: z.string().min(1).max(500),
  coreValueProposition: z.string().min(1).max(600),
  targetMarketSummary: z.string().min(1).max(400),
})
export type BlueprintOverview = z.infer<typeof BlueprintOverviewSchema>

// ── Section: Problem ─────────────────────────────────────────────────────────
// Maps to the Problem deep-dive panel. Inherits from OA problem signal.

export const BlueprintProblemSchema = z.object({
  statement: z.string().min(1).max(600),
  // Ordered by severity descending — UI renders as an impact list.
  painPoints: z.array(z.string().min(1).max(250)).min(2).max(6),
  // What people do today without this solution — validates market awareness.
  currentAlternatives: z.array(z.string().min(1).max(250)).min(1).max(4),
  // Why this problem is urgent/solvable now (timing, tech shift, regulation, etc.)
  whyNow: z.string().min(1).max(400),
  problemSeverity: RatingSchema,
})
export type BlueprintProblem = z.infer<typeof BlueprintProblemSchema>

// ── Section: Customer ─────────────────────────────────────────────────────────
// Maps to the Customer panel with ICP card and segment breakdown.

export const CustomerSegmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(400),
  // Key observable traits — demographics, behaviors, firmographics, etc.
  characteristics: z.array(z.string().min(1).max(200)).min(2).max(6),
  // Human-readable estimate: "~500K SMBs in the US" — not false precision.
  estimatedSize: z.string().min(1).max(150),
  // True when this segment is both the buyer and the primary revenue source.
  isPrimaryBuyer: z.boolean(),
})
export type CustomerSegment = z.infer<typeof CustomerSegmentSchema>

export const BlueprintCustomerSchema = z.object({
  icp: z.object({
    title: z.string().min(1).max(100),         // e.g. "Head of Operations at 10–50 person SaaS"
    description: z.string().min(1).max(400),
    jobToBeDone: z.string().min(1).max(300),   // JTBD framing for product decisions
    // Flags whether the person who buys is different from the person who uses.
    // 'different' means a separate sales motion (e.g. top-down enterprise).
    buyerVsUser: z.enum(['same', 'different', 'both']),
  }),
  segments: z.array(CustomerSegmentSchema).min(1).max(4),
})
export type BlueprintCustomer = z.infer<typeof BlueprintCustomerSchema>

// ── Section: Solution ─────────────────────────────────────────────────────────
// Maps to the Solution panel. Workspace generator uses coreCapabilities as
// feature node seeds.

export const BlueprintSolutionSchema = z.object({
  description: z.string().min(1).max(600),
  // 2–6 core capabilities the product delivers — consumed by Workspace as feature seeds.
  coreCapabilities: z.array(z.string().min(1).max(250)).min(2).max(6),
  // What makes this solution better — not the same as OA.competitiveAdvantage.
  differentiators: z.array(z.string().min(1).max(250)).min(1).max(4),
  // Structural advantage that is hard to copy (network effects, proprietary data, etc.)
  // Nullable because most v0 products don't yet have a true moat.
  unfairAdvantage: z.string().max(300).nullable(),
  // Optional — only populated when tech approach materially shapes the product's viability.
  technologyApproach: z.string().max(400).nullable(),
})
export type BlueprintSolution = z.infer<typeof BlueprintSolutionSchema>

// ── Section: Business Model ────────────────────────────────────────────────────
// Maps to the Business Model panel. GTM motion drives Workspace asset selection.

export const RevenueStreamSchema = z.object({
  type: z.enum([
    'subscription', 'usage', 'one_time', 'freemium',
    'marketplace', 'enterprise', 'other',
  ]),
  description: z.string().min(1).max(300),
  // Intentionally a string to prevent false precision: "~$49/seat/month".
  pricingHypothesis: z.string().min(1).max(200),
  isPrimary: z.boolean(),
})
export type RevenueStream = z.infer<typeof RevenueStreamSchema>

export const BlueprintBusinessModelSchema = z.object({
  revenueStreams: z.array(RevenueStreamSchema).min(1).max(4),
  // Narrative on LTV/CAC hypothesis and payback period at a high level.
  unitEconomicsHypothesis: z.string().min(1).max(400),
  goToMarketSummary: z.string().min(1).max(500),
  gtmMotion: z.enum([
    'product_led', 'sales_led', 'community_led', 'partnership_led', 'marketing_led',
  ]),
  // Ordered by priority — first channel is primary.
  keyChannels: z.array(z.string().min(1).max(150)).min(1).max(5),
})
export type BlueprintBusinessModel = z.infer<typeof BlueprintBusinessModelSchema>

// ── Section: Personas ─────────────────────────────────────────────────────────
// Maps to the Personas panel. Up to 3 personas; exactly 1 must have isPrimary=true.
// Workspace generator creates persona cards from this section.

export const PersonaSchema = z.object({
  // Descriptive handle: "Sarah — Overwhelmed Ops Manager"
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  // Age range, company stage, team size, etc. — qualitative, not a data table.
  demographics: z.string().min(1).max(200),
  goals: z.array(z.string().min(1).max(200)).min(2).max(4),
  frustrations: z.array(z.string().min(1).max(200)).min(2).max(4),
  // Observable daily behaviors relevant to the problem domain.
  behaviors: z.array(z.string().min(1).max(200)).min(1).max(4),
  techSavviness: z.enum(['low', 'medium', 'high']),
  isPrimary: z.boolean(),
})
export type Persona = z.infer<typeof PersonaSchema>

export const BlueprintPersonasSchema = z.object({
  personas: z.array(PersonaSchema).min(1).max(3),
})
export type BlueprintPersonas = z.infer<typeof BlueprintPersonasSchema>

// ── Section: User Journeys ────────────────────────────────────────────────────
// Maps to the User Journeys panel. Stages feed the "before/after" flow diagram.

export const JourneyStageSchema = z.object({
  stage: z.string().min(1).max(80),    // "Discover", "Onboard", "Core Loop", etc.
  action: z.string().min(1).max(300),  // What the user does at this stage
  emotion: EmotionSchema,
  // Friction point at this stage — null if the stage is already working well.
  painPoint: z.string().max(250).nullable(),
  // Where the product can intervene or add value at this stage.
  opportunity: z.string().max(250).nullable(),
})
export type JourneyStage = z.infer<typeof JourneyStageSchema>

export const UserJourneySchema = z.object({
  // Must match a persona name from BlueprintPersonas.
  personaName: z.string().min(1).max(100),
  // One-sentence context for what triggers this journey.
  scenario: z.string().min(1).max(300),
  stages: z.array(JourneyStageSchema).min(3).max(7),
  // Key takeaway that informs a product decision.
  keyInsight: z.string().min(1).max(300),
})
export type UserJourney = z.infer<typeof UserJourneySchema>

export const BlueprintUserJourneysSchema = z.object({
  // Min 1 (primary persona), max 2 (primary + secondary buyer if buyerVsUser=different).
  journeys: z.array(UserJourneySchema).min(1).max(2),
})
export type BlueprintUserJourneys = z.infer<typeof BlueprintUserJourneysSchema>

// ── Section: MVP Scope ────────────────────────────────────────────────────────
// Maps to the MVP Scope panel. Workspace generator reads scope items as cards.

export const ScopeItemSchema = z.object({
  feature: z.string().min(1).max(150),
  rationale: z.string().min(1).max(300),
  priority: MoSCoWPrioritySchema,
})
export type ScopeItem = z.infer<typeof ScopeItemSchema>

export const BlueprintMvpScopeSchema = z.object({
  // The falsifiable hypothesis the MVP is designed to test.
  hypothesis: z.string().min(1).max(500),
  // What "success" looks like at the end of the MVP phase.
  successCriteria: z.string().min(1).max(400),
  scope: z.array(ScopeItemSchema).min(3).max(12),
  // Deliberate exclusions — prevents scope creep and clarifies tradeoffs.
  outOfScope: z.array(z.string().min(1).max(200)).min(1).max(6),
  // Human-readable estimate: "6–10 weeks with 2 engineers"
  estimatedBuildTime: z.string().min(1).max(100),
})
export type BlueprintMvpScope = z.infer<typeof BlueprintMvpScopeSchema>

// ── Section: Requirements ─────────────────────────────────────────────────────
// Maps to the Requirements panel. Functional reqs feed Workspace feature nodes.

export const RequirementSchema = z.object({
  // Prefix-namespaced ID generated by the model: "F-001" (functional), "NF-001" (non-functional).
  id: z.string().min(1).max(20),
  type: z.enum(['functional', 'non_functional']),
  // Grouping label: "Auth", "Data Storage", "Performance", "Security", etc.
  category: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
  priority: MoSCoWPrioritySchema,
  // Concrete, testable condition that proves the requirement is met.
  acceptanceCriteria: z.string().min(1).max(400),
})
export type Requirement = z.infer<typeof RequirementSchema>

export const BlueprintRequirementsSchema = z.object({
  functional: z.array(RequirementSchema).min(3).max(15),
  nonFunctional: z.array(RequirementSchema).min(2).max(8),
})
export type BlueprintRequirements = z.infer<typeof BlueprintRequirementsSchema>

// ── Section: Roadmap ─────────────────────────────────────────────────────────
// Maps to the Roadmap panel. Phases feed Workspace timeline cards.

export const MilestoneSchema = z.object({
  phase: z.number().int().min(1).max(5),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(400),
  // Concrete output of this phase — not goals, but artifacts or states.
  deliverables: z.array(z.string().min(1).max(200)).min(1).max(6),
  // Single measurable signal that confirms this phase succeeded.
  successMetric: z.string().min(1).max(300),
  estimatedDuration: z.string().min(1).max(80),
  // Phase names or milestone names that must complete before this phase can start.
  dependencies: z.array(z.string().max(100)),
})
export type Milestone = z.infer<typeof MilestoneSchema>

export const BlueprintRoadmapSchema = z.object({
  milestones: z.array(MilestoneSchema).min(2).max(5),
  // Human-readable end-to-end timeline: "18–24 months to Series A readiness"
  totalEstimatedTimeline: z.string().min(1).max(100),
  // Which phase or milestone is the highest dependency — where delay is fatal.
  criticalPath: z.string().min(1).max(400),
})
export type BlueprintRoadmap = z.infer<typeof BlueprintRoadmapSchema>

// ── Section: Risks ────────────────────────────────────────────────────────────
// Blueprint-specific risk taxonomy, separate from OA risk categories which are
// evidence-tier-linked. These risks are execution-level (build/GTM/adoption).

export const BlueprintRiskCategorySchema = z.enum([
  'product', 'market', 'technical', 'customer_adoption',
  'competition', 'regulatory', 'team', 'financial',
])
export type BlueprintRiskCategory = z.infer<typeof BlueprintRiskCategorySchema>

export const BlueprintRiskSchema = z.object({
  category: BlueprintRiskCategorySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  severity: RiskSeveritySchema,
  mitigation: z.string().min(1).max(300),
  // Roadmap phase where this risk is most acute. Null if risk spans all phases.
  phase: z.number().int().min(1).max(5).nullable(),
})
export type BlueprintRisk = z.infer<typeof BlueprintRiskSchema>

export const BlueprintRisksSchema = z.object({
  risks: z.array(BlueprintRiskSchema).min(3).max(8),
})
export type BlueprintRisks = z.infer<typeof BlueprintRisksSchema>

// ── Section: Metrics ─────────────────────────────────────────────────────────
// Maps to the Metrics panel. Workspace generator uses north star for the
// primary OKR card.

export const MetricSchema = z.object({
  name: z.string().min(1).max(100),
  // AARRR + operational framing — drives which dashboard widget the Workspace uses.
  category: z.enum([
    'acquisition', 'activation', 'retention', 'revenue',
    'referral', 'engagement', 'operational',
  ]),
  description: z.string().min(1).max(300),
  // Target is a string to prevent false precision: "> 40% DAU/MAU", "< $5 CAC".
  target: z.string().min(1).max(150),
  // How this is actually measured — tool, event, query, etc.
  measurementMethod: z.string().min(1).max(200),
  // Which roadmap phase this metric becomes the primary tracking focus.
  phase: z.number().int().min(1).max(5),
})
export type Metric = z.infer<typeof MetricSchema>

export const BlueprintMetricsSchema = z.object({
  northStar: z.object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    // Why this metric, not another — e.g. "reflects value delivery, not vanity growth".
    rationale: z.string().min(1).max(300),
    target: z.string().min(1).max(150),
  }),
  // Supporting KPIs — 3–12, covering all roadmap phases.
  metrics: z.array(MetricSchema).min(3).max(12),
})
export type BlueprintMetrics = z.infer<typeof BlueprintMetricsSchema>

// ── Root schema ───────────────────────────────────────────────────────────────
// _schemaVersion is a literal for now. Expand to a union when v2.0 ships, keeping
// all new fields optional so existing v1.0 rows parse without error.
//
// Versioning strategy:
//   - Write contract (JSON schema in blueprint-agent/schemas.ts): always enforces
//     the current version. New generations MUST produce valid v1.0.
//   - Read contract (this Zod schema): expanded to a union on each version bump.
//     Old rows remain parseable.
//   - blueprint_versions.versionNumber: auto-incremented per startup, monotonic.
//     The row with isCurrent=true is the live version. History is never deleted.
//
// Schema evolution strategy:
//   - Adding optional fields: safe — add with .optional() here AND as a non-required
//     JSON schema property. Old rows parse; new generations include the field.
//   - Renaming fields: breaking change. Bump schemaVersion, keep old field as .optional()
//     in the Zod read schema, require new field only in the JSON write schema.
//   - Removing fields: treat as a rename (alias old field, mark deprecated).
//   - Changing enum values: breaking change. Bump schemaVersion; use z.union on
//     enum values in the Zod schema to handle both old and new values in reads.
//
// Workspace generation contract:
//   Each section maps to a Workspace generator input:
//     personas       → PersonaCard nodes
//     userJourneys   → JourneyMap nodes
//     mvpScope       → FeatureCard nodes (must_have scope items)
//     requirements   → SpecCard nodes (functional requirements)
//     roadmap        → MilestoneCard nodes
//     businessModel  → GTMCard and RevenueCard nodes
//     metrics        → MetricCard nodes (northStar as primary OKR)

export const BlueprintContentSchema = z.object({
  _schemaVersion: z.literal('1.0'),

  overview:      BlueprintOverviewSchema,
  problem:       BlueprintProblemSchema,
  customer:      BlueprintCustomerSchema,
  solution:      BlueprintSolutionSchema,
  businessModel: BlueprintBusinessModelSchema,
  personas:      BlueprintPersonasSchema,
  userJourneys:  BlueprintUserJourneysSchema,
  mvpScope:      BlueprintMvpScopeSchema,
  requirements:  BlueprintRequirementsSchema,
  roadmap:       BlueprintRoadmapSchema,
  risks:         BlueprintRisksSchema,
  metrics:       BlueprintMetricsSchema,
})
export type BlueprintContent = z.infer<typeof BlueprintContentSchema>
