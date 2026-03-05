import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  COMMAND_ACKS,
  OPENAI_REQUEST_TIMEOUT_MS,
  SPOTIFY_INTENT_MAX_TOKENS,
} from "../../../../core/constants/index.js";
import { sessionRuntime } from "../../../infrastructure/config/index.js";
import { resolvePersonaWorkspaceDir, appendRawStream } from "../../../context/persona-context/index.js";
import { captureUserPreferencesFromMessage } from "../../../context/user-preferences/index.js";
import { recordIdentityMemoryUpdate } from "../../../context/identity/engine/index.js";
import { extractMemoryUpdateFact, buildMemoryFactMetadata, upsertMemoryFactInMarkdown, ensureMemoryTemplate } from "../../../../../memory/runtime-compat/index.js";
import { shouldDraftOnlyWorkflow } from "../../routing/intent-router/index.js";
import { speak, stopSpeaking } from "../../../audio/voice/index.js";
import {
  broadcast,
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../../infrastructure/hud-gateway/index.js";
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../../llm/providers/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../quality/reply-normalizer/index.js";
import {
  normalizeSpotifyAction,
  normalizeSpotifyIntentFallback,
  runDesktopSpotifyAction,
  buildDesktopSpotifyFallbackReply,
  isDeviceUnavailableError,
  shouldSuppressSpotifyTts,
  buildSpotifyLaunchReply,
  buildSpotifyPlayConfirmation,
  shouldFallbackToDesktopSpotify,
} from "./spotify-runtime-utils/index.js";
import {
  sanitizeYouTubeTopic,
  sanitizeYouTubeSource,
  normalizeYouTubeIntentFallback,
} from "./youtube-intent-utils/index.js";
import {
  runSpotifyViaHudApi,
  runYouTubeHomeControlViaHudApi,
  runMissionBuildViaHudApi,
} from "./integration-api-bridge/index.js";

function buildMissionBuildIdempotencyKey({ userContextId, conversationId, prompt, deploy }) {
  const payload = JSON.stringify({
    userContextId: String(userContextId || "").trim().toLowerCase(),
    conversationId: String(conversationId || "").trim().toLowerCase(),
    deploy: deploy !== false,
    prompt: String(prompt || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 1200),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

export async function sendDirectAssistantReply(userText, replyText, ctx, thinkingStatus = "Confirming mission") {
  const { source, sender, sessionId, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const normalizedReply = normalizeAssistantReply(replyText);
  if (normalizedReply.skip) {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    return "";
  }

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus(thinkingStatus, userContextId);
  broadcastMessage("user", userText, source, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "user", userText, { source, sender: sender || null });

  const streamId = createAssistantStreamId();
  broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDelta(streamId, normalizedReply.text, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", normalizedReply.text, { source, sender: "nova" });

  try {
    if (useVoice) {
      await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
  }
  return normalizedReply.text;
}

// ===== Memory update sub-handler =====
export async function handleMemoryUpdate(text, ctx) {
  const { source, sender, sessionId, useVoice, ttsVoice, userContextId, conversationId } = ctx;
  const fact = extractMemoryUpdateFact(text);
  const assistantStreamId = createAssistantStreamId();
  const summary = {
    route: "memory_update",
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

  function sendAssistantReply(reply) {
    const normalized = normalizeAssistantReply(reply);
    if (normalized.skip) return "";
    broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDelta(assistantStreamId, normalized.text, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    return normalized.text;
  }

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Updating memory", userContextId);
  broadcastMessage("user", text, source, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "user", text, { source, sender: sender || null });

  if (!fact) {
    const reply = "Tell me exactly what to remember after 'update your memory'.";
    const finalReply = sendAssistantReply(reply);
    summary.reply = finalReply;
    if (finalReply && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalReply, { source, sender: "nova" });
    try {
      if (finalReply && useVoice) await speak(normalizeAssistantSpeechText(finalReply) || finalReply, ttsVoice);
    } finally {
      broadcastState("idle", userContextId);
    }
    summary.latencyMs = Date.now() - startedAt;
    return summary;
  }

  try {
    const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
    const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
    const existingContent = fs.existsSync(memoryFilePath) ? fs.readFileSync(memoryFilePath, "utf8") : ensureMemoryTemplate();
    const memoryMeta = buildMemoryFactMetadata(fact);
    const updatedContent = upsertMemoryFactInMarkdown(existingContent, memoryMeta.fact, memoryMeta.key);
    fs.writeFileSync(memoryFilePath, updatedContent, "utf8");
    const preferenceCapture = captureUserPreferencesFromMessage({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      userInputText: memoryMeta.fact,
      nlpConfidence: 1,
      source: "memory_update",
      sessionKey: ctx.sessionKey || "",
    });
    if (Array.isArray(preferenceCapture?.updatedKeys) && preferenceCapture.updatedKeys.length > 0) {
      console.log(
        `[Preference] Updated ${preferenceCapture.updatedKeys.length} field(s) for ${userContextId || "anonymous"} during memory update.`,
      );
    }
    recordIdentityMemoryUpdate({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      memoryFact: memoryMeta.fact,
      conversationId,
      sessionKey: ctx.sessionKey || "",
      source: source || "hud",
    });
    const confirmation = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;
    const finalConfirmation = sendAssistantReply(confirmation);
    summary.reply = finalConfirmation;
    if (finalConfirmation && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalConfirmation, { source, sender: "nova" });
    appendRawStream({
      event: "memory_manual_upsert",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: userContextId || undefined,
      key: memoryMeta.key || null,
    });
    console.log(`[Memory] Manual memory update applied for ${userContextId || "anonymous"} key=${memoryMeta.key || "general"}.`);
    if (finalConfirmation && useVoice) await speak(normalizeAssistantSpeechText(finalConfirmation) || finalConfirmation, ttsVoice);
  } catch (err) {
    const failure = `I couldn't update MEMORY.md: ${describeUnknownError(err)}`;
    const finalFailure = sendAssistantReply(failure);
    summary.ok = false;
    summary.error = String(err instanceof Error ? err.message : describeUnknownError(err));
    summary.reply = finalFailure;
    if (finalFailure && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalFailure, { source, sender: "nova" });
    try {
      if (finalFailure && useVoice) await speak(normalizeAssistantSpeechText(finalFailure) || finalFailure, ttsVoice);
    } catch {}
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}

// ===== Shutdown sub-handler =====
export async function handleShutdown(ctx) {
  const { ttsVoice } = ctx;
  stopSpeaking();
  await speak("Shutting down now. If you need me again, just restart the system.", ttsVoice);
  process.exit(0);
}

const SPOTIFY_MIN_THINKING_MS = 650;

// ===== YouTube sub-handler =====
export async function handleYouTube(text, ctx) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  stopSpeaking();
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
        speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice),
        10_000,
        "YouTube TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  try {
    const intent = normalizeYouTubeIntentFallback(text);
    broadcastThinkingStatus("Applying YouTube update", userContextId);
    const hudResult = await runYouTubeHomeControlViaHudApi(intent, ctx);
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
  return summary;
}

// ===== Spotify sub-handler =====
export async function handleSpotify(text, ctx, llmCtx) {
  const { source, sender, sessionId, sessionKey, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel } = llmCtx;
  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Controlling Spotify", userContextId);
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
    route: "spotify",
    ok: true,
    reply: "",
    error: "",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
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
  let assistantStreamStarted = false;

  const ensureSpotifyAssistantStreamStarted = () => {
    if (assistantStreamStarted) return;
    broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);
    assistantStreamStarted = true;
  };

  async function emitSpotifyAssistantReply(replyText) {
    const normalized = normalizeAssistantReply(String(replyText || ""));
    if (normalized.skip) {
      if (assistantStreamStarted) {
        broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
        assistantStreamStarted = false;
      }
      return "";
    }
    ensureSpotifyAssistantStreamStarted();
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
    if (useVoice && !shouldSuppressSpotifyTts(userContextId, normalized.text)) {
      await withTimeout(
        speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice),
        12_000,
        "Spotify TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  const spotifySystemPrompt = `You are a Spotify command parser. Given user input, respond with ONLY a valid JSON object â€” no markdown, no explanation.

Schema:
{
  "action": one of: "open"|"play"|"pause"|"next"|"previous"|"now_playing"|"play_liked"|"play_smart"|"seek"|"restart"|"volume"|"shuffle"|"repeat"|"queue"|"like"|"unlike"|"list_devices"|"transfer"|"play_recommended"|"save_playlist"|"set_favorite_playlist"|"clear_favorite_playlist"|"add_to_playlist",
  "query": "search string if needed, else empty string",
  "type": "track"|"artist"|"album"|"playlist"|"genre" (only when action=play or queue),
  "positionMs": integer milliseconds (only when action=seek),
  "volumePercent": integer 0-100 (only when action=volume),
  "shuffleOn": true|false (only when action=shuffle),
  "repeatMode": "off"|"track"|"context" (only when action=repeat),
  "deviceName": "device name string" (only when action=transfer),
  "response": "short TTS-friendly confirmation under 14 words â€” be natural and enthusiastic"
}

CRITICAL RULES:
- "play [artist/song/album name]" MUST use action="play" with the name as query. NEVER use play_recommended for named artists/songs/albums.
- play_recommended is ONLY for vague mood-based requests with no specific artist or track, e.g. "play something chill", "play me something upbeat".
- "play some music" or "play music" with no specifics -> action="play_smart" (uses user's favorite playlist or liked songs).
- For seek, convert human time like "1:30" to positionMs (90000).
- For "skip forward 30s", positionMs=-1 for relative forward, query="30".
- For "rewind 15s", positionMs=-2 for relative backward, query="15".
- For volume "louder"/"quieter" use volumePercent=75 or 30.
- The "response" field must be warm, natural, and varied. Don't always say "Playing X." â€” use variations like "You got it, putting on X." or "Great choice, playing X now." or "On it!".

Examples:
- "pause" -> { "action": "pause", "query": "", "response": "Paused." }
- "play Dark Side of the Moon" -> { "action": "play", "query": "Dark Side of the Moon", "type": "album", "response": "Great choice â€” putting on Dark Side of the Moon." }
- "play Kanye West" -> { "action": "play", "query": "Kanye West", "type": "artist", "response": "Playing Kanye West for you." }
- "play Bohemian Rhapsody" -> { "action": "play", "query": "Bohemian Rhapsody", "type": "track", "response": "Bohemian Rhapsody, coming right up." }
- "play something chill" -> { "action": "play_recommended", "query": "chill", "response": "Finding something chill for you." }
- "play some music" -> { "action": "play_smart", "query": "", "response": "Putting on some music for you." }
- "play music" -> { "action": "play_smart", "query": "", "response": "On it, starting your music." }
- "set volume to 60" -> { "action": "volume", "query": "", "volumePercent": 60, "response": "Volume set to 60%." }
- "shuffle on" -> { "action": "shuffle", "query": "", "shuffleOn": true, "response": "Shuffle is on." }
- "repeat this song" -> { "action": "repeat", "query": "", "repeatMode": "track", "response": "Repeating this track." }
- "queue Bohemian Rhapsody" -> { "action": "queue", "query": "Bohemian Rhapsody", "type": "track", "response": "Added to queue." }
- "like this" -> { "action": "like", "query": "", "response": "Liked." }
- "play on my phone" -> { "action": "transfer", "query": "", "deviceName": "phone", "response": "Transferring to your phone." }
- "go to 2 minutes" -> { "action": "seek", "query": "", "positionMs": 120000, "response": "Jumping to 2 minutes." }
- "restart the song" -> { "action": "restart", "query": "", "response": "Starting over." }
- "save this playlist as my favorite" -> { "action": "save_playlist", "query": "", "response": "Saved as your favorite playlist." }
- "my favorite playlist is called <playlist name>" -> { "action": "set_favorite_playlist", "query": "<playlist name>", "response": "Saved your favorite playlist." }
- "clear my favorite playlist" -> { "action": "clear_favorite_playlist", "query": "", "response": "Cleared your favorite playlist." }
- "add this to playlist <playlist name>" -> { "action": "add_to_playlist", "query": "<playlist name>", "response": "Adding this track to that playlist." }
- "play my favorite playlist" -> { "action": "play_smart", "query": "", "response": "Playing your favorite playlist." }
Rules for save_playlist: saves the currently playing playlist as the user's favorite for the smart play button.
Rules for play_smart: plays the user's saved favorite playlist, or falls back to liked songs if none saved.
Output ONLY valid JSON, nothing else.`;

  let spotifyRaw = "";

  try {
    ensureSpotifyAssistantStreamStarted();
    // Fast path: skip LLM for unambiguous commands â€” saves 300â€“800ms on pause/next/prev etc.
    broadcastThinkingStatus("Parsing Spotify command", userContextId);
    const fastIntent = normalizeSpotifyIntentFallback(text);
    const needsLlm = fastIntent.action === "play" || fastIntent.action === "open";
    let intent = null;
    if (!needsLlm) {
      intent = fastIntent;
    } else {
      // LLM needed: play (query), seek (time), volume, transfer, queue, play_recommended, etc.
      try {
        if (activeChatRuntime.provider === "claude") {
          const r = await withTimeout(
            claudeMessagesCreate({
              apiKey: activeChatRuntime.apiKey,
              baseURL: activeChatRuntime.baseURL,
              model: selectedChatModel,
              system: spotifySystemPrompt,
              userText: text,
              maxTokens: SPOTIFY_INTENT_MAX_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            "Claude Spotify parse",
          );
          spotifyRaw = r.text;
        } else {
          const parse = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: selectedChatModel,
              messages: [{ role: "system", content: spotifySystemPrompt }, { role: "user", content: text }],
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            "OpenAI Spotify parse",
          );
          spotifyRaw = extractOpenAIChatText(parse);
        }
        intent = JSON.parse(spotifyRaw);
      } catch {
        intent = fastIntent;
      }
    }

    // --- Sanitize and clamp all LLM-sourced fields before use ---
    const action = normalizeSpotifyAction(intent?.action);
    // query: strip, cap at 200 chars, no newlines
    const rawQuery = String(intent?.query || "").replace(/[\r\n]/g, " ").trim().slice(0, 200);
    // response: strip, cap at 120 chars for TTS safety
    const rawResponse = String(intent?.response || "").replace(/[\r\n]/g, " ").trim().slice(0, 120);
    // numeric fields: clamp to valid ranges
    const safePositionMs = Number.isFinite(Number(intent?.positionMs)) ? Math.max(-2, Number(intent.positionMs)) : undefined;
    const safeVolumePercent = Number.isFinite(Number(intent?.volumePercent)) ? Math.max(0, Math.min(100, Math.round(Number(intent.volumePercent)))) : undefined;
    const safeShuffleOn = intent?.shuffleOn != null ? Boolean(intent.shuffleOn) : undefined;
    const safeRepeatMode = ["off", "track", "context"].includes(String(intent?.repeatMode)) ? String(intent.repeatMode) : undefined;
    // deviceName: strip, cap at 80 chars
    const safeDeviceName = intent?.deviceName ? String(intent.deviceName).replace(/[\r\n]/g, " ").trim().slice(0, 80) : undefined;
    const safeType = ["track", "artist", "album", "playlist", "genre"].includes(String(intent?.type)) ? String(intent.type) : undefined;

    const sanitizedIntent = {
      query: rawQuery,
      type: safeType,
      positionMs: safePositionMs,
      volumePercent: safeVolumePercent,
      shuffleOn: safeShuffleOn,
      repeatMode: safeRepeatMode,
      deviceName: safeDeviceName,
    };

    let reply = rawResponse;
    const requiresVerifiedSpotifyApiAction = new Set([
      "set_favorite_playlist",
      "clear_favorite_playlist",
      "save_playlist",
      "add_to_playlist",
      "play_smart",
      "play_liked",
      "now_playing",
      "list_devices",
      "transfer",
      "like",
      "unlike",
      "queue",
    ]);
    broadcastThinkingStatus("Applying Spotify command", userContextId);
    const hudResult = await runSpotifyViaHudApi(action, sanitizedIntent, ctx);
      const intentQuery = rawQuery;

    if (hudResult.ok) {
      if (hudResult.fallbackRecommended === true) {
        runDesktopSpotifyAction(action, intentQuery);
      }
      if (action === "play" && intentQuery && hudResult.message) {
        reply = buildSpotifyPlayConfirmation(intentQuery);
      } else if (action === "now_playing" && hudResult?.nowPlaying?.playing) {
        const base = hudResult.message || "Now playing.";
        reply = `${base} Want me to add this track to a playlist?`;
      } else {
        reply = hudResult.message || reply || "Done.";
      }
    } else {
      if (!hudResult.attempted && requiresVerifiedSpotifyApiAction.has(action)) {
        summary.ok = false;
        summary.error = "I need your connected Spotify account for that command. Reconnect Spotify and retry.";
        reply = summary.error;
      } else if (
        (hudResult.code === "spotify.not_found" || hudResult.code === "spotify.forbidden")
        && (action === "play" || action === "set_favorite_playlist" || action === "clear_favorite_playlist" || action === "add_to_playlist")
      ) {
        summary.ok = false;
        summary.error = hudResult.message || "Could not verify an exact Spotify match.";
        reply = summary.error;
      } else {
      const shouldFallback = !hudResult.attempted || shouldFallbackToDesktopSpotify(hudResult.code);
      if (shouldFallback) {
        runDesktopSpotifyAction(action, intentQuery);
        if (isDeviceUnavailableError(hudResult.code) && intentQuery) {
          reply = buildSpotifyPlayConfirmation(intentQuery);
        } else if (isDeviceUnavailableError(hudResult.code)) {
          reply = buildSpotifyLaunchReply();
        } else {
          reply = reply || buildDesktopSpotifyFallbackReply(action);
          if (hudResult.message) reply = `${reply} ${hudResult.message}`.trim();
        }
      } else {
        summary.ok = false;
        summary.error = hudResult.message || "Spotify playback failed.";
        reply = reply || summary.error;
      }
      }
    }

    // Keep thinking visible briefly so HUD orb/status has time to animate.
    const thinkingElapsedMs = Date.now() - startedAt;
    if (thinkingElapsedMs < SPOTIFY_MIN_THINKING_MS) {
      await new Promise((resolve) => setTimeout(resolve, SPOTIFY_MIN_THINKING_MS - thinkingElapsedMs));
    }

    // Final TTS safety: cap spoken reply at 120 chars
    broadcastThinkingStatus("Finalizing Spotify response", userContextId);
    const safeReply = String(reply || "Done.").replace(/[\r\n]/g, " ").trim().slice(0, 120);
    summary.reply = await emitSpotifyAssistantReply(safeReply);
  } catch (e) {
    console.error("[Spotify] Handler error:", e?.message || e);
    summary.ok = false;
    summary.error = String(e instanceof Error ? e.message : describeUnknownError(e));
    const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
    summary.reply = await emitSpotifyAssistantReply(ack);
    runDesktopSpotifyAction("open", "");
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}
// ===== Workflow builder sub-handler =====
export async function handleWorkflowBuild(text, ctx, options = {}) {
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
      }),
    });
    const responseStatus = Number(missionBuildResult?.status || 0);
    const data = missionBuildResult?.data || {};
    if (responseStatus === 202 && data?.pending) {
      const retryAfterMs = Number(data?.retryAfterMs || 0);
      const retryAfterNote = retryAfterMs > 0
        ? ` I will keep this in progress and you can retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
        : "";
      const pendingReply = `I'm already building that mission for you.${retryAfterNote}`;
      summary.reply = await emitWorkflowAssistantReply(pendingReply);
      summary.ok = true;
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

    const label = data?.missionSummary?.label || data?.mission?.label || "Generated Workflow";
    const provider = data?.provider || "LLM";
    const model = data?.model || "default model";
    const stepCount = Number.isFinite(Number(data?.missionSummary?.nodeCount))
      ? Number(data.missionSummary.nodeCount)
      : (Array.isArray(data?.mission?.nodes) ? data.mission.nodes.length : 0);
    const scheduleTime = data?.missionSummary?.schedule?.time || "09:00";
    const scheduleTimezone = data?.missionSummary?.schedule?.timezone || "America/New_York";

    const reply = data?.deployed
      ? `Built and deployed "${label}" with ${stepCount} workflow steps. It is scheduled for ${scheduleTime} ${scheduleTimezone}. Generated using ${provider} ${model}. Open the Missions page to review or edit it.`
      : `Built a workflow draft "${label}" with ${stepCount} steps. It's ready for review and not deployed yet. Generated using ${provider} ${model}. Open the Missions page to review or edit it.`;
    const normalizedReply = normalizeAssistantReply(reply);
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    summary.provider = String(provider || "");
    summary.model = String(model || "");

    appendRawStream({
      event: "workflow_build_done",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deployed: Boolean(data?.deployed),
      provider,
      model,
      stepCount,
    });
    if (!normalizedReply.skip) summary.reply = await emitWorkflowAssistantReply(normalizedReply.text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workflow build failed.";
    summary.ok = false;
    summary.error = msg;
    appendRawStream({
      event: "workflow_build_error",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      message: msg,
    });
    const isUnauthorized = /\bunauthorized\b/i.test(msg);
    const reply = isUnauthorized
      ? "I could not build that workflow because your session is not authorized for missions yet. Re-open Nova, sign in again, then retry and I will continue from your latest prompt."
      : `I couldn't build that workflow yet: ${msg}`;
    summary.reply = await emitWorkflowAssistantReply(reply);
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}



