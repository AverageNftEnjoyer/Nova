/**
 * Token regression gate (token-efficiency Stage 5, PLAN.md step 3).
 *
 * Runs the offline token harness (token-baseline-harness.mjs: real runtime, fake models, no network, no API keys)
 * and checks every scenario x provider shape against the THRESHOLDS table below. A change that breaks prompt caching
 * (per-turn text in the static prefix) or bloats the prompt / tool schemas fails CI without spending API money.
 *
 * Metrics per scenario/shape (~tok = ceil(chars / 3.5), the harness's estimator; "call" = one model request):
 *   calls             ceiling  number of model requests in the scenario
 *   maxTotalTokens    ceiling  largest per-call input INCLUDING tool schemas (inputTokens + toolsTokens)
 *   maxInputTokens    ceiling  largest per-call input without tool schemas (system + messages)
 *   maxToolsTokens    ceiling  largest per-call tool-schema size (0 = the scenario must not send tools)
 *   sumToolsTokens    ceiling  tool-schema tokens summed over the scenario
 *   minStablePrefix   FLOOR    smallest stable prefix over calls 2..n (leading chars identical to the previous call)
 *   maxUncached       ceiling  largest (totalTokens - stablePrefixTokens) over calls 2..n: the "uncached input
 *                              tokens per call" of PLAN.md Stage 5
 * Single-call scenarios (mission-run) have no calls 2..n, so they get no prefix/uncached rows.
 *
 * Thresholds: measured 2026-09-24 on the Stage 1-4 tree (Node 24.13, models gpt-5.6-terra / claude-sonnet-5), re-measured
 * the same day after the dropped-context fix (per-turn sections now reach the prompt, the static prompt names the
 * user's unconnected integrations) and the context-sections scenario was added. context-sections mixes a direct turn
 * with tool-loop turns, so like mission-run it has no prefix/uncached rows (its prefix between a no-tools call and a
 * tools call is 1 by construction); the harness checks cover its sections instead.
 * Ceilings = measured x 1.1 rounded UP to the next 50 (calls: x 1.1 rounded up); floors = measured x 0.9 rounded
 * DOWN to the next 50. Each entry is [measured, threshold]. When a change legitimately moves a number, re-measure
 * (`node scripts/smoke/token-efficiency/token-baseline-harness.mjs --out tb.json --quiet`, then
 * `node scripts/smoke/token-efficiency/token-regression-gate.mjs --report tb.json`), update both values and the date,
 * and say why in the version history entry (hud/lib/meta/version). A scenario in the report without thresholds fails too.
 *
 * Usage:
 *   node scripts/smoke/token-efficiency/token-regression-gate.mjs              run the harness, gate it
 *   ... --report <file.json>                    gate an existing harness report (no harness run)
 *   ... --mutation break-prefix|bloat-prompt    run the harness with a deliberate regression (expected to FAIL)
 *   ... --self-test                             gate the clean run, then prove the gate fails on both mutations
 * Needs `npm run build:agent-core` (the harness uses dist/ tool modules); `npm run smoke:token-gate` does that first.
 * The mutations come from token-gate-break-prefix-hook.mjs, an in-memory module-loader hook; no file is changed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const HARNESS = path.join(here, "token-baseline-harness.mjs");
const HOOK = path.join(here, "token-gate-break-prefix-hook.mjs");
const MUTATION_MARKER = "[token-gate-hook] mutation applied:";
const MUTATIONS = ["break-prefix", "bloat-prompt"];

// [measured 2026-09-24 (re-measured after the dropped-context fix), threshold]
export const THRESHOLDS = {
  "chat-10-turn/openai": { calls: [10, 11], maxTotalTokens: [4788, 5300], maxInputTokens: [4788, 5300], maxToolsTokens: [0, 0], sumToolsTokens: [0, 0], minStablePrefix: [3227, 2900], maxUncached: [1222, 1350] },
  "chat-10-turn/claude": { calls: [10, 11], maxTotalTokens: [4805, 5300], maxInputTokens: [4805, 5300], maxToolsTokens: [0, 0], sumToolsTokens: [0, 0], minStablePrefix: [3244, 2900], maxUncached: [1223, 1350] },
  "web-research/openai": { calls: [3, 4], maxTotalTokens: [6415, 7100], maxInputTokens: [5227, 5750], maxToolsTokens: [1188, 1350], sumToolsTokens: [3564, 3950], minStablePrefix: [5162, 4600], maxUncached: [868, 1000] },
  "web-research/claude": { calls: [3, 4], maxTotalTokens: [6241, 6900], maxInputTokens: [5144, 5700], maxToolsTokens: [1097, 1250], sumToolsTokens: [3291, 3650], minStablePrefix: [5088, 4550], maxUncached: [793, 900] },
  "agent-task/openai": { calls: [6, 7], maxTotalTokens: [5902, 6500], maxInputTokens: [4714, 5200], maxToolsTokens: [1188, 1350], sumToolsTokens: [7128, 7850], minStablePrefix: [5030, 4500], maxUncached: [384, 450] },
  "agent-task/claude": { calls: [6, 7], maxTotalTokens: [5830, 6450], maxInputTokens: [4733, 5250], maxToolsTokens: [1097, 1250], sumToolsTokens: [6582, 7250], minStablePrefix: [4956, 4450], maxUncached: [372, 450] },
  "agent-task-large-output/openai": { calls: [5, 6], maxTotalTokens: [17890, 19700], maxInputTokens: [16702, 18400], maxToolsTokens: [1188, 1350], sumToolsTokens: [5940, 6550], minStablePrefix: [5156, 4600], maxUncached: [6768, 7450] },
  "agent-task-large-output/claude": { calls: [5, 6], maxTotalTokens: [17841, 19650], maxInputTokens: [16744, 18450], maxToolsTokens: [1097, 1250], sumToolsTokens: [5485, 6050], minStablePrefix: [5082, 4550], maxUncached: [6782, 7500] },
  "gmail-triage/openai": { calls: [4, 5], maxTotalTokens: [8397, 9250], maxInputTokens: [6516, 7200], maxToolsTokens: [1881, 2100], sumToolsTokens: [7524, 8300], minStablePrefix: [6105, 5450], maxUncached: [951, 1050] },
  "gmail-triage/claude": { calls: [4, 5], maxTotalTokens: [8269, 9100], maxInputTokens: [6554, 7250], maxToolsTokens: [1715, 1900], sumToolsTokens: [6860, 7550], minStablePrefix: [5956, 5350], maxUncached: [965, 1100] },
  "mission-run/openai": { calls: [1, 2], maxTotalTokens: [550, 650], maxInputTokens: [550, 650], maxToolsTokens: [0, 0], sumToolsTokens: [0, 0] },
  "mission-run/claude": { calls: [1, 2], maxTotalTokens: [542, 600], maxInputTokens: [542, 600], maxToolsTokens: [0, 0], sumToolsTokens: [0, 0] },
  "context-sections/openai": { calls: [3, 4], maxTotalTokens: [5695, 6300], maxInputTokens: [4507, 5000], maxToolsTokens: [1188, 1350], sumToolsTokens: [2376, 2650] },
  "context-sections/claude": { calls: [3, 4], maxTotalTokens: [5621, 6200], maxInputTokens: [4524, 5000], maxToolsTokens: [1097, 1250], sumToolsTokens: [2194, 2450] },
};

const FLOORS = new Set(["minStablePrefix"]);

// ── Metrics + evaluation ─────────────────────────────────────────────────────────────────────────────────────

/** Gate metrics of one harness scenario entry (null for a metric that cannot be computed). */
export function scenarioMetrics(entry) {
  const calls = Array.isArray(entry?.calls) ? entry.calls : [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const max = (values) => (values.length ? Math.max(...values) : null);
  const later = calls.slice(1);
  return {
    calls: calls.length,
    maxTotalTokens: max(calls.map((c) => num(c.totalTokens))),
    maxInputTokens: max(calls.map((c) => num(c.inputTokens))),
    maxToolsTokens: max(calls.map((c) => num(c.toolsTokens))),
    sumToolsTokens: calls.reduce((t, c) => t + num(c.toolsTokens), 0),
    minStablePrefix: later.length ? Math.min(...later.map((c) => num(c.stablePrefixTokens))) : null,
    maxUncached: later.length ? Math.max(...later.map((c) => num(c.totalTokens) - num(c.stablePrefixTokens))) : null,
  };
}

/** Rows { key, metric, measured, op, threshold, pass } for a harness report against `thresholds`. */
export function evaluateReport(report, thresholds = THRESHOLDS) {
  const rows = [];
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const byKey = new Map(scenarios.map((s) => [`${s.scenario}/${s.shape}`, s]));
  for (const [key, limits] of Object.entries(thresholds)) {
    const entry = byKey.get(key);
    if (!entry) {
      rows.push({ key, metric: "present in report", measured: "missing", op: "", threshold: "", pass: false });
      continue;
    }
    if (entry.error) {
      rows.push({ key, metric: "ran without error", measured: String(entry.error).slice(0, 60), op: "", threshold: "", pass: false });
    }
    const measured = scenarioMetrics(entry);
    for (const [metric, [, threshold]] of Object.entries(limits)) {
      const value = measured[metric];
      const floor = FLOORS.has(metric);
      const pass = value !== null && (floor ? value >= threshold : value <= threshold);
      rows.push({ key, metric, measured: value === null ? "n/a" : value, op: floor ? ">=" : "<=", threshold, pass });
    }
  }
  for (const key of byKey.keys()) {
    if (!thresholds[key]) rows.push({ key, metric: "has thresholds", measured: "none", op: "", threshold: "", pass: false });
  }
  return rows;
}

function formatRows(rows) {
  const header = ["scenario/shape", "metric", "measured", "threshold", "result"];
  const cells = rows.map((r) => [r.key, r.metric, String(r.measured), `${r.op} ${r.threshold}`.trim(), r.pass ? "PASS" : "FAIL"]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === 2 || i === 3 ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...cells.map(line)].join("\n");
}

// ── Harness runner ───────────────────────────────────────────────────────────────────────────────────────────

/** Run the harness in a child process (optionally with a mutation hook); resolves { exitCode, report, output }. */
function runHarness(mutation = "") {
  const outFile = path.join(os.tmpdir(), `nova-token-gate-${process.pid}-${mutation || "clean"}-${Date.now()}.json`);
  const env = { ...process.env };
  // Each harness run picks its own fresh temp data dir (isolated-data-dir.mjs); never share one between runs.
  delete env.NOVA_DATA_DIR;
  delete env.NOVA_TOKEN_GATE_MUTATION;
  const nodeArgs = [];
  if (mutation) {
    env.NOVA_TOKEN_GATE_MUTATION = mutation;
    nodeArgs.push("--import", pathToFileURL(HOOK).href);
  }
  nodeArgs.push(HARNESS, "--out", outFile, "--quiet");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("close", (code) => {
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(outFile, "utf8"));
      } catch {
        report = null;
      }
      try { fs.rmSync(outFile, { force: true }); } catch { /* best effort */ }
      resolve({ exitCode: code ?? 1, report, output });
    });
  });
}

