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
import { describeUnknownError, withTimeout } from "../../../../llm/providers/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
import { runTelegramDomainService } from "../../../../services/telegram/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

const TELEGRAM_TTS_TIMEOUT_MS = 10_000;

export async function handleTelegramWorker(text, ctx, llmCtx = {}, requestHints = {}) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;

  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Processing Telegram request", userContextId);

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
    route: "telegram",
    responseRoute: "telegram",
    ok: true,
    reply: "",
    error: "",
    errorMessage: "",
    sessionKey: sessionKey || "",
    provider: "",
    model: "",
    toolCalls: ["telegram"],
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
    telemetry: {
      domain: "telegram",
      userContextId: String(userContextId || "").trim(),
      conversationId: String(conversationId || "").trim(),
      sessionKey: String(sessionKey || "").trim(),
      action: "",
      providerId: "",
      adapterId: "",
      attemptCount: 0,
      chatIdCount: 0,
    },
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
        TELEGRAM_TTS_TIMEOUT_MS,
        "Telegram TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const result = await runTelegramDomainService({
      text,
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
    });
    summary.ok = result?.ok === true;
    summary.error = summary.ok ? "" : String(result?.code || "telegram.execution_failed");
    summary.errorMessage = summary.ok ? "" : String(result?.message || "Telegram request failed.");
    summary.provider = String(result?.provider?.providerId || "");
    summary.telemetry = {
      ...summary.telemetry,
      action: String(result?.action || ""),
      providerId: String(result?.provider?.providerId || ""),
      adapterId: String(result?.provider?.adapterId || ""),
      attemptCount: Number(result?.telemetry?.attemptCount || 0),
      chatIdCount: Number(result?.telemetry?.chatIdCount || 0),
    };
    summary.toolExecutions = Array.isArray(result?.operations)
      ? result.operations.map((operation) => ({
          tool: String(operation?.operation || ""),
          ok: operation?.ok === true,
          chatId: String(operation?.chatId || ""),
          status: Number(operation?.status || 0),
          attempts: Number(operation?.attempts || 0),
          errorCode: String(operation?.errorCode || ""),
        }))
      : [];
    summary.retries = summary.toolExecutions
      .filter((operation) => Number(operation?.attempts || 0) > 1)
      .map((operation) => ({
        tool: operation.tool,
        chatId: operation.chatId,
        attempts: Number(operation.attempts || 0),
      }));
    summary.reply = await emitAssistantReply(
      String(result?.reply || "Telegram request completed.").trim().slice(0, 220),
    );
  } catch (error) {
    summary.ok = false;
    summary.error = "telegram.execution_failed";
    summary.errorMessage = describeUnknownError(error);
    summary.reply = await emitAssistantReply("I couldn't complete the Telegram request right now. Retry in a moment.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }

  return normalizeWorkerSummary(summary, {
    defaultRoute: "telegram",
    defaultResponseRoute: "telegram",
    defaultProvider: String(summary.provider || ""),
    defaultLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
