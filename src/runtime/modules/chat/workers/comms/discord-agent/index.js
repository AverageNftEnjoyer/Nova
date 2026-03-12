import { sessionRuntime } from "../../../../infrastructure/config/index.js";
import { speak, stopSpeaking } from "../../../../audio/voice/index.js";
import {
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../../../infrastructure/hud-gateway/index.js";
import { withTimeout } from "../../../../llm/providers/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
import { runDiscordDomainService } from "../../../../services/discord/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

const DISCORD_TTS_TIMEOUT_MS = 10_000;

export async function handleDiscordWorker(text, ctx, llmCtx = {}, requestHints = {}) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const fetchImpl = typeof llmCtx?.fetchImpl === "function" ? llmCtx.fetchImpl : undefined;

  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Delivering Discord message", userContextId);

  const userText = ctx.raw_text || text;
  broadcastMessage("user", userText, source, conversationId, userContextId);
  if (sessionId) {
    sessionRuntime.appendTranscriptTurn(sessionId, "user", userText, {
      source,
      sender: sender || null,
      sessionKey: sessionKey || undefined,
      conversationId: conversationId || undefined,
      nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
      nlpCorrectionCount: Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : undefined,
      ...(ctx.nlpBypass ? { nlpBypass: true } : {}),
    });
  }

  const assistantStreamId = createAssistantStreamId();
  const summary = {
    route: "discord",
    responseRoute: "discord",
    ok: true,
    reply: "",
    error: "",
    telemetry: {
      latencyMs: 0,
      tokens: 0,
      provider: "discord-webhook-adapter",
      toolCalls: 0,
    },
    sessionKey: sessionKey || "",
    provider: "discord-webhook-adapter",
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
    requestHints: requestHints && typeof requestHints === "object" ? { ...requestHints } : {},
    canRunToolLoop: false,
    canRunWebSearch: false,
    canRunWebFetch: false,
    latencyMs: 0,
  };
  const startedAt = Date.now();
  let assistantStreamStarted = false;

  const ensureAssistantStreamStarted = () => {
    if (assistantStreamStarted) return;
    broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);
    assistantStreamStarted = true;
  };

  async function emitAssistantReply(replyText) {
    const normalized = normalizeAssistantReply(String(replyText || ""));
    if (normalized.skip) {
      if (assistantStreamStarted) {
        broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
        assistantStreamStarted = false;
      }
      return "";
    }
    ensureAssistantStreamStarted();
    broadcastAssistantStreamDelta(assistantStreamId, normalized.text, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    assistantStreamStarted = false;
    if (sessionId) {
      sessionRuntime.appendTranscriptTurn(sessionId, "assistant", normalized.text, {
        source,
        sender: "nova",
        sessionKey: sessionKey || undefined,
        conversationId: conversationId || undefined,
      });
    }
    if (useVoice) {
      await withTimeout(
        speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice),
        DISCORD_TTS_TIMEOUT_MS,
        "Discord TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const serviceResult = await runDiscordDomainService({
      text,
      userContextId,
      conversationId,
      sessionKey,
      requestHints,
      fetchImpl,
    });
    summary.ok = serviceResult?.ok === true;
    summary.error = summary.ok ? "" : String(serviceResult?.code || "discord_delivery_failed");
    summary.telemetry = {
      ...(summary.telemetry || {}),
      ...(serviceResult?.telemetry && typeof serviceResult.telemetry === "object" ? serviceResult.telemetry : {}),
    };
    summary.latencyMs = Math.max(0, Number(serviceResult?.telemetry?.latencyMs || 0));
    if (summary.ok) {
      summary.reply = await emitAssistantReply(String(serviceResult?.message || "Discord delivery completed."));
    } else {
      summary.reply = await emitAssistantReply("I couldn't complete the Discord delivery right now. Please retry.");
    }
    summary.requestHints.discordDelivery = {
      code: String(serviceResult?.code || ""),
      summary: serviceResult?.summary && typeof serviceResult.summary === "object"
        ? {
            status: String(serviceResult.summary.status || ""),
            okCount: Number(serviceResult.summary.okCount || 0),
            failCount: Number(serviceResult.summary.failCount || 0),
          }
        : null,
      errors: Array.isArray(serviceResult?.meta?.errors)
        ? serviceResult.meta.errors.map((entry) => ({
            code: String(entry?.code || ""),
            target: String(entry?.target || ""),
            status: Number(entry?.status || 0),
            retryable: entry?.retryable === true,
          }))
        : [],
    };
  } catch {
    summary.ok = false;
    summary.error = "discord_worker_execution_failed";
    summary.reply = await emitAssistantReply("I couldn't complete the Discord delivery right now. Please retry.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    const elapsed = Date.now() - startedAt;
    summary.latencyMs = Math.max(summary.latencyMs, elapsed);
    summary.telemetry.latencyMs = summary.latencyMs;
  }

  return normalizeWorkerSummary(summary, {
    defaultRoute: "discord",
    defaultResponseRoute: "discord",
    defaultProvider: String(summary.provider || "discord-webhook-adapter"),
    defaultLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
