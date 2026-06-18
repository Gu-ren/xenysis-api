# Xenysis API — CLAUDE.md

## Product

Xenysis is an AI Technical Cofounder. It turns startup ideas into startup blueprints through a structured founder conversation.

**User journey:** Founder Session → Opportunity Assessment → Startup Blueprint

---

## Tech Stack

- Hono (HTTP server)
- TypeScript + Zod
- Drizzle ORM + Postgres
- OpenAI GPT-4o (chat + extraction)
- Claude Sonnet 4.6 (blueprint generation)
- Server-Sent Events (SSE) for chat streaming

---

## Repository Layout

```
src/
  agents/
    base/               — shared agent interface, logActivity, trackUsage
    blueprint-agent/    — generates the Startup Blueprint (Claude)
    opportunity-agent/  — generates the Opportunity Assessment (Claude)
  lib/
    ai/                 — provider adapters (OpenAI, Anthropic)
    contracts/          — Zod schemas for all cross-layer data shapes
    db/schema/          — Drizzle table definitions
    evidence/           — confidence.ts, gaps.ts (pure functions, no DB)
  modules/
    founder-sessions/   — chat SSE endpoint, memory extraction, session router
    blueprint/          — blueprint generation router
    opportunity/        — opportunity assessment router
    startups/           — startup CRUD
    auth/               — auth middleware
  services/
    understanding-engine.ts   — core engine: builds FounderUnderstanding per turn
drizzle/migrations/           — numbered SQL migration files
tests/                        — Vitest integration tests
```

---

## Conversation Engine Architecture

The founder session is a real-time SSE chat loop. After each founder message:

1. **Chat LLM** (GPT-4o streaming) — generates the advisor response
2. **Memory extraction** (GPT-4o, structured output) — extracts `FounderMemory` from recent messages
3. **`mergeFounderMemory`** — merges extracted memory into the accumulated session memory
4. **`updateUnderstanding`** — calls `buildUnderstanding` to produce `FounderUnderstanding` from merged memory, upserts `founder_understanding` table
5. **Completion check** — if `isComplete = true`, closes the session

The system prompt for step 1 is built by `buildChatSystemPrompt` and reads the current `FounderUnderstanding` to focus questioning and enforce conversation rules.

### Key data shapes

| Shape | File | Purpose |
|---|---|---|
| `FounderMemory` | `lib/contracts/founder-memory.ts` | Accumulated narrative + per-category scores extracted from conversation |
| `FounderUnderstanding` | `lib/contracts/founder-understanding.ts` | Derived session state: confidence per category, saturation, gaps, completion |
| `SessionSummary` | `lib/contracts/session-summary.ts` | Rolling summary injected into system prompt to handle context window limits |
| `OpportunityAssessmentContent` | `lib/contracts/opportunity-assessment.ts` | OA output shape; input to BlueprintAgent |
| `BlueprintContent` | `lib/contracts/blueprint.ts` | Final blueprint output shape |

### Evidence strength scale (1–6, do not change)

```
1 = Founder assumption (floor — always output 1, never 0)
2 = Anecdotal observation
3 = Customer conversations
4 = Customer interviews (structured)
5 = Paying customers
6 = Usage / revenue data
```

### Confidence ceilings by evidence strength (do not change)

```
1 → max 25    2 → max 40    3 → max 60
4 → max 78    5 → max 90    6 → max 100
```

`GAP_PENALTY_CEILING = 40` — explicitly_unvalidated categories are capped at strength-2 level even if confidence is higher. This is intentional: absence of external evidence is a hard bound in the Opportunity Assessment layer. Do not raise this ceiling.

### Completion gate (do not change logic — only thresholds may vary by stage)

Session completes when all three **required categories** (problem, customer, solution) reach the stage-appropriate threshold. Supporting categories (market, pricing, competition, risks, founder_fit) generate warnings but never block completion.

```
REQUIRED_CATEGORIES  = ['problem', 'customer', 'solution']
THRESHOLD_COMPLETE   = 80   (building / revenue stage)
THRESHOLD_HYPOTHESIS = 60   (idea stage)
```

Evidence floor: if `maxEvidenceStrength >= 4` (customer interviews or better), the threshold is always `THRESHOLD_COMPLETE` regardless of declared stage. This prevents gaming the idea-stage threshold while hiding real validation.

---

## Founder Session v2.1

### Why These Changes Exist

The v2 conversation engine had five structural failure modes identified through adversarial simulation against 20 founder archetypes:

1. **Pre-validation founders could never complete.** `GAP_PENALTY_CEILING = 40` capped explicitly_unvalidated required categories, making the 80% completion threshold unreachable for any founder who correctly disclosed "I haven't spoken to customers yet."

2. **Dual-ICP / marketplace founders got permanently stuck.** The engine was designed around a single ICP. Marketplace founders who correctly said "both sides matter" triggered customer saturation (3 turns with delta < 5) and blocked the category at 25-40% confidence.

