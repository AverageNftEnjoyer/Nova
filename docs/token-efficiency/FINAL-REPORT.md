# Token-Efficiency Overhaul — Final Report

Stages 0–5 of [PLAN.md](PLAN.md), 2026-09-23 to 2026-09-24. The session-by-session record is [PROGRESS.md](PROGRESS.md); the Stage 0 numbers and method are in [BASELINE.md](BASELINE.md).

**Read this first.** Every number here is **offline**: the harness drives the real runtime with a fake model and measures the exact request payloads Nova builds. Token counts use the runtime's own estimator (`ceil(chars / 3.5)`), not a provider tokenizer. The live check (PLAN.md Stage 0 step 8) is still deferred, so **no real cached-token count exists yet** and every dollar figure below is an **estimate** from list prices.

## Headline

| | Stage 0 baseline | Final | Change |
| --- | --- | --- | --- |
| Unchanged lead-in between chat turns (min, calls 2+) | 533 ~tok | 3,089 ~tok | ×5.8: every chat turn now clears the 1,024-token caching minimum of OpenAI and Claude Sonnet 5 |
| Tool schemas per tool-loop call (user with no Gmail / Coinbase) | 2,905 ~tok | 1,188 ~tok | −59% |
| Agent task (5 tool steps + answer), total input | 41,051 ~tok | 30,754 ~tok | −25% |
| Agent task that reads a 6,000-line log (added in Stage 2) | 534,132 ~tok | 54,142 ~tok | −90% |
| Estimated cost, agent task, gpt-5.6-terra, with caching | $0.043 (automatic caching, if it hit) | $0.038 | see the cost table |
| Estimated cost, 10-turn chat, gpt-5.6-terra | $0.100 | $0.058 | −42% |
| Estimated cost, 10-turn chat, claude-sonnet-5 | $0.109 (no caching possible) | $0.061 | −44% |

Chat totals did not shrink (the same content is sent); what changed is that most of it is now a cacheable prefix. Tool-loop totals shrank because of tool scoping (Stage 3) and, for large tool outputs, output caps (Stage 2).

## Baseline vs final, per scenario (offline, exact)

Rerun for this report on 2026-09-24 with `npm run smoke:token-baseline` (24/24 checks). "Total" = input + tool schemas summed over the scenario's calls. "Prefix" = the leading part of each call identical to the previous call, minimum over calls 2+ (what a provider can serve from cache).

| Scenario [shape] | Calls | Total ~tok (baseline → final) | Tool schemas ~tok (baseline → final) | Prefix min, calls 2+ (baseline → final) |
| --- | --- | --- | --- | --- |
| 10-turn chat [openai] | 10 | 39,634 → 39,637 | 0 → 0 | 533 → **3,089** |
| 10-turn chat [claude] | 10 | 39,562 → 39,804 | 0 → 0 | 525 → **3,106** |
| Web research [openai] | 3 | 20,567 → **15,418** | 8,715 → 3,564 | 6,309 → 4,594 |
| Web research [claude] | 3 | 19,790 → **15,083** | 8,094 → 3,291 | 6,095 → 4,520 |
| Agent task [openai] | 6 | 41,051 → **30,754** | 17,430 → 7,128 | 6,514 → 4,798 |
| Agent task [claude] | 6 | 39,796 → **30,390** | 16,188 → 6,582 | 6,300 → 4,724 |
| Agent task, large output [openai] | 5 | 534,132 → **54,142** ¹ | 14,700 → 5,940 | n/a → 4,588 |
| Agent task, large output [claude] | 5 | 533,259 → **53,851** ¹ | 13,665 → 5,485 | n/a → 4,514 |
| Gmail triage, Gmail connected [openai] | 4 | 31,365 → **28,230** | 11,620 → 8,484 | 6,582 → 5,799 |
| Gmail triage, Gmail connected [claude] | 4 | 30,531 → **27,692** | 10,792 → 7,824 | 6,368 → 5,651 |
| Mission run [openai] | 1 | 550 → 550 | 0 | n/a |
| Mission run [claude] | 1 | 542 → 542 | 0 | n/a |

