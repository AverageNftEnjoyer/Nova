/**
 * Tiered model routing (token-efficiency Stage 6): offline cost ESTIMATE per harness scenario, per routing mode,
 * plus the invariants the routing must keep on the real request payloads.
 *
 * Runs the offline harness (token-baseline-harness.mjs, fake model, no network) once per routing mode
 * (off / trivial / cost-saving) with --include-requests, then prices every captured call at the model it was
 * actually sent to (src/providers/pricing). All dollar figures are ESTIMATES from list prices:
 *   - 300 output tokens per call (the fake model reports none);
 *   - caches are per model: a call's cached input comes only from the PREVIOUS CALL ON THE SAME MODEL in that
 *     scenario, and only above that model's cache minimum (resolveCacheMinPrefixTokens). A call routed to another
 *     model can't use the selected model's cache: that is the cache impact of routing, priced in here;
 *   - OpenAI-compatible: the leading part identical to that previous call is cached (automatic caching);
 *   - Claude: only up to a cache breakpoint (the static block, or the latest message in the tool loop), and each
 *     call writes up to its own last breakpoint at the cache-write rate (see priceCall).
 * Serialization and ~tokens (ceil(chars / 3.5)) are the harness's own.
 *
 * Checks:
 *   RC-1  mode off: every request uses the scenario's selected model.
 *   RC-2  mode off: requests are byte-identical (ISO timestamps masked, see ISO_TIMESTAMP) to mode trivial (the
 *         harness has no trivial call site) and, when --baseline <harness json with --include-requests> is given,
 *         to that snapshot.
 *   RC-3  hard scenarios (agent tasks) send byte-identical requests in all three modes (hard is never downgraded).
 *   RC-4  every request in every mode uses the selected model or that provider's economy model (never another
 *         provider's model).
 *   RC-5  no mode costs more than mode off in any scenario (estimate; 0.1% tolerance for run-to-run noise).
 *
 * Usage: node scripts/smoke/token-efficiency/model-routing-cost.mjs [--baseline <file>] [--out <file.json>]
 * Needs `npm run build:agent-core` (the harness imports dist/ tool modules); `npm run smoke:model-routing-cost` does it.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { DEFAULT_ECONOMY_MODELS } from "../../../src/runtime/modules/agent-tasks/budget-settings/index.js";
import { resolveModelPricing } from "../../../src/providers/pricing/index.js";
import { resolveCacheMinPrefixTokens } from "../../../src/runtime/modules/model-routing/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const harness = path.join(repoRoot, "scripts/smoke/token-efficiency/token-baseline-harness.mjs");
const MODES = ["off", "trivial", "cost-saving"];
const HARD_SCENARIOS = new Set(["agent-task", "agent-task-large-output", "gmail-triage"]);
const OUTPUT_TOKENS = 300;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || String(next).startsWith("--")) out[token.slice(2)] = "1";
    else {
      out[token.slice(2)] = String(next);
      i += 1;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

function runHarness(mode) {
  const out = path.join(isolatedDataDir, `harness-${mode}.json`);
  // Each run gets its own data dir (a subfolder of this script's temp dir), so modes never share state.
  const dataDir = path.join(isolatedDataDir, `data-${mode}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const result = spawnSync(process.execPath, [harness, "--routing-mode", mode, "--include-requests", "--quiet", "--out", out], {
    cwd: repoRoot,
    env: { ...process.env, NOVA_DATA_DIR: dataDir },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`harness (mode ${mode}) exited ${result.status}:\n${String(result.stdout || "").slice(-3000)}\n${String(result.stderr || "").slice(-2000)}`);
  }
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const approxTokens = (chars) => Math.ceil(chars / 3.5);

function serialize(shape, request) {
  const tools = JSON.stringify(request?.tools ?? []);
  if (shape === "claude") return `${tools}\n${JSON.stringify(request?.system ?? "")}\n${JSON.stringify(request?.messages ?? [])}`;
  return `${tools}\n${JSON.stringify(request?.messages ?? [])}`;
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Chars of the Claude static cached part: tools + the system block that carries cache_control. */
function claudeStaticChars(request) {
  const system = request?.system;
  if (!Array.isArray(system)) return 0;
  const cached = system.find((block) => block && block.cache_control);
  return cached ? JSON.stringify(request?.tools ?? []).length + JSON.stringify(cached.text ?? "").length : 0;
}

