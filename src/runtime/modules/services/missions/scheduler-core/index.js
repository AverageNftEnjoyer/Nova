import { randomUUID } from "node:crypto";

const SCHEDULER_MAX_RUNS_PER_TICK = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_TICK || "20", 10) || 20),
);
const SCHEDULER_MAX_RUNS_PER_USER_PER_TICK = Math.max(
  1,
  Math.min(25, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_USER_PER_TICK || "4", 10) || 4),
);
const SCHEDULER_MAX_RETRIES_PER_RUN_KEY = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RETRIES_PER_RUN_KEY || "3", 10) || 3),
);
const SCHEDULER_RETRY_BASE_MS = Math.max(
  10_000,
  Math.min(3_600_000, Number.parseInt(process.env.NOVA_SCHEDULER_RETRY_BASE_MS || "60000", 10) || 60_000),
);
const SCHEDULER_RETRY_MAX_MS = Math.max(
  SCHEDULER_RETRY_BASE_MS,
  Math.min(21_600_000, Number.parseInt(process.env.NOVA_SCHEDULER_RETRY_MAX_MS || "900000", 10) || 900_000),
);
const SCHEDULER_MAX_PARALLEL_ENQUEUE_WORKERS = Math.max(
  1,
  Math.min(20, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_PARALLEL_ENQUEUE_WORKERS || "4", 10) || 4),
);

function sanitizeSchedulerUserId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function computeRetryDelayMs(previousAttempts) {
  const exponent = Math.max(0, Math.floor(previousAttempts));
  const delay = SCHEDULER_RETRY_BASE_MS * Math.pow(2, exponent);
  return Math.max(SCHEDULER_RETRY_BASE_MS, Math.min(SCHEDULER_RETRY_MAX_MS, Math.floor(delay)));
}

