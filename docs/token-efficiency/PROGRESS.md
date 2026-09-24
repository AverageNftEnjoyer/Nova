# Token-Efficiency Overhaul — Progress Log

Read this file first at the start of every session. It is the only place context survives between sessions.

## Status

The plan is [PLAN.md](PLAN.md) (revised 2026-09-23: stages 0 tracking/baseline + usage ledger, 1 caching, 2 tool output ceilings, 3 tool schema diet if justified, 4 per-task budgets, 5 analytics (Home panel + `/analytics`), regression gate and report).

| Stage | State |
| --- | --- |
| 0 — Tracking & baseline | **Done** (user-confirmed 2026-09-23). Step 8 (live check) is deferred: the user will run it later. |
| 1 — Stable prefix & caching | **Done** (user-confirmed 2026-09-23; uncommitted). 1a–1d done, 1e skipped. Cache-hit acceptance awaits the deferred live check. |
| 2 — Tool output ceilings | **Done** (coordinator-verified 2026-09-23; uncommitted). |
| 3 — Tool schema diet | **Done** (coordinator-verified 2026-09-23; uncommitted). Done: the model is offered `coinbase_*` / `gmail_*` / `phantom_*` tools only when that integration is connected (tool schemas per tool-loop call 2,940 → 1,188 ~tok OpenAI shape, 2,733 → 1,097 Claude shape, for a user with neither). Skipped: shortening `browser_agent` and other descriptions. See the Session 6 log entry. |
| 4 — Per-task budgets | **Done** (coordinator-verified 2026-09-23; uncommitted). Migration 0014, per-task and default budgets ($0.25 / 100,000 tokens), enforcement before every model call of both tool loops (warn at 80% → trim + economy model → pause before a call that would go over), HUD budget bar / actions / settings. See the Session 7 log entry. |
| 5 — Analytics, gate & report | **Code complete, awaiting coordinator verification** (2026-09-24, autopilot). `/analytics` and the Home Analytics panel read the `llm_usage` ledger; offline regression gate `smoke:token-gate` (in `smoke:src-release`); [FINAL-REPORT.md](FINAL-REPORT.md); README / CLAUDE.md updated. Version not bumped. See the Session 8 log entry. |

Rules: see PLAN.md "Ground rules".

## Resume state

- Last session: 2026-09-24 (Session 8, Stage 5). Stage 0 committed (V.70/V.71); Stage 1 and later are uncommitted. Autopilot running Stages 2–5 via one manager agent per stage; the coordinator verifies each stage before starting the next.
- Next action: see the latest stage entry in the session log. Autopilot rules: no commits, no real API calls, no dropped-context bug fix and no version bump without explicit user approval.
- Baseline numbers are in [BASELINE.md](BASELINE.md). Rerun them with `npm run smoke:token-baseline`.

## Stage 0 implementation (Session 2)

- **Usage helper** `src/providers/usage/index.js`:
  - Normalised shape `{ inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens }`, where `inputTokens` is always the total input.
  - Anthropic: `input_tokens + cache_read + cache_creation`. Streaming merges `message_start` and the cumulative `message_delta`.
  - `recordLlmUsageSafe` writes one `llm_usage` row, never throws, and runs a daily retention prune.
  - `withLlmUsageObserver` is an AsyncLocalStorage observer, used by the agent-task service.
- **Call sites:** each chat turn gets one recorder (`chat-handler/llm-usage-recorder`). Every successful API call records exactly one row:
  - tool-loop steps and the loop's recovery call
  - Claude tool loop, Claude direct create/stream
  - OpenAI direct/stream and empty-reply recovery
  - both refinement branches
  - Spotify intent parsing
  - The runtime.js helpers only return normalised `usage`; they never write the ledger.
  - A call that throws writes no row, because no usage is available for it.
  - `promptTokens` and `completionTokens` keep their meaning (total input / output).
- **Run summary:**
  - Carries `cachedInputTokens` and `cacheWriteInputTokens` (the worker-contract whitelist passes them through).
  - The error path (`ok:false`) now reports the calls already made. It used to report 0.
  - WS `usage`, `request_done`, the transcript metadata and `persistUsage` gained the two fields additively.
- **Migration 13** (committed in V.70):
  - `agent_tasks.cached_input_tokens` and `cache_write_input_tokens` (INTEGER NOT NULL DEFAULT 0)
  - the `llm_usage` table, with indexes (user_id, ts), (user_id, source, ref_id) and (ts)
  - `purgeLocalUserData` includes `llm_usage`.
  - Retention: `NOVA_LLM_USAGE_RETENTION_DAYS` (default 90, 1–3650). It runs on the first write per process, then at most every 24 h.
- **Agent tasks** (`src/runtime/modules/agent-tasks/index.js`): completed, failed and approval-paused attempts all persist tokens, cached and cache-write counts, and cost.
  - Usage comes from the ledger observer, so it also covers thrown errors. It falls back to the returned totals.
  - Tokens are **cumulative per task**. A resume after a pause adds to them. A retry of a failed or cancelled task resets them (the existing HUD behaviour).
  - A user pause, stop or delete mid-run adds the attempt's tokens with an update fenced on `attempt_no`.
  - The HUD `AgentTask` type and task store round-trip the new columns.
- **Missions:** `completeWithConfiguredLlm` returns `usage` and writes a `mission` row per call. `ref_id` is `ctx.runId`, passed from ai-executors through a new optional 6th parameter.
- **Pricing** (`src/providers/pricing/index.js`, the single source for runtime and HUD):
  - current models plus a legacy table, all with cached-input rates (Anthropic also cache-write)
  - exact-ID lookup with no prefix guessing; an unpriced ID returns null and logs once
  - `estimateTokenCostUsd(model, in, out, { cachedInputTokens, cacheWriteInputTokens })` stays backward compatible
  - The runtime constants re-export the tables, and the HUD pricing module delegates here.
- **Harness and smokes** (`scripts/smoke/token-efficiency/`): `smoke:token-baseline` (18 checks) and `smoke:token-usage` (usage normalisation 11, cost math 8, ledger and agent-task persistence 9).

### Decisions made

- The call sites record the ledger rows, not the provider helpers, so provider and conversation context stay explicit. The per-turn recorder gives the error path its totals.
- Pricing moved out of `constants/index.js` into a dependency-free module, because the HUD can't import the runtime constants (env and workspace side effects). The constants file re-exports the tables.
- `llm_usage.cost_usd` is NULL for unpriced models; `agent_tasks.cost_usd` keeps its 0-for-unknown convention.
- Only the standard pricing tier is modelled. Long-context tiers are not.

### Current-models update (user request, Session 2)

Sources and rates are in BASELINE.md "Pricing used for cost". All official pages were fetched 2026-09-23.

| Provider | Old default → new default | Picker list now | Why this default |
| --- | --- | --- | --- |
| OpenAI | gpt-4.1-mini (runtime) / gpt-4.1 (HUD) → **gpt-5.6-terra** | gpt-5.6-terra, gpt-5.6-sol, gpt-5.6-luna | The docs describe it as the model that "balances intelligence and cost"; function calling works on Chat Completions. GPT-6 Sol/Luna need `reasoning_effort: "none"` for tools on Chat Completions and Astra has none, so gpt-6-* is priced but not offered. |
| Anthropic | claude-sonnet-4-20250514 (retired 2026-06-15) → **claude-sonnet-5** | claude-sonnet-5, claude-opus-5-5, claude-fable-5-1, claude-haiku-4-5-20251001 | The docs call it "the best combination of speed and intelligence", at $2/$10. |
| xAI | grok-4-0709 (retired 2026-05-15, redirects to grok-4.3) → **grok-4.3** | grok-4.3, grok-4.7, grok-build-0.1 | The cheapest general model, with "strong tool calling"; grok-4.7 is the flagship. |
| Google | gemini-2.5-pro (limited access) → **gemini-3.8-flash** | gemini-3.8-flash, gemini-3.1-pro-preview, gemini-3.5-flash-lite, gemini-3.1-flash-lite | The stable, most capable Flash model, and the model used in the OpenAI-compat doc examples. There is no stable Pro model. |

- Updated everywhere:
  - `src/runtime/core/constants` defaults and `src/providers/runtime/index.ts`
  - `src/config` (not live), `src/integrations/chatkit/config` (gpt-5-mini → gpt-5.6-luna; live only with `NOVA_CHATKIT_ENABLED=1`)
  - HUD integration model lists, stores and hooks, mission model lists, model labels, agent chart labels
  - `api/chat/route.ts` fallback
  - The create-task modal already reads the shared lists.
- **Backward compatibility:**
  - Stored IDs are never validated against the list or rewritten; there is no migration.
  - Pickers append an unknown stored ID as "`<id>` (legacy)".
  - Legacy IDs that the API still serves stay priced. Unpriced IDs show "Pricing unknown", and the runtime logs them once.
- **Open decision for the user:** whether to migrate users' stored model choices that point at retired models (claude-sonnet-4-20250514, claude-opus-4*, claude-3-*: requests now fail at Anthropic). Nothing rewrites them today.

