import fs from "node:fs";
import path from "node:path";

type MetricBucket = {
  latenciesMs: number[];
  success: number;
  failure: number;
  authFailures: number;
  reportFailures: number;
  reportSuccess: number;
  refreshSuccess: number;
  refreshFailure: number;
  statusClass: Record<string, number>;
};

type AlertState = {
  authFailureWindow: number[];
  providerFailureWindow: number[];
  reportFailureWindow: number[];
  latencyBreachWindow: number[];
  cooldownUntilMs: number;
};

export type CoinbaseStructuredLog = {
  ts: string;
  provider: "coinbase";
  event: string;
  endpoint?: string;
  status: "ok" | "error";
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
  latencyMs?: number;
  errorCode?: string;
  message?: string;
  details?: Record<string, unknown>;
};

const buckets = new Map<string, MetricBucket>();
const alertState: AlertState = {
  authFailureWindow: [],
  providerFailureWindow: [],
  reportFailureWindow: [],
  latencyBreachWindow: [],
  cooldownUntilMs: 0,
};

const ALERT_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.NOVA_COINBASE_ALERT_WINDOW_MS || "300000", 10) || 300_000);
const ALERT_AUTH_FAILURE_THRESHOLD = Math.max(1, Number.parseInt(process.env.NOVA_COINBASE_ALERT_AUTH_FAILURE_THRESHOLD || "5", 10) || 5);
const ALERT_PROVIDER_FAILURE_THRESHOLD = Math.max(1, Number.parseInt(process.env.NOVA_COINBASE_ALERT_PROVIDER_FAILURE_THRESHOLD || "8", 10) || 8);
const ALERT_REPORT_FAILURE_THRESHOLD = Math.max(1, Number.parseInt(process.env.NOVA_COINBASE_ALERT_REPORT_FAILURE_THRESHOLD || "5", 10) || 5);
const ALERT_LATENCY_P95_THRESHOLD_MS = Math.max(250, Number.parseInt(process.env.NOVA_COINBASE_ALERT_LATENCY_P95_MS || "4000", 10) || 4000);
const ALERT_LATENCY_MIN_SAMPLES = Math.max(3, Number.parseInt(process.env.NOVA_COINBASE_ALERT_LATENCY_MIN_SAMPLES || "10", 10) || 10);
const ALERT_COOLDOWN_MS = Math.max(10_000, Number.parseInt(process.env.NOVA_COINBASE_ALERT_COOLDOWN_MS || "120000", 10) || 120_000);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return Number(sorted[index] || 0);
}

function getBucket(endpoint: string): MetricBucket {
  const key = String(endpoint || "unknown").trim() || "unknown";
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: MetricBucket = {
    latenciesMs: [],
    success: 0,
    failure: 0,
    authFailures: 0,
    reportFailures: 0,
    reportSuccess: 0,
    refreshSuccess: 0,
    refreshFailure: 0,
    statusClass: {},
  };
  buckets.set(key, created);
  return created;
}

function appendWindow(list: number[], atMs: number): void {
  list.push(atMs);
  const minTs = atMs - ALERT_WINDOW_MS;
  while (list.length > 0 && list[0] < minTs) list.shift();
}

function appendJsonl(relativePath: string, payload: unknown): void {
  const line = `${JSON.stringify(payload)}\n`;
  const root = process.cwd();
  const resolved = path.resolve(root, relativePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, line, "utf8");
}

function emitAlertIfNeeded(event: string, details: Record<string, unknown>) {
  const now = Date.now();
  if (now < alertState.cooldownUntilMs) return;
  alertState.cooldownUntilMs = now + ALERT_COOLDOWN_MS;
  appendJsonl(path.join("archive", "logs", "coinbase-alerts.jsonl"), {
    ts: new Date(now).toISOString(),
    provider: "coinbase",
    event,
    details,
  });
}

export function recordCoinbaseStructuredLog(log: CoinbaseStructuredLog): void {
  const payload = {
    ...log,
    provider: "coinbase",
    ts: log.ts || new Date().toISOString(),
    userContextId: String(log.userContextId || "").trim(),
  };
  appendJsonl(path.join("archive", "logs", "coinbase-structured.jsonl"), payload);
}

