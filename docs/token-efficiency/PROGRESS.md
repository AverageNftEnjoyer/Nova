# Token-Efficiency Overhaul — Progress Log

Read this file first at the start of every session. It is the only place context survives between sessions.

## Status

The plan is [PLAN.md](PLAN.md) (revised 2026-09-23: stages 0 tracking/baseline + usage ledger, 1 caching, 2 tool output ceilings, 3 tool schema diet if justified, 4 per-task budgets, 5 analytics (Home panel + `/analytics`), regression gate and report).

| Stage | State |
| --- | --- |
| 0 — Tracking & baseline | Map done (read-only). Tracking, harness and baseline not started. |
| 1–5 | Not started |

Rules: see PLAN.md "Ground rules".

## Resume state

- Last session: 2026-09-23. Stage 0 map finished; plan revised into PLAN.md. No source files changed.
- Next action: Stage 0 step 1 in PLAN.md (usage normalisation), then the offline harness. Live checks wait for the spend ceiling (PLAN.md "Needs your answer").
- Measurement scripts used so far lived in the session scratchpad (not the repo). Stage 0 step 7 rebuilds them under `scripts/smoke/token-efficiency/`. Their results are under "Static measurements".

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
4. Gemini/Grok cost is never computed (missing pricing); mission LLM calls report no usage.
5. Agent tasks that fail or pause record zero tokens even though tokens were spent.
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
