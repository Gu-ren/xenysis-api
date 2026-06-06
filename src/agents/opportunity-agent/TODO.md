# TODO(sprint-3): OpportunityAgent

Provider: OpenAI GPT-4o (chat completions + JSON schema mode)
Input: { userId, startupId, jobId, sessionId }
Output: OpportunityAssessment (validated by OpportunityAssessmentSchema)
Artifact: opportunity_assessment_versions

Module files:
- `index.ts` — OpportunityAgent class
- `prompt.ts` — PROMPT_VERSION = 'opportunity-v1.0', buildSystemPrompt(), buildUserMessage()
- `context-builder.ts` — buildOpportunityInput(db, startupId, sessionId)
- `persist.ts` — createOrUpdateAssessment(db, ...)

Stages: analyzing-idea → market-analysis → customer-analysis → risk-analysis → scoring

Future: ResearchAgent and MarketAgent become private functions inside this module.
They write to ai_usage_log but do NOT create generation_jobs rows.
