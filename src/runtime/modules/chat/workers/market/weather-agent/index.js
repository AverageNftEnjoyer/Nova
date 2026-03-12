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
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import {
  clearPendingWeatherConfirmation,
  runWeatherLookup,
  writePendingWeatherConfirmation,
} from "../weather-service/index.js";

const WEATHER_TTS_TIMEOUT_MS = 10_000;

export async function handleWeatherWorker(text, ctx, llmCtx = {}) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;

  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Checking weather", userContextId);

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
    route: "weather",
    responseRoute: "weather",
    ok: true,
    reply: "",
    error: "",
    errorMessage: "",
    sessionKey: sessionKey || "",
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
    telemetry: {
      domain: "weather",
      userContextId: String(userContextId || "").trim(),
      conversationId: String(conversationId || "").trim(),
      sessionKey: String(sessionKey || "").trim(),
      provider: "",
      toolCalls: 0,
      tokens: 0,
      latencyMs: 0,
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
        WEATHER_TTS_TIMEOUT_MS,
        "Weather TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const weatherResult = await runWeatherLookup({ text });
    const suggestedLocation = String(weatherResult?.suggestedLocation || "").trim();
    if (weatherResult?.needsConfirmation && suggestedLocation) {
      writePendingWeatherConfirmation({
        userContextId,
        conversationId,
        prompt: text,
        suggestedLocation,
      });
      broadcastThinkingStatus("Confirming location", userContextId);
    } else {
      clearPendingWeatherConfirmation({ userContextId, conversationId });
      broadcastThinkingStatus("Summarizing weather", userContextId);
    }
    summary.reply = await emitAssistantReply(
      String(weatherResult?.reply || "I couldn't fetch weather right now. Please retry.").trim(),
    );
  } catch (error) {
    clearPendingWeatherConfirmation({ userContextId, conversationId });
    summary.ok = false;
    summary.error = String(error instanceof Error ? error.message : describeUnknownError(error));
    summary.errorMessage = summary.error;
    summary.reply = await emitAssistantReply("I couldn't fetch weather right now. Please retry.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
    summary.telemetry.latencyMs = summary.latencyMs;
  }

  return normalizeWorkerSummary(summary, {
    defaultRoute: "weather",
    defaultResponseRoute: "weather",
    defaultProvider: "",
    defaultLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