function tail(text, lines = 25) {
  return String(text || "").trimEnd().split(/\r?\n/).slice(-lines).map((l) => `    ${l}`).join("\n");
}

/** Gate one harness run: prints the table, returns the list of failure strings (empty = pass). */
function gateRun(label, run, { printTable = true } = {}) {
  const failures = [];
  if (run.exitCode !== 0) failures.push(`harness exited with code ${run.exitCode}`);
  if (!run.report) failures.push("harness wrote no JSON report");
  const rows = run.report ? evaluateReport(run.report) : [];
  const failedRows = rows.filter((r) => !r.pass);
  for (const r of failedRows) failures.push(`${r.key} ${r.metric}: ${r.measured}${r.op ? ` (${r.op} ${r.threshold})` : ""}`);
  console.log(`\n== ${label}`);
  if (printTable && rows.length) console.log(formatRows(rows));
  else if (failedRows.length) console.log(formatRows(failedRows));
  if (run.exitCode !== 0 && run.output) console.log(`  harness output (tail):\n${tail(run.output)}`);
  console.log(`  ${rows.length - failedRows.length}/${rows.length} threshold checks passed${failures.length ? `, gate FAILED (${failures.length} failure${failures.length === 1 ? "" : "s"})` : ", gate PASSED"}`);
  return { failures, failedRows };
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  if (args.report) {
    const report = JSON.parse(fs.readFileSync(path.resolve(args.report), "utf8"));
    const { failures } = gateRun(`token gate: ${args.report}`, { exitCode: 0, report, output: "" });
    return failures.length ? 1 : 0;
  }

  if (args.mutation) {
    if (!MUTATIONS.includes(args.mutation)) throw new Error(`unknown --mutation ${args.mutation} (${MUTATIONS.join(", ")})`);
    const run = await runHarness(args.mutation);
    const { failures } = gateRun(`token gate: harness with deliberate regression "${args.mutation}"`, run);
    console.log(`\ntoken-gate: ${failures.length ? "FAIL" : "PASS"} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return failures.length ? 1 : 0;
  }

  const selfTest = args["self-test"] === "1";
  // The three harness runs are independent (each has its own temp data dir), so run them side by side.
  const [clean, ...mutated] = await Promise.all([runHarness(""), ...(selfTest ? MUTATIONS.map((m) => runHarness(m)) : [])]);
  const { failures } = gateRun("token gate: clean harness run", clean);
  const selfTestFailures = [];

  if (selfTest) {
    console.log("\n== self-test: the gate must FAIL on deliberate regressions (in-memory hook, no file changed)");
    const expectations = {
      // Per-turn text in the static prefix: caching breaks, so the prefix floor must trip on the chat scenario.
      "break-prefix": (rows) => ["chat-10-turn/openai", "chat-10-turn/claude"].every((key) => rows.some((r) => r.key === key && r.metric === "minStablePrefix")),
      // A bigger static prompt: a size ceiling must trip on a tool-loop scenario.
      "bloat-prompt": (rows) => rows.some((r) => r.key.startsWith("agent-task/") && (r.metric === "maxTotalTokens" || r.metric === "maxInputTokens")),
    };
    MUTATIONS.forEach((mutation, i) => {
      const run = mutated[i];
      if (!run.output.includes(`${MUTATION_MARKER} ${mutation}`)) {
        selfTestFailures.push(`${mutation}: the hook never rewrote the system-prompt module (loader hook did not apply)`);
      }
      const { failures: mutatedFailures, failedRows } = gateRun(`self-test: harness with "${mutation}" (expected to FAIL)`, run, { printTable: false });
      if (mutatedFailures.length === 0) selfTestFailures.push(`${mutation}: the gate PASSED a deliberately broken run`);
      else if (!expectations[mutation](failedRows)) selfTestFailures.push(`${mutation}: the gate failed, but not on the expected metric`);
      else console.log(`  [PASS] self-test ${mutation}: gate failed as expected`);
    });
    const missing = evaluateReport({ scenarios: (clean.report?.scenarios || []).filter((s) => s.scenario !== "gmail-triage") });
    if (missing.some((r) => r.key === "gmail-triage/openai" && r.metric === "present in report" && !r.pass)) {
      console.log("  [PASS] self-test missing-scenario: a report without gmail-triage fails the gate");
    } else selfTestFailures.push("missing-scenario: a report without gmail-triage did not fail the gate");
    for (const f of selfTestFailures) console.log(`  [FAIL] self-test ${f}`);
  }

  const allFailures = [...failures, ...selfTestFailures];
  if (failures.length) console.log(`\ngate failures:\n  ${failures.join("\n  ")}`);
  console.log(`\ntoken-gate: ${allFailures.length ? "FAIL" : "PASS"}${selfTest ? " (with self-test)" : ""} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return allFailures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`token-gate: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  },
);
