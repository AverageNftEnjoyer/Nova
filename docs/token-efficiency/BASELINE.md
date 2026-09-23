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
- Determinism: four reruns gave identical numbers. Payload bytes also matched, except chat call 1. The Personality Calibration section embeds `updated=<ISO timestamp>` there; the field is fixed-width, so the counts don't change. That timestamp will also break a cached prefix in Stage 1.

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
