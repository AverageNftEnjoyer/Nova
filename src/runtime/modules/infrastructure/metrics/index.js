import { getSystemMetrics as getWindowsSystemMetrics } from "./windowsMetrics.js";

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 2000;
const DEFAULT_METRICS_MODE = "once";

function resolveIntervalMs(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs));
}

/**
 * Get current system metrics
 */
export async function getSystemMetrics() {
  return getWindowsSystemMetrics();
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

  // Send initial metrics (fire-and-forget, errors logged not thrown)
  sendMetrics(broadcast, userContextId);

  // Default mode is one-shot to avoid background polling CPU cost on Windows.
  if (mode !== "poll") {
    if (process.env.NOVA_METRICS_DEBUG === "1") {
      console.debug(`[Metrics] One-shot mode active (NOVA_METRICS_MODE=${mode || "once"})`);
    }
    return () => {};
  }

  // Then update every interval
  const timer = setInterval(() => sendMetrics(broadcast, userContextId), safeIntervalMs);

  return () => clearInterval(timer);
}

async function sendMetrics(broadcast, userContextId = "") {
  try {
    const metrics = await getSystemMetrics();
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
