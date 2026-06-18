import type { BlueprintContent } from '../../lib/contracts/blueprint.ts'

// Returned by BlueprintAgent.execute() on successful generation.
export interface BlueprintAgentOutput {
  blueprintId:   string
  versionId:     string
  versionNumber: number
  content:       BlueprintContent
}