¹ This scenario was added in Stage 2; its "baseline" is the same harness run on the pre-Stage-2 code.

Notes:
- Tool-loop prefixes got *shorter* in tokens only because the tool schemas at their start got shorter (Stage 3). Within a loop each request still repeats ~88–99% of the previous one.
- The Claude chat total rose by ~240 characters-as-tokens over 10 calls: the `system` field is now an array of blocks (JSON wrapper characters counted by the harness, not billed tokens).
- Chat turns 8 and 10 have longer prefixes when the chosen skills happen to match the previous turn.

## What each stage contributed

| Stage | What changed | Measured effect (offline) |
| --- | --- | --- |
| 0 — Tracking & baseline | Usage normaliser for all four providers (cached / cache-write tokens), `llm_usage` per-call ledger (migration 13), cache-aware pricing incl. Gemini and Grok, mission usage, tokens on failed / paused tasks, offline harness, new default models | No token change (measurement only). Made every later number possible. |
| 1 — Stable prefix & caching | Skills and all per-turn sections moved after a byte-stable static system prompt; Claude `system` as blocks with `cache_control` on the static block; latest-message breakpoint in the Claude tool loop | Chat lead-in min 533 → 3,089 ~tok (OpenAI shape), 525 → 3,106 (Claude). Totals unchanged (+3 ~tok). Tool loops were already append-only. |
| 2 — Tool output ceilings | One output-cap registry in the executor; `read` 400-line window; `memory_get` 32k → 12k chars with `offset`; markers say how to get more | Large-output agent task 534,132 → 62,902 ~tok (−88%). Normal scenarios +35 ~tok per tool-loop call (the new `memory_get.offset` schema field). |
| 3 — Tool schema diet | `coinbase_*` / `gmail_*` / `phantom_*` offered only when connected (stable per user, cache-safe). Description shortening skipped (≈1% win). | Tool schemas per call 2,940 → 1,188 ~tok (OpenAI), 2,733 → 1,097 (Claude); agent task 41,266 → 30,754 (−25%); web research −25%; Gmail-connected user 2,940 → 2,121 per call. |
| 4 — Per-task budgets | Per-task cost / token budgets (migration 14), 80% warning, then trim + same-provider economy model, then pause before a call that would go over; Resume / Raise budget / Abort | No change in the harness scenarios (no budget is reached there). It caps the worst case instead: `smoke:agent-task-budget` proves no model call is made after the pause point. Default $0.25 / 100,000 tokens (3× the measured agent task). |
| 5 — Analytics & gate | `/analytics` and the Home Analytics panel read the ledger; offline regression gate (`smoke:token-gate`) | No token change. Locks in Stages 1–3 (see "Regression gate"). |

## Estimated cost per scenario (estimates, not billing)

Assumptions, applied the same way to baseline and final:
- Models: `gpt-5.6-terra` ($2.00 input / $0.20 cached / $12.00 output per 1M) for the OpenAI shape, `claude-sonnet-5` ($2.00 / $0.20 read / $2.50 write / $10.00) for the Claude shape. Rates from `src/providers/pricing` (read from the official pages on 2026-09-23).
- 300 output tokens per call (the fake model reports none).
- "With caching": for calls 2+ the stable prefix is billed at the cached rate if it is at least 1,024 tokens, the rest at the input rate. Claude: the static system part is billed as a cache write (1.25×) on call 1, later chat calls read at most that static part, and tool-loop steps 2+ write their new tokens (the latest-message breakpoint). OpenAI's 128-token cache granularity is ignored.
- Baseline Claude had no `cache_control`, so it had no caching. Baseline OpenAI is shown with the caching the provider *might* have applied automatically to the append-only tool loops (not verified).

