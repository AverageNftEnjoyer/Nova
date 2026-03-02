export type CoinbaseRolloutStage = "off" | "alpha" | "beta" | "ramp" | "full";

export type CoinbaseRolloutAccess = {
  enabled: boolean;
  stage: CoinbaseRolloutStage;
  reason: string;
  supportChannel: string;
  percent: number;
};

export type CoinbaseRolloutHealthSnapshot = {
  pass: boolean;
  reasons: string[];
  metrics: {
    sampleCount: number;
    errorRatePct: number;
    worstP95Ms: number;
    reportSuccessRatePct: number;
  };
  thresholds: {
    minSampleCount: number;
    maxErrorRatePct: number;
    maxP95Ms: number;
    minReportSuccessRatePct: number;
  };
};

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(String(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function toBool(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

function parseUserSet(raw: unknown): Set<string> {
  return new Set(
    String(raw || "")
      .split(",")
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeStage(raw: unknown): CoinbaseRolloutStage {
  const stage = String(raw || "full").trim().toLowerCase();
  if (stage === "off" || stage === "alpha" || stage === "beta" || stage === "ramp" || stage === "full") return stage;
  return "full";
}

function normalizeUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 96);
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function percentBucket(userContextId: string, salt: string): number {
  const hash = fnv1a32(`${salt}:${userContextId}`);
  return hash % 100;
}

export function resolveCoinbaseRolloutAccess(userContextIdRaw: unknown): CoinbaseRolloutAccess {
  const userContextId = normalizeUserContextId(userContextIdRaw);
  const stage = normalizeStage(process.env.NOVA_COINBASE_ROLLOUT_STAGE);
  const supportChannel = String(process.env.NOVA_COINBASE_SUPPORT_CHANNEL || "#nova-coinbase-support").trim() || "#nova-coinbase-support";
  const percent = toInt(process.env.NOVA_COINBASE_ROLLOUT_PERCENT, 0, 0, 100);
  const killSwitch = toBool(process.env.NOVA_COINBASE_ROLLOUT_KILL_SWITCH, false);
  const alphaUsers = parseUserSet(process.env.NOVA_COINBASE_ALPHA_USERS);
  const betaUsers = parseUserSet(process.env.NOVA_COINBASE_BETA_USERS);
  const salt = String(process.env.NOVA_COINBASE_ROLLOUT_SALT || "nova-coinbase-rollout").trim() || "nova-coinbase-rollout";

  if (!userContextId) {
    return { enabled: false, stage, reason: "missing_user_context", supportChannel, percent };
  }
  if (killSwitch) {
    return { enabled: false, stage: "off", reason: "kill_switch", supportChannel, percent };
  }
  if (stage === "off") {
    return { enabled: false, stage, reason: "disabled", supportChannel, percent };
  }
  if (stage === "full") {
    return { enabled: true, stage, reason: "full", supportChannel, percent: 100 };
  }
  if (alphaUsers.has(userContextId)) {
    return { enabled: true, stage, reason: "alpha_allowlist", supportChannel, percent };
  }
  if (stage === "alpha") {
    return { enabled: false, stage, reason: "alpha_only", supportChannel, percent };
  }
  if (betaUsers.has(userContextId)) {
    return { enabled: true, stage, reason: "beta_allowlist", supportChannel, percent };
  }
  if (stage === "beta") {
    return { enabled: false, stage, reason: "beta_only", supportChannel, percent };
  }
  const bucket = percentBucket(userContextId, salt);
  if (bucket < percent) {
    return { enabled: true, stage, reason: "ramp_percentage", supportChannel, percent };
  }
  return { enabled: false, stage, reason: "ramp_percentage_blocked", supportChannel, percent };
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function evaluateCoinbaseRolloutHealth(snapshot: unknown): CoinbaseRolloutHealthSnapshot {
  const minSampleCount = toInt(process.env.NOVA_COINBASE_ROLLOUT_MIN_SAMPLES, 20, 1, 1_000_000);
  const maxErrorRatePct = toNumber(process.env.NOVA_COINBASE_ROLLOUT_MAX_ERROR_RATE_PCT, 2, 0, 100);
  const maxP95Ms = toInt(process.env.NOVA_COINBASE_ROLLOUT_MAX_P95_MS, 5_000, 100, 120_000);
  const minReportSuccessRatePct = toNumber(process.env.NOVA_COINBASE_ROLLOUT_MIN_REPORT_SUCCESS_RATE_PCT, 98, 0, 100);

  const endpoints = (snapshot && typeof snapshot === "object" && (snapshot as { endpoints?: unknown }).endpoints
    && typeof (snapshot as { endpoints?: unknown }).endpoints === "object"
    ? ((snapshot as { endpoints?: Record<string, unknown> }).endpoints || {})
    : {}) as Record<string, unknown>;

  let success = 0;
  let failure = 0;
  let reportSuccess = 0;
  let reportFailure = 0;
  let worstP95Ms = 0;
  for (const endpoint of Object.values(endpoints)) {
    const entry = (endpoint && typeof endpoint === "object") ? (endpoint as Record<string, unknown>) : {};
    success += safeNumber(entry.success);
    failure += safeNumber(entry.failure);
    reportSuccess += safeNumber(entry.reportSuccess);
    reportFailure += safeNumber(entry.reportFailures);
    const latency = entry.latency && typeof entry.latency === "object" ? (entry.latency as Record<string, unknown>) : {};
    worstP95Ms = Math.max(worstP95Ms, safeNumber(latency.p95));
  }
  const sampleCount = success + failure;
  const errorRatePct = sampleCount > 0 ? (failure / sampleCount) * 100 : 0;
  const reportTotal = reportSuccess + reportFailure;
  const reportSuccessRatePct = reportTotal > 0 ? (reportSuccess / reportTotal) * 100 : 100;

  const reasons: string[] = [];
  if (sampleCount < minSampleCount) reasons.push(`insufficient_samples:${sampleCount}<${minSampleCount}`);
  if (errorRatePct > maxErrorRatePct) reasons.push(`error_rate_too_high:${errorRatePct.toFixed(2)}>${maxErrorRatePct}`);
  if (worstP95Ms > maxP95Ms) reasons.push(`latency_p95_too_high:${worstP95Ms}>${maxP95Ms}`);
  if (reportSuccessRatePct < minReportSuccessRatePct) {
    reasons.push(`report_success_too_low:${reportSuccessRatePct.toFixed(2)}<${minReportSuccessRatePct}`);
  }

  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      sampleCount,
      errorRatePct: Number(errorRatePct.toFixed(4)),
      worstP95Ms,
      reportSuccessRatePct: Number(reportSuccessRatePct.toFixed(4)),
    },
    thresholds: {
      minSampleCount,
      maxErrorRatePct,
      maxP95Ms,
      minReportSuccessRatePct,
    },
  };
}
