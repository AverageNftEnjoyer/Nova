import crypto from "node:crypto";

const DEFAULT_SCHEDULE_TIME = "09:00";
const DEFAULT_SCHEDULE_TIMEZONE = "America/New_York";
const DEFAULT_LABEL = "Generated Workflow";
const DEFAULT_PROVIDER = "LLM";
const DEFAULT_MODEL = "default model";

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

function normalizeString(value, maxLength = 0) {
  const normalized = String(value || "").trim();
  if (!maxLength || normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trim();
}

function normalizeScopePart(value) {
  return normalizeString(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePromptSeed(value) {
  return normalizeString(value, 1200)
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeMissionBuildInput(input = {}) {
  return {
    prompt: normalizeString(input.prompt, 5000),
    deploy: normalizeBool(input.deploy, true),
    engine: normalizeString(input.engine || "src", 32).toLowerCase() || "src",
    timezone: normalizeString(input.timezone, 80),
    enabled: normalizeBool(input.enabled, true),
    userContextId: normalizeScopePart(input.userContextId),
    conversationId: normalizeScopePart(input.conversationId),
  };
}

export function buildMissionBuildIdempotencyKey(input = {}) {
  const normalized = normalizeMissionBuildInput(input);
  const seed = JSON.stringify({
    userContextId: normalized.userContextId,
    conversationId: normalized.conversationId,
    prompt: normalizePromptSeed(normalized.prompt),
    deploy: normalized.deploy,
    timezone: normalized.timezone,
    enabled: normalized.enabled,
    engine: normalized.engine,
  });
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 40);
}

export function summarizeMissionBuildPayload(payload = {}) {
  const missionSummary = payload?.missionSummary && typeof payload.missionSummary === "object"
    ? payload.missionSummary
    : {};
  const mission = payload?.mission && typeof payload.mission === "object"
    ? payload.mission
    : {};
  const schedule = missionSummary?.schedule && typeof missionSummary.schedule === "object"
    ? missionSummary.schedule
    : {};
  const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];

  return {
    deployed: payload?.deployed === true,
    label: normalizeString(missionSummary?.label || mission?.label || DEFAULT_LABEL, 200) || DEFAULT_LABEL,
    provider: normalizeString(payload?.provider || DEFAULT_PROVIDER, 120) || DEFAULT_PROVIDER,
    model: normalizeString(payload?.model || DEFAULT_MODEL, 120) || DEFAULT_MODEL,
    stepCount: Number.isFinite(Number(missionSummary?.nodeCount))
      ? Number(missionSummary.nodeCount)
      : nodes.length,
    scheduleTime: normalizeString(schedule?.time || DEFAULT_SCHEDULE_TIME, 32) || DEFAULT_SCHEDULE_TIME,
    scheduleTimezone: normalizeString(schedule?.timezone || DEFAULT_SCHEDULE_TIMEZONE, 80) || DEFAULT_SCHEDULE_TIMEZONE,
  };
}

export function buildMissionBuildAssistantReply(payload = {}) {
  const summary = summarizeMissionBuildPayload(payload);
  if (summary.deployed) {
    return `Built and deployed "${summary.label}" with ${summary.stepCount} workflow steps. It is scheduled for ${summary.scheduleTime} ${summary.scheduleTimezone}. Generated using ${summary.provider} ${summary.model}. Open the Missions page to review or edit it.`;
  }
  return `Built a workflow draft "${summary.label}" with ${summary.stepCount} steps. It's ready for review and not deployed yet. Generated using ${summary.provider} ${summary.model}. Open the Missions page to review or edit it.`;
}

export function buildMissionBuildResponseBase(input = {}) {
  const mission = input?.mission && typeof input.mission === "object" ? input.mission : {};
  const provider = normalizeString(input?.provider || DEFAULT_PROVIDER, 120) || DEFAULT_PROVIDER;
  const model = normalizeString(input?.model || DEFAULT_MODEL, 120) || DEFAULT_MODEL;
  const label = normalizeString(mission?.label || DEFAULT_LABEL, 200) || DEFAULT_LABEL;
  const description = normalizeString(mission?.description, 500);
  const integration = normalizeString(mission?.integration, 80);
  const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];
  const scheduleTime = normalizeString(input?.scheduleTime || DEFAULT_SCHEDULE_TIME, 32) || DEFAULT_SCHEDULE_TIME;
  const scheduleTimezone = normalizeString(input?.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE, 80) || DEFAULT_SCHEDULE_TIMEZONE;

  return {
    ok: true,
    provider,
    model,
    debug: normalizeString(input?.debug, 240),
    missionSummary: {
      label,
      description,
      integration,
      nodeCount: nodes.length,
      schedule: {
        time: scheduleTime,
        timezone: scheduleTimezone,
      },
    },
  };
}
