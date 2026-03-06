import {
  buildMissionBuildAssistantReply,
  buildMissionBuildIdempotencyKey,
  normalizeMissionBuildInput,
} from "./build-service/index.js";
import { runMissionBuildViaProviderAdapter } from "./provider-adapter/index.js";

function resolveFailureReply(message) {
  const isUnauthorized = /\bunauthorized\b/i.test(message);
  if (isUnauthorized) {
    return "I could not build that workflow because your session is not authorized for missions yet. Re-open Nova, sign in again, then retry and I will continue from your latest prompt.";
  }
  return `I couldn't build that workflow yet: ${message}`;
}

function toStepCount(data = {}) {
  if (Number.isFinite(Number(data?.missionSummary?.nodeCount))) {
    return Number(data.missionSummary.nodeCount);
  }
  return Array.isArray(data?.mission?.nodes) ? data.mission.nodes.length : 0;
}

export async function runMissionsDomainService(input = {}, dependencies = {}) {
  const userContextId = String(input?.userContextId || "").trim();
  const conversationId = String(input?.conversationId || "").trim();
  const sessionKey = String(input?.sessionKey || "").trim();
  if (!userContextId || !conversationId || !sessionKey) {
    return {
      route: "workflow_build",
      responseRoute: "workflow_build",
      ok: false,
      code: "missions.context_missing",
      error: "Mission build requires userContextId, conversationId, and sessionKey.",
      reply: "I couldn't build that mission yet because scoped session context is missing.",
      provider: "",
      model: "",
      deployed: false,
      stepCount: 0,
      data: null,
    };
  }

  const normalizedInput = normalizeMissionBuildInput({
    prompt: input?.text,
    deploy: input?.deploy,
    timezone: input?.timezone,
    enabled: input?.enabled,
    engine: input?.engine,
    userContextId,
  });
  const runAdapter = typeof dependencies?.runMissionBuildViaProviderAdapter === "function"
    ? dependencies.runMissionBuildViaProviderAdapter
    : runMissionBuildViaProviderAdapter;

  const missionBuildResult = await runAdapter({
    ...normalizedInput,
    supabaseAccessToken: String(input?.supabaseAccessToken || "").trim(),
    idempotencyKey: buildMissionBuildIdempotencyKey({
      userContextId,
      conversationId,
      prompt: normalizedInput.prompt,
      deploy: normalizedInput.deploy,
      engine: normalizedInput.engine,
    }),
  });

  const responseStatus = Number(missionBuildResult?.status || 0);
  const data = missionBuildResult?.data || {};

  if (responseStatus === 202 && data?.pending) {
    const retryAfterMs = Number(data?.retryAfterMs || 0);
    const retryAfterNote = retryAfterMs > 0
      ? ` I will keep this in progress and you can retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
      : "";
    return {
      route: "workflow_build",
      responseRoute: "workflow_build",
      ok: true,
      code: "missions.pending",
      error: "",
      reply: `I'm already building that mission for you.${retryAfterNote}`,
      provider: "",
      model: "",
      deployed: false,
      stepCount: 0,
      data,
    };
  }

  if (!missionBuildResult?.ok) {
    const message = String(
      missionBuildResult?.error
      || data?.error
      || `Workflow build failed (${responseStatus || "request"}).`,
    ).trim() || "Workflow build failed.";
    return {
      route: "workflow_build",
      responseRoute: "workflow_build",
      ok: false,
      code: String(missionBuildResult?.code || "missions.build_failed"),
      error: message,
      reply: resolveFailureReply(message),
      provider: String(data?.provider || ""),
      model: String(data?.model || ""),
      deployed: false,
      stepCount: toStepCount(data),
      data,
    };
  }

  return {
    route: "workflow_build",
    responseRoute: "workflow_build",
    ok: true,
    code: "missions.build_ok",
    error: "",
    reply: buildMissionBuildAssistantReply(data),
    provider: String(data?.provider || ""),
    model: String(data?.model || ""),
    deployed: Boolean(data?.deployed),
    stepCount: toStepCount(data),
    data,
  };
}
