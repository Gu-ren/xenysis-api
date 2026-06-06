# TODO(sprint-2): Agent base infrastructure

Files to create:

- `agent.interface.ts` — `Agent<TInput, TOutput>` interface, `AgentInput`, `AgentContext`
- `events.ts` — `GenerationEvent` discriminated union (stage, progress, log, complete, error)
- `runner.ts` — `AgentRunner`: retry loop, job state transitions, SSE event forwarding
- `utils.ts` — `trackUsage()`, `logActivity()`, `fromAnthropic()`, `fromOpenAI()`

See XENYSIS_BACKEND_SPEC.md §Agent Architecture for full interface contracts.

Rule: Every Anthropic/OpenAI call MUST call trackUsage() immediately after response.