3. **Mid-session pivots got anchored.** The memory extraction anchor block ("do not decay without new evidence") suppressed legitimate score resets when a founder changed direction mid-session.

4. **Blueprint fabrication was silent.** A session could complete with `pricing` explicitly_unvalidated, and the blueprint agent would fabricate a revenue model without any warning to the founder.

5. **Vague / overconfident founders triggered false completion.** Evidence strength leaked across categories from traction signals. Not fixed in v2.1 — tracked for v3.

---

## v2.1 Fixes — Scope and Constraints

### F1 + F2 — Founder Stage Detection + Hypothesis Completion

**Problem solved:** Pre-validation founders loop indefinitely with no graceful exit.

**Fix:** Founders declare their stage at session creation (`'idea'` / `'building'` / `'revenue'`). `'idea'` stage uses `THRESHOLD_HYPOTHESIS = 60`. Sessions completing under this threshold produce `blueprintMode = 'hypothesis'` — framed as a thinking tool, not a validated spec.

**Evidence floor:** If `maxEvidenceStrength >= 4` fires at any point, completion threshold auto-escalates to 80 regardless of declared stage.

**Key constraint:** `founderStage` is immutable after session creation. Stage auto-upgrade mid-session is v3 — do not implement.

**Files changed:**
- `drizzle/migrations/0005_founder_stage.sql`
- `lib/db/schema/founder-sessions.ts`
- `lib/contracts/founder-understanding.ts`
- `modules/founder-sessions/chat-prompt.ts`
- `modules/founder-sessions/router.ts`
- `services/understanding-engine.ts`
- `agents/blueprint-agent/prompt.ts`

**Migration default:** `'building'` — all existing sessions preserve v2 behavior.

---

### F3 — Dual-ICP / Marketplace Support

**Problem solved:** Marketplace founders saturate on `customer` because the engine expects a single ICP.

**Fix:** When `multiIcpDetected = true`, `customer` is excluded from the blocked-topics list even after saturation. The focus instruction shifts from "who is your exact buyer" to "which segment is your beachhead." Replace-with-latest field in memory and understanding.

**Extraction trigger:** Set `multi_icp_detected = true` only for genuine two-sided marketplaces or dual-segment businesses with different pricing/service models. Do NOT trigger for buyer/user distinction, segment variations, or discovery uncertainty.

**Key constraint:** Only `customer` saturation is suppressed when the flag is set. All other categories saturate normally.

**Files changed:**
- `lib/contracts/founder-memory.ts`
- `lib/contracts/founder-understanding.ts`
- `modules/founder-sessions/chat-prompt.ts`
- `services/understanding-engine.ts`

---

### F4 — Pivot Detection (detection only — no merge bypass)

**Problem solved:** Mid-session direction changes get anchored; blueprints reflect a chimera of both directions.

**Fix (detection only):** The extraction LLM sets `pivot_detected = true` on genuine pivots. The chat system prompt injects a PIVOT DETECTED section instructing the advisor to name both directions and confirm which to use.

**What is NOT in v2.1:** The `mergeFounderMemory` confidence merge bypass. When `pivot_detected = true`, the memory merge still uses evidence-gated logic (existing behavior). The bypass is deferred to v2.2. Do not add it.

**What `pivot_detected` does in v2.1:** Chat acknowledgment only + `pivotCount` analytics. It does NOT change how confidence scores are merged.

**Files changed:**
- `lib/contracts/founder-memory.ts`
- `lib/contracts/founder-understanding.ts`
- `modules/founder-sessions/chat-prompt.ts`
- `services/understanding-engine.ts`

---

### F5 — Blueprint Fabrication Prevention (simple — no bridge turn)

**Problem solved:** Blueprint agent silently fabricates sections for categories the founder never discussed.

**Fix:** `gapsInBlueprint` is computed at completion — the list of categories that are `explicitly_unvalidated` when `isComplete = true`. The chat closing message names these explicitly. The blueprint agent prefixes affected fields with `[HYPOTHESIS — not founder-validated]`.

**What is NOT in v2.1:** The bridge turn (session stays `active` for one more exchange after `isComplete = true`). Requires a second migration. Deferred to v2.2. Do not add `pendingBridgeTurn` or a `pending_completion` session status.

**Key constraint:** `gapsInBlueprint` is always empty when `isComplete = false`. It is derived and read-only. Do not add it to any extraction schema.

**Files changed:**
- `lib/contracts/founder-understanding.ts`
- `modules/founder-sessions/chat-prompt.ts`
- `agents/blueprint-agent/prompt.ts`

---

## Instrumentation

All instrumentation uses `logActivity` from `agents/base/utils.ts` into `activityLog`. No new tables.

### Events added in v2.1

