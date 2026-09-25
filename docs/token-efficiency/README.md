# Token Efficiency: Reference

Written for AI models and developers who will change prompt assembly, provider calls, tools, budgets or analytics. It describes how Nova keeps LLM spend low and what you must not break. The work shipped in V.70–V.73 (2026-09-23 to 2026-09-25); the git history for those versions holds the session-by-session record.

## Rules that keep caching working

1. **Static prompt first, byte-stable.** The chat system prompt = static part (identity, policies, persona SOUL/USER/MEMORY/IDENTITY, runtime line, HUD persona, the per-user "not connected" integrations line) + per-turn part (skills, preferences, identity, personality, continuity, short-term, operator routing, web / link / memory context, strict output) appended after it. Nothing that depends on the user's message, the time of the turn or recall may go into the static part. Contract: `staticSystemPrompt` / `turnContextPrompt` in `prompt-context-builder`.
2. **Claude:** `system` is sent as blocks with `cache_control` on the static block; the Claude tool loop adds a breakpoint on the latest message (max 4 per request). Test: `claude-cache-system-smoke`.
3. **OpenAI / Gemini / Grok** cache the identical leading part automatically. Keep the tool list in registry order.
4. **Tool scoping is per user, never per turn.** `coinbase_*` / `gmail_*` / `phantom_*` are offered only when that integration is connected (`chat-handler/model-tool-scope`). Changing the tool set per turn breaks the cache.
5. **One model per tool loop.** A routing tier is decided once per turn or per call site. Only budget degradation may switch model mid-loop.
6. **Per-turn context has its own budget**, `NOVA_PROMPT_TURN_CONTEXT_MAX_TOKENS` (default 5,000), counted only over text after the static prompt. `NOVA_MAX_PROMPT_TOKENS` (default 18,000) only sizes history, which keeps its ~1,400-token target.
7. **Tool output caps live in one registry**, `src/tools/core/output-caps`, applied in the executor. `read` returns a 400-line window without `endLine`; markers say how much was cut and how to get more. Don't add per-tool truncation.
8. **Step 1e is deliberately not done:** the per-turn context is not moved after the history, because Google's and xAI's OpenAI-compatible docs don't say whether a system message may follow user / assistant turns. Don't guess (CLAUDE.md).

## Where things live

| Concern | Code |
| --- | --- |
| Usage normalisation (all providers, incl. cached / cache-write) | `src/providers/usage` |
| Prices (exact model IDs; unknown = unpriced, `cost_usd` NULL) | `src/providers/pricing` (the only price table; the HUD delegates to it) |
| Per-call ledger | `llm_usage` table (migrations 13, 17 sources, 18 `tier`); one row per successful call; sources `chat` / `agent-task` / `mission` / `utility` / `embedding` |
| Retired model IDs → current model | `src/providers/models/retired-model-aliases` (applied at request time) + migration 16 (rewrites stored IDs, audit in kv_state `model-migrations`) |
| Per-task budgets | migration 14 columns, migration 15 `agent_task_budget_events`; settings `src/runtime/modules/agent-tasks/budget-settings` (kv_state `agent-task-budget`) |
| Tiered model routing | `src/runtime/modules/model-routing` (kv_state `model-routing`); HUD `hud/lib/settings/model-routing`, `/api/model-routing`, Settings → Model routing |
| Analytics | `hud/lib/analytics` (`usage-aggregation.ts` is pure), `/api/analytics`, `/api/analytics/summary`, `/analytics` page, Home Analytics panel |

## Budgets

- Default **$2.00 per task, cost only**; the token budget is optional (null default). $2.00 ≈ 4.9× a worst-case harness agent task on the most expensive current model (gpt-6-astra / claude-fable-5-1 ≈ $0.41 uncached). `smoke:agent-task-budget` (ATB-8a) recomputes this from the price table, so a pricier model fails the smoke.
- Checked before every model call of both tool loops, plus a pre-call guard on agent-task direct completions and the correction pass: warn at 80% → trim older tool results + same-provider economy model → pause (`pause_reason 'budget'`) before a call that would go over. Resume re-runs the task from the start; `agent_task_effects` prevents repeated side effects.
- The projection uses the uncached rate on purpose (the cached share is unknown until the provider answers).
- An unpriced model is never blocked by a cost budget; the card flags it.

## Model routing