/** True when the request's latest message carries a cache breakpoint (Claude tool loop, calls 2+). */
function claudeLatestMessageBreakpoint(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const last = messages[messages.length - 1];
  return Array.isArray(last?.content) && last.content.some((block) => block && block.cache_control);
}

/**
 * Estimated USD of one call from the pricing tables.
 * OpenAI-compatible providers cache any identical leading part automatically (above the model's minimum).
 * Claude caches only up to a cache breakpoint: the previous request's static block (tools + static system), or
 * its whole length when its latest message carried a breakpoint (tool loop); this request writes up to its own
 * last breakpoint at the cache-write rate.
 */
function priceCall(shape, model, { inputTokens, prefixTokens, previous, request }) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const min = resolveCacheMinPrefixTokens(shape, model);
  const cachedRate = pricing.cachedInput ?? pricing.input;
  const writeRate = pricing.cacheWrite ?? pricing.input;
  let cached = 0;
  let written = 0;
  if (shape === "claude") {
    const cacheable = previous
      ? (claudeLatestMessageBreakpoint(previous.request) ? previous.tokens : approxTokens(claudeStaticChars(previous.request)))
      : 0;
    const hit = Math.min(prefixTokens, cacheable);
    cached = hit >= min ? hit : 0;
    const breakpointEnd = claudeLatestMessageBreakpoint(request) ? inputTokens : approxTokens(claudeStaticChars(request));
    written = breakpointEnd >= min ? Math.max(0, breakpointEnd - cached) : 0;
  } else {
    cached = prefixTokens >= min ? prefixTokens : 0;
  }
  const uncached = Math.max(0, inputTokens - cached - written);
  return (cached * cachedRate + written * writeRate + uncached * pricing.input + OUTPUT_TOKENS * pricing.output) / 1e6;
}

function priceScenario(scenario) {
  const shape = scenario.shape;
  const previousByModel = new Map();
  let total = 0;
  let unpriced = 0;
  const models = new Map();
  for (const request of scenario.requests || []) {
    const model = String(request?.model || "");
    models.set(model, (models.get(model) || 0) + 1);
    const text = serialize(shape, request);
    const inputTokens = approxTokens(text.length);
    const previous = previousByModel.get(model);
    const prefixTokens = previous ? approxTokens(commonPrefixLength(previous.text, text)) : 0;
    const cost = priceCall(shape, model, { inputTokens, prefixTokens, previous, request });
    if (cost === null) unpriced += 1;
    else total += cost;
    previousByModel.set(model, { text, tokens: inputTokens, request });
  }
  return { costUsd: Number(total.toFixed(6)), unpriced, models: Object.fromEntries(models) };
}

// The only run-to-run difference in the harness payloads is the Identity Intelligence `updated=<ISO time>` stamp (the
// time a trait was learned, i.e. while the scenario ran; the stable-prefix rules in docs/token-efficiency/README.md). ISO
// timestamps are therefore masked before comparing requests ACROSS runs; everything else must match byte for byte.
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const hashes = (scenario) =>
  (scenario.requests || []).map((r) => crypto.createHash("sha256").update(JSON.stringify(r).replace(ISO_TIMESTAMP, "<ts>")).digest("hex"));
const key = (s) => `${s.scenario}/${s.shape}`;

const reports = {};
for (const mode of MODES) reports[mode] = runHarness(mode);
const selectedModels = reports.off.models;

