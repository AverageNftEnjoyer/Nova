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
import { runMissionBuildViaHudApi } from "../../shared/integration-api-bridge/index.js";
import {
  buildMissionBuildAssistantReply,
  buildMissionBuildIdempotencyKey,
} from "../../../../services/missions/build-service/index.js";

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
