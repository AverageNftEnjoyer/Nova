import { ROOT_WORKSPACE_DIR } from "../../../../../core/constants/index.js";
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
import { cacheRecentCryptoReport } from "../../../core/crypto-report-dedupe/index.js";
import { runCryptoRequest } from "../crypto-service/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

const CRYPTO_TTS_TIMEOUT_MS = 10_000;

export async function handleCryptoWorker(text, ctx, llmCtx = {}) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const runtimeTools = llmCtx?.runtimeTools || null;
  const availableTools = Array.isArray(llmCtx?.availableTools) ? llmCtx.availableTools : [];
  const canRunToolLoop = llmCtx?.canRunToolLoop === true
    || (
      availableTools.length > 0
      && typeof runtimeTools?.executeToolUse === "function"
    );

  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Checking Coinbase", userContextId);

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
    route: "crypto",
    ok: true,
    reply: "",
    error: "",
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
    canRunToolLoop,
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
        CRYPTO_TTS_TIMEOUT_MS,
        "Crypto TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const cryptoResult = await runCryptoRequest({
      text,
      runtimeTools,
      availableTools,
      userContextId,
      conversationId,
      workspaceDir: ROOT_WORKSPACE_DIR,
    });
    const reply = String(cryptoResult?.reply || "").trim();
    if (cryptoResult?.toolCall) {
      summary.toolCalls.push(String(cryptoResult.toolCall));
    }
    if (!reply) {
      summary.ok = false;
      summary.error = "crypto_worker_no_reply";
      summary.reply = await emitAssistantReply("I couldn't complete the crypto request. Rephrase it and retry.");
    } else {
      if (String(cryptoResult?.toolCall || "").trim() === "coinbase_portfolio_report") {
        cacheRecentCryptoReport(userContextId, conversationId, reply);
      }
      summary.reply = await emitAssistantReply(reply);
    }
  } catch (error) {
    summary.ok = false;
    summary.error = String(error instanceof Error ? error.message : describeUnknownError(error));
    summary.reply = await emitAssistantReply("I couldn't complete the crypto request right now. Retry in a moment.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }

  return normalizeWorkerSummary(summary, {
    fallbackRoute: "crypto",
    fallbackResponseRoute: "crypto",
    fallbackProvider: "",
    fallbackLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