const rows = [];
for (const off of reports.off.scenarios) {
  const row = { scenario: off.scenario, shape: off.shape, calls: (off.requests || []).length, modes: {} };
  for (const mode of MODES) {
    const match = reports[mode].scenarios.find((s) => key(s) === key(off));
    row.modes[mode] = match ? priceScenario(match) : null;
  }
  rows.push(row);
}

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ status: "PASS", name });
  } catch (error) {
    checks.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

check("RC-1 mode off: every request uses the scenario's selected model", () => {
  for (const s of reports.off.scenarios) {
    for (const r of s.requests || []) assert.equal(r.model, selectedModels[s.shape], `${key(s)} sent ${r.model}`);
  }
});

check("RC-2 mode off requests are byte-identical to mode trivial (no trivial call site in the harness)", () => {
  for (const s of reports.off.scenarios) {
    const t = reports.trivial.scenarios.find((x) => key(x) === key(s));
    assert.deepEqual(hashes(t), hashes(s), `${key(s)} differs between off and trivial`);
  }
});

if (args.baseline) {
  check(`RC-2b mode off requests are byte-identical to the pre-routing snapshot (${path.basename(args.baseline)})`, () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(args.baseline), "utf8"));
    for (const s of reports.off.scenarios) {
      const b = baseline.scenarios.find((x) => key(x) === key(s));
      assert.ok(b && Array.isArray(b.requests), `${key(s)} missing from the baseline (run it with --include-requests)`);
      assert.deepEqual(hashes(s), hashes(b), `${key(s)} differs from the baseline`);
    }
  });
}

check("RC-3 hard scenarios (agent tasks) send identical requests in every mode", () => {
  for (const s of reports.off.scenarios.filter((x) => HARD_SCENARIOS.has(x.scenario))) {
    for (const mode of ["trivial", "cost-saving"]) {
      const m = reports[mode].scenarios.find((x) => key(x) === key(s));
      assert.deepEqual(hashes(m), hashes(s), `${key(s)} changed in mode ${mode}`);
    }
  }
});

check("RC-4 every request uses the selected model or the same provider's economy model", () => {
  for (const mode of MODES) {
    for (const s of reports[mode].scenarios) {
      const allowed = new Set([selectedModels[s.shape], DEFAULT_ECONOMY_MODELS[s.shape]]);
      for (const r of s.requests || []) assert.ok(allowed.has(r.model), `${mode} ${key(s)} sent ${r.model}`);
    }
  }
});

check("RC-5 no routing mode costs more than mode off in any scenario (estimate)", () => {
  for (const row of rows) {
    for (const mode of ["trivial", "cost-saving"]) {
      // Tolerance: the masked timestamps above also shift the per-call cached prefix by a few characters between runs.
      const tolerance = Math.max(1e-5, row.modes.off.costUsd * 0.001);
      assert.ok(row.modes[mode].costUsd <= row.modes.off.costUsd + tolerance, `${row.scenario}/${row.shape} ${mode} $${row.modes[mode].costUsd} > off $${row.modes.off.costUsd}`);
    }
  }
});

const fmt = (v) => `$${v.toFixed(4)}`;
console.log("Estimated cost per harness scenario by routing mode (ESTIMATES: list prices, 300 output tokens per call,");
console.log("cached prefix per model; see the header of this file). Selected models:", JSON.stringify(selectedModels));
console.log("| Scenario [shape] | Calls | Off | Trivial (default) | Cost-saving | Models in cost-saving |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) {
  const cs = row.modes["cost-saving"];
  const models = Object.entries(cs.models).map(([m, n]) => `${m} x${n}`).join(", ");
  console.log(`| ${row.scenario} [${row.shape}] | ${row.calls} | ${fmt(row.modes.off.costUsd)} | ${fmt(row.modes.trivial.costUsd)} | ${fmt(cs.costUsd)} | ${models} |`);
}
if (args.out) {
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify({ selectedModels, economyModels: DEFAULT_ECONOMY_MODELS, rows }, null, 2)}\n`, "utf8");
}
console.log("");
for (const c of checks) console.log(`[${c.status}] ${c.name}${c.detail ? ` :: ${c.detail}` : ""}`);
const failed = checks.filter((c) => c.status === "FAIL").length;
console.log(`\nmodel-routing-cost: ${checks.length - failed} checks passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
