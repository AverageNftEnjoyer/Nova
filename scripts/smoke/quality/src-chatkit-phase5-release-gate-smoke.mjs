import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadBaseline(filePath) {
  if (fs.existsSync(filePath)) return readJson(filePath);
  return {
    thresholds: {
      minServeReliabilityPct: 95,
      maxP50Ms: 6000,
      maxP95Ms: 14000,
      maxP99Ms: 22000,
      minQualityScore: 90,
    },
  };
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return Number(sorted[index] || 0);
}

function readEventsFromJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function computeMetrics(events) {
  const serveAttempts = events.filter((event) => String(event?.event || "").startsWith("chatkit.serve."));
  const serveSuccess = serveAttempts.filter((event) => String(event?.event || "") === "chatkit.serve.success");
  const serveLatencies = serveSuccess
    .map((event) => Number(event?.latencyMs || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const shadowComparisons = events.filter((event) => String(event?.event || "") === "chatkit.shadow.compare");
  const shadowSuccess = shadowComparisons.filter((event) => event?.details?.shadowOk === true);

  const reliabilityPct = serveAttempts.length > 0 ? (serveSuccess.length / serveAttempts.length) * 100 : 0;
  const shadowAgreementPct = shadowComparisons.length > 0 ? (shadowSuccess.length / shadowComparisons.length) * 100 : 100;
  const qualityScore = Number((reliabilityPct * 0.8 + shadowAgreementPct * 0.2).toFixed(2));

  return {
    counts: {
      totalEvents: events.length,
      serveAttempts: serveAttempts.length,
      serveSuccess: serveSuccess.length,
      shadowComparisons: shadowComparisons.length,
      shadowSuccess: shadowSuccess.length,
    },
    reliabilityPct: Number(reliabilityPct.toFixed(2)),
    latencyMs: {
      p50: percentile(serveLatencies, 50),
      p95: percentile(serveLatencies, 95),
      p99: percentile(serveLatencies, 99),
    },
    qualityScore,
  };
}

function selectDataset() {
  const root = process.cwd();
  const livePath = path.join(root, "archive", "logs", "chatkit-events.jsonl");
  const fixturePath = path.join(root, "scripts", "smoke", "fixtures", "chatkit-phase5-events.jsonl");
  const minLiveSamples = Number.parseInt(process.env.NOVA_CHATKIT_PHASE5_MIN_LIVE_SAMPLES || "8", 10) || 8;
  const lookbackMinutes = Number.parseInt(process.env.NOVA_CHATKIT_PHASE5_LOOKBACK_MINUTES || "30", 10) || 30;
  const userContextPrefix = String(process.env.NOVA_CHATKIT_PHASE5_USER_CONTEXT_PREFIX || "").trim().toLowerCase();
  const lookbackMs = Math.max(1, lookbackMinutes) * 60 * 1000;
  const nowMs = Date.now();

  const liveEvents = readEventsFromJsonl(livePath);
  const recentLiveEvents = liveEvents.filter((event) => {
    const ts = Date.parse(String(event?.ts || ""));
    return Number.isFinite(ts) && ts >= nowMs - lookbackMs;
  });
  const scopedLiveEvents = userContextPrefix
    ? recentLiveEvents.filter((event) => String(event?.userContextId || "").trim().toLowerCase().startsWith(userContextPrefix))
    : recentLiveEvents;
  const liveServeAttempts = scopedLiveEvents.filter((event) => String(event?.event || "").startsWith("chatkit.serve."));
  const liveHasSufficientCoverage = liveServeAttempts.length >= minLiveSamples;

  if (liveHasSufficientCoverage) {
    return { mode: "live", sourcePath: livePath, events: scopedLiveEvents };
  }
  const fixtureEvents = readEventsFromJsonl(fixturePath);
  return { mode: "fixture", sourcePath: fixturePath, events: fixtureEvents };
}

function evaluateGate(metrics, baseline) {
  const t = baseline.thresholds || {};
  const checks = {
    reliability: metrics.reliabilityPct >= Number(t.minServeReliabilityPct || 0),
    p50: metrics.latencyMs.p50 <= Number(t.maxP50Ms || Number.MAX_SAFE_INTEGER),
    p95: metrics.latencyMs.p95 <= Number(t.maxP95Ms || Number.MAX_SAFE_INTEGER),
    p99: metrics.latencyMs.p99 <= Number(t.maxP99Ms || Number.MAX_SAFE_INTEGER),
    quality: metrics.qualityScore >= Number(t.minQualityScore || 0),
  };
  const pass = Object.values(checks).every(Boolean);
  return { pass, checks };
}

const root = process.cwd();
const baselinePath = path.join(root, "scripts", "smoke", "quality", "chatkit-phase5-baseline.json");
const baseline = loadBaseline(baselinePath);
const dataset = selectDataset();
const metrics = computeMetrics(dataset.events);

assert.equal(metrics.counts.totalEvents > 0, true, "Phase 5 gate requires non-empty event data");

const evaluation = evaluateGate(metrics, baseline);
const report = {
  ts: new Date().toISOString(),
  phase: "phase5",
  verdict: evaluation.pass ? "PASS" : "BLOCKED",
  datasetMode: dataset.mode,
  sourcePath: dataset.sourcePath,
  baselinePath,
  checks: evaluation.checks,
  metrics,
};

const reportPath = path.join(root, "archive", "logs", "chatkit-phase5-gate-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

if (!evaluation.pass) {
  throw new Error(
    `[src-chatkit-phase5-release-gate] BLOCKED checks=${JSON.stringify(evaluation.checks)} report=${reportPath}`,
  );
}

console.log(`[src-chatkit-phase5-release-gate] PASS mode=${dataset.mode} report=${reportPath}`);