### Doc findings: cached-token reporting per provider (2026-09-23)

| Provider | Usage field | Caching | Source |
| --- | --- | --- | --- |
| OpenAI | `prompt_tokens_details.cached_tokens`, a subset of `prompt_tokens` | Automatic above 1,024 tokens | developers.openai.com API reference and prompt-caching guide |
| xAI | `prompt_tokens_details.cached_tokens`; `prompt_tokens` includes the cached tokens | Automatic; no minimum documented | docs.x.ai prompt-caching usage-and-pricing |
| Gemini (OpenAI-compat) | **Not documented** whether `prompt_tokens_details.cached_tokens` is returned | Implicit caching is on by default for 2.5+ (minimum 2,048 tokens for 2.5, 4,096 for 3.x) | ai.google.dev openai and caching pages |
| Anthropic | `cache_read_input_tokens`, `cache_creation_input_tokens`; `input_tokens` excludes both | Only with `cache_control` | platform.claude.com prompt-caching and streaming |

- The `message_delta` usage is cumulative and may carry input and cache fields.
- `message_start` may omit usage. The normaliser handles both.
- Gemini's `cached_tokens` needs the live check to confirm.

### Left undone / open issues

1. Step 8 (live check) is not run; it needs a spend ceiling.
2. LLM calls not in the ledger:
   - `hud/app/api/missions/nova-suggest/route.ts`
   - the `test-*-model` and `list-claude-models` routes
   - ChatKit serving and shadow calls (their usage still counts in the run summary)
   - embeddings (`src/memory/embeddings`)
   - The Gmail summary route goes through `completeWithConfiguredLlm`, so its calls land as source `mission` with an empty ref. `build-from-prompt` also lands as `mission` with an empty ref.
