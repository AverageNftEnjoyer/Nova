import { createHash } from "node:crypto";
import { shouldDraftOnlyWorkflow } from "../../../routing/intent-router/index.js";
import { stopSpeaking, speak } from "../../../../audio/voice/index.js";
import {
  broadcastState,
  broadcastThinkingStatus,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../../../infrastructure/hud-gateway/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
import { appendRawStream } from "../../../../context/persona-context/index.js";
import {
  buildMissionBuildAssistantReply,
  buildMissionBuildIdempotencyKey,
  normalizeMissionBuildInput,
} from "../../../../services/missions/build-service/index.js";

const DEFAULT_BRIDGE_TIMEOUT_MS = 7_500;
const DEFAULT_BRIDGE_RETRY_COUNT = 1;
const TRANSIENT_RETRY_DELAY_MS = 180;

function toBoundedInt(value, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveHudApiBaseUrl(input) {
  return String(input || process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

function resolveRuntimeSharedToken(input) {
  const explicit = String(input || process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim();
  if (explicit) return explicit;
  const encryptionKey = String(process.env.NOVA_ENCRYPTION_KEY || "").trim();
  if (!encryptionKey) return "";
  return createHash("sha256")
    .update(`nova-runtime-shared-token:${encryptionKey}`)
    .digest("hex");
}

function resolveRuntimeSharedTokenHeader(input) {
  return (
    String(input || process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token")
      .trim()
      .toLowerCase()
    || "x-nova-runtime-token"
  );
}

function buildMissionHeaders(token, idempotencyKey) {
  const headers = {
    "Content-Type": "application/json",
  };
  const sharedToken = resolveRuntimeSharedToken();
  const sharedHeader = resolveRuntimeSharedTokenHeader();
  if (sharedToken) headers[sharedHeader] = sharedToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  return headers;
}

function isTransientStatus(status) {
  return Number(status) === 429 || Number(status) >= 500;
}

function isAbortError(error) {
  return String(error?.name || "").trim().toLowerCase() === "aborterror";
}

function describeUnknownError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function getBridgeTimeoutMs() {
  return toBoundedInt(
    process.env.NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS,
    DEFAULT_BRIDGE_TIMEOUT_MS,
    1000,
    30_000,
  );
}

function getBridgeRetryCount() {
  return toBoundedInt(
    process.env.NOVA_INTEGRATION_BRIDGE_RETRY_COUNT,
    DEFAULT_BRIDGE_RETRY_COUNT,
    0,
    2,
  );
}

async function fetchWithTimeoutAndRetry(url, init) {
  const timeoutMs = getBridgeTimeoutMs();
  const retryCount = getBridgeRetryCount();
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryCount) {
    attempt += 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (attempt <= retryCount && isTransientStatus(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt > retryCount) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Mission build request failed.");
}

async function runMissionBuildViaHudApi(input = {}) {
  const normalizedInput = normalizeMissionBuildInput(input);
  const token = String(input?.supabaseAccessToken || "").trim();
  const idempotencyKey = String(input?.idempotencyKey || "").trim();
  const headers = buildMissionHeaders(token, idempotencyKey);

  try {
    const response = await fetchWithTimeoutAndRetry(
      `${resolveHudApiBaseUrl()}/api/missions/build`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: normalizedInput.prompt,
          deploy: normalizedInput.deploy,
          engine: normalizedInput.engine,
          ...(normalizedInput.timezone ? { timezone: normalizedInput.timezone } : {}),
          enabled: normalizedInput.enabled,
        }),
      },
    );
    const data = await response.json().catch(() => ({}));
    return {
      attempted: true,
      ok: response.ok && data?.ok === true,
      status: Number(response.status || 0),
      data,
      error: "",
      code: "",
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      data: null,
      error: describeUnknownError(error),
      code: isAbortError(error) ? "missions.timeout" : "missions.network",
    };
  }
}

export async function handleMissionBuildWorker(text, ctx, options = {}) {
  const { source, useVoice, ttsVoice, supabaseAccessToken, conversationId, userContextId } = ctx;
  const engine = String(options.engine || "src").trim().toLowerCase() || "src";
  stopSpeaking();

  const emitWorkflowAssistantReply = async (replyText) => {
    const normalizedReply = normalizeAssistantReply(String(replyText || ""));
    if (normalizedReply.skip) return "";
    const streamId = createAssistantStreamId();
    broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDelta(streamId, normalizedReply.text, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
    if (useVoice) {
      await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
    return normalizedReply.text;
  };

  const summary = {
    route: "workflow_build",
    ok: true,
    reply: "",
    error: "",
    provider: "",
    model: "",
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: null,
    memoryRecallUsed: false,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    requestHints: {},
    canRunToolLoop: false,
    canRunWebSearch: false,
    canRunWebFetch: false,
    latencyMs: 0,
  };
  const startedAt = Date.now();

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Building workflow", userContextId);
  try {
    const deploy = !shouldDraftOnlyWorkflow(text);
    appendRawStream({
      event: "workflow_build_start",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deploy,
    });

    const missionBuildResult = await runMissionBuildViaHudApi({
      prompt: text,
      deploy,
      engine,
      supabaseAccessToken,
      idempotencyKey: buildMissionBuildIdempotencyKey({
        userContextId,
        conversationId,
        prompt: text,
        deploy,
        engine,
      }),
    });
    const responseStatus = Number(missionBuildResult?.status || 0);
    const data = missionBuildResult?.data || {};

    if (responseStatus === 202 && data?.pending) {
      const retryAfterMs = Number(data?.retryAfterMs || 0);
      const retryAfterNote = retryAfterMs > 0
        ? ` I will keep this in progress and you can retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
        : "";
      summary.reply = await emitWorkflowAssistantReply(
        `I'm already building that mission for you.${retryAfterNote}`,
      );
      return summary;
    }

    if (!missionBuildResult?.ok) {
      const missionBuildError = String(
        missionBuildResult?.error
        || data?.error
        || `Workflow build failed (${responseStatus || "request"}).`,
      ).trim();
      throw new Error(missionBuildError || "Workflow build failed.");
    }

    const reply = buildMissionBuildAssistantReply(data);
    const normalizedReply = normalizeAssistantReply(reply);
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    summary.provider = String(data?.provider || "");
    summary.model = String(data?.model || "");

    appendRawStream({
      event: "workflow_build_done",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deployed: Boolean(data?.deployed),
      provider: String(data?.provider || ""),
      model: String(data?.model || ""),
      stepCount: Number.isFinite(Number(data?.missionSummary?.nodeCount))
        ? Number(data.missionSummary.nodeCount)
        : (Array.isArray(data?.mission?.nodes) ? data.mission.nodes.length : 0),
    });
    if (!normalizedReply.skip) {
      summary.reply = await emitWorkflowAssistantReply(normalizedReply.text);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workflow build failed.";
    summary.ok = false;
    summary.error = message;
    appendRawStream({
      event: "workflow_build_error",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      message,
    });
    const isUnauthorized = /\bunauthorized\b/i.test(message);
    const reply = isUnauthorized
      ? "I could not build that workflow because your session is not authorized for missions yet. Re-open Nova, sign in again, then retry and I will continue from your latest prompt."
      : `I couldn't build that workflow yet: ${message}`;
    summary.reply = await emitWorkflowAssistantReply(reply);
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }

  return summary;
}