export function recordCoinbaseMetric(input: {
  endpoint: string;
  latencyMs?: number;
  ok: boolean;
  errorCode?: string;
  statusClass?: string;
  category?: "request" | "report" | "refresh";
}): void {
  const bucket = getBucket(input.endpoint);
  if (Number.isFinite(Number(input.latencyMs || 0)) && Number(input.latencyMs || 0) >= 0) {
    bucket.latenciesMs.push(Number(input.latencyMs || 0));
    if (bucket.latenciesMs.length > 2_000) bucket.latenciesMs.shift();
  }
  if (input.ok) bucket.success += 1;
  else bucket.failure += 1;
  const statusClass = String(input.statusClass || (input.ok ? "2xx" : "5xx"));
  bucket.statusClass[statusClass] = Number(bucket.statusClass[statusClass] || 0) + 1;
  const code = String(input.errorCode || "").trim().toUpperCase();
  if (!input.ok && code.startsWith("AUTH")) bucket.authFailures += 1;
  if (input.category === "report") {
    if (input.ok) bucket.reportSuccess += 1;
    else bucket.reportFailures += 1;
  }
  if (input.category === "refresh") {
    if (input.ok) bucket.refreshSuccess += 1;
    else bucket.refreshFailure += 1;
  }

  const now = Date.now();
  if (!input.ok && code.startsWith("AUTH")) appendWindow(alertState.authFailureWindow, now);
  if (!input.ok && (statusClass === "5xx" || code === "UPSTREAM_UNAVAILABLE" || code === "TIMEOUT" || code === "NETWORK")) {
    appendWindow(alertState.providerFailureWindow, now);
  }
  if (input.category === "report" && !input.ok) appendWindow(alertState.reportFailureWindow, now);
  const p95 = percentile(bucket.latenciesMs, 95);
  if (bucket.latenciesMs.length >= ALERT_LATENCY_MIN_SAMPLES && p95 >= ALERT_LATENCY_P95_THRESHOLD_MS) {
    appendWindow(alertState.latencyBreachWindow, now);
  }

  if (alertState.authFailureWindow.length >= ALERT_AUTH_FAILURE_THRESHOLD) {
    emitAlertIfNeeded("coinbase.alert.auth_failures", {
      threshold: ALERT_AUTH_FAILURE_THRESHOLD,
      windowMs: ALERT_WINDOW_MS,
      count: alertState.authFailureWindow.length,
    });
  }
  if (alertState.providerFailureWindow.length >= ALERT_PROVIDER_FAILURE_THRESHOLD) {
    emitAlertIfNeeded("coinbase.alert.provider_failures", {
      threshold: ALERT_PROVIDER_FAILURE_THRESHOLD,
      windowMs: ALERT_WINDOW_MS,
      count: alertState.providerFailureWindow.length,
    });
  }
  if (alertState.reportFailureWindow.length >= ALERT_REPORT_FAILURE_THRESHOLD) {
    emitAlertIfNeeded("coinbase.alert.report_failures", {
      threshold: ALERT_REPORT_FAILURE_THRESHOLD,
      windowMs: ALERT_WINDOW_MS,
      count: alertState.reportFailureWindow.length,
    });
  }
  if (alertState.latencyBreachWindow.length >= 1) {
    emitAlertIfNeeded("coinbase.alert.latency_p95_breach", {
      thresholdMs: ALERT_LATENCY_P95_THRESHOLD_MS,
      minSamples: ALERT_LATENCY_MIN_SAMPLES,
      windowMs: ALERT_WINDOW_MS,
      p95Ms: p95,
      endpoint: input.endpoint,
    });
  }
}

export function getCoinbaseMetricsSnapshot(): Record<string, unknown> {
  const endpoints: Record<string, unknown> = {};
  for (const [endpoint, bucket] of buckets.entries()) {
    endpoints[endpoint] = {
      success: bucket.success,
      failure: bucket.failure,
      authFailures: bucket.authFailures,
      reportSuccess: bucket.reportSuccess,
      reportFailures: bucket.reportFailures,
      refreshSuccess: bucket.refreshSuccess,
      refreshFailure: bucket.refreshFailure,
      latency: {
        p50: percentile(bucket.latenciesMs, 50),
        p95: percentile(bucket.latenciesMs, 95),
        p99: percentile(bucket.latenciesMs, 99),
      },
      statusClass: bucket.statusClass,
    };
  }
  return {
    provider: "coinbase",
    generatedAt: new Date().toISOString(),
    endpoints,
    alerts: {
      authFailureCount: alertState.authFailureWindow.length,
      providerFailureCount: alertState.providerFailureWindow.length,
      reportFailureCount: alertState.reportFailureWindow.length,
      latencyBreachCount: alertState.latencyBreachWindow.length,
      cooldownUntilMs: alertState.cooldownUntilMs,
    },
  };
}

export function resetCoinbaseObservabilityForTests(): void {
  buckets.clear();
  alertState.authFailureWindow = [];
  alertState.providerFailureWindow = [];
  alertState.reportFailureWindow = [];
  alertState.latencyBreachWindow = [];
  alertState.cooldownUntilMs = 0;
}