3. `sessionContext.persistUsage` (`src/session/runtime/index.js`) and operator-finalization telemetry ignore the cached fields.
4. `resolveOpenAiRequestTuning` (prompt-recovery) sends `reasoning_effort: "minimal"` on strict passes for any `gpt-5*` model, which now includes gpt-5.6-*. OpenAI's per-model pages list none/low/medium/high/xhigh/max for gpt-5.6, **not** minimal. Strict correction passes on the new OpenAI default may be rejected. It was not changed (no request changes in Stage 0); it needs a decision before or with the release. `verbosity` support per model is also unverified.
5. The Claude tool loop doesn't inject `userContextId`/`conversationId` into `gmail_*` and `coinbase_*` tool inputs, unlike the OpenAI loop (found by the harness).
6. The web-search preload runs a real search on research turns and agent tasks, but its result is dropped by the `no_system_budget` bug (known issue #1), so the call is wasted.
7. The Personality Calibration section embeds a live `updated=<timestamp>`. It will break a Stage 1 cached prefix.
8. `scripts/smoke/local-db/local-data-smoke.mjs` (not in any npm script) fails on a pre-existing worktree-manager import path.
9. `src-delegated-chat-worker-contract-smoke` P31-C4 fails at HEAD because it expects `fallbackReason`, which `normalizeWorkerSummary` never had. This is pre-existing.
10. Release files (version, README, CLAUDE.md) were not bumped. When this ships, they should mention:
    - `NOVA_LLM_USAGE_RETENTION_DAYS`
    - the `llm_usage` table in the CLAUDE.md storage list
    - the new default models
    - migration 13

## Corrections to the plan's architecture context

| Plan said | Actual |
| --- | --- |
| `src/llm/` exists | It does not. LLM code: `src/providers/runtime/runtime.js` (JS, used by the runtime), `src/providers/clients/index.ts` (TS), `src/runtime/llm/providers/index.js` (re-export). HUD missions have their own client: `hud/lib/missions/llm/providers.ts`. |
| Gemini / Grok are separate clients | Both go through the **OpenAI SDK** against OpenAI-compatible endpoints (`generativelanguage.googleapis.com/v1beta/openai`, `api.x.ai/v1`). Only Claude has its own client (raw `fetch` to `/v1/messages`). |
| Agent tasks accumulate long conversation history | An agent task is **one** `handleInput` call = one tool loop, max `NOVA_TOOL_LOOP_MAX_STEPS` = 6 steps, max 32 s (`TOOL_LOOP_MAX_DURATION_MS`). History growth inside a task is the tool-loop message array, not chat turns. Chat sessions are the multi-turn case and are already bounded (see §4). This is why compaction was dropped from the plan (see PLAN.md). |
| Gmail list returns bodies | Gmail tools already fetch **metadata + snippet only** (`format=metadata`); no tool returns message bodies. |
| Memory injection has no cap | Chat memory recall is already top-3, 600 chars per hit, and inside a 1000-token section cap (§5). |
| Per-task tracking needs new fields | `agent_tasks` already has `tokens_in`, `tokens_out`, `cost_usd`. Missing: cached vs uncached split. |

## Map

### 1. Prompt assembly for one chat / agent turn

Entry: `handleInput` (`src/runtime/modules/chat/core/chat-handler/index.js`) → operator routing (domain workers may answer without an LLM) → `executeChatRequest` (`.../execute-chat-request/index.js:174`) → `buildPromptContextForTurn` (`.../prompt-context-builder/index.js:41`).

The system prompt is one string built in this order (S = static per session, D = dynamic per turn):

| # | Section | Source | S/D |
| --- | --- | --- | --- |
| 1 | Identity line, `## Tooling` (says "No external tool contracts registered" — `toolNames` is never passed), `## Safety`, `## Response Quality`, `## Source & Citation Policy` | `buildAgentSystemPrompt` (`src/runtime/modules/context/system-prompt/index.js:104`) | S |
| 2 | `## Skills (framework)` — skills picked by scoring **the user's message** | `buildRuntimeSkillsPrompt(dir, text)` (`context/skills/index.js:671`) | **D** |
| 3 | `## Memory` = SOUL.md + USER.md + MEMORY.md + IDENTITY.md (AGENTS.md is loaded but **not** included) | `buildPersonaPrompt` (`context/bootstrap/index.js:152`), cached by file mtime+size | S* |
| 4 | Time zone, Reply Tags, Messaging, Voice, Workspace | `buildAgentSystemPrompt` | S |
| 5 | `## Runtime` line (host, node, model, `channel=<source>`) | `buildRuntimeLine` | S per model+channel |
| 6 | `## Runtime Persona (HUD)` (name, style, tone, custom instructions) | prompt-context-builder:131 | S* |
| 7 | User Preference Memory | `buildUserPreferencePromptSection` | D |
| 8 | Identity Intelligence | `syncIdentityIntelligenceFromTurn` | D |
| 9 | Personality Calibration | `syncPersonalityFromTurn` | D |
| 10 | Conversation Continuity (only if history exists) | fixed text | S after turn 1 |
| 11 | Short-Term Context, Operator Routing Contract | request hints | D |
| 12 | Live Web Search Context / Link Context / Live Memory Recall | enrichment tasks, prompt-context-builder:280-429 | D |
| 13 | Strict Output Requirements | output constraints | D |

\* MEMORY.md is rewritten after turns by `applyMemoryFactsToWorkspace` (execute-chat-request:684), which changes the persona block (and any cache) whenever a fact is auto-captured.

Sections 7–13 are added through `appendBudgetedPromptSection` (`src/runtime/modules/chat/prompt/prompt-budget/index.js:108`).

Then the messages array is `[system, ...history, user]` (prompt-context-builder:461). Claude gets `system` as a top-level string and the same history + user message.

**Consequence for caching:** the first byte that changes between turns is the Skills section at ~517 tokens. Everything after it (persona ≈2.1k tokens) can't be a cached prefix. OpenAI only caches when the first 1,024 tokens are identical, so **OpenAI/Gemini/Grok prefix caching cannot hit today**, and dynamic sections 7–13 are interleaved after the persona inside the same system string.

### 2. Provider clients and prompt caching today

No provider uses caching, and no cache usage is read anywhere (`cache_control`, `cached_tokens`, `prompt_tokens_details`, `cache_read_input_tokens` appear nowhere in `src/` or `hud/lib/`).

| Provider | Call sites | Caching today | Usage read |
| --- | --- | --- | --- |
| OpenAI | `streamOpenAiChatCompletion` (`src/providers/runtime/runtime.js:572`), tool loop (`tool-loop-runner/index.js:113`), direct-completion, response-refinement, prompt-recovery, spotify-agent | Automatic prefix caching exists server-side but can't hit (prefix unstable before 1,024 tokens) | `prompt_tokens`, `completion_tokens` only (`runtime.js:642`, `tool-loop-runner:136`) |
| Anthropic | `claudeMessagesCreate` / `claudeMessagesStream` (`runtime.js:669`, `:713`), `createMessage` in `claude-tool-loop/index.js:27` | None (no `cache_control`) | `input_tokens`, `output_tokens` only (`runtime.js:707`, `:803`, `:818`; `claude-tool-loop:105`) |
| Gemini | Same OpenAI-SDK code, Gemini OpenAI-compat base URL | None | Same as OpenAI |
| Grok | Same OpenAI-SDK code, x.ai base URL | None | Same as OpenAI |
| HUD missions | `completeWithConfiguredLlm` (`hud/lib/missions/llm/providers.ts:47`) | None | **No usage returned at all** — mission runs are untracked |

Quoted, OpenAI stream usage (`runtime.js:640-644`):
```js
const usage = chunk?.usage;
if (usage) {
  promptTokens = Number(usage.prompt_tokens || promptTokens);
  completionTokens = Number(usage.completion_tokens || completionTokens);
}
```
Quoted, Claude request body (`runtime.js:740-746`), no cache breakpoints:
```js
body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages: requestMessages })
```

Pricing (`src/runtime/core/constants/index.js:179-199`): OpenAI + Claude input/output rates only. **No Gemini or Grok entries → `estimateTokenCostUsd` returns `null` (stored as 0 for agent tasks).** No cached-input rates. Default models: `gpt-4.1-mini`, `claude-sonnet-4-20250514`, `gemini-2.5-pro`, `grok-4-0709`.

### 3. Tool schemas

- Enabled set: `NOVA_ENABLED_TOOLS` default list of 25 names (`constants/index.js:55`); 23 registered without a memory manager (+`memory_search`, `memory_get` when memory is on).
- Tool runtime is only initialised when `turnPolicy.likelyNeedsToolRuntime` or the turn is an agent task (`chat-handler/index.js:633`).
- When a tool loop runs, **every enabled tool's full schema is sent on every step**: OpenAI via `toolRuntime.toOpenAiToolDefinitions(availableTools)` (execute-chat-request:492 → tool-loop-runner:119), Claude via `claude-tool-loop:72`. No per-domain scoping; domain routing happens earlier (operator lanes/workers) but doesn't narrow `availableTools`.
- Tool schemas are **outside** the 6,000-token prompt budget (the budget only counts system + history + user).
- Since Stage 3 the model gets `modelTools` (execute-chat-request → `chat-handler/model-tool-scope`): `availableTools` minus the `coinbase_*` / `gmail_*` / `phantom_*` tools of integrations the user has not connected. `availableTools` itself (execution, task policy, domain workers) is unchanged.

### 4. History and the agent task loop

- Chat history: last `SESSION_MAX_TURNS`=20 transcript turns → trimmed from the oldest end to a budget (`computeHistoryTokenBudget`: target 1,400, min 220, max `SESSION_MAX_HISTORY_TOKENS`=3,200) by `trimHistoryMessagesByTokenBudget` (`context/persona-context/index.js:176`). No summarisation; older turns are dropped. Sliding the window shifts the start of the history each turn once it's full.
- Tool loop (both providers): the message array grows each step with the assistant tool call + **raw tool results**, and the whole array plus all tool schemas is resent every step (max 6 steps). A final "recovery" call resends everything once more if the loop ended without text (tool-loop-runner:420).
- `agent_tasks` (`src/db/migrations/0004-local-data.js:21` + 0006–0011): token/cost columns are `tokens_in INTEGER`, `tokens_out INTEGER`, `cost_usd REAL`. Written once at completion by `persistCompleted` (`src/runtime/modules/agent-tasks/index.js:124`) from `runSummary.promptTokens/completionTokens`. Failed / paused tasks don't record tokens.
- Chat turns: usage goes to the `usage` WebSocket event, `appendRawStream`, the transcript turn metadata, and `sessionContext.persistUsage`.

### 5. Memory injection

- Chat recall: `memoryManager.searchWithDiagnostics(text, 3)` (prompt-context-builder:345), each hit `content.slice(0, 600)`, joined, then added as "Live Memory Recall" through the section budget (max 1,000 tokens per section, and only if system budget remains). 450 ms timeout.
- `memory_search` tool: default `top_k` 5, output truncated to 8,000 chars. `memory_get`: truncated to **32,000 chars** (~9k tokens).
- Token counting everywhere is `countApproxTokens` = `ceil(chars / 3.5)` (`src/runtime/core/context-prompt/index.js:1`); no real tokenizer.

### 6. Tool output caps (what reaches the model)

| Tool | Cap today | Visible marker |
| --- | --- | --- |
| `read` (file) | **None** — returns the whole file unless `startLine/endLine` given | — |
| `web_fetch` | 16,000 chars markdown (2 MB download cap) | `... [truncated]` |
| `web_search` | top 5 results, 400-char snippets, 6,000 chars total | `... [truncated]` |
| `exec` | 8,000 chars (1 MB capture) | `... [truncated]` |
| `browser_agent` | default 12,000, max 32,000 chars | `... [truncated]` |
| `memory_get` | 32,000 chars | `... [truncated]` |
| `memory_search` | 8,000 chars | `... [truncated]` |
| `gmail_*` list/summary | metadata + snippet rows, `maxResults` ≤ 25–30 | n/a |
| `grep`, `ls`, `coinbase_*` | not yet measured | — |

In the tool loop the raw tool result string is pushed as-is (tool-loop-runner:397, claude-tool-loop:173); only web results get wrapped.

## Static measurements (2026-09-23, approximate tokens = chars/3.5, the runtime's own estimator)

Fresh-install workspace built from `templates/`:

| Item | ~Tokens |
| --- | --- |
| SOUL.md / USER.md / MEMORY.md / IDENTITY.md | 704 / 859 / 320 / 192 |
| AGENTS.md (not injected) | 1,498 |
| Persona block (section 3) | 2,089 |
| Base system prompt, "hi" | 3,187 |
| Skills section, by query | 244–336 |
| Stable prefix before the first per-turn byte | **517** |
| Tool schemas, OpenAI format, 23 tools | **2,753** (per tool-loop call) |
| Tool schemas, Anthropic format | 2,562 |
| Largest single schema: `browser_agent` | 379 |
| Coinbase schemas (5) / Gmail schemas (9) | 778 / 861 |

## Pre-existing issues found (not fixed — zero-behavior-change rule)

1. **Dynamic context is silently dropped at default settings.** Input budget = 6,000 − 1,400 reserve = 4,600; with a 1,400 history target the system prompt may use ~3,195 tokens. The fresh-install base prompt is ~3,187–3,240, so `appendBudgetedPromptSection` returns `no_system_budget` for Live Memory Recall, Web Search preload, Link Context, Identity and Preference sections. Verified with the real function: included at 3,000 tokens, dropped at 3,187+. Users with longer persona files are further over. This is a quality bug that probably deserves its own fix, but fixing it **increases** tokens, so it needs your call.
2. `## Tooling` tells the model "No external tool contracts registered in this runtime yet." even when tools are attached (`toolNames` never passed).
3. AGENTS.md (~1.5k tokens) is copied into every workspace and loaded from disk each time the persona signature changes, but never used in the prompt.
4. ~~Gemini/Grok cost is never computed (missing pricing); mission LLM calls report no usage.~~ Fixed in Stage 0.
5. ~~Agent tasks that fail or pause record zero tokens even though tokens were spent.~~ Fixed in Stage 0.
6. ~~`read` has no output cap.~~ Fixed in Stage 2 (400-line window, 20,000-char cap).

## Decisions

Recorded in PLAN.md ("Decided", "Needs your answer"). The original stages 3 (memory budget), 4 (compaction) and 6 (model tiering) were dropped; PLAN.md gives the reason for each. Per-task budgets were restored at the user's request (2026-09-23) as Stage 4, and the Home Analytics panel was added to Stage 5.

## Session log

### 2026-09-23 — Session 1 (Stage 0 mapping)
- Read the full prompt path, all provider call sites, both tool loops, the agent-task service and schema, memory recall, and tool output caps.
- Measured static prompt, persona and tool-schema sizes with read-only scripts against a temp `NOVA_DATA_DIR` and a temp workspace (no real user data read or written).
- No source files changed; no tests needed for this session.

### 2026-09-23 — Session 1b (plan revision)
- Rewrote the original 8-stage plan into PLAN.md, based on the map: kept caching (main win), tracking/baseline, tool output ceilings and the regression gate; made the tool-schema work conditional; dropped memory budgeting, compaction, model tiering and per-task budgets.
- Confirmed the memory pipeline makes no LLM calls, and that smokes can drive `handleInput` with a fake client (`runtimeSelectionOverride`), which makes a free, exact offline baseline possible.

### 2026-09-23 — Session 1c (budgets + analytics)
- Restored per-task budgets as Stage 4, adapted to single-loop tasks: budget checked after every model call; 80% warning; at 100% trim loop context → same-provider economy model → pause with Resume / Raise budget / Abort.
- Added an `llm_usage` per-call ledger to Stage 0 so analytics covers chat, agent tasks and missions (today `/api/analytics` reads only `agent_tasks`).
- Stage 5 now turns the Home Analytics panel (currently a static link card in `home-main-screen.tsx`) into a live summary and extends `/analytics`.

### 2026-09-23 — Session 2 (Stage 0 implementation)
- Built the usage normaliser, the `llm_usage` ledger (migration 13), cache-aware pricing, the call-site wiring, mission usage, failed/paused agent-task tokens, and the offline harness plus smokes. BASELINE.md written.
- The session was interrupted by a usage limit. Meanwhile the user committed V.70 (`dce2799`), which includes migration 13, `src/db/llm-usage.js`, `src/providers/usage` and `src/providers/pricing`. The work resumed on top of it.
- Scope addition (user): model lists and defaults moved to current-generation models, based on official docs (see "Current-models update").
- Bug found by the smokes and fixed: `recordLlmUsageSafe(null)` threw.
- Verified:
  - `npm run typecheck` passes.
  - `npm run lint`: 825 errors, the same count measured before any Stage 0 edit. All are in gitignored build output (`hud/runtime-resources`, `hud/dist`) and in untouched files. eslint on the touched HUD files: 0 errors, 2 pre-existing warnings.
  - Smokes pass: `smoke:token-usage` 28/28, `smoke:token-baseline` 18/18, `smoke:agent-tasks`, `smoke:local-db`, `smoke:src-tools`, `smoke:src-tool-loop-guardrails`, `smoke:src-providers`, `smoke:src-missions`, `smoke:src-prompt`.
- No live API calls; no real user data read.

### 2026-09-23 — Session 2b (Stage 0 close-out)
- Fixed the `reasoning_effort` bug introduced by the new OpenAI default: `resolveOpenAiRequestTuning` (`chat-handler/prompt-recovery/index.js`) sent `"minimal"` on strict passes to every `gpt-5*` model, and the gpt-5.6 models accept only none/low/medium/high/xhigh/max (model pages for gpt-5.6-terra/-sol/-luna, and the latest-model guide says to replace `minimal` with `low`; checked 2026-09-23). gpt-5.6 now gets `"low"`; older gpt-5 models are unchanged (unverified, so left alone).
- New smoke `scripts/smoke/runtime/openai-request-tuning-smoke.mjs` (`npm run smoke:openai-request-tuning`, 4/4). Typecheck clean.
- `scripts/smoke/README.md` was rewritten by a separate agent to document every smoke (177 + 1 Playwright spec).
- Step 8 deferred by the user. Stage 0 closed.

### 2026-09-23 — Session 3 (Stage 1, step 1a)
- User: "focus on the next smallest change" — Stage 1 started one small change at a time.
- `buildAgentSystemPrompt` (`src/runtime/modules/context/system-prompt/index.js`): the per-message Skills section moved from before the persona to the end of the base prompt. Content unchanged; only its position moved. Only the chat prompt path uses this builder, and no smoke checks section order.
- Measured with `npm run smoke:token-baseline`: total tokens identical in every scenario (same content). 10-turn chat, unchanged lead-in vs previous call (calls 2+): OpenAI shape avg 1,555 → **3,511**, min 533 → **3,048**; Claude shape avg 1,547 → **3,504**, min 525 → **3,041**. Every chat call now clears OpenAI's 1,024-token automatic-caching minimum. Tool-loop scenarios unchanged (already stable within a loop).
- Checks: typecheck, smoke:src-prompt, smoke:src-routing, smoke:audit, smoke:agent-tasks, smoke:token-usage, smoke:token-baseline 18/18 — all pass.
- Not yet proven with real billing: that providers actually report cached tokens for these calls (needs the deferred live check).

### 2026-09-23 — Session 3 (Stage 1, step 1b)
- Correction to Stage 0 open issue 8: there is no live timestamp in Personality Calibration. The only timestamp in the prompt is `updated=` in Identity Intelligence (`context/identity/prompt/index.js:37`). It is the date a trait was last learned and changes only when Identity learns something, not per call. Left as is (changing it would change prompt content).
- `prompt-context-builder` now builds the base prompt without skills, then the HUD persona overlay, and records that as `staticSystemPrompt`. Skills (`buildSkillsPromptBlock`, new export in `context/system-prompt`) and all per-turn sections are appended after it. It returns `staticSystemPrompt` and `turnContextPrompt` alongside the unchanged `systemPrompt` (= static + per-turn, the same string callers already send). Budget math is unchanged (it counts the whole string).
- Measured: 10-turn chat unchanged lead-in min 3,048 → 3,089 (OpenAI shape), 3,041 → 3,082 (Claude shape); totals +3 tokens (a blank line between sections). typecheck, smoke:src-prompt, smoke:src-routing, smoke:audit, smoke:agent-tasks, smoke:token-baseline all pass.

### 2026-09-23 — Session 3 (Stage 1, step 1c)
- Read Anthropic's prompt-caching docs (platform.claude.com/docs/en/build-with-claude/prompt-caching, 2026-09-23): minimum cacheable length 512 tokens (Fable 5.1, Opus 5.5), 1,024 (Sonnet 5), 4,096 (Haiku 4.5); order tools → system → messages; max 4 breakpoints; 5-minute default TTL; writes 1.25x, reads 0.1x (0.05x Opus 5.5, 0.025x Fable 5.1); `input_tokens` = tokens after the last breakpoint; `cache_control` also works on `tool_result` blocks; a top-level automatic `cache_control` exists too.
- New `buildClaudeCachedSystem(static, turn)` in `src/providers/runtime/runtime.js`: `system` becomes `[static block with cache_control ephemeral, per-turn block]` (a plain string when there is no static part). `executeChatRequest` builds it once and sends it on the three Claude chat paths (tool loop, direct reply, refinement correction pass). OpenAI-compatible paths are unchanged.
- Haiku 4.5 note: the static system (~3.1k tokens) is under its 4,096 minimum, so plain Haiku chat won't cache; with tools (tools + system ~5.7k) it will.
- Cost note: the first call in a 5-minute window writes the cache at 1.25x on the static part; every later call reads it at 0.1x. A one-off single message costs slightly more; any follow-up within 5 minutes comes out ahead.
- New smoke `scripts/smoke/token-efficiency/claude-cache-system-smoke.mjs` (4/4), added to `smoke:token-usage`. Harness: Claude-shape unchanged lead-in min 3,082 → 3,106; its total rose ~240 over 10 calls, which is JSON block-wrapper characters counted by the harness, not billed tokens. typecheck, smoke:src-prompt, smoke:src-routing, smoke:audit, smoke:agent-tasks, smoke:src-providers, smoke:token-baseline all pass.

### 2026-09-23 — Session 3 (Stage 1, step 1d)
- `claude-tool-loop`: from the second call of a loop on, the request's latest message gets a `cache_control` breakpoint on its last block (`withLatestMessageCacheBreakpoint`, exported for tests; returns a copy, never mutates the loop's messages; skips empty text). Breakpoints per request: 2 of the allowed 4 (static system + latest message). Not on the first call, because a loop that answers without tools makes only one call and the write would be wasted. Effect: steps 3+ read all earlier steps from cache at 0.1x.
- Smoke `claude-cache-system-smoke.mjs` extended to 6/6 (CC-5, CC-6). typecheck, smoke:src-tool-loop-guardrails, smoke:src-routing, smoke:agent-tasks, smoke:audit, smoke:token-baseline all pass.

