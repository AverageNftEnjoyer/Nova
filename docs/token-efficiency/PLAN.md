# Token-Efficiency Plan (revised)

This replaces the original 8-stage plan. It keeps the stages that fit how Nova actually works and drops the ones that target problems Nova doesn't have. Every claim here is from the Stage 0 map in [PROGRESS.md](PROGRESS.md). Read PROGRESS.md first each session; it holds the map, the measurements and the resume state.

## Ground rules (unchanged)

1. Never commit. Leave everything unstaged for review.
2. No regressions. At every stage boundary: `npm run typecheck`, `npm run lint`, the relevant `scripts/smoke/` suites, and Playwright where the HUD changed.
3. Measure before and after. A stage with no measured win is reported as a failed stage.
4. Read the code path fully before changing it. Read the provider's official docs before touching an API request (CLAUDE.md rule).
5. Update PROGRESS.md at the end of every session with exact resume state.
6. Hard stop after each stage; wait for explicit confirmation.
7. Every release that ships a stage updates `hud/lib/meta/version/index.ts`, `README.md` and `CLAUDE.md` together.

"No regressions" for prompt changes means: the same content reaches the model, the existing conversation-quality and routing smokes pass, and a before/after spot-check shows no difference in answers. Byte-identical model output is not a meaningful test, because LLM output isn't deterministic.

## Where the tokens go today (from Stage 0)

| Per call | ~Tokens | Notes |
| --- | --- | --- |
| System prompt, fresh install | 3,190 | Only the first ~517 are identical turn to turn |
| Persona files inside it | 2,090 | SOUL/USER/MEMORY/IDENTITY |
| Tool schemas, when a tool loop runs | 2,750 | All 23 tools, every step, outside the prompt budget |
| History | ≤ 1,400 target, 3,200 max | Sliding window, already bounded |
| Memory recall | ≤ 1,000 | Already capped (and currently dropped by a budget bug) |
| Tool results in a loop | up to 16k chars each | Resent on every later step, max 6 steps |

Almost everything is paid in full on every call because nothing is cached. That is the main win.

## What was kept, changed, and dropped

| Original stage | Decision | Why |
| --- | --- | --- |
| 0 Recon & baseline | **Kept, cheaper** | Baseline measured offline with a fake client (free, exact, repeatable). Only cache-hit checks need live calls. |
| 1 Prompt caching | **Kept, main stage** | Nothing is cached today and the prefix is unstable after ~517 tokens. Biggest and safest win. |
| 2 Lazy tool schemas | **Reduced, conditional** | Per-turn tool sets would break the cache from Stage 1. Once cached, schemas cost a fraction. Only trim/scope per task if still significant after Stage 1. Lazy hydration dropped. |
| 3 Memory token budget | **Dropped** | Chat recall is already top-3 × 600 chars inside a 1,000-token cap. The two large memory outputs (`memory_get`, `memory_search`) are tool outputs, covered in Stage 2 below. |
| 4 Conversation compaction | **Dropped** | Agent tasks are one tool loop (≤ 6 steps, 32 s), not long conversations. Chat history is already a ~1.4k-token sliding window. Summarising would add LLM calls. Resending tool results inside a loop is handled by caching in Stage 1. |
| 5 Tool output ceilings | **Kept, smaller** | Most tools already cap by characters. `read` is uncapped and `memory_get` allows 32k chars. Gmail already never fetches bodies. |
| 6 Tiered model routing | **Restored as Stage 6** (user request 2026-09-24; originally dropped for the reason at right) | The memory pipeline makes no LLM calls. The only extra calls are the rare output-constraint correction pass, empty-reply recovery and Spotify intent parsing. A classifier would cost more to build and maintain than it saves. |
| 7 Per-task budgets | **Kept, adapted** (Stage 4) | Existing limits (6 steps, 32 s) cap the time spent on a task, not the money. A budget adds an explicit cost ceiling and makes spend visible. The degradation order is adapted because compaction was dropped: trim loop context → cheapest model → pause and ask. |
| 8 Dashboard, gates, report | **Kept** (Stage 5) | Built into the existing Home Analytics panel and `/analytics` page rather than a new dashboard, fed by a per-call usage ledger so chat, agent tasks and missions all count. |

---

## Stage 0 — Tracking and baseline

Goal: accurate per-call numbers, including cache usage, and a baseline that costs nothing to rerun.

