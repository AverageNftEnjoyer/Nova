// ===== Request Scheduler =====
// Bounded in-memory scheduler with workload lanes + concurrency controls.

const SCHEDULER_LANES = ["fast", "default", "tool", "background"];

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeScope(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLane(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (SCHEDULER_LANES.includes(normalized)) return normalized;
  return "default";
}

function createSchedulerError(code, message, retryAfterMs = 0) {
  const err = new Error(message);
  err.code = code;
  err.retryAfterMs = Math.max(0, Number(retryAfterMs || 0));
  return err;
}

function buildLaneWeights(options = {}) {
  const weights = {
    fast: toInt(options.fast ?? process.env.NOVA_SCHEDULER_WEIGHT_FAST, 3, 1, 32),
    default: toInt(options.default ?? process.env.NOVA_SCHEDULER_WEIGHT_DEFAULT, 2, 1, 32),
    tool: toInt(options.tool ?? process.env.NOVA_SCHEDULER_WEIGHT_TOOL, 1, 1, 32),
    background: toInt(options.background ?? process.env.NOVA_SCHEDULER_WEIGHT_BACKGROUND, 1, 1, 32),
  };

  const roundRobin = [];
  for (const lane of SCHEDULER_LANES) {
    for (let i = 0; i < weights[lane]; i += 1) {
      roundRobin.push(lane);
    }
  }
  return { weights, roundRobin: roundRobin.length > 0 ? roundRobin : ["default"] };
}

export function createRequestScheduler(options = {}) {
  const strictUserIsolation =
    String(options.strictUserIsolation ?? process.env.NOVA_SCHEDULER_STRICT_USER_ISOLATION ?? "1").trim() !== "0";
  const configuredMaxInFlightGlobal = toInt(
    options.maxInFlightGlobal ?? process.env.NOVA_SCHEDULER_MAX_INFLIGHT_GLOBAL,
    6,
    1,
    128,
  );
  const maxInFlightGlobal = strictUserIsolation ? Number.MAX_SAFE_INTEGER : configuredMaxInFlightGlobal;
  const maxInFlightPerUser = toInt(
    options.maxInFlightPerUser ?? process.env.NOVA_SCHEDULER_MAX_INFLIGHT_PER_USER,
    2,
    1,
    32,
  );
  const maxInFlightPerConversation = toInt(
    options.maxInFlightPerConversation ?? process.env.NOVA_SCHEDULER_MAX_INFLIGHT_PER_CONVERSATION,
    1,
    1,
    8,
  );
  const maxQueueSize = toInt(
    options.maxQueueSize ?? process.env.NOVA_SCHEDULER_MAX_QUEUE_SIZE,
    120,
    1,
    5000,
  );
  const maxQueueSizePerUser = toInt(
    options.maxQueueSizePerUser ?? process.env.NOVA_SCHEDULER_MAX_QUEUE_SIZE_PER_USER,
    80,
    1,
    5000,
  );
  const queueStaleMs = toInt(
    options.queueStaleMs ?? process.env.NOVA_SCHEDULER_QUEUE_STALE_MS,
    90_000,
    1000,
    30 * 60 * 1000,
  );
  const supersedeQueuedByKey =
    String(options.supersedeQueuedByKey ?? process.env.NOVA_SCHEDULER_SUPERSEDE_QUEUED_BY_KEY ?? "1").trim() !== "0";
  const { weights: laneWeights, roundRobin: laneRoundRobin } = buildLaneWeights(options.laneWeights || {});

  let inFlightGlobal = 0;
  const inFlightByUser = new Map();
  const inFlightByConversation = new Map();
  const laneQueues = {
    fast: [],
    default: [],
    tool: [],
    background: [],
  };
  let laneCursor = 0;
  const counters = {
    enqueued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    queueFull: 0,
    queueStale: 0,
    superseded: 0,
  };

  function getMapCount(map, key) {
    if (!key) return 0;
    return Number(map.get(key) || 0);
  }

  function bumpMapCount(map, key, delta) {
    if (!key) return;
    const next = Number(map.get(key) || 0) + Number(delta || 0);
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }

  function estimateRetryAfterMs() {
    if (strictUserIsolation) return 450;
    if (inFlightGlobal >= maxInFlightGlobal) return 1200;
    return 600;
  }

  function getTotalQueued() {
    return SCHEDULER_LANES.reduce((sum, lane) => sum + laneQueues[lane].length, 0);
  }

  function getQueuedForUser(userId) {
    if (!userId) return 0;
    let total = 0;
    for (const lane of SCHEDULER_LANES) {
      total += laneQueues[lane].reduce((sum, job) => sum + (job?.userId === userId ? 1 : 0), 0);
    }
    return total;
  }

  function canRunJob(job) {
    if (!job) return false;
    if (!strictUserIsolation && inFlightGlobal >= maxInFlightGlobal) return false;
    if (job.userId && getMapCount(inFlightByUser, job.userId) >= maxInFlightPerUser) return false;
    if (job.conversationId && getMapCount(inFlightByConversation, job.conversationId) >= maxInFlightPerConversation) return false;
    return true;
  }

  function markJobStart(job) {
    inFlightGlobal += 1;
    bumpMapCount(inFlightByUser, job.userId, 1);
    bumpMapCount(inFlightByConversation, job.conversationId, 1);
  }

  function markJobEnd(job) {
    inFlightGlobal = Math.max(0, inFlightGlobal - 1);
    bumpMapCount(inFlightByUser, job.userId, -1);
    bumpMapCount(inFlightByConversation, job.conversationId, -1);
  }

  function pruneStaleJobs(nowMs = Date.now()) {
    for (const lane of SCHEDULER_LANES) {
      const q = laneQueues[lane];
      let idx = 0;
      while (idx < q.length) {
        const job = q[idx];
        if (!job || nowMs - Number(job.enqueuedAt || 0) <= queueStaleMs) {
          idx += 1;
          continue;
        }
        q.splice(idx, 1);
        counters.queueStale += 1;
        job.reject(createSchedulerError("queue_stale", "Request expired in queue. Please retry.", 0));
      }
    }
  }

  function removeQueuedBySupersedeKey(supersedeKey) {
    if (!supersedeQueuedByKey || !supersedeKey) return 0;
    let removed = 0;
    for (const lane of SCHEDULER_LANES) {
      const q = laneQueues[lane];
      for (let i = q.length - 1; i >= 0; i -= 1) {
        const job = q[i];
        if (!job || job.supersedeKey !== supersedeKey) continue;
        q.splice(i, 1);
        counters.superseded += 1;
        removed += 1;
        job.reject(createSchedulerError("superseded", "Request superseded by a newer request in this conversation."));
      }
    }
    return removed;
  }

  function pickRunnableFromLane(lane) {
    const q = laneQueues[lane];
    for (let i = 0; i < q.length; i += 1) {
      if (canRunJob(q[i])) return { lane, index: i };
    }
    return null;
  }

  function pickNextRunnable() {
    const rrLen = laneRoundRobin.length;
    for (let attempt = 0; attempt < rrLen; attempt += 1) {
      const lane = laneRoundRobin[laneCursor % rrLen];
      laneCursor = (laneCursor + 1) % rrLen;
      const candidate = pickRunnableFromLane(lane);
      if (candidate) return candidate;
    }
    for (const lane of SCHEDULER_LANES) {
      const candidate = pickRunnableFromLane(lane);
      if (candidate) return candidate;
    }
    return null;
  }

  function dispatch() {
    pruneStaleJobs();
    while (inFlightGlobal < maxInFlightGlobal && getTotalQueued() > 0) {
      const candidate = pickNextRunnable();
      if (!candidate) break;
      const q = laneQueues[candidate.lane];
      const job = q.splice(candidate.index, 1)[0];
      if (!job) break;

      markJobStart(job);
      counters.started += 1;
      Promise.resolve()
        .then(() => job.run())
        .then((result) => {
          counters.completed += 1;
          job.resolve(result);
        })
        .catch((err) => {
          counters.failed += 1;
          job.reject(err);
        })
        .finally(() => {
          markJobEnd(job);
          dispatch();
        });
    }
  }

  function enqueue(params = {}) {
    const run = params.run;
    if (typeof run !== "function") {
      return Promise.reject(createSchedulerError("invalid_job", "Scheduler job is missing executable run function."));
    }

    pruneStaleJobs();
    if (getTotalQueued() >= maxQueueSize) {
      counters.queueFull += 1;
      return Promise.reject(
        createSchedulerError(
          "queue_full",
          "Nova is currently processing too many requests. Please retry shortly.",
          estimateRetryAfterMs(),
        ),
      );
    }

    const lane = normalizeLane(params.lane);
    const userId = normalizeScope(params.userId);
    if (userId && getQueuedForUser(userId) >= maxQueueSizePerUser) {
      counters.queueFull += 1;
      return Promise.reject(
        createSchedulerError(
          "queue_full",
          "Nova is currently processing too many requests for this user. Please retry shortly.",
          estimateRetryAfterMs(),
        ),
      );
    }
    const conversationId = normalizeScope(params.conversationId);
    const supersedeKey = normalizeScope(params.supersedeKey);

    return new Promise((resolve, reject) => {
      removeQueuedBySupersedeKey(supersedeKey);
      laneQueues[lane].push({
        enqueuedAt: Date.now(),
        lane,
        userId,
        conversationId,
        supersedeKey,
        run,
        resolve,
        reject,
      });
      counters.enqueued += 1;
      dispatch();
    });
  }

  function getSnapshot() {
    return {
      inFlightGlobal,
      queued: getTotalQueued(),
      queuedByLane: {
        fast: laneQueues.fast.length,
        default: laneQueues.default.length,
        tool: laneQueues.tool.length,
        background: laneQueues.background.length,
      },
      strictUserIsolation,
      configuredMaxInFlightGlobal,
      maxInFlightGlobal,
      maxInFlightPerUser,
      maxInFlightPerConversation,
      maxQueueSize,
      maxQueueSizePerUser,
      queueStaleMs,
      supersedeQueuedByKey,
      laneWeights: { ...laneWeights },
      activeUsers: inFlightByUser.size,
      activeConversations: inFlightByConversation.size,
      counters: { ...counters },
    };
  }

  return {
    enqueue,
    getSnapshot,
  };
}
