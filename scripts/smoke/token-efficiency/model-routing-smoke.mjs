/**
 * Tiered model routing smoke (token-efficiency Stage 6), module level (src/runtime/modules/model-routing).
 *
 *   MR-1  settings: default mode "trivial", save / read round trip, an invalid mode throws, per-user isolation
 *   MR-2  exhaustive matrix (every provider x every priced picker model x every tier x every mode): the provider never
 *         changes, hard is never routed, mode off never routes, "trivial" routes only trivial, the model is always the
 *         selected one or that provider's economy model
 *   MR-3  the call-site table: every site's fixed tier; an empty-reply recovery inside a hard turn is hard
 *   MR-4  turn classification rules (agent task, lanes, request shape, tool loop with / without a lane)
 *   MR-5  cache-aware guard: a call is routed only when it is estimated cheaper, including the selected model's warm
 *         cache (Claude correction pass stays on Sonnet with a small uncached tail, routes with a larger one)
 *   MR-6  explicit model, missing / invalid / not-cheaper economy model and unpriced models are never routed
 *   MR-7  runWithRouteFallback: a refused economy model is retried once on the selected model; other errors and
 *         unrouted calls pass through
 *
 * Offline: temp NOVA_DATA_DIR, no network, no API keys.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

import {
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  OPENAI_MODEL_PRICING_USD_PER_1M,
} from "../../../src/providers/pricing/index.js";
import {
  DEFAULT_ECONOMY_MODELS,
  writeAgentTaskBudgetSettings,
} from "../../../src/runtime/modules/agent-tasks/budget-settings/index.js";
import {
  DEFAULT_MODEL_ROUTING_MODE,
  MODEL_CALL_SITES,
  MODEL_ROUTING_MODES,
  MODEL_TIERS,
  classifyTurnTier,
  estimateCallCostUsd,
  isModelUnavailableError,
  readModelRoutingSettings,
  resolveCallSiteTier,
  resolveModelRoute,
  runWithRouteFallback,
  writeModelRoutingSettings,
} from "../../../src/runtime/modules/model-routing/index.js";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

const PROVIDER_MODELS = {
  openai: Object.keys(OPENAI_MODEL_PRICING_USD_PER_1M),
  claude: Object.keys(CLAUDE_MODEL_PRICING_USD_PER_1M),
  gemini: Object.keys(GEMINI_MODEL_PRICING_USD_PER_1M),
  grok: Object.keys(GROK_MODEL_PRICING_USD_PER_1M),
};

await check("MR-1 settings: default trivial, round trip, invalid mode throws, per user", () => {
  assert.equal(DEFAULT_MODEL_ROUTING_MODE, "trivial");
  assert.deepEqual(readModelRoutingSettings("mr-user-a"), { mode: "trivial", updatedAt: null });
  const saved = writeModelRoutingSettings("mr-user-a", { mode: "cost-saving" });
  assert.equal(saved.mode, "cost-saving");
  assert.ok(saved.updatedAt);
  assert.equal(readModelRoutingSettings("MR-USER-A").mode, "cost-saving");
  assert.equal(readModelRoutingSettings("mr-user-b").mode, "trivial");
  assert.throws(() => writeModelRoutingSettings("mr-user-a", { mode: "cheap" }), /Routing mode must be one of/);
  assert.equal(readModelRoutingSettings("mr-user-a").mode, "cost-saving", "a rejected write changes nothing");
  assert.throws(() => writeModelRoutingSettings("", { mode: "off" }), /user id/);
  assert.equal(readModelRoutingSettings("").mode, "trivial");
});

await check("MR-2 matrix: provider unchanged, hard never routed, off never routes, model is selected or economy", () => {
  let routedCount = 0;
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    for (const model of models) {
      for (const tier of MODEL_TIERS) {
        for (const mode of MODEL_ROUTING_MODES) {
          const route = resolveModelRoute({ userContextId: "mr-matrix", provider, model, callSite: "chat.turn", tier, settings: { mode } });
          const label = `${provider}/${model}/${tier}/${mode}`;
          assert.equal(route.provider, provider, `${label}: provider changed`);
          assert.equal(route.selectedModel, model, label);
          assert.ok([model, DEFAULT_ECONOMY_MODELS[provider]].includes(route.model), `${label}: sent ${route.model}`);
          if (tier === "hard") assert.equal(route.model, model, `${label}: hard was downgraded`);
          if (mode === "off") assert.equal(route.model, model, `${label}: routed with routing off`);
          if (mode === "trivial" && tier !== "trivial") assert.equal(route.model, model, `${label}: trivial mode routed ${tier}`);
          if (route.routed) {
            routedCount += 1;
            assert.notEqual(route.model, model);
          }
        }
      }
    }
  }
  assert.ok(routedCount > 0, "something must be routed");
});

await check("MR-3 call-site table: fixed tiers; empty-reply recovery is hard inside a hard turn", () => {
  const expected = {
    "chat.turn": "standard",
    "chat.output-correction": "trivial",
    "chat.empty-reply-recovery": "trivial",
    "spotify.intent-parse": "trivial",
    "mission.ai-classify": "trivial",
    "mission.ai-extract": "trivial",
    "mission.ai-summarize": "standard",
    "mission.ai-generate": "standard",
    "mission.ai-chat": "standard",
    "mission.build-from-prompt": "hard",
    "utility.nova-suggest": "trivial",
    "utility.gmail-summary": "trivial",
  };
  assert.deepEqual(Object.keys(MODEL_CALL_SITES).sort(), Object.keys(expected).sort());
  for (const [site, tier] of Object.entries(expected)) assert.equal(resolveCallSiteTier(site), tier, site);
  assert.equal(resolveCallSiteTier("chat.turn", { turnTier: "hard" }), "hard");
  assert.equal(resolveCallSiteTier("chat.empty-reply-recovery", { turnTier: "hard" }), "hard");
  assert.equal(resolveCallSiteTier("chat.empty-reply-recovery", { turnTier: "standard" }), "trivial");
  assert.equal(resolveCallSiteTier("chat.output-correction", { turnTier: "hard" }), "trivial");
  assert.equal(resolveCallSiteTier("unknown.site"), null);
  const unknown = resolveModelRoute({ provider: "openai", model: "gpt-5.6-terra", callSite: "unknown.site", settings: { mode: "cost-saving" } });
  assert.equal(unknown.routed, false);
  assert.equal(unknown.reason, "unknown-call-site");
  const build = resolveModelRoute({ provider: "openai", model: "gpt-5.6-terra", callSite: "mission.build-from-prompt", settings: { mode: "cost-saving" } });
  assert.equal(build.reason, "hard-never-routed");
});

await check("MR-4 turn classification rules", () => {
  const cases = [
    [{ source: "agent-task", text: "hi" }, "hard", "agent-task"],
    [{ source: "hud", toolLoop: true, operatorWorker: { agentId: "market", reasoningMode: "probability-market-analysis" }, text: "odds?" }, "hard", "lane-analysis"],
    [{ source: "hud", text: "Walk me step by step through this." }, "hard", "multi-step-reasoning"],
    [{ source: "hud", text: "```js\nconst a = 1\n```" }, "hard", "multi-step-reasoning"],
    [{ source: "hud", text: "x".repeat(1500) }, "hard", "multi-step-reasoning"],
    [{ source: "hud", toolLoop: true, text: "what's new?" }, "hard", "ambiguous-tool-routing"],
    [{ source: "hud", toolLoop: true, operatorWorker: { agentId: "web-research", reasoningMode: "evidence-synthesis" }, text: "latest news" }, "standard", "tool-result-synthesis"],
    [{ source: "hud", toolLoop: true, operatorLane: { id: "gmail" }, text: "inbox" }, "standard", "tool-result-synthesis"],
    [{ source: "hud", text: "Good morning!" }, "standard", "chat"],
    [{ source: "hud", text: "I'm planning a small dinner party." }, "standard", "chat"],
  ];
  for (const [input, tier, reason] of cases) {
    assert.deepEqual(classifyTurnTier(input), { tier, reason }, JSON.stringify(input).slice(0, 80));
  }
});

await check("MR-5 cache-aware guard: routed only when estimated cheaper, warm cache included", () => {
  const base = { userContextId: "mr-guard", provider: "claude", model: "claude-sonnet-5", callSite: "chat.output-correction", settings: { mode: "trivial" } };
  // Sonnet 5: 3,100 warm tokens at $0.20 + 800 at $2 + 300 out at $10 = $0.00522; Haiku cold: 3,900 x $1 + 300 x $5 = $0.0054.
  const stay = resolveModelRoute({ ...base, estimate: { inputTokens: 3900, mainWarmPrefixTokens: 3100, writePrefixTokens: 3100 } });
  assert.equal(stay.routed, false);
  assert.equal(stay.reason, "cache-makes-selected-cheaper");
  assert.equal(stay.estimatedCostUsd.selected, 0.00522);
  assert.equal(stay.estimatedCostUsd.economy, 0.0054);
  const go = resolveModelRoute({ ...base, estimate: { inputTokens: 4600, mainWarmPrefixTokens: 3100, writePrefixTokens: 3100 } });
  assert.equal(go.routed, true);
  assert.equal(go.model, "claude-haiku-4-5-20251001");
  // Without a warm cache the guard only sees list prices: Haiku is cheaper.
  assert.equal(resolveModelRoute({ ...base, estimate: { inputTokens: 3900 } }).routed, true);
  // OpenAI: gpt-5.6-luna uncached ($0.20) costs the same as gpt-5.6-terra cached ($0.20) and output is 10x cheaper.
  const openai = resolveModelRoute({ userContextId: "mr-guard", provider: "openai", model: "gpt-5.6-terra", callSite: "chat.empty-reply-recovery", turnTier: "standard", settings: { mode: "trivial" }, estimate: { inputTokens: 5000, mainWarmPrefixTokens: 5000 } });
  assert.equal(openai.routed, true);
  assert.equal(openai.model, "gpt-5.6-luna");
  // Cache minimums: a 3,100-token prefix is below Haiku's 4,096 minimum, above Sonnet's 1,024.
  assert.equal(
    estimateCallCostUsd({ provider: "claude", model: "claude-haiku-4-5-20251001", inputTokens: 3100, outputTokens: 0, warmPrefixTokens: 3100 }),
    0.0031,
  );
  assert.equal(
    estimateCallCostUsd({ provider: "claude", model: "claude-sonnet-5", inputTokens: 3100, outputTokens: 0, warmPrefixTokens: 3100 }),
    0.00062,
  );
});

await check("MR-6 explicit model, bad / not-cheaper economy model and unpriced models are never routed", () => {
  const common = { userContextId: "mr-econ", callSite: "mission.ai-classify", settings: { mode: "cost-saving" } };
  assert.equal(resolveModelRoute({ ...common, provider: "openai", model: "gpt-5.6-terra", explicitModel: true }).reason, "explicit-model");
  assert.equal(resolveModelRoute({ ...common, provider: "openai", model: "gpt-5.6-luna" }).reason, "already-economy");
  assert.equal(resolveModelRoute({ ...common, provider: "openai", model: "gpt-6-luna" }).reason, "economy-not-cheaper");
  assert.equal(resolveModelRoute({ ...common, provider: "openai", model: "my-custom-model" }).reason, "unpriced");
  assert.equal(resolveModelRoute({ ...common, provider: "openai", model: "gpt-5.6-terra", economyModel: "claude-haiku-4-5-20251001" }).reason, "no-economy-model");
  // The economy model is the Stage 4 setting (one source of truth): changing it there changes routing.
  writeAgentTaskBudgetSettings("mr-econ", { economyModels: { openai: "gpt-6-luna" } });
  const route = resolveModelRoute({ ...common, provider: "openai", model: "gpt-5.6-terra" });
  assert.equal(route.model, "gpt-6-luna");
  assert.equal(route.provider, "openai");
});

await check("MR-7 runWithRouteFallback retries a refused economy model once on the selected model", async () => {
  const route = resolveModelRoute({ userContextId: "mr-fallback", provider: "openai", model: "gpt-5.6-terra", callSite: "spotify.intent-parse", settings: { mode: "trivial" } });
  assert.equal(route.routed, true);
  const seen = [];
  const refused = Object.assign(new Error("The model `gpt-5.6-luna` does not exist or you do not have access to it."), { status: 404 });
  const outcome = await runWithRouteFallback(route, async (model) => {
    seen.push(model);
    if (model === "gpt-5.6-luna") throw refused;
    return "ok";
  });
  assert.deepEqual(seen, ["gpt-5.6-luna", "gpt-5.6-terra"]);
  assert.deepEqual(outcome, { result: "ok", model: "gpt-5.6-terra" });
  await assert.rejects(runWithRouteFallback(route, async () => { throw new Error("rate limited"); }), /rate limited/);
  const unrouted = resolveModelRoute({ provider: "openai", model: "gpt-5.6-terra", callSite: "spotify.intent-parse", settings: { mode: "off" } });
  const calls = [];
  await assert.rejects(runWithRouteFallback(unrouted, async (model) => { calls.push(model); throw refused; }));
  assert.deepEqual(calls, ["gpt-5.6-terra"], "an unrouted call is never retried");
  assert.equal(isModelUnavailableError({ status: 404 }), true);
  assert.equal(isModelUnavailableError(new Error("model_not_found: unknown model")), true);
  assert.equal(isModelUnavailableError(new Error("Request timed out")), false);
});

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? ` :: ${r.detail}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nmodel-routing: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
