import fs from "fs";
import path from "path";
import { exec } from "child_process";
import crypto from "crypto";
import {
  COMMAND_ACKS,
  OPENAI_REQUEST_TIMEOUT_MS,
  SPOTIFY_INTENT_MAX_TOKENS,
} from "../../../core/constants.js";
import { sessionRuntime } from "../../infrastructure/config.js";
import { resolvePersonaWorkspaceDir, appendRawStream } from "../../context/persona-context.js";
import { captureUserPreferencesFromMessage } from "../../context/user-preferences.js";
import { recordIdentityMemoryUpdate } from "../../context/identity/engine.js";
import { extractMemoryUpdateFact, buildMemoryFactMetadata, upsertMemoryFactInMarkdown, ensureMemoryTemplate } from "../../context/memory.js";
import { shouldDraftOnlyWorkflow } from "../routing/intent-router.js";
import { speak, stopSpeaking } from "../../audio/voice.js";
import {
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../infrastructure/hud-gateway.js";
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../llm/providers.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../quality/reply-normalizer.js";

const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const WORKFLOW_BUILD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WORKFLOW_BUILD_TIMEOUT_MS || "45000", 10);
const RUNTIME_SHARED_TOKEN = String(process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim();
const RUNTIME_SHARED_TOKEN_HEADER = String(process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token")
  .trim()
  .toLowerCase() || "x-nova-runtime-token";

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

const VALID_SPOTIFY_ACTIONS = new Set([
  "open", "play", "pause", "next", "previous",
  "now_playing", "play_liked", "play_smart", "seek", "restart",
  "volume", "shuffle", "repeat",
  "queue", "like", "unlike",
  "list_devices", "transfer",
  "play_recommended", "save_playlist", "set_favorite_playlist", "clear_favorite_playlist", "add_to_playlist",
]);

function normalizeSpotifyAction(action) {
  const normalized = String(action || "").trim().toLowerCase();
  return VALID_SPOTIFY_ACTIONS.has(normalized) ? normalized : "open";
}

function normalizeSpotifyIntentFallback(text) {
  const input = String(text || "").trim().toLowerCase();
  const switchToQueryMatch = input.match(/\b(?:switch|change)\s+(?:the\s+)?(?:song|track|music)\s+(?:to|into)\s+(.+)$/i);
  if (switchToQueryMatch?.[1]) {
    const query = String(switchToQueryMatch[1]).trim();
    if (query) return { action: "play", query, response: `Switching to ${query}.` };
  }
  const switchArtistQueryMatch = input.match(/\b(?:switch|change)\s+to\s+(.+\s+by\s+.+)$/i);
  if (switchArtistQueryMatch?.[1]) {
    const query = String(switchArtistQueryMatch[1]).trim();
    if (query) return { action: "play", query, response: `Switching to ${query}.` };
  }
  if (/\b(now playing|what.*playing|what am i listening|what'?s playing|what song.*playing|song is this.*playing|song.*playing currently)\b/i.test(input)) {
    return { action: "now_playing", query: "", response: "Checking what's playing on Spotify." };
  }
  if (/\b(you(?:'| a)?re|your)\s+the\s+one\s+playing\s+it\b/i.test(input)) {
    return { action: "now_playing", query: "", response: "Checking what's playing now." };
  }
  if (/\bplay\b.*\b(i like|from my liked|my liked songs?|my favorites?|one of my favorites?)\b/i.test(input)) {
    return { action: "play_liked", query: "", response: "Playing something you like from Spotify." };
  }
  if (/\b(previous|go back|last song|prev)\b/i.test(input)) {
    return { action: "previous", query: "", response: "Going back to the previous track." };
  }
  if (/\b(next|skip)\b/i.test(input)) {
    return { action: "next", query: "", response: "Skipping to the next track." };
  }
  if (/\b(restart|replay|start over|from the beginning)\b/i.test(input) || (/\bretreat\b/i.test(input) && /\b(song|track|music)\b/i.test(input))) {
    return { action: "restart", query: "", response: "Restarting the track." };
  }
  if (/\b(resume|continue|unpause)\b/i.test(input)) {
    return { action: "play", query: "", response: "Resuming Spotify playback." };
  }
  if (/\b(pause|stop music|stop song)\b/i.test(input)) {
    return { action: "pause", query: "", response: "Pausing Spotify." };
  }
  if (/\bshuffle (on|off)\b/i.test(input)) {
    const on = /\bshuffle on\b/i.test(input);
    return { action: "shuffle", query: "", shuffleOn: on, response: on ? "Shuffle on." : "Shuffle off." };
  }
  if (/\brepeat (off|track|song|playlist|context)\b/i.test(input)) {
    const m = input.match(/\brepeat (off|track|song|playlist|context)\b/i);
    const raw = (m?.[1] || "off").toLowerCase();
    const mode = raw === "song" ? "track" : raw === "playlist" ? "context" : raw;
    return { action: "repeat", query: "", repeatMode: mode, response: `Repeat ${mode}.` };
  }
  if (/\blike (this|the song|current|it)\b|\blike this song\b/i.test(input)) {
    return { action: "like", query: "", response: "Liking this track." };
  }
  if (/\bunlike|remove.*liked\b/i.test(input)) {
    return { action: "unlike", query: "", response: "Removing from liked songs." };
  }
  if (/\b(list|show|what) (devices?|available)\b/i.test(input)) {
    return { action: "list_devices", query: "", response: "Fetching your Spotify devices." };
  }
  const setFavoriteNamedMatch = input.match(/\b(?:my\s+favorite\s+playlist\s+is(?:\s+called)?|set\s+(?:my\s+)?favorite\s+playlist\s+to|make)\s+(.+)$/i);
  if (setFavoriteNamedMatch?.[1]) {
    const query = String(setFavoriteNamedMatch[1]).trim().replace(/\s+playlist$/i, "").trim();
    if (query) return { action: "set_favorite_playlist", query, response: `Saved ${query} as your favorite playlist.` };
  }
  if (/\b(?:clear|remove|unset|forget)\s+(?:my\s+)?favorite\s+playlist\b/i.test(input) || /\bunfavorite\s+(?:my\s+)?playlist\b/i.test(input)) {
    return { action: "clear_favorite_playlist", query: "", response: "Cleared your favorite playlist." };
  }
  if (/\b(favorite|save|remember|bookmark)\s+(this\s+)?(playlist|album|this music)\b/i.test(input) && !/\bsong\b|\btrack\b|\bto\s+(my|a)\s+playlist\b/i.test(input)) {
    return { action: "save_playlist", query: "", response: "Saving this as your favorite playlist." };
  }
  const addToPlaylistNamedMatch = input.match(/\badd\s+(?:this|current|this song|this track|song|track)?\s*(?:to|into)\s+(?:my\s+)?playlist\s+(.+)$/i);
  if (addToPlaylistNamedMatch?.[1]) {
    const query = String(addToPlaylistNamedMatch[1]).trim();
    if (query) return { action: "add_to_playlist", query, response: `Adding this track to ${query}.` };
  }
  if (/\badd\s+(?:this|current|this song|this track|song|track)\s+(?:to|into)\s+(?:my\s+)?playlist\b/i.test(input)) {
    return { action: "add_to_playlist", query: "", response: "Adding this track to your favorite playlist." };
  }
  if (/\bplay\s+(my\s+)?(favorite|saved|default)\s+(playlist|music|songs?)\b/i.test(input)) {
    return { action: "play_smart", query: "", response: "Playing your favorite playlist." };
  }
  if (/\bplay\s+(some\s+)?music\b/i.test(input) && !/\bplay\s+\w+\s+music\b/i.test(input)) {
    return { action: "play_smart", query: "", response: "Putting on some music for you." };
  }
  if (/\b(play|put on)\b/i.test(input)) {
    return { action: "play", query: "", response: "Playing Spotify." };
  }
  return { action: "open", query: "", response: "Opening Spotify." };
}

function runDesktopSpotifyAction(action, query) {
  const run = (command) => {
    try {
      exec(command, (error) => {
        if (error) {
          console.warn("[Spotify] Desktop fallback command failed:", error?.message || error);
        }
      });
    } catch (error) {
      console.warn("[Spotify] Desktop fallback command threw:", error?.message || error);
    }
  };
  if (action === "open") {
    run("start spotify:");
    return;
  }
  if (action === "pause") {
    run('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
    return;
  }
  if (action === "next") {
    run('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB0)"');
    return;
  }
  if (action === "previous") {
    run('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB1)"');
    return;
  }
  if (action === "play" && query) {
    const encoded = encodeURIComponent(query);
    run(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
    return;
  }
  if (action === "play") {
    run('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
    return;
  }
  run("start spotify:");
}

function buildDesktopSpotifyFallbackReply(action) {
  if (action === "now_playing") {
    return "I opened Spotify, but I need Spotify OAuth connected to read your current track.";
  }
  if (action === "play_liked") {
    return "I opened Spotify. Connect Spotify in Integrations and I can play from your Liked Songs directly.";
  }
  if (action === "pause") return "Paused Spotify using desktop media controls.";
  if (action === "next") return "Skipped to the next track using desktop controls.";
  if (action === "previous") return "Went back to the previous track using desktop controls.";
  if (action === "play") return "Playing Spotify using desktop controls.";
  return "Opening Spotify.";
}

function isDeviceUnavailableError(errorCode) {
  const code = String(errorCode || "").trim().toLowerCase();
  return code === "spotify.device_unavailable";
}

const SPOTIFY_LAUNCH_REPLIES = [
  "Launching Spotify now — what would you like to hear?",
  "Opening Spotify for you. Just tell me what to play!",
  "Spotify is starting up — let me know what you'd like to listen to.",
  "Absolutely, launching Spotify now. What should I put on?",
  "On it — Spotify is opening. What are we listening to?",
];

const SPOTIFY_PLAY_CONFIRMATIONS = [
  "Absolutely, playing QUERY now.",
  "You got it — playing QUERY.",
  "On it, putting on QUERY.",
  "Playing QUERY for you.",
  "QUERY coming right up.",
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SPOTIFY_TTS_DEDUPE_WINDOW_MS = 12_000;
const SPOTIFY_MIN_THINKING_MS = 650;
const spotifyLastSpokenByUser = new Map();

function shouldSuppressSpotifyTts(userContextId, replyText) {
  const userKey = String(userContextId || "").trim().toLowerCase() || "anonymous";
  const normalizedReply = String(replyText || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalizedReply) return false;
  const now = Date.now();
  const existing = spotifyLastSpokenByUser.get(userKey);
  if (existing && existing.reply === normalizedReply && now - Number(existing.ts || 0) <= SPOTIFY_TTS_DEDUPE_WINDOW_MS) {
    return true;
  }
  spotifyLastSpokenByUser.set(userKey, { reply: normalizedReply, ts: now });
  if (spotifyLastSpokenByUser.size > 500) {
    for (const [key, value] of spotifyLastSpokenByUser.entries()) {
      if (now - Number(value?.ts || 0) > SPOTIFY_TTS_DEDUPE_WINDOW_MS * 4) {
        spotifyLastSpokenByUser.delete(key);
      }
    }
  }
  return false;
}

function buildSpotifyLaunchReply() {
  return pickRandom(SPOTIFY_LAUNCH_REPLIES);
}

function buildSpotifyPlayConfirmation(query) {
  if (!query) return "Playing now.";
  return pickRandom(SPOTIFY_PLAY_CONFIRMATIONS).replace(/QUERY/g, query);
}

function shouldFallbackToDesktopSpotify(errorCode) {
  const code = String(errorCode || "").trim().toLowerCase();
  return (
    code === "spotify.not_connected"
    || code === "spotify.device_unavailable"
    || code === "spotify.not_found"
    || code === "spotify.token_missing"
    || code === "spotify.unauthorized"
    || code === "spotify.forbidden"
    || code === "spotify.internal"
    || code === "spotify.transient"
    || code === "spotify.network"
    || code === "spotify.timeout"
    || code === "spotify.cancelled"
  );
}

async function runSpotifyViaHudApi(action, intent, ctx) {
  const token = String(ctx?.supabaseAccessToken || "").trim();
  const normalizedUserContextId = String(ctx?.userContextId || "").trim();
  if (!token || !normalizedUserContextId || action === "open") {
    return { attempted: false, ok: false, message: "", code: "", fallbackRecommended: true };
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (RUNTIME_SHARED_TOKEN) headers[RUNTIME_SHARED_TOKEN_HEADER] = RUNTIME_SHARED_TOKEN;
  const body = {
    action,
    query: String(intent?.query || "").trim(),
    userContextId: normalizedUserContextId,
  };
  if (intent?.type) body.type = intent.type;
  if (intent?.positionMs != null) body.positionMs = Number(intent.positionMs);
  if (intent?.volumePercent != null) body.volumePercent = Number(intent.volumePercent);
  if (intent?.shuffleOn != null) body.shuffleOn = Boolean(intent.shuffleOn);
  if (intent?.repeatMode) body.repeatMode = String(intent.repeatMode);
  if (intent?.deviceId) body.deviceId = String(intent.deviceId);
  if (intent?.deviceName) body.deviceName = String(intent.deviceName);
  try {
    const res = await fetch(`${HUD_API_BASE_URL}/api/integrations/spotify/playback`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) {
      return {
        attempted: true,
        ok: true,
        message: String(data?.message || "").trim(),
        code: "",
        fallbackRecommended: data?.fallbackRecommended === true,
        nowPlaying: data?.nowPlaying || null,
      };
    }
    return {
      attempted: true,
      ok: false,
      message: String(data?.error || "").trim() || `Spotify playback request failed (${res.status}).`,
      code: String(data?.code || "").trim(),
      fallbackRecommended: data?.fallbackRecommended === true,
      nowPlaying: data?.nowPlaying || null,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      message: describeUnknownError(err),
      code: "spotify.network",
      fallbackRecommended: true,
    };
  }
}

// ===== Spotify sub-handler =====
export async function handleSpotify(text, ctx, llmCtx) {
  const { source, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel } = llmCtx;
  stopSpeaking();
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Controlling Spotify", userContextId);
  broadcastMessage("user", ctx.raw_text || text, source, conversationId, userContextId);
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
    if (useVoice && !shouldSuppressSpotifyTts(userContextId, normalized.text)) {
      await withTimeout(
        speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice),
        12_000,
        "Spotify TTS",
      ).catch(() => {});
    }
    return normalized.text;
  }

  const spotifySystemPrompt = `You are a Spotify command parser. Given user input, respond with ONLY a valid JSON object — no markdown, no explanation.

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
  "response": "short TTS-friendly confirmation under 14 words — be natural and enthusiastic"
}

CRITICAL RULES:
- "play [artist/song/album name]" MUST use action="play" with the name as query. NEVER use play_recommended for named artists/songs/albums.
- play_recommended is ONLY for vague mood-based requests with no specific artist or track, e.g. "play something chill", "play me something upbeat".
- "play some music" or "play music" with no specifics -> action="play_smart" (uses user's favorite playlist or liked songs).
- For seek, convert human time like "1:30" to positionMs (90000).
- For "skip forward 30s", positionMs=-1 for relative forward, query="30".
- For "rewind 15s", positionMs=-2 for relative backward, query="15".
- For volume "louder"/"quieter" use volumePercent=75 or 30.
- The "response" field must be warm, natural, and varied. Don't always say "Playing X." — use variations like "You got it, putting on X." or "Great choice, playing X now." or "On it!".

Examples:
- "pause" -> { "action": "pause", "query": "", "response": "Paused." }
- "play Dark Side of the Moon" -> { "action": "play", "query": "Dark Side of the Moon", "type": "album", "response": "Great choice — putting on Dark Side of the Moon." }
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
    // Fast path: skip LLM for unambiguous commands — saves 300–800ms on pause/next/prev etc.
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
      if (
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
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), Math.max(5000, WORKFLOW_BUILD_TIMEOUT_MS));
    const headers = { "Content-Type": "application/json" };
    headers["X-Idempotency-Key"] = buildMissionBuildIdempotencyKey({
      userContextId,
      conversationId,
      prompt: text,
      deploy,
    });
    if (String(supabaseAccessToken || "").trim()) {
      headers.Authorization = `Bearer ${String(supabaseAccessToken).trim()}`;
    }
    if (RUNTIME_SHARED_TOKEN) {
      headers[RUNTIME_SHARED_TOKEN_HEADER] = RUNTIME_SHARED_TOKEN;
    }
    const res = await fetch(`${HUD_API_BASE_URL}/api/missions/build`, {
      method: "POST",
      headers,
      signal: abortController.signal,
      body: JSON.stringify({ prompt: text, deploy, engine }),
    }).finally(() => clearTimeout(timeoutId));
    const data = await res.json().catch(() => ({}));
    if (res.status === 202 && data?.pending) {
      const retryAfterMs = Number(data?.retryAfterMs || 0);
      const retryAfterNote = retryAfterMs > 0
        ? ` I will keep this in progress and you can retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
        : "";
      const pendingReply = `I'm already building that mission for you.${retryAfterNote}`;
      const normalizedPending = normalizeAssistantReply(pendingReply);
      summary.reply = normalizedPending.skip ? "" : normalizedPending.text;
      summary.ok = true;
      if (!normalizedPending.skip) {
        broadcastMessage("assistant", normalizedPending.text, source, conversationId, userContextId);
        if (useVoice) await speak(normalizeAssistantSpeechText(normalizedPending.text) || normalizedPending.text, ttsVoice);
      }
      return summary;
    }
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Workflow build failed (${res.status}).`);

    const label = data?.workflow?.label || "Generated Workflow";
    const provider = data?.provider || "LLM";
    const model = data?.model || "default model";
    const stepCount = Array.isArray(data?.workflow?.summary?.workflowSteps) ? data.workflow.summary.workflowSteps.length : 0;
    const scheduleTime = data?.workflow?.summary?.schedule?.time || "09:00";
    const scheduleTimezone = data?.workflow?.summary?.schedule?.timezone || "America/New_York";

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
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source, conversationId, userContextId);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
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
    const normalizedReply = normalizeAssistantReply(reply);
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source, conversationId, userContextId);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}
