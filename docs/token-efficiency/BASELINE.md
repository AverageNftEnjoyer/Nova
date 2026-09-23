# Token-Efficiency Baseline (Stage 0)

Recorded 2026-09-23 against HEAD `dce2799` (V.70) plus the uncommitted Stage 0 changes. Behaviour is the current (pre-Stage 1) behaviour, including the dropped-context bug (PROGRESS.md "Pre-existing issues" #1), so Stage 1 deltas stay clean.

**Live check (PLAN.md Stage 0 step 8) was NOT run.** No spend ceiling has been set yet, so there are no real-billing numbers and no measured cache hits. Every number below is offline and exact for the request payloads Nova builds; token counts use the runtime's own estimator, not a provider tokenizer.

## Method

- Harness: `scripts/smoke/token-efficiency/token-baseline-harness.mjs` (helpers in `token-harness-lib.mjs`).
- It drives the real `handleInput` with a fake client. OpenAI-compatible calls are served through `runtimeSelectionOverride` with a fake `chat.completions.create` (streaming and non-streaming). Claude calls use the runtime's own `fetch` code against a fake host that answers with JSON or a real SSE stream.
- Network guard: `fetch`, `http` and `https` are replaced. Only the two fake hosts answer; any other request fails the run. Temp `NOVA_DATA_DIR`, no API keys.
- Tools: the real tool runtime and executor run. `web_search`, `web_fetch` and `gmail_*` get canned results shaped like the real outputs. `ls`, `read` and `grep` work on a fixture workspace. `coinbase_*` and `browser_agent` throw if called.
- Mission run: the real `hud/lib/missions/workflow/executors/ai-executors.ts` (`executeAiSummarize`) and `completeWithConfiguredLlm` are transpiled and run in a vm, the same technique as `src-mission-agent-runtime-smoke.mjs`. It runs a trigger → web-search → ai-summarize → output mission with canned upstream text.
- Metrics per call:
  - **input**: `JSON(messages)` for OpenAI; `JSON(system) + JSON(messages)` for Claude.
  - **tools**: `JSON(tools)`, reported separately.
  - **~tok**: `countApproxTokens` = ceil(chars / 3.5).
  - **stable prefix**: leading characters identical to the previous call in the same scenario and shape. The serialization is `JSON(tools) \n JSON(messages)` for OpenAI and `JSON(tools) \n JSON(system) \n JSON(messages)` for Claude, which is the order a provider sees as a cacheable prefix.
- Models: `gpt-5.6-terra` and `claude-sonnet-5` (the new defaults). The model name only affects the `## Runtime` line.
- Determinism: four reruns gave identical numbers. Payload bytes also matched, except chat call 1. The Identity Intelligence section (`src/runtime/modules/context/identity/prompt`) embedded `updated=<ISO timestamp>` there (earlier notes wrongly said Personality Calibration); the field is fixed-width, so the counts didn't change. Removed in Stage 1.

## How to rerun

```bash
npm run smoke:token-baseline                      # table to stdout; 18 invariant checks; exit 0 = pass
node scripts/smoke/token-efficiency/token-baseline-harness.mjs --out <file.json>   # keep the JSON results (needs build:agent-core first)
npm run smoke:token-usage                          # usage normalisation, cost math, llm_usage ledger + agent-task token persistence
```

## Results (exact, offline)

Per-scenario summary. "Prefix, calls 2+" is the stable prefix averaged over calls after the first.

| Scenario | Shape | Calls | Sum input ~tok | Sum tools ~tok | Sum total ~tok | Tools share per call | Prefix, calls 2+ (avg / min ~tok) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10-turn chat | OpenAI | 10 | 39,634 | 0 | 39,634 | none | 1,555 / 533 |
| 10-turn chat | Claude | 10 | 39,562 | 0 | 39,562 | none | 1,547 / 525 |
| Web research (search + fetch) | OpenAI | 3 | 11,852 | 8,715 | 20,567 | 46.0 → 38.4 % | 6,502 / 6,309 |
| Web research | Claude | 3 | 11,696 | 8,094 | 19,790 | 44.3 → 37.3 % | 6,276 / 6,095 |
| Agent task (5 tool steps + final) | OpenAI | 6 | 23,621 | 17,430 | 41,051 | 44.6 → 39.3 % | 6,732 / 6,514 |
| Agent task | Claude | 6 | 23,608 | 16,188 | 39,796 | 42.8 → 37.7 % | 6,526 / 6,300 |
| Gmail triage (3 tool steps + final) | OpenAI | 4 | 19,745 | 11,620 | 31,365 | 44.1 → 32.7 % | 7,496 / 6,582 |
| Gmail triage | Claude | 4 | 19,739 | 10,792 | 30,531 | 42.4 → 31.1 % | 7,285 / 6,368 |
| Mission run (ai-summarize) | OpenAI | 1 | 550 | 0 | 550 | none | n/a |
| Mission run | Claude | 1 | 542 | 0 | 542 | none | n/a |

Per call (OpenAI shape; Claude is within ±1–2 %):

| Scenario | Input ~tok per call | Prefix ~tok per call |
| --- | --- | --- |
| 10-turn chat | 3196, 3536, 3781, 3736, 3951, 4191, 4199, 4308, 4309, 4427 | 0, 533, 901, 720, 720, 901, 901, 4199, 806, 4310 |
| Web research | 3405, 3789, 4658 | 0, 6309, 6694 |
| Agent task | 3610, 3678, 3802, 3952, 4097, 4482 | 0, 6514, 6583, 6707, 6856, 7002 |
| Gmail triage | 3678, 4574, 5524, 5969 | 0, 6582, 7478, 8428 |

The system prompt alone is 3,050–3,490 ~tok per call. Tool schemas cost 2,905 ~tok per tool-loop call in OpenAI format and 2,698 in Anthropic format (25 tools, memory tools included).

## What the numbers say

- **Chat turns:** only ~525–900 ~tok repeat from one turn to the next. The first per-turn byte is in the Skills section, as the map predicted. Turns 8 and 10 reach 97 % only because the chosen skills happened to match the previous turn. That's below OpenAI's 1,024-token automatic-caching minimum, so chat prefix caching can't hit today.
- **Tool loops:** inside one loop each request only appends, so 88–99 % of each step (6.3k–8.4k ~tok) repeats the previous call. That is above the OpenAI (1,024) and Gemini 2.5 (2,048) automatic-caching minimums. So OpenAI, xAI and possibly Gemini may **already** give cache hits on tool-loop steps 2+ today. Only the live check can confirm this; it is not a measured fact. Claude caches nothing without `cache_control`.
- **Tool schemas** are 31–46 % of every tool-loop request.
- **Mission prompts are small** (~550 ~tok) because upstream text is capped at 1,600 chars per node.

## Pricing used for cost

All rates are in `src/providers/pricing/index.js` (USD per 1M tokens). Every rate was read from the official pages below on 2026-09-23. Standard tier only; long-context tiers are not applied.

| Provider | Source |
| --- | --- |
| OpenAI | https://developers.openai.com/api/docs/pricing , /api/docs/models , /api/docs/models/all , /api/docs/deprecations |
| Anthropic | https://platform.claude.com/docs/en/about-claude/pricing , /about-claude/models/overview , /about-claude/model-deprecations , /build-with-claude/prompt-caching |
| Google | https://ai.google.dev/gemini-api/docs/pricing , /gemini-api/docs/models , /gemini-api/docs/openai , /gemini-api/docs/caching |
| xAI | https://docs.x.ai/developers/models , /developers/migration/may-15-retirement , /developers/advanced-api-usage/prompt-caching |

Current models (offered in Nova's pickers; default first):

| Model | Input | Cached input | Cache write | Output |
| --- | --- | --- | --- | --- |
| gpt-5.6-terra (default) | 2.00 | 0.20 | n/a | 12.00 |
| gpt-5.6-sol | 4.00 | 0.40 | n/a | 20.00 |
| gpt-5.6-luna | 0.20 | 0.02 | n/a | 1.20 |
| claude-sonnet-5 (default) | 2.00 | 0.20 | 2.50 | 10.00 |
| claude-opus-5-5 | 4.00 | 0.20 | 5.00 | 20.00 |
| claude-fable-5-1 | 10.00 | 0.25 | 12.50 | 50.00 |
| claude-haiku-4-5-20251001 | 1.00 | 0.10 | 1.25 | 5.00 |
| gemini-3.8-flash (default) | 0.75 | 0.075 | n/a | 3.75 |
| gemini-3.1-pro-preview | 2.00 | 0.20 | n/a | 12.00 |
| gemini-3.5-flash-lite | 0.30 | 0.03 | n/a | 2.50 |
| gemini-3.1-flash-lite | 0.25 | 0.025 | n/a | 1.50 |
| grok-4.3 (default) | 1.25 | 0.20 | n/a | 2.50 |
| grok-4.7 | 2.00 | 0.50 | n/a | 6.00 |
| grok-build-0.1 | 1.00 | 0.20 | n/a | 2.00 |

- **Priced but not in pickers:**
  - gpt-6-sol 2 / 0.20 / 10 (plus a 2.50 cache write)
  - gpt-6-astra 10 / 1 / 50
  - gpt-6-luna 0.10 / 0.01 / 0.50
  - These are excluded because OpenAI documents function calling on Chat Completions for GPT-6 Sol/Luna only with `reasoning_effort: "none"`, and not at all for Astra. Nova's tool loop doesn't send that.
- **Legacy (still served; cost only):** see `LEGACY_MODEL_PRICING_USD_PER_1M`, e.g. gpt-4.1-mini 0.40 / 0.10 / 1.60.
- **Price corrections found:** gpt-4o was coded 5/15 and is officially 2.50/10; gpt-4o-mini was coded 0.60/2.40 and is 0.15/0.60; gpt-5.2-pro was coded 12/96 and is 21/168.

**Unverified, so left unpriced or not asserted:**
- claude-3-7-sonnet and claude-3-5-sonnet prices (retired).
- grok-3-mini and grok-code-fast-1 billing after the redirect.
- Gemini long-context tiers and explicit-cache storage charges (not modelled).
- The gemini-3.8-flash price change after 2026-12-31 (not modelled).

## Stage 1 re-measure (2026-09-23, V.72)

Same harness, same scenarios, same models. "Before" is HEAD `36bc6c2` (V.71, which already includes Stage 1 step 1a, Skills moved to the end of the system prompt) run with the Stage 1 harness in a temporary worktree, so both sides use the same metrics. "After" is the V.72 working tree. Offline and exact for the request bytes; token counts use the runtime estimator (chars / 3.5).

**Simulated provider caches.** The fake providers now model each provider's documented caching rules, so the harness can show cache reads without a key (rules in the header of `token-harness-lib.mjs`):
- OpenAI-compatible: automatic prefix caching against any earlier request in the scenario, from 1,024 tokens, in 128-token steps.
- Anthropic: only at `cache_control` breakpoints, with the 20-block lookback, max 4 breakpoints and the 1,024-token minimum for claude-sonnet-5.
These are models of the docs, not real billing. Only the deferred live check can confirm real cache hits.

Input $ per run uses the Stage 0 rates: gpt-5.6-terra $2.00 in / $0.20 cached; claude-sonnet-5 $2.00 in / $0.20 cache read / $2.50 cache write, per 1M tokens. Output tokens are the same before and after, so they are left out.

| Scenario | Shape | Total input ~tok (b→a) | Sim cached (b→a) | Sim cache-write (a) | Uncached (b→a) | Input $ per run (b→a) | Static sys ~tok (b→a) | Calls with identical system (b→a) | Prefix avg/min calls 2+ (b→a) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chat-10-turn | openai | 38,757 → 43,154 | 31,488 → 33,280 | 0 | 7,269 → 9,874 | 0.0208 → 0.0264 | 3,014 → 3,195 | 1/10 → 10/10 | 3423/2960 → 3756/3283 |
| chat-10-turn | claude | 38,685 → 43,420 | 0 → 33,948 | 4,420 | 38,685 → 5,052 | 0.0774 → 0.0279 | 3,015 → 3,196 | 1/10 → 10/10 | 3416/2953 → 3673/3284 |
| web-research | openai | 20,305 → 22,433 | 12,672 → 14,208 | 0 | 7,633 → 8,225 | 0.0178 → 0.0193 | 3,200 → 3,195 | 3/3 → 3/3 | 6414/6222 → 7124/6931 |
| web-research | claude | 19,528 → 21,749 | 0 → 13,805 | 7,853 | 19,528 → 91 | 0.0391 → 0.0226 | 3,201 → 3,196 | 3/3 → 3/3 | 6188/6008 → 6533/5980 |
| agent-task | openai | 40,528 → 42,760 | 32,896 → 34,688 | 0 | 7,632 → 8,072 | 0.0218 → 0.0231 | 3,360 → 3,253 | 6/6 → 6/6 | 6645/6426 → 7017/6799 |
| agent-task | claude | 39,274 → 41,682 | 0 → 34,020 | 7,418 | 39,274 → 244 | 0.0785 → 0.0258 | 3,362 → 3,254 | 6/6 → 6/6 | 6438/6212 → 6707/6038 |
| gmail-triage | openai | 31,014 → 33,853 | 22,016 → 24,192 | 0 | 8,998 → 9,661 | 0.0224 → 0.0242 | 3,452 → 3,253 | 4/4 → 4/4 | 7409/6495 → 8118/7204 |
| gmail-triage | claude | 30,179 → 33,138 | 0 → 23,725 | 9,288 | 30,179 → 125 | 0.0604 → 0.0282 | 3,453 → 3,254 | 4/4 → 4/4 | 7198/6281 → 7595/6038 |
| mission-run | openai | 550 → 550 | 0 → 0 | 0 | 550 → 550 | 0.0011 → 0.0011 | 28 → 28 | 1/1 → 1/1 | 0/0 → 0/0 |
| mission-run | claude | 542 → 542 | 0 → 0 | 0 | 542 → 542 | 0.0011 → 0.0011 | 28 → 28 | 1/1 → 1/1 | 0/0 → 0/0 |

What changed and why:
- **The static system prompt is identical on every call** in every scenario (chat: 1/10 → 10/10). It is ~3,195–3,254 ~tok, above OpenAI's 1,024-token automatic-caching minimum and Anthropic's 1,024-token minimum for claude-sonnet-5. It is below Gemini 3.x's 4,096-token implicit-caching minimum on its own, so Gemini chat only caches once the history pushes the prefix past 4,096. It is also below claude-haiku-4-5's 4,096 minimum; there the history breakpoint does the caching after a few turns.
- **Claude**: cache reads on every call after the first in every scenario (0/19 → 19/19). Uncached input drops 87 % in chat and 99 % in tool loops. Input cost per run drops **42–67 %** (chat 0.0774 → 0.0279 $, web research 0.0391 → 0.0226 $, agent task 0.0785 → 0.0258 $), after paying for the cache writes.
- **OpenAI**: it already cached from the Skills move in step 1a, and still does on every call after the first. Its input cost per run goes **up 6–27 %**, because the `no_system_budget` fix now delivers the per-turn context (identity, preferences, short-term context, memory/web/link context) that was silently dropped before. That is the intended trade (PLAN.md "Found issues" #1): same caching, more of the context that was meant to reach the model.
- **Total input tokens** rise 5–12 % for the same reason (plus ~180 ~tok of new static text: Conversation Continuity is now always in the static prompt, and a short section explains the per-turn block).
- The chat "stable prefix vs the previous call" stays at ~3.3k minimum rather than growing with history, because the previous call's final user turn carried its per-turn block and the history copy of that message does not. Caches still read the history: OpenAI matches against every earlier request, and Anthropic's history breakpoint is written one turn and read the next.
- Mission runs are unchanged (~550 ~tok, below every cache minimum).

## Stage 2 re-measure: tool output caps (2026-09-23, V.72)

"Before" is the Stage 1 commit `1ae8acc` and "after" is the Stage 2 working tree, both run with the Stage 2 harness in the same way as the Stage 1 comparison (before in a temporary worktree). Same rates and the same simulated caches as above.

New scenario **large-read**: an agent task reads `logs/server.log` (3,000 lines, ~95 characters each, ~285 KB) and then greps it for `ERROR`. The older scenarios' fixture files are all under 30 lines, so caps don't touch them. This scenario is the case caps exist for.

| Scenario | Shape | Total input ~tok (b→a) | Sim cached (b→a) | Sim cache-write (a) | Uncached (b→a) | Input $ per run (b→a) | Static sys ~tok (b→a) | Calls with identical system (b→a) | Prefix avg/min calls 2+ (b→a) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chat-10-turn | openai | 43,349 → 43,154 | 33,408 → 33,280 | 0 | 9,941 → 9,874 | 0.0266 → 0.0264 | 3,214 → 3,195 | 10/10 → 10/10 | 3775/3303 → 3756/3283 |
| chat-10-turn | claude | 43,613 → 43,420 | 34,123 → 33,948 | 4,420 | 5,050 → 5,052 | 0.0280 → 0.0279 | 3,215 → 3,196 | 10/10 → 10/10 | 3692/3303 → 3673/3284 |
| web-research | openai | 22,491 → 22,565 | 14,208 → 14,208 | 0 | 8,283 → 8,357 | 0.0194 → 0.0196 | 3,214 → 3,195 | 3/3 → 3/3 | 7143/6951 → 7168/6976 |
| web-research | claude | 21,807 → 22,026 | 13,844 → 13,922 | 8,015 | 91 → 89 | 0.0226 → 0.0230 | 3,215 → 3,196 | 3/3 → 3/3 | 6552/5999 → 6591/6024 |
| agent-task | openai | 42,878 → 43,021 | 34,816 → 34,944 | 0 | 8,062 → 8,077 | 0.0231 → 0.0231 | 3,272 → 3,253 | 6/6 → 6/6 | 7037/6818 → 7061/6843 |
| agent-task | claude | 41,801 → 41,971 | 34,117 → 34,239 | 7,488 | 247 → 244 | 0.0259 → 0.0261 | 3,274 → 3,254 | 6/6 → 6/6 | 6727/6058 → 6751/6083 |
| gmail-triage | openai | 33,930 → 34,029 | 24,192 → 24,320 | 0 | 9,738 → 9,709 | 0.0243 → 0.0243 | 3,272 → 3,253 | 4/4 → 4/4 | 8138/7224 → 8162/7248 |
| gmail-triage | claude | 33,216 → 33,314 | 23,785 → 23,859 | 9,332 | 124 → 123 | 0.0283 → 0.0283 | 3,274 → 3,254 | 4/4 → 4/4 | 7615/6058 → 7639/6083 |
| large-read | openai | 185,635 → 39,902 | 95,488 → 22,656 | 0 | 90,147 → 17,246 | 0.1994 → 0.0390 | 3,272 → 3,253 | 3/3 → 3/3 | 47798/6673 → 11371/6698 |
| large-read | claude | 185,095 → 39,362 | 95,182 → 22,329 | 16,944 | 91 → 89 | 0.2438 → 0.0470 | 3,274 → 3,254 | 3/3 → 3/3 | 47389/6058 → 10963/6083 |
| mission-run | openai | 550 → 550 | 0 → 0 | 0 | 550 → 550 | 0.0011 → 0.0011 | 28 → 28 | 1/1 → 1/1 | 0/0 → 0/0 |
| mission-run | claude | 542 → 542 | 0 → 0 | 0 | 542 → 542 | 0.0011 → 0.0011 | 28 → 28 | 1/1 → 1/1 | 0/0 → 0/0 |

- **large-read**: input drops **~78 %** (185k → 40k ~tok per run). Input cost drops **80 %** on OpenAI ($0.199 → $0.039) and **81 %** on Claude ($0.244 → $0.047). Before, `read` returned the whole file (~81k ~tok), which was then resent on the next step. Now it returns lines 1–337: the 32,000-character budget ends the window before 400 lines of this log. The window ends with `[Output truncated by Nova: showed lines 1-337 of 3,000; 2,663 more lines not shown. To get more, call read with {"path": "logs/server.log", "startLine": 338, "endLine": 737}.]`
- **Other tool scenarios** are +0.1–1.0 % input tokens. Tool schemas grew by 44 ~tok per tool-loop call (OpenAI shape 2,905 → 2,949): the `offset` parameter on `memory_get` / `web_fetch` and a longer `read` description. On Claude, web results are now wrapped as external content, as the OpenAI-compatible loop already did.
- **Chat and missions:** no change; they don't run tools.
- **Measurement artifact:** the ~19 ~tok difference in "Static sys ~tok" between the two columns is the temporary worktree path in the prompt's `## Workspace` line; the code is identical. The Stage 1 table above has the same artifact on its "before" side.
