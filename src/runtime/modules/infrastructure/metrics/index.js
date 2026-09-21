import {
  getSystemMetrics as getWindowsSystemMetrics,
  getWindowsMetricsPoller,
} from "../windowsMetrics/index.js";

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 2000;
const DEFAULT_METRICS_MODE = "once";
// On-demand metrics collection spawns a heavy PowerShell probe, so results are cached this long.
export const ON_DEMAND_METRICS_TTL_MS = 60_000;

function resolveIntervalMs(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs));
}

let onDemandCache = { value: null, at: 0 };
let onDemandInFlight = null;

/**
 * Get current system metrics on demand (explicit client request).
 * TTL-cached (>= 60s) and single-flight: concurrent callers share one collection.
 * The first call after boot is the first time the PowerShell probe runs; there is no boot-time spawn.
 */
export async function getSystemMetrics(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(0, options.ttlMs) : ON_DEMAND_METRICS_TTL_MS;
  const collect = typeof options.collect === "function" ? options.collect : collectFreshMetrics;
  const now = Date.now();
  if (onDemandCache.value && now - onDemandCache.at < ttlMs) {
    return onDemandCache.value;
  }
  if (onDemandInFlight) return onDemandInFlight;

  onDemandInFlight = (async () => {
    try {
      const value = await collect();
      if (value) onDemandCache = { value, at: Date.now() };
      // On failure fall back to the last good value (possibly stale) rather than throwing.
      return value || onDemandCache.value;
    } finally {
      onDemandInFlight = null;
    }
  })();
  return onDemandInFlight;
}

/** Test hook: drop the on-demand cache. */
export function resetOnDemandMetricsCache() {
  onDemandCache = { value: null, at: 0 };
  onDemandInFlight = null;
}

async function collectFreshMetrics() {
  if (process.env.NOVA_METRICS_DISABLED === "1") return null;
  const poller = getWindowsMetricsPoller();
  // Respect the poller's failure backoff; otherwise force a real (single-flight) poll now
  // instead of the poller's default "return stale value and refresh in background".
  if (poller.lastGoodValue && Date.now() < poller.nextPollAt && poller.failureCount > 0) {
    return poller.lastGoodValue;
  }
  await poller.pollNow();
  return poller.lastGoodValue;
}

/**
 * Start broadcasting system metrics at interval
 */
export function startMetricsBroadcast(broadcast, intervalMs = DEFAULT_INTERVAL_MS, options = {}) {
  if (process.env.NOVA_METRICS_DISABLED === "1") {
    if (process.env.NOVA_METRICS_DEBUG === "1") {
      console.debug("[Metrics] Polling disabled via NOVA_METRICS_DISABLED=1");
    }
    return () => {};
  }

  const safeIntervalMs = resolveIntervalMs(intervalMs);
  const mode = String(process.env.NOVA_METRICS_MODE || DEFAULT_METRICS_MODE).toLowerCase();
  const userContextId =
    typeof options.userContextId === "string" ? options.userContextId.trim() : "";

  // Default mode is on-demand: no boot-time collection and no background polling. Metrics are
  // only collected when a client sends `request_system_metrics` (see getSystemMetrics above).
  if (mode !== "poll") {
    if (process.env.NOVA_METRICS_DEBUG === "1") {
      console.debug(`[Metrics] On-demand mode active (NOVA_METRICS_MODE=${mode || "once"})`);
    }
    return () => {};
  }

  // Explicit poll mode: send initial metrics (fire-and-forget, errors logged not thrown)...
  sendMetrics(broadcast, userContextId);

  // ...then update every interval
  const timer = setInterval(() => sendMetrics(broadcast, userContextId), safeIntervalMs);

  return () => clearInterval(timer);
}

async function sendMetrics(broadcast, userContextId = "") {
  try {
    // Poll mode bypasses the on-demand TTL cache; the Windows poller enforces its own interval/backoff.
    const metrics = await getWindowsSystemMetrics();
    if (metrics) {
      // System metrics are tenant-neutral runtime telemetry.
      // An empty userContextId intentionally keeps this event global.
      const payload = {
        type: "system_metrics",
        metrics,
        ts: Date.now(),
        ...(userContextId ? { userContextId } : {}),
      };
      broadcast(payload);
    }
  } catch (err) {
    if (process.env.NOVA_METRICS_DEBUG === "1") {
      console.debug(`[Metrics] sendMetrics failed: ${err.message}`);
    }
  }
}
