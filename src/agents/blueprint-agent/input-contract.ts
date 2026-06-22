import type { AgentInput } from '../base/agent.interface.ts'
import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { FounderUnderstanding } from '../../lib/contracts/founder-understanding.ts'
import type { OpportunityAssessmentContent } from '../../lib/contracts/opportunity-assessment.ts'
import type { Startup } from '../../lib/db/schema/startups.ts'

// BlueprintAgent input — assembled by context-builder.ts.
//
// Primary sources (required):
//   startups                        → startup       (name, description, category, lifecycleStage)
//   founder_memories                → founderMemory  (narrative + per-category signals)
//   founder_understanding           → understanding  (per-category confidence, gaps, warnings)
//   opportunity_assessment_versions → assessment     (current validated OA content)
//
// assessmentId links the generated blueprint row back to the parent
// opportunity_assessments row via blueprints.assessment_id.
//
// sessionId is carried from opportunityAssessments.sessionId so the blueprint
// row references the same session that produced the upstream assessment.
export interface BlueprintAgentInput extends AgentInput {
  sessionId:    string
  assessmentId: string
  startup:      Startup
  founderMemory: FounderMemory
  understanding: FounderUnderstanding
  assessment:   OpportunityAssessmentContent
}
