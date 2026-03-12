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
import { runMarketDomainService } from "../../../../services/market/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

const MARKET_TTS_TIMEOUT_MS = 10_000;

export async function handleMarketWorker(text, ctx, llmCtx = {}, requestHints = {}) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const runtimeTools = llmCtx?.runtimeTools || null;
  const availableTools = Array.isArray(llmCtx?.availableTools) ? llmCtx.availableTools : [];
  const canRunWebSearch = availableTools.some((tool) => String(tool?.name || "") === "web_search");

  stopSpeaking(userContextId ? { userContextId } : undefined);
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Scanning markets", userContextId);

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
    route: "market",
    responseRoute: "market",
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
    requestHints: requestHints && typeof requestHints === "object" ? { ...requestHints } : {},
    canRunToolLoop: false,
    canRunWebSearch,
    canRunWebFetch: false,
    latencyMs: 0,
    telemetry: {
      domain: "market",
      provider: "",
      toolCalls: 0,
      tokens: 0,
      latencyMs: 0,
      userContextId: String(userContextId || "").trim(),
      conversationId: String(conversationId || "").trim(),
      sessionKey: String(sessionKey || "").trim(),
      query: "",
      resultCount: 0,
      attemptCount: 0,
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
        speak(
          normalizeAssistantSpeechText(normalized.text) || normalized.text,
          ttsVoice,
          userContextId ? { userContextId } : undefined,
        ),
        MARKET_TTS_TIMEOUT_MS,
        "Market TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const result = await runMarketDomainService({
      text,
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      runtimeTools,
      availableTools,
    });
    summary.ok = result?.ok === true;
    summary.error = summary.ok ? "" : String(result?.code || "market.execution_failed");
    summary.errorMessage = summary.ok ? "" : String(result?.message || "Market request failed.");
    summary.provider = String(result?.provider?.providerId || "");
    summary.toolCalls = Number(result?.telemetry?.attemptCount || 0) > 0 && canRunWebSearch ? ["web_search"] : [];
    summary.toolExecutions = summary.toolCalls.map((tool) => ({
      tool,
      ok: result?.ok === true,
      query: String(result?.query || ""),
      resultCount: Number(result?.telemetry?.resultCount || 0),
    }));
    summary.telemetry = {
      ...summary.telemetry,
      provider: String(result?.provider?.providerId || ""),
      query: String(result?.query || ""),
      resultCount: Number(result?.telemetry?.resultCount || 0),
      attemptCount: Number(result?.telemetry?.attemptCount || 0),
      toolCalls: summary.toolCalls.length,
    };
    summary.requestHints.marketScan = {
      query: String(result?.query || ""),
      resultCount: Number(result?.telemetry?.resultCount || 0),
      code: String(result?.code || ""),
    };
    summary.reply = await emitAssistantReply(
      String(result?.reply || "I couldn't scan market conditions right now. Retry in a moment.").trim(),
    );
  } catch (error) {
    summary.ok = false;
    summary.error = "market.execution_failed";
    summary.errorMessage = describeUnknownError(error);
    summary.reply = await emitAssistantReply("I couldn't scan market conditions right now. Retry in a moment.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
    summary.telemetry.latencyMs = summary.latencyMs;
  }

  return normalizeWorkerSummary(summary, {
    defaultRoute: "market",
    defaultResponseRoute: "market",
    defaultProvider: String(summary.provider || ""),
    defaultLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
