import { exec } from "child_process";

const VALID_SPOTIFY_ACTIONS = new Set([
  "open", "play", "pause", "next", "previous",
  "now_playing", "play_liked", "play_smart", "seek", "restart",
  "volume", "shuffle", "repeat",
  "queue", "like", "unlike",
  "list_devices", "transfer",
  "play_recommended", "save_playlist", "set_favorite_playlist", "clear_favorite_playlist", "add_to_playlist",
]);

export function normalizeSpotifyAction(action) {
  const normalized = String(action || "").trim().toLowerCase();
  return VALID_SPOTIFY_ACTIONS.has(normalized) ? normalized : "open";
}

export function normalizeSpotifyIntentFallback(text) {
  const input = String(text || "").trim().toLowerCase();
  const setPlaylistToQueryMatch = input.match(
    /\b(?:change|set|switch|update|make)\s+(?:my\s+)?(?:spotify\s+)?(?:favorite\s+)?playlist\s+(?:to|as|called)\s+(.+)$/i,
  );
  if (setPlaylistToQueryMatch?.[1]) {
    const query = String(setPlaylistToQueryMatch[1]).trim().replace(/\s+playlist$/i, "").trim();
    if (query) return { action: "set_favorite_playlist", query, response: `Saved ${query} as your favorite playlist.` };
  }
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
  if (/\bplay\b.*\b(my\s+)?(favorite|saved|default)\s+playlist\b/i.test(input)) {
    return { action: "play_smart", query: "", response: "Playing your favorite playlist." };
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
    const match = input.match(/\brepeat (off|track|song|playlist|context)\b/i);
    const raw = (match?.[1] || "off").toLowerCase();
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
  if (/\bplay\b.*\b(random|any)\b.*\b(from|off|on)\b.*\b(my\s+)?(favorite|saved|default)\s+playlist\b/i.test(input)) {
    return { action: "play_smart", query: "", response: "Playing from your favorite playlist." };
  }
  if (/\bplay\s+(some\s+)?music\b/i.test(input) && !/\bplay\s+\w+\s+music\b/i.test(input)) {
    return { action: "play_smart", query: "", response: "Putting on some music for you." };
  }
  if (/\b(play|put on)\b/i.test(input)) {
    return { action: "play", query: "", response: "Playing Spotify." };
  }
  return { action: "open", query: "", response: "Opening Spotify." };
}

export function runDesktopSpotifyAction(action, query) {
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

export function buildDesktopSpotifyFallbackReply(action) {
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

export function isDeviceUnavailableError(errorCode) {
  const code = String(errorCode || "").trim().toLowerCase();
  return code === "spotify.device_unavailable";
}

const SPOTIFY_LAUNCH_REPLIES = [
  "Launching Spotify now - what would you like to hear?",
  "Opening Spotify for you. Tell me what to play.",
  "Spotify is starting up - let me know what you want to hear.",
  "Launching Spotify now. What should I put on?",
  "Spotify is opening. What are we listening to?",
];

const SPOTIFY_PLAY_CONFIRMATIONS = [
  "Absolutely, playing QUERY now.",
  "You got it - playing QUERY.",
  "On it, putting on QUERY.",
  "Playing QUERY for you.",
  "QUERY coming right up.",
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SPOTIFY_TTS_DEDUPE_WINDOW_MS = 12_000;
const spotifyLastSpokenByUser = new Map();

export function shouldSuppressSpotifyTts(userContextId, replyText) {
  const userKey = String(userContextId || "").trim().toLowerCase();
  if (!userKey) return false;
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

export function buildSpotifyLaunchReply() {
  return pickRandom(SPOTIFY_LAUNCH_REPLIES);
}

export function buildSpotifyPlayConfirmation(query) {
  if (!query) return "Playing now.";
  return pickRandom(SPOTIFY_PLAY_CONFIRMATIONS).replace(/QUERY/g, query);
}

export function shouldFallbackToDesktopSpotify(errorCode) {
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
