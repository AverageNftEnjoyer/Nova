import { sessionRuntime } from "../../../../infrastructure/config/index.js";
import { speak, stopSpeaking } from "../../../../audio/voice/index.js";
import {
  broadcast,
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
import {
  sanitizeYouTubeTopic,
  sanitizeYouTubeSource,
  normalizeYouTubeIntentFallback,
} from "./intent-utils/index.js";
import { runYouTubeDomainService } from "../../../../services/youtube/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

export async function handleYouTubeWorker(text, ctx) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  stopSpeaking(userContextId ? { userContextId } : undefined);
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Updating YouTube", userContextId);
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
    route: "youtube",
    ok: true,
    reply: "",
    error: "",
    provider: "",
    model: "",
    toolCalls: ["youtube_home_control"],
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
        10_000,
        "YouTube TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const intent = normalizeYouTubeIntentFallback(text);
    broadcastThinkingStatus("Applying YouTube update", userContextId);
    const hudResult = await runYouTubeDomainService({
      intent,
      ctx,
    });
    let reply = String(intent.response || "Updating YouTube.").trim();
    if (hudResult.ok) {
      const topicLabel = sanitizeYouTubeTopic(hudResult.topic || intent.topic).replace(/-/g, " ");
      reply = hudResult.message || `Switched YouTube to ${topicLabel}.`;
      if (userContextId) {
        broadcast(
          {
            type: "youtube:home:updated",
            topic: sanitizeYouTubeTopic(hudResult.topic || intent.topic),
            commandNonce: Number.isFinite(Number(hudResult.commandNonce)) ? Number(hudResult.commandNonce) : 0,
            preferredSources: Array.isArray(hudResult.preferredSources)
              ? hudResult.preferredSources.map((entry) => sanitizeYouTubeSource(entry)).filter(Boolean).slice(0, 4)
              : [],
            strictTopic: hudResult.strictTopic === true,
            strictSources: hudResult.strictSources === true,
            items: Array.isArray(hudResult.items)
              ? hudResult.items
                .map((entry) => {
                  if (!entry || typeof entry !== "object") return null;
                  const videoId = String(entry.videoId || "").trim();
                  if (!videoId) return null;
                  return {
                    videoId,
                    title: String(entry.title || "").trim(),
                    channelId: String(entry.channelId || "").trim(),
                    channelTitle: String(entry.channelTitle || "").trim(),
                    publishedAt: String(entry.publishedAt || "").trim(),
                    thumbnailUrl: String(entry.thumbnailUrl || "").trim(),
                    description: String(entry.description || "").trim(),
                    score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
                    reason: String(entry.reason || "").trim(),
                  };
                })
                .filter(Boolean)
                .slice(0, 8)
              : [],
            selected: hudResult.selected && typeof hudResult.selected === "object"
              ? {
                  videoId: String(hudResult.selected.videoId || "").trim(),
                  title: String(hudResult.selected.title || "").trim(),
                  channelId: String(hudResult.selected.channelId || "").trim(),
                  channelTitle: String(hudResult.selected.channelTitle || "").trim(),
                  publishedAt: String(hudResult.selected.publishedAt || "").trim(),
                  thumbnailUrl: String(hudResult.selected.thumbnailUrl || "").trim(),
                  description: String(hudResult.selected.description || "").trim(),
                  score: Number.isFinite(Number(hudResult.selected.score)) ? Number(hudResult.selected.score) : 0,
                  reason: String(hudResult.selected.reason || "").trim(),
                }
              : null,
            ts: Date.now(),
          },
          { userContextId },
        );
      }
    } else {
      summary.ok = false;
      summary.error = hudResult.message || "I couldn't update YouTube right now.";
      reply = summary.error;
    }
    summary.reply = await emitAssistantReply(String(reply || "Done.").slice(0, 180));
  } catch (e) {
    summary.ok = false;
    summary.error = String(e instanceof Error ? e.message : describeUnknownError(e));
    summary.reply = await emitAssistantReply("I couldn't update YouTube right now.");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return normalizeWorkerSummary(summary, {
    defaultRoute: "youtube",
    defaultResponseRoute: "youtube",
    defaultProvider: String(summary.provider || ""),
    defaultLatencyMs: Number(summary.latencyMs || 0),
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