| Scenario | OpenAI shape: baseline no cache / baseline auto-cache → final no cache / **final with caching** | Claude shape: baseline → final no cache / **final with caching** |
| --- | --- | --- |
| 10-turn chat | $0.115 / $0.100 → $0.115 / **$0.058** | $0.109 → $0.110 / **$0.061** |
| Web research | $0.052 / $0.029 → $0.042 / **$0.024** | $0.049 → $0.039 / **$0.025** |
| Agent task | $0.104 / $0.043 → $0.083 / **$0.038** | $0.098 → $0.079 / **$0.037** |
| Agent task, large output | $1.086 / – → $0.126 / **$0.060** | $1.082 → $0.123 / **$0.066** |
| Gmail triage | $0.077 / $0.037 → $0.071 / **$0.035** | $0.073 → $0.067 / **$0.036** |
| Mission run | $0.005 → $0.005 (single call, nothing to cache) | $0.004 → $0.004 |

Provider notes for the same payloads:
- **Gemini 3.x** implicit caching needs a 4,096-token prefix. Chat turns (~3.1k static prefix) will usually **miss**; tool loops (4.5k+) qualify. Whether Gemini's OpenAI-compatible endpoint reports `cached_tokens` is undocumented (PROGRESS.md "Doc findings").
- **Claude Haiku 4.5** needs 4,096 tokens: plain chat won't cache, tool loops will.
- **xAI** caches automatically with no documented minimum.
- A Claude one-off message costs slightly more than before (the 1.25× cache write on the static part); any follow-up within 5 minutes comes out ahead.

## Regression gate

`npm run smoke:token-gate` (`scripts/smoke/token-efficiency/token-regression-gate.mjs --self-test`, after `build:agent-core`). It is part of the release chain `npm run smoke:src-release` (after `smoke:agent-tasks`), which `npm run verify:release-readiness` runs. The repo has no CI workflow files; this chain is the CI/release gate. It needs no API keys and makes no network calls; the whole run takes a few seconds.

It runs the offline harness and checks every scenario × shape against a threshold table in the script. Ceilings are the value measured on 2026-09-24 × 1.1, rounded up to the next 50; floors are × 0.9, rounded down to the next 50.

| Scenario [shape] | Calls ≤ | Largest call, input + tools ≤ | Tool schemas per call ≤ / sum ≤ | Stable prefix, calls 2+ ≥ | Uncached part of calls 2+ ≤ |
| --- | --- | --- | --- | --- | --- |
| 10-turn chat [openai / claude] | 11 | 4,900 / 4,900 (measured 4,428 / 4,444) | 0 / 0 | 2,750 (measured 3,089 / 3,106) | 1,050 (948 / 947) |
| Web research [openai / claude] | 4 | 6,450 / 6,250 | 1,350 / 3,950; 1,250 / 3,650 | 4,100 / 4,050 | 1,000 / 900 |
| Agent task [openai / claude] | 7 | 6,250 / 6,200 | 1,350 / 7,850; 1,250 / 7,250 | 4,300 / 4,250 | 450 / 450 |
| Agent task, large output [openai / claude] | 6 | 19,100 / 19,050 | 1,350 / 6,550; 1,250 / 6,050 | 4,100 / 4,050 | 7,450 / 7,500 |
| Gmail triage [openai / claude] | 5 | 8,950 / 8,800 | 2,350 / 9,350; 2,200 / 8,650 | 5,200 / 5,050 | 1,050 / 1,100 |
| Mission run [openai / claude] | 2 | 650 / 600 | 0 / 0 | n/a (one call) | n/a |

There is also a separate ceiling on per-call input without tool schemas. The full table, with each measured value next to its threshold, is `THRESHOLDS` in the script. A missing scenario, a scenario without thresholds, a harness error or a failing harness check also fails the gate.

**Proof that it fails.** `--self-test` runs the clean harness and two deliberate regressions. They are injected in memory by a module-loader hook (`token-gate-break-prefix-hook.mjs`, `NOVA_TOKEN_GATE_MUTATION`); no file on disk changes.
- `break-prefix` puts a per-call counter in front of the first line of the static system prompt. The gate fails on the chat prefix floor (min prefix 11 / 10 ~tok vs ≥ 2,750) and on the uncached ceiling (4,419 / 4,437 vs ≤ 1,050).
- `bloat-prompt` adds ~1,250 tokens to the static prompt. The gate fails 12 size ceilings on the tool-loop scenarios (for example agent task [openai]: largest call 6,903 vs ≤ 6,250).
- A report without one scenario fails.

