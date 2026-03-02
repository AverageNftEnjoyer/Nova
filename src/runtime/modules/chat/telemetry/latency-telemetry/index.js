function normalizeMetricKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toDurationMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

const HOT_STAGE_RATIO_THRESHOLD = (() => {
  const parsed = Number.parseFloat(String(process.env.NOVA_LATENCY_HOT_STAGE_RATIO || "0.35"));
  if (!Number.isFinite(parsed)) return 0.35;
  return Math.max(0.05, Math.min(0.95, parsed));
})();

export function createChatLatencyTelemetry(startedAt = Date.now()) {
  const stageStarts = new Map();
  const stageDurations = Object.create(null);
  const counters = Object.create(null);
  const marks = Object.create(null);

  function addStage(stage, durationMs) {
    const key = normalizeMetricKey(stage);
    if (!key) return 0;
    const normalized = toDurationMs(durationMs);
    if (!normalized) return 0;
    stageDurations[key] = toDurationMs(stageDurations[key]) + normalized;
    return normalized;
  }

  function startStage(stage) {
    const key = normalizeMetricKey(stage);
    if (!key) return "";
    stageStarts.set(key, Date.now());
    return key;
  }

  function endStage(stage) {
    const key = normalizeMetricKey(stage);
    if (!key) return 0;
    const started = stageStarts.get(key);
    if (!Number.isFinite(started)) return 0;
    stageStarts.delete(key);
    return addStage(key, Date.now() - started);
  }

  function incrementCounter(name, amount = 1) {
    const key = normalizeMetricKey(name);
    if (!key) return 0;
    const delta = Number.isFinite(Number(amount)) ? Number(amount) : 1;
    counters[key] = Number(counters[key] || 0) + delta;
    return counters[key];
  }

  function addMark(name, value) {
    const key = normalizeMetricKey(name);
    if (!key) return null;
    marks[key] = value;
    return marks[key];
  }

  async function trackAsync(stage, fn) {
    const key = startStage(stage);
    try {
      return await fn();
    } finally {
      if (key) endStage(key);
    }
  }

  function trackSync(stage, fn) {
    const key = startStage(stage);
    try {
      return fn();
    } finally {
      if (key) endStage(key);
    }
  }

  function snapshot(now = Date.now()) {
    const totalMs = Math.max(0, toDurationMs(now - startedAt));
    const sortedStages = Object.entries(stageDurations)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    const stageMs = Object.fromEntries(sortedStages);
    const [hotStage = "", hotStageMsRaw = 0] = sortedStages[0] || [];
    const hotStageMs = toDurationMs(hotStageMsRaw);
    const hotStageRatio = totalMs > 0 ? hotStageMs / totalMs : 0;
    return {
      totalMs,
      stageMs,
      counters: { ...counters },
      marks: { ...marks },
      hotStage,
      hotStageMs,
      hotStageRatio: Number(hotStageRatio.toFixed(4)),
      hotPath: hotStageRatio >= HOT_STAGE_RATIO_THRESHOLD ? hotStage : "",
    };
  }

  return {
    addStage,
    addMark,
    startStage,
    endStage,
    incrementCounter,
    trackAsync,
    trackSync,
    snapshot,
  };
}