1. **Normalise usage across providers** in one helper used by every call site (`src/providers/runtime/runtime.js`, `tool-loop-runner`, `claude-tool-loop`, `direct-completion`, `response-refinement`, `prompt-recovery`, `spotify-agent`). Output shape: `{ inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens }`, where `inputTokens` is always the total input.
   - OpenAI / Gemini / Grok (OpenAI-compatible): `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`. Confirm per provider in the official docs whether Gemini and xAI return `cached_tokens` on the compat endpoint.
   - Anthropic: total input = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (Anthropic's `input_tokens` excludes cached tokens). Read both from `message_start` and `message_delta` when streaming.
2. **Agent task columns** (migration 13): add `cached_input_tokens` and `cache_write_input_tokens`. Keep `tokens_in` / `tokens_out` as prompt / completion. Uncached input = `tokens_in − cached − cache_write`, calculated when displayed, not stored.
3. **Record tokens on failed and paused tasks too** (today they record 0).
4. **Pricing:** add Gemini and Grok rates and cached-input rates for every priced model, from each provider's pricing page. `estimateTokenCostUsd` takes the cached split.
5. **Missions:** make `completeWithConfiguredLlm` (`hud/lib/missions/llm/providers.ts`) return usage, so mission runs are measurable.
6. **Per-call usage ledger** (same migration): an `llm_usage` table with one row per LLM call: `user_id`, `ts`, `source` (`chat` / `agent-task` / `mission`), `ref_id` (conversation, task or mission run), `provider`, `model`, input / output / cached / cache-write tokens, `cost_usd`. It is written by the usage helper from step 1, so no call site can forget it. This is the single data source for Stage 4 budgets and Stage 5 analytics. Today `/api/analytics` only sums `agent_tasks`, so chat and missions never appear. Prune rows after a retention period (default 90 days, configurable).
7. **Offline baseline harness** (`scripts/smoke/token-efficiency/`): drive `handleInput` with a fake client via the existing `runtimeSelectionOverride` pattern (see `scripts/smoke/routing/*-live-smoke.mjs`), capture every request payload, and report exact input size, the stable-prefix length (bytes identical to the previous call), and tool-schema share. Scenarios:
   - 10-turn chat
   - web research turn (tool loop, canned search/fetch results)
   - agent task with 4–6 tool steps
   - Gmail triage (canned Gmail tool results)
   - mission run (canned LLM step)
8. **Live check (small, on your active provider only):** run the 10-turn chat and the agent task once each to record real usage and confirm cached tokens are 0 today. Needs a spend ceiling from you first.
9. Write `BASELINE.md` with the offline numbers (exact) and the live numbers (real billing).

Acceptance: usage and cost are recorded correctly for all four providers (unit tests with recorded usage payloads), every LLM call lands one `llm_usage` row, the harness runs in CI without API keys, BASELINE.md exists, and all suites are green.

## Stage 1 — Stable prefix and caching (the main win)

Goal: the large unchanging part of each request is billed at the cached rate from the second call on.

1. **Split the system prompt into two parts** in `prompt-context-builder`:
   - **Static:** identity and policies, persona (SOUL/USER/MEMORY/IDENTITY), time zone, messaging, voice, workspace, runtime line, HUD persona overlay. Nothing in it may depend on the user's message.
   - **Per-turn:** Skills section (it's chosen from the message), preferences, identity intelligence, personality, conversation continuity, short-term context, operator routing, web/link/memory context, strict output rules.
   The content stays the same; only its position changes.
2. **Message order:** `[static system] [history…] [per-turn context] [user message]`. For OpenAI-compatible providers the per-turn context is a second system message just before the user message. For Claude, `system` becomes an array of blocks: the static block first, and the per-turn context goes into the final user turn or a trailing system block, whichever the Anthropic docs allow without breaking the cache.
3. **Anthropic:** put `cache_control: { type: "ephemeral" }` on the static system block (this caches the tools too, since tools come before system). In the Claude tool loop, also put a breakpoint on the latest message, so steps 2–6 read the earlier steps from cache (max 4 breakpoints per request). Check the minimum cacheable length for the configured model in the docs.
4. **OpenAI / Gemini / Grok:** caching is automatic once the first 1,024+ tokens are identical. Keep the tool list in a fixed order and the static block byte-stable. Verify in each provider's docs that the compat endpoint caches automatically; don't build Gemini explicit context caching unless the docs show implicit caching doesn't apply.
5. **Persona edits:** already handled. `buildPersonaPrompt` rebuilds when a file's mtime or size changes, and a changed prefix is a cache miss by design. MEMORY.md auto-capture will cause an occasional miss; measure how often before doing anything about it.
6. **Measure:** rerun the offline harness (stable-prefix length should go from ~517 to ~2.6k+ tokens, or ~5k+ with tools) and the live check (cached tokens on turn 2+ and on tool-loop steps 2+). Report cost per scenario before and after.

Acceptance: cache hit on > 90% of calls after the first in the live multi-turn and tool-loop checks; conversation-quality, routing and agent-task smokes green; spot-check shows no answer changes.

## Stage 2 — Tool output ceilings

Goal: no single tool result can dump an unbounded blob into the loop.

1. One registry of per-tool output caps, applied in the tool executor (`src/tools/core/executor`), replacing the scattered per-tool `truncate` constants. Start from today's limits so nothing gets smaller by accident, except:
   - `read`: default to a line window (for example the first 400 lines) when no range is given, with a marker saying the total line count and how to request `startLine` / `endLine`.
   - `memory_get`: lower from 32k chars; the marker explains how to read the next part.
2. Every truncation marker says how much was cut and how to get more (today's markers only say `... [truncated]`).
3. Adversarial smokes for `read` (huge file), `web_fetch` (huge page), `memory_get` (huge doc), `browser_agent` (huge output).

Acceptance: adversarial smokes pass; the offline agent-task scenario shows lower tool-result tokens; suites green.

## Stage 3 — Tool schema diet (only if Stage 1 numbers justify it)

Decide from the Stage 1 measurements. If the tool block is still a meaningful share of uncached cost:

1. Shorten the longest descriptions (`browser_agent` alone is ~380 tokens; the Coinbase and Gmail sets are ~780 and ~860).
2. Scope tools **per session or per agent task**, never per turn, so the cached prefix stays stable (for example, don't attach Coinbase tools to a task that has no Coinbase integration connected).

Skip this stage if the Stage 1 report shows tools are cheap once cached.

## Stage 4 — Per-task budgets with graceful degradation

Goal: no agent task can spend past its budget without the user deciding.

How tasks run matters here: a task is one tool loop (up to 6 model calls), so the budget is checked **after every model call in the loop** (`tool-loop-runner`, `claude-tool-loop`), using the usage from that call. It is not checked once at the end.

1. **Budget fields.** Migration: `agent_tasks.cost_budget_usd` and `agent_tasks.token_budget` (both nullable = use the global default), plus `budget_state` (`ok` / `warning` / `degraded` / `exhausted`). Global defaults live in Settings (stored in `kv_state`). Set the starting default from the Stage 0 baseline (for example 3× the typical agent-task cost), not a guess. The create-task modal gets an optional budget field.
2. **80% warning.** Set `budget_state = warning` and send a WebSocket event (`agent-task-budget`), which the Agent Tasks card shows live as a budget bar next to the existing cost readout.
3. **100%: degrade in this order, never continue silently:**
   - (a) **Trim loop context:** replace older tool results in the loop with their existing short previews (`summarizeToolResultPreview`) and keep only the latest result in full. This is a local, deterministic operation with no extra LLM call; it stands in for the dropped compaction stage.
   - (b) **Cheapest model:** switch the remaining steps to the cheapest configured model of the **same provider** (a per-provider "economy model" setting, so it never needs a second API key). Set `budget_state = degraded`.
   - (c) **Pause and ask:** if the next call would still go over, stop before making it. Pause the task with `pause_reason = 'budget'` (reusing the existing approval-pause path), set `budget_state = exhausted`, and show **Resume / Raise budget / Abort** on the task card.
4. **Resume behavior (state this in the UI):** a task has no mid-loop checkpoint, so Resume re-runs the task from the start with the new budget. Side effects already made are not repeated, because of the existing `agent_task_effects` reservations. Record tokens spent before the pause (Stage 0 step 3).
5. **Test:** a smoke with a fake client whose usage crosses 80%, then 100%, asserts the warning event, then (a), then (b), then the pause, in that order, and that no call is made after the pause. Also test the raise-budget → resume path and the abort path.

Acceptance: the runaway smoke passes; the task card shows budget state live; the agent-task, routing and conversation smokes are green.

## Stage 5 — Analytics, regression gate and final report

Goal: show the savings and budget state where you already look, and lock the win in.

1. **Home Analytics panel** (`hud/app/home/components/home-main-screen.tsx`, currently a static "View Dashboard" link card): make it a compact live summary that still opens `/analytics` on click:
   - spend today (and against a daily figure, if one is set)
   - tokens today, with the cached share (cache hit rate)
   - agent tasks at budget warning / exhausted (clicking opens those tasks)
   It must fit the panel at the 1024×768 minimum, using the same container-query and truncation approach as the other Home panels.
2. **`/analytics` page** (`hud/app/analytics/page.tsx`, `hud/app/api/analytics/route.ts`), switched to read the `llm_usage` ledger:
   - cost and tokens over time, split by source (chat / agent tasks / missions), provider and model, including Gemini and Grok
   - cached vs uncached input over time, and savings from caching in dollars
   - per-task budget use and a list of budget events (warnings, degradations, pauses)
   - token share by tool result, from the harness and per-call records
3. **Regression gate:** a CI smoke using the offline harness. Every scenario has a ceiling on uncached input tokens per call and a floor on stable-prefix length. A change that breaks caching or bloats the prompt fails CI without spending API money.
4. `FINAL-REPORT.md`: baseline vs final per scenario (tokens, cost, cache hit rate), with a table showing what each stage contributed.
5. Update the version file, README and CLAUDE.md for the new settings (budgets, economy model, usage retention) and the caching behavior.

Acceptance: the Home panel and `/analytics` show live ledger data (verified in a browser at 1024×768 and 1920×1080); the gate fails on a deliberately broken prefix; FINAL-REPORT.md is complete; all suites and Playwright are green.

---

## Stage 6 — Tiered model routing (added 2026-09-24 at the user's request)

The user chose full tiered routing over the smaller "cheap model for side calls" option. Goal: cheap models do cheap work and the user's chosen model does the hard reasoning, with **no quality regression on hard work**.

1. Tag every internal model call with a tier: `trivial` (Spotify intent parsing, output-format correction passes, empty-reply recovery, simple classification or extraction), `standard` (tool-result synthesis, ordinary chat), `hard` (multi-step reasoning, agent-task planning and final synthesis, ambiguous tool routing).
2. Route: `trivial` → the provider's economy model (the same per-provider setting Stage 4 added); `standard` → the user's selected model unless routing is set to cost-saving; `hard` → the user's selected model, never downgraded. Never switch provider. The mapping lives in one module, configurable in Settings, with routing off by default until the user turns it on (or on for `trivial` only, whichever the stage report justifies).
3. The classifier is rules first (lane, call site, request shape); a model call is only a fallback, and never for `hard`.
4. Cache safety: switching model changes the cache, so a tier is decided per call site or per turn, never mid-loop (except Stage 4's budget degradation).
5. Quality gates: offline smokes prove every call site gets the expected tier and model; the existing routing, conversation and agent-task smokes pass; a live A/B on `hard` prompts only if the user provides a spend ceiling. Any regression on `hard` blocks the stage.
6. Measure: estimated cost per scenario before/after with the harness and pricing; update the token gate and FINAL-REPORT.md.

## Decided

- **Tracking columns:** two new columns (`cached_input_tokens`, `cache_write_input_tokens`), with `tokens_in` / `tokens_out` kept as prompt / completion and uncached input calculated.
- **Baseline:** recorded with current behavior, including the dropped-context bug below, so Stage 1 deltas are clean.

## Needs your answer before live runs

- Spend ceiling for the Stage 0 and Stage 1 live checks, and which provider/model to use (default: your active chat provider).

## Found issues, kept out of this plan (each needs its own approval)

1. **Dynamic context is silently dropped at default settings.** The fresh-install system prompt (~3,190 tokens) already fills the system budget, so memory recall, web-search preload, link context, identity and preference sections are rejected (`no_system_budget`). Fixing it adds tokens, but Stage 1 makes the static part much cheaper, so the right time to fix it is straight after Stage 1.
2. `## Tooling` tells the model no tools are registered even when they are.
3. AGENTS.md (~1.5k tokens) is copied into every workspace but never used.