The self-test passes only if all three fail and the clean run passes.

Limits: only the multi-turn chat scenario can catch per-turn text in the static prompt, because each tool-loop scenario is one turn. The tool-loop floors catch a prefix break inside a loop (for example a tool list that changes between steps). `cache_control` placement for Claude is covered by `claude-cache-system-smoke`, not by the gate.

## Analytics (Stage 5)

- `GET /api/analytics?days=N` (1–90, default 30; local days) keeps its old agent-task fields and adds `usage` and `budgets`, both read from `llm_usage` and `agent_tasks`:
  - `usage`: totals, by source, by provider, by model (`priced: false` for unknown models), daily series (cost and tokens per source, cost per provider, cached / uncached / cache-write / output tokens, savings) and a savings summary.
  - `budgets`: defaults, counts per state, tasks with a budget ranked by use, and the tasks not "ok".
- It reads with one indexed range query (`user_id, ts`) grouped by UTC hour × source × provider × model; the hours are bucketed into local days in the HUD. The contract is `hud/lib/analytics/types.ts`, the code `hud/lib/analytics/usage-analytics.ts`.
- **Savings** = cost at uncached rates − cost with the cached / cache-write split, both from `src/providers/pricing`, on priced models only. Unpriced models add tokens but no cost or savings, and the page says how many calls that was. The figure can be negative (Anthropic cache writes cost 1.25×).
- `GET /api/analytics/summary` feeds the Home panel: today's totals plus budget alerts on tasks that haven't finished. The panel polls it every 60 s only while the page is visible, refreshes when the tab comes back and after a budget event, and opens `/analytics` (the budget tile opens `/analytics#budgets`).
- Rendered with seeded fake data and empty, dark and light, at 1024×768 and 1920×1080 (PROGRESS.md, Stage 5 entry).

## Verified vs not verified

Verified (offline, by smokes rerun on 2026-09-24):
- Request payloads for every scenario, both shapes: sizes, tool lists, stable prefixes (`smoke:token-baseline`, `smoke:token-gate`).
- Usage normalisation for recorded OpenAI / Gemini / xAI / Anthropic payloads, cost math, one ledger row per call, retention (`smoke:token-usage`).
- Claude `cache_control` placement (`claude-cache-system-smoke`).
- Tool output caps under adversarial inputs (`smoke:tool-output-caps`), tool scoping (`smoke:model-tool-scope`), budget enforcement order and the pause (`smoke:agent-task-budget`).
- The analytics aggregation against seeded fake ledger rows, and the Home panel and `/analytics` rendered in a browser (see PROGRESS.md, Stage 5).

**Not verified:**
- Real cache hits and real cached-token counts on any provider (the live check is deferred; it needs a spend ceiling).
- Whether Gemini's OpenAI-compatible endpoint returns `cached_tokens`.
- Real output token counts (300 per call is an assumption) and therefore real dollar amounts.
- Answer quality after the prompt reordering, beyond the routing / conversation smokes (no live spot-check has been run).

## Open issues (all stages)

Collected from PROGRESS.md (Stages 0–4) plus Stage 5. Fixed items are left out; items that need a user decision are marked **decision**.

**Measurement**
1. The live check (Stage 0 step 8) has not been run. It needs a spend ceiling and a provider. Until then, Stage 1's acceptance criterion ("cache hit on > 90% of calls after the first") is unproven, and so is whether Gemini's compatible endpoint reports `cached_tokens`. **decision**
2. Some LLM calls are not in the ledger: `api/missions/nova-suggest`, the `test-*-model` and `list-claude-models` routes, ChatKit serving and shadow calls, and embeddings. The Gmail summary route and `build-from-prompt` land as source `mission` with an empty `ref_id`.
3. `sessionContext.persistUsage` and the operator-finalization telemetry ignore the cached-token fields.

