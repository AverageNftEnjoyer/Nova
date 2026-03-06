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
import { runMissionsDomainService } from "../../../../services/missions/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleMissionBuildWorker(text, ctx, options = {}) {
  const {
    source,
    useVoice,
    ttsVoice,
    supabaseAccessToken,
    conversationId,
    userContextId,
    sessionKey,
  } = ctx;
  const engine = String(options.engine || "src").trim().toLowerCase() || "src";
  stopSpeaking(userContextId ? { userContextId } : undefined);

  const emitWorkflowAssistantReply = async (replyText) => {
    const normalizedReply = normalizeAssistantReply(String(replyText || ""));
    if (normalizedReply.skip) return "";
    const streamId = createAssistantStreamId();
    broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDelta(streamId, normalizedReply.text, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
    if (useVoice) {
      await speak(
        normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text,
        ttsVoice,
        userContextId ? { userContextId } : undefined,
      );
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

    const missionBuildResult = await runMissionsDomainService({
      text,
      deploy,
      engine,
      userContextId,
      conversationId,
      sessionKey,
      supabaseAccessToken,
    });
    const data = missionBuildResult?.data || {};
    const normalizedReply = normalizeAssistantReply(missionBuildResult?.reply || "");
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    summary.ok = missionBuildResult?.ok !== false;
    summary.error = String(missionBuildResult?.error || "");
    summary.provider = String(missionBuildResult?.provider || data?.provider || "");
    summary.model = String(missionBuildResult?.model || data?.model || "");

    if (summary.ok) {
      appendRawStream({
        event: "workflow_build_done",
        source,
        sessionKey: ctx.sessionKey || "",
        userContextId: ctx.userContextId || undefined,
        engine,
        deployed: Boolean(missionBuildResult?.deployed),
        provider: summary.provider,
        model: summary.model,
        stepCount: Number(missionBuildResult?.stepCount || 0),
      });
    } else {
      appendRawStream({
        event: "workflow_build_error",
        source,
        sessionKey: ctx.sessionKey || "",
        userContextId: ctx.userContextId || undefined,
        engine,
        message: summary.error || "Workflow build failed.",
      });
    }

    if (!normalizedReply.skip) {
      summary.reply = await emitWorkflowAssistantReply(normalizedReply.text);
    }
  } catch (err) {
    summary.ok = false;
    summary.error = err instanceof Error ? err.message : "Workflow build failed.";
    summary.reply = await emitWorkflowAssistantReply(`I couldn't build that workflow yet: ${summary.error}`);
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
    appendScopedTranscriptExchange(
      ctx,
      String(ctx?.raw_text || text || ""),
      String(summary.reply || ""),
    );
  }

  return normalizeWorkerSummary(summary, {
    fallbackRoute: "workflow_build",
    fallbackResponseRoute: "workflow_build",
    fallbackProvider: String(summary.provider || ""),
    fallbackLatencyMs: Number(summary.latencyMs || 0),
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
