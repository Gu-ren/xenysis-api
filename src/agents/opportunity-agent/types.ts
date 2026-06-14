import type { OpportunityAssessmentContent } from '../../lib/contracts/opportunity-assessment.ts'

// Returned by OpportunityAgent.execute() on successful generation.
export interface OpportunityAgentOutput {
  assessmentId:  string
  versionId:     string
  versionNumber: number
  content:       OpportunityAssessmentContent
}
