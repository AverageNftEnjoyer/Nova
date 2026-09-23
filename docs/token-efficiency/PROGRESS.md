# Token-Efficiency Overhaul — Progress Log

Read this file first at the start of every session. It is the only place context survives between sessions.

## Status

The plan is [PLAN.md](PLAN.md) (revised 2026-09-23: stages 0 tracking/baseline + usage ledger, 1 caching, 2 tool output ceilings, 3 tool schema diet if justified, 4 per-task budgets, 5 analytics (Home panel + `/analytics`), regression gate and report).

| Stage | State |
| --- | --- |
| 0 — Tracking & baseline | **Done** (user-confirmed 2026-09-23). Step 8 (live check) is deferred: the user will run it later. |
| 1 — Stable prefix & caching | **In progress.** Step 1a done: Skills section moved to the end of the base system prompt. |
| 2–5 | Not started |

Rules: see PLAN.md "Ground rules".

## Resume state

- Last session: 2026-09-23 (Session 2). Stage 0 is implemented, apart from the live check. Migration 13, `src/db/llm-usage.js`, `src/providers/usage` and `src/providers/pricing` were committed by the user in V.70 (`dce2799`). Everything else listed in the Session 2 log is **uncommitted**.
- Next action: Stage 1, next smallest change (user asked to go one small change at a time). Candidates: remove the live `updated=` timestamp from Personality Calibration; then move sections 7–13 into a per-turn block after history; then Anthropic `cache_control`. Step 8 (live check) still deferred to the user.
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
6. `read` has no output cap.

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