- Tiers: `trivial` (correction pass, empty-reply recovery, Spotify parse, mission classify / extract, nova-suggest, Gmail digest), `standard` (ordinary chat, tool loop on a routed lane, mission summarize / generate / chat), `hard` (agent tasks, financial lanes, multi-step request shape, tool loop without an operator lane, mission build-from-prompt; empty-reply recovery inside a hard turn). Rules only, no classifier call.
- Modes: `off` (requests byte-identical to before routing), `trivial` (**default**), `cost-saving` (opt-in; trivial + standard). Hard is never downgraded; the provider never changes; a mission node's explicit model is never routed.
- A call is routed only when a cache-aware estimate (`estimateCallCostUsd`, per-model cache minimums) says the economy model is cheaper than the selected model with its warm cache. A refused economy model (404 / not found) retries once on the selected model; Claude errors carry `error.status` for this.
- The economy model per provider is the Agent budgets setting (one source of truth).

## Cache minimums (from official docs, read 2026-09-23)

OpenAI 1,024 tokens (automatic). Claude: Sonnet 5 1,024, Opus 5.5 / Fable 5.1 512, Haiku 4.5 4,096. Gemini 3.x implicit 4,096 (2.5: 2,048), so plain Gemini chat (~3.2k static prompt) usually misses; tool loops qualify. xAI: no documented minimum.

Pricing sources (standard tier only): developers.openai.com/api/docs/pricing, platform.claude.com/docs/en/about-claude/pricing, ai.google.dev/gemini-api/docs/pricing, docs.x.ai/developers/models.

## Measured results (offline harness, ~tok = chars / 3.5)

| | Baseline (before caching) | Final (V.73) |
| --- | --- | --- |
| Identical lead-in between chat turns (cacheable) | 533 | 3,227 |
| Tool schemas per tool-loop call, no Gmail / Coinbase | 2,905 | 1,188 |
| Agent task (5 tool steps + answer), total input | 41,051 | 32,144 (includes the per-turn context the old budget silently dropped) |
| Agent task that reads a 6,000-line log | 534,132 | 56,986 |

Cost-saving routing (estimated): 10-turn chat −90% on OpenAI (terra → luna), −3% on Claude (Haiku can't cache a 3.2k prompt). Default mode changes no harness scenario.

## Tests and the regression gate

- `npm run smoke:token-efficiency`: every token-efficiency smoke (usage, harness, caps, tool scope, budgets, integration context, prompt budget, unconnected integrations, routing, routing cost, retired models, analytics). Runs in `smoke:src-release`.
- `npm run smoke:token-gate`: the offline gate. Each harness scenario has ceilings (call size, tool schemas, uncached part) and floors (stable prefix). No API keys, no network. `--self-test` proves it fails on a broken prefix, a bloated prompt and a missing scenario.
- **Changing a gate threshold:** re-measure (`node scripts/smoke/token-efficiency/token-baseline-harness.mjs --out tb.json --quiet`, then `node scripts/smoke/token-efficiency/token-regression-gate.mjs --report tb.json`), set ceilings = measured × 1.1 rounded up to 50 and floors = × 0.9 rounded down to 50, update `THRESHOLDS` in the script with the date, and explain why in the release's version history entry.
- `npm run smoke:token-baseline`: prints the per-scenario numbers.
- Live check (opt-in, costs money): `NOVA_LIVE_TOKEN_CHECK=1 npm run smoke:live-token-check`. It reads the active provider key read-only, runs in a temp data dir, and stops at 80% of a $1 cap.

## Open items

- **Never verified live:** real cache hits and cached-token counts on any provider, real output tokens and dollars, whether Gemini's OpenAI-compatible endpoint returns `cached_tokens`, and answer quality on economy models (live A/B). The live check was blocked because no provider key was saved.
- Mission OpenAI / Grok requests still send `temperature: 0`; whether GPT-5.6 accepts it is undocumented. (Claude 4.7+ rejects it, so it is sent only to older Claude models.)
- Domain worker lanes are counted against a task budget but not stopped by it.
- `src/providers/clients/index.ts` throws Claude errors without an HTTP status (no routed call uses it).
- `phantom_capabilities` still has `userContextId` in its schema (opt-in tool).
- `ops:mission-reliability-review`, `ops:mission-runbook-drills`, `ops:mission-legacy-remediate` hard-code `<cwd>/.user` and read legacy files: port or remove them.
- `src/agent/runner` and `src/agent/compact` call Claude without the ledger, but nothing imports them (dead code).
- Embedding cost is rounded to 6 decimals per row, so tiny calls record $0.