### 2026-09-23 — Session 3 (Stage 1, step 1e skipped; Stage 1 code complete)
- 1e (per-turn context as a second system message after history, so history joins the cached prefix) was **not** done:
  - Google's OpenAI-compat docs (ai.google.dev/gemini-api/docs/openai) and xAI's chat docs don't say whether a system message may follow user/assistant messages. CLAUDE.md forbids guessing API formats.
  - Even for OpenAI the win is small: history is a sliding window trimmed from the oldest end once it passes the ~1,400-token target, so after the first few turns the start of the history changes every turn and can't be cached. It would also move the per-turn instructions after the history, which is a behavior change.
  - Possible later idea (not planned): trim history in larger chunks so its start stays stable for several turns.
- Stage 1 checks: typecheck, lint:agent, smoke:src-prompt, smoke:src-routing, smoke:audit, smoke:agent-tasks, smoke:src-providers, smoke:src-tool-loop-guardrails, smoke:token-usage (incl. claude-cache-system 6/6), smoke:token-baseline 18/18 — all pass.

### 2026-09-23 — Session 5 (Stage 2, tool output ceilings; autopilot manager)

**What changed**
- New `src/tools/core/output-caps/index.ts`: the one registry of per-tool output caps (`TOOL_OUTPUT_LIMITS`, a default for unknown tools, a structured-JSON ceiling for `gmail_*` / `coinbase_*` / `phantom_*`), `applyToolOutputCap`, the shared marker builder, and `truncateInline` for item shaping.
- `src/tools/core/executor`: every result goes through `applyToolOutputCap`, including the `Tool execution failed … Input:` text (which echoes the input). Both tool loops, the domain adapters, link understanding, the web preload and `src/agent/runner` all reach tools through this executor (checked: `tool.execute` has no other caller in `src/`).
- **Choice:** the per-tool output `truncate` helpers were removed from exec, browser_agent, memory_search / memory_get, web_fetch and web_search, and their numbers moved into the registry, so each result gets exactly one cut and one marker. Tool-internal *fetch* limits stay in the tools (web_fetch 2 MB download, web_search 1 MB, exec 1 MB capture, browser_agent 1 MB `maxBuffer`, grep 200 hits) because they bound work, not what the model sees. Item shaping also stays in the tool: web_search snippets (400) and HTTP error bodies (800) now use `truncateInline` (`… [+N chars]`).
- `read` is the one tool that cuts itself: it has to cut on whole lines to name the next `startLine`. It keeps body + marker inside its registry cap, so the central pass is a no-op for it (no double marker).
- `read` (`src/tools/builtin/file-tools`): without `endLine` it returns a window of 400 lines from `startLine` (default 1). Every result stays under 20,000 chars, on whole lines. A single line longer than the budget is cut inside the line, with its own note. Small files without a range come back byte-identical, and explicit ranges that fit behave as before. Two behavior changes:
  - an invalid range now gets the default window (it used to return the whole file)
  - a `startLine` past the end returns `read error: … past the end of the file (N lines).` (it used to return `""`)
