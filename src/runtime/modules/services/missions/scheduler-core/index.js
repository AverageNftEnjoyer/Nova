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
  const activeMissions = allMissions.filter((mission) => mission.status === "active");
  const dueCount = activeMissions.length;

  try {
    for (const mission of activeMissions) {
      if (enqueueCount >= SCHEDULER_MAX_RUNS_PER_TICK) break;
      const userKey = sanitizeSchedulerUserId(mission.userId || "") || "__global__";
      const perUserEnqueues = enqueueCountByUser.get(userKey) || 0;
      if (perUserEnqueues >= SCHEDULER_MAX_RUNS_PER_USER_PER_TICK) continue;

      try {
        const liveUserId = String(mission.userId || "").trim();
        const missionId = String(mission.id || "").trim();
        if (!liveUserId || !missionId) continue;
        const liveMissions = await loadMissions({ userId: liveUserId });
        const liveMission = liveMissions.find((item) => item.id === missionId) ?? null;
        if (!liveMission || liveMission.status !== "active") continue;

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

        if (nativeDayStamp && missionForGate.lastSentLocalDate === nativeDayStamp) continue;

        if (missionForGate.lastRunStatus === "error" && missionForGate.lastRunAt) {
          const lastRunMs = Date.parse(missionForGate.lastRunAt);
          if (Number.isFinite(lastRunMs)) {
            const consecutiveFailures = Math.max(
              0,
              (missionForGate.failureCount || 0) - (missionForGate.successCount || 0),
            );
            const backoffMs = computeRetryDelayMs(Math.min(consecutiveFailures, SCHEDULER_MAX_RETRIES_PER_RUN_KEY));
            if (now.getTime() - lastRunMs < backoffMs) continue;
            if (consecutiveFailures >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY) continue;
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

        if (enqueueResult.ok) {
          enqueueCount += 1;
          enqueueCountByUser.set(userKey, perUserEnqueues + 1);
        } else if (enqueueResult.error !== "duplicate_idempotency_key") {
          warn(`[Scheduler] Failed to enqueue mission ${liveMission.id}:`, enqueueResult.error);
        }
      } catch (err) {
        error(`[Scheduler] Error processing mission ${mission.id}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  } catch (err) {
    error(`[Scheduler] Tick loop failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return { dueCount, runCount: enqueueCount };
}