**Prompt and caching**
4. Dynamic context is silently dropped at default settings (`no_system_budget`): memory recall, web-search preload, link context, identity and preference sections don't fit the system budget. The web-search preload still runs a real search whose result is then dropped. The fix adds tokens, but it is now cheap because the static part is cacheable. **decision**
5. `## Tooling` tells the model no tools are registered even when they are.
6. AGENTS.md (~1.5k tokens) is copied into every workspace but never used.
7. Step 1e was skipped: per-turn context stays before the history, so history is never part of the cached prefix. Placing it after the history is undocumented for the Gemini and xAI compatible endpoints. A possible later idea is trimming history in larger chunks.
8. MEMORY.md auto-capture and persona edits change the static prefix and cause a deliberate cache miss. How often this happens hasn't been measured.
9. On Gemini 3.x (4,096-token implicit-cache minimum) and Claude Haiku 4.5 (4,096), plain chat turns (~3.1k static prefix) won't cache; tool loops will.

**Tools**
10. The Claude tool loop doesn't inject `userContextId` / `conversationId` into `gmail_*` / `coinbase_*` inputs, unlike the OpenAI loop. Fixing it would allow dropping those fields from the schemas (~470 ~tok per call for a user with both integrations connected).
11. For users without Gmail / Coinbase connected, a general tool-loop question about those services now gets the model's own answer instead of a "not connected" tool result. Lane-routed turns are unchanged. The Coinbase skill still names tools the model can't call when Coinbase is unconnected.
12. Coinbase "connected" is decided without decrypting the stored keys, so a key pair that no longer decrypts still shows the tools (they answer DISCONNECTED).
13. `browser_agent` caps are tested with a stub, not the real binary. The 64,000-char structured-JSON ceiling isn't measured against real Coinbase reports. `grep` has no per-line limit (it is capped at 24,000 chars in total).
14. The web_fetch readability worker (5 s) can time out on large real pages, so the tool returns an error instead of capped content. This is pre-existing.

**Budgets**
15. The default token budget (100k) counts cached tokens. With caching, the token limit will usually trip before the cost limit, and the economy model saves no tokens. Options: keep it, or make tokens unlimited by default. **decision**
16. The $0.25 default is reached by normal Opus 5.5 / Fable 5.1 tasks, which then degrade or pause (intended).
17. Budgets are enforced only inside the two tool loops. Direct completions, worker lanes and the refinement passes after a loop are counted but not stopped.
18. The projection is conservative (uncached rate), so a cached task may pause a little early.
19. Budget events are not stored as history. `/analytics` shows each task's current budget state; the warning → degraded → exhausted sequence of a task is not kept.
20. `smoke:agent-task-budget`, `smoke:model-tool-scope` and `smoke:tool-output-caps` are standalone, not in `smoke:src-release`. Only `smoke:token-gate` was added to it.

**Models and release**
21. Stored model choices that point at retired models (claude-sonnet-4-20250514, claude-opus-4*, claude-3-*) are never migrated; their requests now fail at Anthropic. **decision**
22. The version (`hud/lib/meta/version/index.ts`) was not bumped. README.md and CLAUDE.md were updated in Stage 5. The user bumps the version when posting the release. **decision**
23. Pre-existing, unrelated: `scripts/smoke/local-db/local-data-smoke.mjs` fails on a worktree-manager import path; `src-delegated-chat-worker-contract-smoke` P31-C4 expects a `fallbackReason` that never existed; `npm run smoke` (core runtime smoke) throws `requires userContextId`.

**Stage 5**
24. Budget events are shown as each task's current state, not as a history (see 19). Storing a history would need a new table.
25. In time zones with a half-hour offset, calls from local 00:00–00:29 land on the previous day in the daily charts. Range totals and "today" are exact.
26. The gate's thresholds are offline estimator values (chars / 3.5). A deliberate prompt or tool change has to re-measure them (the steps are in the script header).
27. The Home panel's side-by-side layout (from a 13rem container) only appears on panels wider than the 1920×1080 bottom row. At 1024 and 1920 the tiles are stacked rows, which was checked to fit.
28. The analytics page and panel were checked against seeded fake ledger rows only; no real runtime wrote those rows during the browser check (the ledger writers are covered by `smoke:token-usage`).