- `memory_get`: new optional `offset` input (chars, default 0, backward compatible). An `offset` past the end returns an error line. This is the only schema change in Stage 2; its description adds ~35 tokens to every tool-loop call that includes the memory tools.
- `browser_agent`: its `maxOutputChars` input (default 12,000, clamped to 1,000–32,000) is now resolved centrally (`inputOverride` in the registry). Schema unchanged.
- Also: `src/tools/docs/structure.md` lists `core/output-caps/`.

**Caps (chars of tool output kept; the marker, at most 400 chars, is appended)**

| Tool | Before | After | Hint in the marker |
| --- | --- | --- | --- |
| `read` | unlimited | 400-line window without `endLine`; ≤ 20,000 chars total including the marker | `Call read with startLine=N (and optionally endLine) to continue.` |
| `memory_get` | 32,000 | **12,000**, plus `offset` | `Call memory_get with the same chunk_id and offset=N to read the next part.` |
| `web_fetch` | 16,000 of page body + title/source header | 18,000 of the whole result (the header is ~100–300 chars, so the body can only grow) | `…fetch a narrower URL (a specific section or subpage) for other parts.` |
| `web_search` | 6,000 | 6,000 | `Refine the query for more specific results.` |
| `exec` | 8,000 | 8,000 | `Narrow the command's output (filter it, or print a smaller part) to see the rest.` |
| `browser_agent` | 12,000 default, `maxOutputChars` 1,000–32,000 | same | `Narrow the command (for example a scoped snapshot) or raise maxOutputChars (max 32000).` |
| `memory_search` | 8,000 | 8,000 | `Lower top_k or refine the query; memory_get returns one source in full.` |
| `grep` | 200 hits, no char cap | 24,000 (200 hits measured at 17–21k chars on this repo) | `Narrow the pattern or the path to see the remaining matches.` |
| `gmail_*`, `coinbase_*`, `phantom_*` | unlimited (rows bounded by maxResults / limit ≤ 30) | 64,000 (JSON parsed by the domain adapters; a cut makes their `JSON.parse` fail, which they report as a tool error) | `Request fewer items (lower maxResults or limit) to get a complete result.` |
| any other tool (`ls`, `write`, `edit`, future tools) | unlimited | 16,000 | `Ask the tool for a narrower result to see the rest.` |

Marker format: deterministic (plain integers, no timestamps, no locale formatting).
- General: `\n... [truncated: showed chars 1-12000 of 50000; 38000 more not shown. <hint>]`
- `read`: `\n... [truncated: showing lines 1-400 of 5000; 4600 more lines not shown. Call read with startLine=401 (and optionally endLine) to continue.]`
- The old `... [truncated]` marker is gone from `src/tools`. It remains in `link-understanding`, which compacts prompt context, not a tool result.

**Measurements** (`npm run smoke:token-baseline`, offline, ~tok = chars/3.5)
- The harness gained a per-call tool-result metric (`tool res ~tok`, counted from `role: "tool"` messages and `tool_result` blocks).
- It also gained a scenario `agent-task-large-output`: ls, then read a 6,000-line log without a range, grep ERROR, and read a small file.
- "Before" was measured on the same harness against the pre-Stage-2 tool code.

| Scenario [shape] | Tool-result ~tok (sum over calls) | Total ~tok | Largest single call |
| --- | --- | --- | --- |
| agent-task-large-output [openai] | 496,743 → **30,303** | 534,132 → **62,902** (−88%) | 176,173 → 19,073 |
| agent-task-large-output [claude] | 496,743 → **30,303** | 533,259 → **62,031** (−88%) | 176,008 → 18,909 |
| agent-task [openai / claude] | 1,027 / 1,001, unchanged | 41,056 → 41,266 / 39,996 → 40,206 | +35 |
| web-research [openai / claude] | unchanged | +105 each | +35 |
| gmail-triage [openai / claude] | unchanged | +140 each | +35 |
| chat-10-turn, mission-run | 0 | unchanged | unchanged |

- The existing canned scenarios return small tool results, so Stage 2 does **not** reduce them. They grow by ~35 tokens per tool-loop call, which is the new `memory_get.offset` schema entry. The win is only on oversized results (the new scenario), which is what Stage 2 targets.
- New harness check: every tool result in `agent-task-large-output` reaches the model within its ceiling. It would have failed before Stage 2.

**New smoke** `scripts/smoke/token-efficiency/tool-output-caps-smoke.mjs` (`npm run smoke:tool-output-caps`, 16 checks). It covers:
- `read`: a 20,000-line file with and without a range, a startLine-only window, a 300k-char single line, and small files (unchanged).
- The real `web_fetch` tool on a huge page (stubbed `globalThis.fetch` and a TEST-NET IP literal, so no DNS).
- `memory_get` paging that reassembles the whole source, and `memory_search`.
- `exec`: a local node child printing 200k chars.
- `browser_agent`: a stub tool of the same name. The real tool needs the agent-browser binary, and Windows `execFile` can't run a `.cmd` shim.
- An unknown tool, a structured-JSON tool, and a throwing tool with a huge input.

Each check asserts the cap, the marker, the "how to get more" hint, and byte-identical repeats.

**Checks (all run in this session)**
- `npm run build:agent-core`, `npm run typecheck`, `npm run lint:agent`: pass.
- Smokes that pass:
  - `smoke:tool-output-caps` (new) 16/16
  - `smoke:src-tools` 6/6
  - `smoke:src-tool-loop-guardrails` 8/8
  - `smoke:src-files-domain` 3/3
  - `smoke:agent-tasks` 31/31
  - `smoke:token-usage` 34/34
  - `smoke:token-baseline` 23/23
  - `smoke:src-routing` 151/151
  - `npm test` (node:test, including the browser-agent and gmail tool tests)
  - `smoke:src-memory` 9/9
  - `smoke:src-security` 10/10
- Pre-existing failure, not caused by Stage 2: `npm run smoke` (`core/runtime-smoke.mjs`) throws at its line 113. It calls `loadIntegrationsRuntime()` without a user id, which throws `requires userContextId` at `src/providers/runtime/runtime.js:146` (same code at HEAD). This happens before the smoke touches any tool.
- No network, no real API calls, no `.user/` data read.

**Open issues (Stage 2)**
1. `browser_agent` is covered through the executor with a stub, not the real binary.
2. The structured-JSON ceiling (64,000) is set from the tools' row limits. Coinbase report sizes were not measured (that needs a live account).
3. The web_fetch readability worker (5 s default timeout) timed out on a ~375 KB HTML page on this machine in the first smoke draft. The smoke now uses a smaller page and raises `NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS`. This is pre-existing behavior: large real pages may return `web_fetch error: … timed out` instead of capped content.
4. `grep` has no per-line length limit. A 200-hit grep over minified files is now cut at 24,000 chars (before, it was unbounded).
5. BASELINE.md was not rewritten; the Stage 2 numbers are only here.

### 2026-09-23 — Coordinator verification of Stage 2
- Re-ran myself: build:agent-core, typecheck, lint:agent, smoke:tool-output-caps, smoke:src-tools, smoke:src-tool-loop-guardrails, smoke:agent-tasks, smoke:token-usage, smoke:token-baseline, smoke:src-routing — all exit 0. Reviewed the executor diff: one `applyToolOutputCap` call on both the success and failure paths.
- Stage 2 verified. Starting Stage 3 (tool schema diet, conditional).

### 2026-09-23 — Session 6 (Stage 3, tool schema diet; autopilot manager)

**Decisions**

