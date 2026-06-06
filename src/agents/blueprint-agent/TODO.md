# TODO(sprint-4): BlueprintAgent

Provider: Anthropic Claude Sonnet 4.6 (tool_use + tool_choice)
Input: { userId, startupId, jobId, sessionId, assessmentVersionId? }
Output: StartupBlueprint (validated by StartupBlueprintSchema)
Artifact: blueprint_versions

Module files:
- `index.ts` — BlueprintAgent class
- `prompt.ts` — PROMPT_VERSION = 'blueprint-v1.0'
- `context-builder.ts` — buildBlueprintInput(db, startupId, sessionId, assessmentVersionId?)
- `persist.ts`

Stages: business-model → system-planning → mvp-scope → pricing-design → entity-mapping

Anthropic invocation pattern:
  anthropic.messages.create({
    tools: [{ name: 'generate_blueprint', input_schema: StartupBlueprintJsonSchema }],
    tool_choice: { type: 'tool', name: 'generate_blueprint' },
    ...
  })