export async function runMissionScheduleTick(dependencies = {}) {
  const loadMissions = dependencies.loadMissions;
  const getRescheduleOverride = dependencies.getRescheduleOverride;
  const getLocalParts = dependencies.getLocalParts;
  const resolveTimezone = dependencies.resolveTimezone;
  const jobLedger = dependencies.jobLedger;
  const warn = dependencies.warn || console.warn;
  const error = dependencies.error || console.error;

  if (typeof loadMissions !== "function") throw new Error("Scheduler core requires loadMissions");
  if (typeof getRescheduleOverride !== "function") throw new Error("Scheduler core requires getRescheduleOverride");
  if (typeof getLocalParts !== "function") throw new Error("Scheduler core requires getLocalParts");
  if (typeof resolveTimezone !== "function") throw new Error("Scheduler core requires resolveTimezone");
  if (!jobLedger || typeof jobLedger.enqueue !== "function") throw new Error("Scheduler core requires jobLedger");

  await jobLedger.reclaimExpiredLeases().catch((err) => {
    warn("[Scheduler] reclaimExpiredLeases failed:", err instanceof Error ? err.message : err);
  });

  const allMissions = await loadMissions({ allUsers: true });
  const now = new Date();
  let enqueueCount = 0;
  const enqueueCountByUser = new Map();
  const liveMissionsByUser = new Map();
  const activeMissions = allMissions.filter((mission) => mission.status === "active");
  const activeMissionIdsByUser = new Map();
  const dueCount = activeMissions.length;
  const roundRobinUsers = [];

  for (const mission of activeMissions) {
    const liveUserId = String(mission.userId || "").trim();
    const missionId = String(mission.id || "").trim();
    if (!liveUserId || !missionId) continue;
    let missionIds = activeMissionIdsByUser.get(liveUserId);
    if (!missionIds) {
      missionIds = [];
      activeMissionIdsByUser.set(liveUserId, missionIds);
      roundRobinUsers.push(liveUserId);
    }
    missionIds.push(missionId);
  }

  await Promise.all(
    roundRobinUsers.map(async (userId) => {
      const liveMissions = await loadMissions({ userId });
      const missionMap = new Map(
        liveMissions
          .filter((item) => item && typeof item === "object" && String(item.id || "").trim())
          .map((item) => [String(item.id || "").trim(), item]),
      );
      liveMissionsByUser.set(userId, missionMap);
    }),
  );

  try {
    const processMissionSelection = async ({ liveUserId, missionId, userKey }) => {
      try {
        if (!missionId) return { userKey, enqueued: false };
        const liveMission = liveMissionsByUser.get(liveUserId)?.get(missionId) ?? null;
        if (!liveMission || liveMission.status !== "active") return { userKey, enqueued: false };

        const rescheduleOverride = liveMission.userId
          ? await getRescheduleOverride(liveMission.userId, liveMission.id).catch(() => null)
          : null;

        const missionForGate = rescheduleOverride?.overriddenTime
          ? { ...liveMission, scheduledAtOverride: rescheduleOverride.overriddenTime }
          : liveMission;

        const nativeTriggerNode = missionForGate.nodes.find((node) => node.type === "schedule-trigger");
        const nativeTriggerMode = String(nativeTriggerNode?.triggerMode || "daily");
        const nativeTz = resolveTimezone(nativeTriggerNode?.triggerTimezone, missionForGate.settings?.timezone);
        const nativeLocal = getLocalParts(now, nativeTz);
        const nativeDayStamp =
          (nativeTriggerMode === "daily" || nativeTriggerMode === "weekly" || nativeTriggerMode === "once")
            && nativeLocal?.dayStamp
            ? nativeLocal.dayStamp
            : undefined;

        if (nativeDayStamp && missionForGate.lastSentLocalDate === nativeDayStamp) return { userKey, enqueued: false };

        if (missionForGate.lastRunStatus === "error" && missionForGate.lastRunAt) {
          const lastRunMs = Date.parse(missionForGate.lastRunAt);
          if (Number.isFinite(lastRunMs)) {
            const consecutiveFailures = Math.max(
              0,
              (missionForGate.failureCount || 0) - (missionForGate.successCount || 0),
            );
            const backoffMs = computeRetryDelayMs(Math.min(consecutiveFailures, SCHEDULER_MAX_RETRIES_PER_RUN_KEY));
            if (now.getTime() - lastRunMs < backoffMs) return { userKey, enqueued: false };
            if (consecutiveFailures >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY) return { userKey, enqueued: false };
          }
        }

        const idempotencyKey = nativeDayStamp
          ? `${liveMission.id}:${nativeDayStamp}`
          : nativeTriggerMode === "interval"
            ? `${liveMission.id}:interval:${Math.floor(now.getTime() / (Math.max(1, nativeTriggerNode?.triggerIntervalMinutes || 30) * 60_000))}`
            : `${liveMission.id}:hour:${Math.floor(now.getTime() / 3_600_000)}`;

        const inputSnapshot = {};
        if (rescheduleOverride?.overriddenTime) {
          inputSnapshot.scheduledAtOverride = rescheduleOverride.overriddenTime;
        }

        const enqueueResult = await jobLedger.enqueue({
          id: randomUUID(),
          user_id: sanitizeSchedulerUserId(liveMission.userId || "") || "__global__",
          mission_id: liveMission.id,
          idempotency_key: idempotencyKey,
          source: "scheduler",
          priority: 5,
          max_attempts: liveMission.settings.retryOnFail ? liveMission.settings.retryCount + 1 : 1,
          ...(Object.keys(inputSnapshot).length > 0 ? { input_snapshot: inputSnapshot } : {}),
        });

        if (!enqueueResult.ok && enqueueResult.error !== "duplicate_idempotency_key") {
          warn(`[Scheduler] Failed to enqueue mission ${liveMission.id}:`, enqueueResult.error);
        }

        return { userKey, enqueued: Boolean(enqueueResult.ok) };
      } catch (err) {
        error(`[Scheduler] Error processing mission ${missionId || "unknown"}: ${err instanceof Error ? err.message : "unknown"}`);
        return { userKey, enqueued: false };
      }
    };

    let userCursor = 0;
    while (enqueueCount < SCHEDULER_MAX_RUNS_PER_TICK && roundRobinUsers.length > 0) {
      const availableSlots = SCHEDULER_MAX_RUNS_PER_TICK - enqueueCount;
      if (availableSlots <= 0) break;
      const waveMax = Math.max(
        1,
        Math.min(SCHEDULER_MAX_PARALLEL_ENQUEUE_WORKERS, availableSlots, roundRobinUsers.length),
      );
      const initialUsersInWave = roundRobinUsers.length;
      const selectedMissions = [];
      let inspectedUsers = 0;

      while (
        selectedMissions.length < waveMax
        && roundRobinUsers.length > 0
        && inspectedUsers < Math.max(1, initialUsersInWave)
      ) {
        const userIdx = userCursor % roundRobinUsers.length;
        const liveUserId = roundRobinUsers[userIdx];
        const userKey = sanitizeSchedulerUserId(liveUserId || "") || "__global__";
        const perUserEnqueues = enqueueCountByUser.get(userKey) || 0;
        const missionIds = activeMissionIdsByUser.get(liveUserId) || [];
        inspectedUsers += 1;

        if (missionIds.length === 0 || perUserEnqueues >= SCHEDULER_MAX_RUNS_PER_USER_PER_TICK) {
          activeMissionIdsByUser.delete(liveUserId);
          roundRobinUsers.splice(userIdx, 1);
          if (roundRobinUsers.length === 0) break;
          userCursor = roundRobinUsers.length === 0 ? 0 : userIdx % roundRobinUsers.length;
          continue;
        }

        const missionId = missionIds.shift();
        if (missionIds.length === 0) {
          activeMissionIdsByUser.delete(liveUserId);
          roundRobinUsers.splice(userIdx, 1);
          if (roundRobinUsers.length === 0) {
            userCursor = 0;
          } else {
            userCursor = userIdx % roundRobinUsers.length;
          }
        } else {
          userCursor = (userIdx + 1) % roundRobinUsers.length;
        }

        if (!missionId) continue;
        selectedMissions.push({ liveUserId, missionId, userKey });
      }

      if (selectedMissions.length === 0) {
        if (roundRobinUsers.length === 0) break;
        continue;
      }

      const waveResults = await Promise.all(selectedMissions.map((selection) => processMissionSelection(selection)));
      for (const result of waveResults) {
        if (!result.enqueued) continue;
        enqueueCount += 1;
        enqueueCountByUser.set(result.userKey, (enqueueCountByUser.get(result.userKey) || 0) + 1);
      }
    }
  } catch (err) {
    error(`[Scheduler] Tick loop failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return { dueCount, runCount: enqueueCount };
}
