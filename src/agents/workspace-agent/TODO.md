# TODO(sprint-5): WorkspaceAgent

Provider: Anthropic Claude Sonnet 4.6 (tool_use + tool_choice)
Input: { userId, startupId, jobId, blueprintVersionId? }
Output: WorkspaceGraph (validated by WorkspaceGraphSchema)
Artifact: workspace_graph_versions

Module files:
- `index.ts` — WorkspaceAgent class
- `prompt.ts` — PROMPT_VERSION = 'workspace-v1.0'
- `context-builder.ts` — buildWorkspaceInput(db, startupId, blueprintVersionId?)
- `graph-normalizer.ts` — validateAndNormalize(graph): WorkspaceGraph
- `persist.ts`

Stages: seeding-graph → generating-pages → generating-data-layer → generating-services
        → generating-workflows → wiring-connectors → assembling-workspace

Seeding strategy: first 5 assets (Landing, Signup, Login, Dashboard, Settings)
are deterministically pre-populated BEFORE the Anthropic call.

After persistence: triggers PreviewContext generation (inline or child job).

Open question (spec §Open Questions #2): coordinate system for x/y/w/h
must be defined before this agent is implemented.
