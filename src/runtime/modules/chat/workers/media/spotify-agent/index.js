import {
  COMMAND_ACKS,
  OPENAI_REQUEST_TIMEOUT_MS,
  SPOTIFY_INTENT_MAX_TOKENS,
} from "../../../../../core/constants/index.js";
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
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../../../llm/providers/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";
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
} from "./runtime-utils/index.js";
import { runSpotifyViaHudApi } from "../../shared/integration-api-bridge/index.js";
import { runDirectSpotifyNowPlaying } from "./direct-now-playing/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

const SPOTIFY_MIN_THINKING_MS = 650;

export async function handleSpotifyWorker(text, ctx, llmCtx) {
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
    sessionKey: sessionKey || "",
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

  const spotifySystemPrompt = `You are a Spotify command parser. Given user input, respond with ONLY a valid JSON object - no markdown, no explanation.

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
  "response": "short TTS-friendly confirmation under 14 words - be natural and enthusiastic"
}

CRITICAL RULES:
- "play [artist/song/album name]" MUST use action="play" with the name as query. NEVER use play_recommended for named artists/songs/albums.
- play_recommended is ONLY for vague mood-based requests with no specific artist or track, e.g. "play something chill", "play me something upbeat".
- "play some music" or "play music" with no specifics -> action="play_smart" (uses user's favorite playlist or liked songs).
- For seek, convert human time like "1:30" to positionMs (90000).
- For "skip forward 30s", positionMs=-1 for relative forward, query="30".
- For "rewind 15s", positionMs=-2 for relative backward, query="15".
- For volume "louder"/"quieter" use volumePercent=75 or 30.
- The "response" field must be warm, natural, and varied. Don't always say "Playing X." - use variations like "You got it, putting on X." or "Great choice, playing X now." or "On it!".

Examples:
- "pause" -> { "action": "pause", "query": "", "response": "Paused." }
- "play Dark Side of the Moon" -> { "action": "play", "query": "Dark Side of the Moon", "type": "album", "response": "Great choice - putting on Dark Side of the Moon." }
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
    broadcastThinkingStatus("Parsing Spotify command", userContextId);
    const fastIntent = normalizeSpotifyIntentFallback(text);
    const needsLlm = fastIntent.action === "play" || fastIntent.action === "open";
    let intent = null;
    if (!needsLlm) {
      intent = fastIntent;
    } else {
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

    const action = normalizeSpotifyAction(intent?.action);
    const rawQuery = String(intent?.query || "").replace(/[\r\n]/g, " ").trim().slice(0, 200);
    const rawResponse = String(intent?.response || "").replace(/[\r\n]/g, " ").trim().slice(0, 120);
    const safePositionMs = Number.isFinite(Number(intent?.positionMs)) ? Math.max(-2, Number(intent.positionMs)) : undefined;
    const safeVolumePercent = Number.isFinite(Number(intent?.volumePercent)) ? Math.max(0, Math.min(100, Math.round(Number(intent.volumePercent)))) : undefined;
    const safeShuffleOn = intent?.shuffleOn != null ? Boolean(intent.shuffleOn) : undefined;
    const safeRepeatMode = ["off", "track", "context"].includes(String(intent?.repeatMode)) ? String(intent.repeatMode) : undefined;
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
    const hudResult = action === "now_playing" && !String(ctx?.supabaseAccessToken || "").trim()
      ? await runDirectSpotifyNowPlaying(userContextId)
      : await runSpotifyViaHudApi(action, sanitizedIntent, ctx);
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
        summary.error = hudResult.code === "spotify.unauthorized"
          ? "I need your authenticated Nova session for that Spotify command. Sign in and retry."
          : "I need your connected Spotify account for that command. Reconnect Spotify and retry.";
        reply = summary.error;
      } else if (
        action === "now_playing"
        && (hudResult.code === "spotify.token_missing" || hudResult.code === "spotify.not_connected")
      ) {
        summary.ok = false;
        summary.error = hudResult.message || "Reconnect Spotify and retry.";
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

    const thinkingElapsedMs = Date.now() - startedAt;
    if (thinkingElapsedMs < SPOTIFY_MIN_THINKING_MS) {
      await new Promise((resolve) => setTimeout(resolve, SPOTIFY_MIN_THINKING_MS - thinkingElapsedMs));
    }

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
  return normalizeWorkerSummary(summary, {
    fallbackRoute: "spotify",
    fallbackResponseRoute: "spotify",
    fallbackProvider: String(activeChatRuntime?.provider || ""),
    fallbackLatencyMs: Number(summary.latencyMs || 0),
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(sessionKey || ""),
  });
}
