import type { AgentInput } from '../base/agent.interface.ts'
import type { FounderMemory } from '../../lib/contracts/founder-memory.ts'
import type { FounderUnderstanding } from '../../lib/contracts/founder-understanding.ts'
import type { SessionSummary } from '../../lib/contracts/session-summary.ts'
import type { ConfidenceBreakdown, ValidationGapSummary } from '../../lib/contracts/opportunity-assessment.ts'
import type { Startup } from '../../lib/db/schema/startups.ts'
import type { EvidenceRecordRow } from '../../lib/db/schema/understanding.ts'

// OpportunityAgent input — assembled by context-builder.ts, not passed directly from the route.
//
// Primary sources (required):
//   founder_memories       → founderMemory         (narrative + per-category confidence/evidence)
//   founder_understanding  → understanding         (completion state, evidence strength, warnings)
//   evidence_records       → evidenceRecords       (quality audit trail, filtered to this session)
//   startups               → startup               (name, description, category, lifecycleStage)
//
// Pre-computed before LLM call (v2.0):
//   computeEvidenceConfidence() → preComputedConfidence  (deterministic confidence breakdown)
//   computeValidationGaps()     → preComputedGaps        (gap list keyed from assessmentTier)
//
// Supplemental (optional):
//   session_summaries      → latestSummary         (rolling conversation summary for additional context)
//
// Raw chat history is NOT included. The memory + understanding pipeline is the source of truth.
export interface OpportunityAgentInput extends AgentInput {
  sessionId:             string
  startup:               Startup               // name, description, category, lifecycleStage
  founderMemory:         FounderMemory         // merged narrative + per-category confidence/evidence
  understanding:         FounderUnderstanding  // per-category confidence, completion state, warnings
  evidenceRecords:       EvidenceRecordRow[]   // evidence quality audit trail for this session
  preComputedConfidence: ConfidenceBreakdown   // deterministic evidence quality — LLM confidence anchor
  preComputedGaps:       ValidationGapSummary  // validation gaps derived from assessmentTier
  latestSummary?:        SessionSummary        // supplemental rolling summary (may be absent)
}