| Item | Decision | Why |
| --- | --- | --- |
| (a) Scope integration-bound tools by connected integrations | **Done** | `coinbase_*` + `gmail_*` are 1,752 of the 2,940 ~tok of tool schemas per OpenAI-shape tool-loop call (60%). For an unconnected user every one of them can only return "not connected" (`coinbase_spot_price` also needs stored credentials: `CoinbaseService.getSpotPrice` calls `requireCredentials`). Scoping depends only on stored integration state, so it is stable per user and cache-safe. |
| (b) Shorten `browser_agent` and other long descriptions | **Skipped** | `browser_agent` is 387 ~tok, but only ~178 of that is description text (622 chars over the tool and its 10 parameters); the rest is schema structure. Every description is one short line that carries a format (`browser:<userContextId>:<conversationId>`), a limit (timeout max 120000, output default 12000 / max 32000), a default (`json` true) or the CLI flag it maps to. A trim that keeps all of them saves ~30–40 ~tok per call (~1% of a tool-loop call, and 0.1x once cached). Dropping rarely used parameters (`headed`, `actionPolicyPath`, `confirmActions`, `allowedDomains`) would save more, but it removes capability, which is not a description change, and there is no usage data behind it. The Coinbase descriptions are the next longest; after (a) they are only sent to users with Coinbase connected. No description text changed. |
| (c1) Drop `userContextId` / `conversationId` from the `coinbase_*` / `gmail_*` schemas | **Not done; recommended together with Stage 0 open issue 5** | Would save ~470 ~tok per call for a user with both connected (1,752 → 1,282). The OpenAI loop injects both fields, but the Claude loop does not (open issue 5), so there the model still has to fill them. Removing `required: userContextId` first needs the Claude loop to inject them, which is a separate behavior fix. |
| (c2) Scope by turn intent, or per agent task by guessed need | **Rejected** | Varies the tool list per turn and breaks the cached prefix (PLAN.md rule). There is no stable per-task signal for which non-integration tools a task needs. |
| (c3) `phantom_capabilities` | **Included in (a)** | Same rule (`phantom.connected`). It is opt-in (not in the default `NOVA_ENABLED_TOOLS`), so the default list is unaffected. |

**What changed**
- New `src/runtime/modules/chat/core/chat-handler/model-tool-scope/index.js`: `INTEGRATION_BOUND_TOOLS` (prefix + connected test per integration), `readRuntimeIntegrationsSnapshot`, `resolveConnectedToolIntegrations`, `selectModelTools`, `resolveModelToolsForUser`.
  - The connected tests mirror the tools themselves. Coinbase = `coinbase.connected` plus a stored `apiKey` and `apiSecret` (as `FileBackedCoinbaseCredentialProvider`, but without decrypting; a key pair that fails to decrypt keeps the tools, which then report DISCONNECTED as before). Gmail = `gmail.connected` (as the Gmail tools). Phantom = `phantom.connected`.
  - It reads the `integration_state` runtime snapshot row on every tool-loop turn (one indexed SQLite read, no decryption, no cache), so connecting or disconnecting mid-session takes effect on the next turn. `cachedLoadIntegrationsRuntime` (60 s TTL) was deliberately not used for that reason. No user, no snapshot or a read error means nothing is connected (the tools could not work in that state either).
  - It keeps registry order and passes the tool objects through, so the list is byte-identical across turns for the same user.
- `execute-chat-request`: computes `modelTools` once per turn when a tool loop will run. The OpenAI loop gets `toOpenAiToolDefinitions(modelTools)`, the Claude loop gets `modelTools`. If scoping leaves no tool (only integration tools enabled, none connected), the turn answers through the direct path instead of sending an empty `tools` array.
- `claude-tool-loop`: new optional `modelTools` input, used only for the tool definitions (defaults to `availableTools`, so existing callers are unchanged).
- **Not changed:** `availableTools` everywhere else: the chat-handler `llmCtx`, tool execution in both loops, `task-tool-policy`, the Gmail / Coinbase / crypto / files / market / web-research workers and provider adapters, diagnostics. So every lane's "not connected" reply is exactly as before. A model that calls an unoffered integration tool anyway still has it executed and gets the tool's own "disconnected" result.
- Harness (`token-baseline-harness.mjs`): gmail-triage now seeds a Gmail-connected runtime snapshot for its user (placeholder data, no token), because the scenario is about a Gmail user. New check: every scenario's tool list is identical on every call and offers `coinbase_*` / `gmail_*` only when connected (24 checks now).

**Measurements** (`npm run smoke:token-baseline`, ~tok = chars/3.5; "before" is the same harness run on the Stage 2 tree at the start of this session)

| Scenario [shape] | Tools offered | Tool schemas ~tok per tool-loop call | Tool-schema share of a call (avg) | Sum of tool-schema ~tok | Total ~tok |
| --- | --- | --- | --- | --- | --- |
| web-research [openai / claude] | 25 → 11 | 2,940 → **1,188** / 2,733 → **1,097** | 43% → 23% / 41% → 22% | 8,820 → 3,564 / 8,199 → 3,291 | 20,674 → 15,418 / 19,991 → 15,083 |
| agent-task [openai / claude] | 25 → 11 | same as above | 43% → 23% / 41% → 22% | 17,640 → 7,128 / 16,398 → 6,582 | 41,266 → 30,754 (−25%) / 40,206 → 30,390 (−24%) |
| agent-task-large-output [openai / claude] | 25 → 11 | same as above | 29% → 15% / 28% → 14% | 14,700 → 5,940 / 13,665 → 5,485 | 62,902 → 54,142 / 62,031 → 53,851 |
| gmail-triage, Gmail connected [openai / claude] | 25 → 20 | 2,940 → **2,121** / 2,733 → **1,956** | 38% → 31% / 36% → 29% | 11,760 → 8,484 / 10,932 → 7,824 | 31,506 → 28,230 / 30,800 → 27,692 |
| chat-10-turn, mission-run | no tools | unchanged | – | 0 | unchanged |

- Totals moved by exactly the tool-schema difference (prompt and messages unchanged). A user with both Coinbase and Gmail connected gets the same 25-tool list as before (smoke MTS-4).
- Cost effect: tool schemas are the start of the cached prefix. For a user with neither integration this saves ~1.75k tokens at full price on the first call of every cache window and on uncached calls, ~1.75k × the cached rate on the other calls, and ~1.75k tokens of context on every tool-loop call. Connecting or disconnecting an integration causes one deliberate prefix-cache miss.

**New smoke** `scripts/smoke/token-efficiency/model-tool-scope-smoke.mjs` (`npm run smoke:model-tool-scope`, 9 checks):
- the connected-state matrix, order and pass-through;
- through `handleInput` with fake OpenAI and Claude models: no integration tool for an unconnected user, and a byte-identical list on every call and across two turns;
- tools appear on the next turn after connecting Gmail, then Coinbase, and vanish after disconnecting;
- the Gmail status lane still answers "Gmail status: not connected" from `gmail_capabilities` (not "not enabled") without a model call, and the Coinbase adapter still gets `DISCONNECTED` (not `TOOL_NOT_ENABLED`);
- a scope with only integration tools answers directly, with no `tools` array;
- no network.

A mutation run with scoping disabled fails MTS-3, MTS-4 and MTS-6.

**Checks (all run in this session)**
- All exit 0: `build:agent-core`, `typecheck`, `lint:agent`.
- Smokes, all exit 0:
  - `smoke:model-tool-scope` (new) 9/9
  - `smoke:src-tools` 6/6, `smoke:src-tool-loop-guardrails`, `smoke:tool-output-caps` 16/16
  - `smoke:agent-tasks` 31/31, `smoke:token-usage`, `smoke:token-baseline` 24/24
  - `smoke:src-routing` 151/151, `smoke:src-providers` 16/16, `smoke:src-gmail-domain` 3/3
  - `smoke:src-coinbase-ci` (the ten Coinbase suites, 75 PASS lines), `smoke:src-coinbase-readiness`
- No pre-existing failures hit in this set. No network, no real API calls, no `.user/` data read. `src/tools` was not changed.

**Open issues (Stage 3)**
1. (c1) above: dropping the injected `userContextId` / `conversationId` fields from the integration schemas (~470 ~tok for connected users) waits on the Claude loop injecting them (Stage 0 open issue 5).
2. The model no longer sees Gmail / Coinbase tools for an unconnected user. A general question such as "what's in my inbox?" that reaches the tool loop (not a Gmail / Coinbase / crypto lane) now gets the model's own "I can't access that" answer instead of a tool call that returned "not connected". Turns the router sends to those lanes are unaffected. The Coinbase skill (`skills/coinbase/SKILL.md`) still names the Coinbase tools when it is selected for a turn; with Coinbase unconnected the model cannot call them.
3. Coinbase "connected" is decided from stored values without decrypting them (by design: no secret handling in the scoping path). A stored key pair that no longer decrypts still shows the tools, which answer DISCONNECTED as before.

### 2026-09-23 — Coordinator verification of Stage 3
- Re-ran myself: typecheck, lint:agent, smoke:model-tool-scope, smoke:src-tools, smoke:tool-output-caps, smoke:agent-tasks, smoke:token-usage, smoke:token-baseline, smoke:src-routing, smoke:src-gmail-domain, smoke:src-providers — all exit 0. Reviewed `model-tool-scope`: scopes only the model-facing list; `availableTools` (execution, policy, workers) unchanged.
- For the user's final review: behavior change for users without Gmail/Coinbase connected — a general tool-loop question about those services now gets the model's own answer instead of a tool call that returns "not connected" (lane-routed Gmail/Coinbase turns unchanged).
- Stage 3 verified. Starting Stage 4 (per-task budgets).