| Event type | Where | Fires when |
|---|---|---|
| `session.started` | `modules/founder-sessions/router.ts` | Enriched: add `founderStage` to existing meta |
| `session.completed` | `modules/founder-sessions/router.ts` | New: fires on session close with full completion snapshot |
| `understanding.completion_threshold_reached` | `services/understanding-engine.ts` | `isComplete` transitions false → true |
| `understanding.gap_identification_entered` | `services/understanding-engine.ts` | `questioningMode` transitions to `'gap_identification'` |
| `understanding.multi_icp_detected` | `services/understanding-engine.ts` | `multiIcpDetected` transitions false → true |
| `understanding.pivot_detected` | `services/understanding-engine.ts` | Every turn where `pivotDetected = true` |
| `understanding.category_saturated` | `services/understanding-engine.ts` | First turn `saturationCount` reaches `SATURATION_THRESHOLD` |
| `understanding.gap_confirmed` | `services/understanding-engine.ts` | `validationStatus` transitions to `'explicitly_unvalidated'` |
| `blueprint_generated` | `agents/blueprint-agent/persist.ts` | Enriched: add `gapsInBlueprint`, `blueprintMode`, `founderStage` |

All `understanding.*` events are fire-and-forget in the post-stream side-effects block.

---

## What Must Not Be Changed

**`GAP_PENALTY_CEILING = 40`**
Caps explicitly_unvalidated categories at anecdotal level for the Opportunity Assessment layer. The completion gate uses raw LLM confidence (which can exceed 40) — the ceiling applies only in `computeEvidenceConfidence`. Raising it would let the OA present hypothesis-level knowledge as validated.

**`SATURATION_THRESHOLD = 3`**
A category targeted 3 turns with `confidenceDelta < 5` is blocked. This is intentional — it prevents fixation and forces the engine toward `gap_identification` mode. Do not increase this threshold.

**Evidence-gated confidence merge in `mergeFounderMemory`**
The merge only updates `category_confidence[cat]` when `category_evidence[cat].length > 0`. This prevents decay from context-window truncation. Do not remove this gate. The F4 bypass is v2.2 — not here.

**Anchor block in `buildMemoryExtractionSystemPrompt`**
The `--- ESTABLISHED UNDERSTANDING ---` block prevents artificial score decay when the extraction window only shows recent messages. The pivot exception (v2.1) is the only authorized override. Keep it narrow.

**`REQUIRED_CATEGORIES = ['problem', 'customer', 'solution']`**
Only these three gate completion. Do not add categories — it makes the gate significantly harder and has downstream quality implications.

**`founderStage` immutability**
Stage is set at session creation and does not change. The evidence floor corrects the threshold without changing the declared stage. Do not add mid-session stage mutation logic.

**`pendingBridgeTurn` — not implemented**
F5 is warning + label only. Do not add `pendingBridgeTurn`, `pending_completion` boolean column, or `pending_completion` session status. This is v2.2.

**F4 merge bypass — not implemented**
`pivot_detected = true` causes chat acknowledgment only. The confidence merge is unchanged in v2.1. Do not add `pivotDetected` as a condition in the `mergeFounderMemory` confidence loop.

---

## Database Migrations

Migrations run with `drizzle-kit migrate`. Add new migrations as the next number after all existing files.

| File | What it adds |
|---|---|
| `0000_xenysis_full_schema.sql` | Full initial schema |
| `0001_hard_captain_america.sql` | `founder_understanding`, `evidence_records` tables |
| `0002_opportunity_constraints.sql` | Opportunity assessment constraints |
| `0003_validation_gap_recognition.sql` | Validation gap fields on understanding |
| `0004_ai_provider_column.sql` | AI provider column on generation jobs |
| `0004_brown_forge.sql` | (parallel 0004 — do not renumber) |
| `0005_founder_stage.sql` | **v2.1** — `founder_stage` column on `founder_sessions` (DEFAULT 'building') |

Note: two `0004_` files exist — only `0004_brown_forge` is in the journal. `0004_ai_provider_column.sql` is not journaled. Migration `0005_founder_stage` is now applied. The next migration is `0006_`.

---

## PR Plan for v2.1

Three PRs in dependency order:

```
PR1: F1+F2  ──► PR2: F3+F4  ──► PR3: F5
(migration)      (signals)        (output safety)
```

- **PR1** is the only PR with a DB migration. All others are JSONB-additive with Zod defaults.
- **PR2** can be developed in parallel but must rebase onto PR1 before merge.
- **PR3** can be developed in parallel but must stack on PR2 before merge.

---

## Out of Scope — v2.1

Do not implement these in this sprint.

| Item | Reason deferred |
|---|---|
| F4 merge bypass (confidence reset on pivot) | Hotpath risk, needs calibration data |
| F5 bridge turn (session stays open after completion) | Requires second migration |
| Stage auto-upgrade mid-session | Needs session data to validate |
| Insider expertise evidence level | Evidence scale redesign — v3 |
| Narrative extraction bandwidth increase (3 → 5 items) | Prompt cost impact — v3 |
| Gap_identification beginner mode | UX research required — v3 |
| `pending_completion` session status | Tied to bridge turn — v2.2 |
| Traction-signal evidence scope leak fix | Extraction prompt calibration sprint |