### 2026-09-23 — Session 7 (Stage 4, per-task budgets; autopilot manager)

**Migration** `src/db/migrations/0014-agent-task-budgets.js` (registered in `index.js`): `agent_tasks.cost_budget_usd REAL` and `token_budget INTEGER` (NULL = the user's default), `budget_state TEXT NOT NULL DEFAULT 'ok'` (CHECK ok / warning / degraded / exhausted). `pause_reason` gains the value `'budget'` (the column is free text, no migration needed).

**Defaults and arithmetic** (offline, no live calls). The `agent-task` harness scenario (5 tool steps + a final answer, `smoke:token-baseline` on the Stage 3 tree) sends 30,754 ~tok of input over 6 calls (OpenAI shape) and 30,390 (Claude shape). Output is assumed at ~300 tokens per call (1,800 in total; the fake client reports none), and all input is billed uncached (worst case):
- gpt-5.6-terra: 30,754 × $2/M + 1,800 × $12/M = $0.0615 + $0.0216 = **$0.083**
- claude-sonnet-5: 30,390 × $2/M + 1,800 × $10/M = $0.0608 + $0.0180 = **$0.079**
- A typical task is therefore ~$0.08 and ~32.5k tokens. Three times that gives the defaults: **$0.25 and 100,000 tokens** (total tokens: input including cached, plus output).
- Economy models (the cheapest tool-capable picker model per provider): openai `gpt-5.6-luna` (0.20 / 1.20), claude `claude-haiku-4-5-20251001` (1.00 / 5.00), gemini `gemini-3.1-flash-lite` (0.25 / 1.50), grok `grok-build-0.1` (1.00 / 2.00). An economy model is only accepted from the same provider's current models, and is used only when it is priced cheaper than the task's model.
- Settings are stored in kv_state (namespace `agent-task-budget`, key `settings`) and only written when the user saves them. There is no env var.

**Degradation as built** (`src/runtime/modules/agent-tasks/budget`). One controller per attempt. Spend = the task's earlier attempts (row `cost_usd`, `tokens_in + tokens_out`) + this attempt, observed through `withLlmUsageObserver` (every LLM call of the attempt). Fraction = the larger of the cost share and the token share.
- After each call: at ≥ 80%, `budget_state = warning` and a user-scoped WebSocket `agent-task-budget` event.
- Before every model call of both loops (every step, plus the OpenAI recovery call), the next call is projected: input = max(the last call's input, chars/3.5 of the request about to be sent), billed at the uncached rate; output = the last call's output (256 before any call). If the projection reaches 100%, the task degrades ONCE: (a) earlier tool results in the loop history become `summarizeToolResultPreview` previews and the latest step's results stay in full (a deliberate one-time cache miss); (b) the rest of the loop uses the provider's economy model (`budget_state = degraded`, event). If the projection with the economy model is still over, or the spend is already over, it stops (c) BEFORE the call: `AgentTaskBudgetExhaustedError` → the service pauses the task (`status paused`, `pause_reason 'budget'`, `budget_state 'exhausted'`, tokens and cost of the attempt added, the error text says what was spent and that Resume re-runs from the start).
- Only agent tasks: `execute-chat-request` passes the controller to the loops only when `source === "agent-task"`. With no budget (no own value and no default), the controller is null and the loops run exactly as before (checked byte-identical by ATB-5).
- Resume (play) re-runs from the start and is refused while spend ≥ the effective budget. Raise budget (PATCH `action: "raise-budget"`) sets the task's own budget (it must be above the spend), recomputes the state and requeues. Abort = the existing stop. `agent_task_effects` still guards side effects.

**Files**
- Runtime (subagent A): new `agent-tasks/budget/index.js` (controller) and `agent-tasks/budget-settings/index.js` + `.d.ts` (settings, shared with the HUD; written by the manager); new `chat-handler/loop-context-trim/index.js`; `tool-loop-runner`, `claude-tool-loop` (optional `taskBudget`), `execute-chat-request` (source gate, `runSummary.budgetExhausted`, "Paused: this agent task reached its budget."), `chat-handler/index.js` (ctx pass-through), `infrastructure/hud-gateway` (scoped event type + `broadcastAgentTaskBudget`), `agent-tasks/index.js` (controller per attempt, fenced `budget_state` writes, `persistBudgetPaused`, `onBudgetEvent` test hook).
- Pre-existing bug fixed on the way (A): `chat/workers/shared/worker-contract` `normalizeWorkerSummary` dropped `errorCode` / `pendingApproval`, so through the real `handleInput` an approval-required agent task failed instead of pausing. They now pass through (plus `budgetExhausted`), only when set. **Behavior change:** approval-required agent tasks now pause as designed.
- HUD (subagent B): `lib/agents/types.ts`, new `lib/agents/task-budget.ts` (client-safe event parsing / merge helpers), `lib/agents/task-store.ts` (budget columns, effective budget per task, create validation, resume guard, `raiseTaskBudget`, settings read / update), `app/api/agent-tasks/route.ts` (raise-budget), new `app/api/agent-tasks/budget-settings/route.ts` (GET / PUT), `lib/chat/hooks/useNovaState.ts` (scoped event → `nova:agent-task-budget` window event), `app/home/hooks/use-agent-tasks.ts` (live merge, `raiseBudget`), `components/agents/task-card.tsx` (budget bar, state chip, Resume / Raise budget / Abort, side-effects note), `task-list.tsx`, `agent-tasks-home-module.tsx`, `create-task-modal.tsx` (optional budget), `components/settings/settings-nav.tsx`, `settings-modal.tsx`, new `panels/settings-agent-budgets-panel.tsx`.
- Smokes (subagent C): new `scripts/smoke/token-efficiency/agent-task-budget-smoke.mjs` (`npm run smoke:agent-task-budget`, 18 checks); new helper `scripts/smoke/lib/hud-task-store.mjs`; `agent-task-store-smoke.mjs` (budget-settings import rewrite + budget checks); `token-harness-lib.mjs` (optional scripted usage); `package.json`; `scripts/smoke/README.md` (new rows, token-efficiency count 8, `smoke:token-usage` row now lists its 4 smokes).
- Mutation runs (in-memory module rewrite, no source edits): enforcement disabled → 10 of 18 checks fail; source gate removed → both ATB-5 checks fail.

**Checks (all run by the manager; all exit 0)**
- `build:agent-core`, `typecheck` (agent + hud, including the secret-input guard), `lint:agent`.
- HUD eslint on all 14 touched or new HUD files: exit 0.
- `smoke:agent-task-budget` 18/0, `smoke:agent-tasks` (all six), `smoke:token-usage`, `smoke:token-baseline` 24/0, `smoke:model-tool-scope` 9/0, `smoke:tool-output-caps` 16/0, `smoke:src-tools` 6/0, `smoke:src-tool-loop-guardrails`, `smoke:local-db`, `smoke:src-routing` (no failing summary).
- No pre-existing failures hit in this set. No network, no real API calls, no `.user/` data.
- UI (subagent B, not re-done by the manager): rendered at 1024×768 in headless Chromium against `next dev` with a scratch `NOVA_DATA_DIR` and seeded fake tasks. Checked the warning, degraded (a simulated window event), exhausted and raise-form states, raise validation and requeue, the create-modal placeholders and the settings panel. Dark theme only. The real runtime → WebSocket path was not exercised in the browser (it is covered by the service smoke through `onBudgetEvent`).

**Open issues (Stage 4)**
1. The default token budget (100k) is checked alongside the cost budget. With caching the real cost falls well below the uncached estimate, so the token limit is usually hit first. The economy model saves no tokens, so a token-bound task goes degraded → exhausted on the same check without a cheaper call, and step (b) mainly helps cost-bound tasks. Options: keep it, or make the default token budget "no limit" and keep tokens as an optional per-task limit. Needs a user decision.
2. Budgets are enforced only inside the two tool loops. Direct completions (no tool loop), worker lanes and refinement / output-constraint calls after the loop are counted, but they are not stopped.
3. The projection is deliberately conservative (uncached input rate, at least the last call's input), so a cached task may pause somewhat before it would really go over.
4. Tasks on expensive models (Fable, Opus) reach the $0.25 default within a normal run and degrade or pause. That is intended, but users should know.
5. At 1024×768 the Home task list is small; a budget-paused card with the raise form open needs scrolling inside the list. Light theme not visually verified.
6. `smoke:agent-task-budget` is standalone (not in an aggregate). It could be appended to `smoke:agent-tasks` / the release chain.
7. For Stage 5 / release docs: README and CLAUDE.md should mention the budget settings (Settings → Agent budgets; kv_state `agent-task-budget`), the economy model per provider, and migration 0014. Version not bumped.

### 2026-09-23 — Coordinator verification of Stage 4
- Re-ran myself: build:agent-core, typecheck, lint:agent, smoke:agent-task-budget, smoke:agent-tasks, smoke:token-usage, smoke:token-baseline, smoke:model-tool-scope, smoke:tool-output-caps, smoke:src-tools, smoke:src-tool-loop-guardrails, smoke:local-db, smoke:src-routing — all exit 0.
- For the user's final review: (1) default token budget 100k counts cached tokens too, so with caching the token limit, not cost, will usually trip first — options: keep, or make tokens unlimited by default and budget on cost only; (2) default $0.25 per task is reached by normal Opus/Fable tasks; (3) out-of-scope bug fix in worker-contract (approval-needing agent tasks now pause as designed instead of failing); (4) light theme and the live WebSocket path for budget events were not browser-checked.
- Stage 4 verified. Starting Stage 5 (analytics, regression gate, final report).

### 2026-09-24 — Session 8 (Stage 5, analytics, regression gate and final report; autopilot manager)

**What changed**
- Analytics API (subagent A):
  - New contract `hud/lib/analytics/types.ts` (written by the manager) and new server-only `hud/lib/analytics/usage-analytics.ts`.
  - `GET /api/analytics?days=N` (`app/api/analytics/route.ts`, rewritten) keeps the old agent-task fields and adds `usage` and `budgets` (shape in FINAL-REPORT.md, "Analytics"). `days` is 1–90, default 30. It uses one query on the `(user_id, ts)` index, grouped by UTC hour, source, provider and model, then bucketed into local days.
  - Savings are computed from `src/providers/pricing`, on priced models only.
  - New `GET /api/analytics/summary` for Home: today's totals and budget alerts on tasks that haven't finished (terminal tasks are excluded on the manager's review).
- `/analytics` page (A, `app/analytics/page.tsx`):
  - The range buttons now drive `days` (1 / 7 / 30 / 90).
  - New sections: usage cards (spend with an unpriced-calls note, tokens, cache hit rate, estimated savings), cost by source and tokens (cached / uncached / output) over time, by provider, by source, by model ("Pricing unknown" for unpriced models), and `#budgets` (count chips, tasks with a budget and alerts, each with a state chip and status badge).
  - The old task charts are kept. Every section has an empty state, and a failed load shows Try again.
  - The manager added `formatUsdTick`, so the y-axis no longer shows duplicate "$0.03" ticks.
- Home panel (subagent B, then the manager): new `app/home/components/analytics-home-module.tsx` and `app/home/hooks/use-home-analytics-summary.ts`; `home-main-screen.tsx` only swaps the static "View Dashboard" button for the module.
  - Tiles: Spend (today, "+?" when some calls are unpriced), Tokens (today, % cached), Budgets (warning+degraded / exhausted; opens `/analytics#budgets`, or "OK").
  - Polling: every 60 s while the page is visible, refresh when it becomes visible again, debounced refresh on the budget window event, abort on unmount.
  - The manager rewrote the layout after the browser check. B's 2-column tiles truncated the values to "$0…" in the 117 px panel at 1024 px, so the tiles are now stacked rows (label, then value + secondary text) and sit side by side only from a 13rem container. The manager also replaced the nonexistent `bg-s-20` class with `bg-s-15`.
- Regression gate (subagent C):
  - New `scripts/smoke/token-efficiency/token-regression-gate.mjs` and helper `token-gate-break-prefix-hook.mjs` (an in-memory `module.registerHooks` rewrite of `context/system-prompt`; no file changes).
  - `npm run smoke:token-gate` (build + `--self-test`) is added to `smoke:src-release` after `smoke:agent-tasks`. The repo has no CI workflow files.
  - Thresholds: measured × 1.1 rounded up to the next 50 for ceilings, × 0.9 rounded down to the next 50 for floors. They are in the script and in FINAL-REPORT.md.
  - `scripts/smoke/README.md` has the new rows, the heading is now "(9, plus 2 helpers)", and the release-chain row is updated.
- Docs (manager): FINAL-REPORT.md.
  - README: default models, per-task budgets, usage analytics, prompt caching and scoped tools, output caps, `NOVA_LLM_USAGE_RETENTION_DAYS`, `smoke:token-gate`.
  - CLAUDE.md: `llm_usage` and migrations 13–14 in Storage; Agent Tasks budgets; LLM usage & cost; prompt caching; tool output caps.
  - The version was **not** bumped (autopilot rule; CLAUDE.md asks for it with every change, so this is left to the user).

**Gate proof** (`npm run smoke:token-gate`, exit 0):
- The clean run passes 80/80 threshold checks.
- `break-prefix` (a per-call counter in front of the static prompt) fails 4 checks: chat min prefix 11 / 10 ~tok vs ≥ 2,750, uncached 4,419 / 4,437 vs ≤ 1,050.
- `bloat-prompt` (+~1,250 tokens) fails 12 size ceilings on the tool-loop scenarios.
- A report missing a scenario fails.
- Standalone, `--mutation break-prefix` exits 1. `git status --short src` is unchanged by the gate.

**Browser check** (manager): `next dev` on 127.0.0.1:3218 with a scratch `NOVA_DATA_DIR`. Data: 180 fake `llm_usage` rows over 30 days (gpt-5.6-terra, claude-sonnet-5, gemini-3.8-flash, grok-4.3 and an unpriced id; chat / agent-task / mission), one row for another user, and 4 fake tasks in ok / warning / degraded / exhausted. Checked in Playwright Chromium at 1024×768 and 1920×1080, dark and light (theme set through the `ui-storage` kv mirror), then again with the ledger and tasks emptied.
- APIs: 30-day totals 180 calls, $1.53, 41% cached, savings $0.57 ($2.10 at uncached rates − $1.53). The other user's row is excluded. Today (summary): 6 calls, $0.03, 52% cached; alerts 1 warning / 1 degraded / 1 exhausted.
- Home panel, 1024: 117×192 px, three stacked rows "SPEND $0.03+? 6 calls / TOKENS 34.4k 52% cached / BUDGETS 2/1 warn / out". Nothing overflows or is cut. The rest of Home is unchanged.
- Home panel, 1920: 253×278 px, the same stacked rows with room to spare.
- Clicking Budgets opens `/analytics#budgets` and scrolls to the section.
- `/analytics`: no horizontal scroll at either width. The charts render (175 bar rects measured; the earlier full-page screenshots showed empty charts only because of the resize animation). The by-model table shows "Pricing unknown" for the unpriced id. The budgets section shows chips, bars, state chips and a dimmed completed task.
- Empty state: the panel shows "$0.00 0 calls / 0 0% cached / OK In limits". Every usage section on the page says "No LLM calls in this range yet", and the budgets section explains how to set a budget.
- Console errors are only the expected `ws://localhost:8765` refusals (no runtime running).

**Checks (all run by the manager; all exit 0)**
- `build:agent-core`, `typecheck` (agent + hud + secret-input guard), `lint:agent`.
- HUD eslint on the 8 touched HUD files.
- `smoke:token-gate` (80/80 + self-test), `smoke:token-baseline` 24/24, `smoke:agent-task-budget` 18/18, `smoke:agent-tasks`, `smoke:token-usage`, `smoke:model-tool-scope` 9/9, `smoke:tool-output-caps` 16/16, `smoke:local-db`, `smoke:src-routing` (29 summaries, no failure), `smoke:src-release-readiness` 12/12.
- Harness rerun: identical to the numbers in FINAL-REPORT.md.
- No pre-existing failure was hit in this set. No real API calls. One unintended registry download: subagent A ran `npx tsx --version`, which fetched tsx into the npm cache; it wasn't used. No `.user/` data was read.

**Open issues (Stage 5)**: FINAL-REPORT.md "Open issues" 24–28. The full list for all stages is there too.

### 2026-09-24 — Coordinator verification of Stage 5; autopilot finished
- Re-ran myself: build:agent-core, typecheck, lint:agent, smoke:token-gate, smoke:token-baseline, smoke:agent-task-budget, smoke:agent-tasks, smoke:token-usage, smoke:model-tool-scope, smoke:tool-output-caps, smoke:local-db, smoke:src-routing — all exit 0.
- Stages 0–5 complete (Stage 0 committed in V.70/V.71; Stages 1–5 uncommitted). Waiting on the user: live check (spend ceiling), dropped-context bug fix, token-budget default, retired-model migration, version bump. Full list in FINAL-REPORT.md.

### 2026-09-24 — User decisions after Stage 5
- "Fix all 7 decisions; if Opus will hit the budget, raise it; make it enterprise ready; fix everything; then Stage 6."
- Live check approved with a **$1 cap** on the active provider (run by the coordinator after the fixes).
- **Stage 6 = full tiered routing** (added to PLAN.md).
- Order: close-out fixes manager (decisions 2–6 + FINAL-REPORT's 28 open issues) → coordinator verification → live check ($1) → Stage 6 manager → verification → version bump (decision 7) → present.
