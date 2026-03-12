// ===== Voice System =====
// TTS, STT, mic capture, audio playback, and all shared voice/busy state.
// Bug Fix 1: STT model is now configurable via NOVA_STT_MODEL (default: whisper-1).
// Bug Fix 3: Shared mutable state is owned here with explicit get/set accessors.

import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "url";
import { FishAudioClient } from "fish-audio";
import {
  MPV_PATH,
  THINK_SOUND_PATH,
  VOICE_AFTER_TTS_SUPPRESS_MS,
  STT_MODEL,
} from "../../../core/constants/index.js";
import { loadOpenAIIntegrationRuntime, getOpenAIClient } from "../../llm/providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

let fishAudioClient = null;
function getFishAudioClient() {
  const apiKey = String(process.env.FISH_API_KEY || "").trim();
  if (!apiKey) return null;
  if (fishAudioClient) return fishAudioClient;
  try {
    fishAudioClient = new FishAudioClient({ apiKey });
  } catch {
    fishAudioClient = null;
  }
  return fishAudioClient;
}

const REFERENCE_ID = process.env.REFERENCE_ID;
const PETER_ID = process.env.PETER_ID;
const MORD_ID = process.env.MORD_ID;
const ULTRON_ID = process.env.ULTRON_ID;

export const VOICE_MAP = {
  default: REFERENCE_ID,
  peter: PETER_ID,
  mord: MORD_ID,
  ultron: ULTRON_ID,
};

function normalizeUserContextId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function createVoiceRuntimeState() {
  return {
    busy: false,
    currentVoice: "default",
    voiceEnabled: false,
    muted: true,
    suppressVoiceWakeUntilMs: 0,
    currentPlayer: null,
  };
}

const GLOBAL_VOICE_RUNTIME_KEY = "__global__";
const _voiceRuntimeStateByUser = new Map();
const _voiceRuntimeContext = new AsyncLocalStorage();

// Injected broadcast function to break hud-gateway circular dep
let _broadcastState = () => {};
let _resolveVoiceBroadcastUserContextId = () => "";
export function initVoiceBroadcast(fn, resolveUserContextId = null) {
  _broadcastState = typeof fn === "function" ? fn : () => {};
  _resolveVoiceBroadcastUserContextId =
    typeof resolveUserContextId === "function" ? resolveUserContextId : () => "";
}

function resolveVoiceBroadcastUserContextId() {
  try {
    return normalizeUserContextId(_resolveVoiceBroadcastUserContextId());
  } catch {
    return "";
  }
}

export function withVoiceRuntimeContext(userContextId = "", fn) {
  if (typeof fn !== "function") {
    throw new Error("withVoiceRuntimeContext requires a function");
  }
  return _voiceRuntimeContext.run(
    { userContextId: normalizeUserContextId(userContextId) },
    fn,
  );
}

function resolveContextualUserContextId() {
  try {
    return normalizeUserContextId(_voiceRuntimeContext.getStore()?.userContextId || "");
  } catch {
    return "";
  }
}

function resolveVoiceEventUserContextId(options = {}) {
  const explicit = normalizeUserContextId(options?.userContextId || "");
  return explicit || resolveContextualUserContextId() || resolveVoiceBroadcastUserContextId();
}

function resolveVoiceRuntimeStateKey(userContextId = "") {
  return normalizeUserContextId(userContextId) || GLOBAL_VOICE_RUNTIME_KEY;
}

function getVoiceRuntimeState(options = {}) {
  const stateKey = resolveVoiceRuntimeStateKey(resolveVoiceEventUserContextId(options));
  if (!_voiceRuntimeStateByUser.has(stateKey)) {
    _voiceRuntimeStateByUser.set(stateKey, createVoiceRuntimeState());
  }
  return _voiceRuntimeStateByUser.get(stateKey);
}

export function getBusy(options = {}) { return getVoiceRuntimeState(options).busy; }
export function setBusy(val, options = {}) { getVoiceRuntimeState(options).busy = Boolean(val); }

export function getCurrentVoice(options = {}) { return getVoiceRuntimeState(options).currentVoice; }
export function setCurrentVoice(v, options = {}) {
  getVoiceRuntimeState(options).currentVoice = String(v || "default");
}

export function getVoiceEnabled(options = {}) { return getVoiceRuntimeState(options).voiceEnabled; }
export function setVoiceEnabled(v, options = {}) {
  getVoiceRuntimeState(options).voiceEnabled = Boolean(v);
}

export function getMuted(options = {}) { return getVoiceRuntimeState(options).muted; }
export function setMuted(v, options = {}) { getVoiceRuntimeState(options).muted = Boolean(v); }

export function getSuppressVoiceWakeUntilMs(options = {}) {
  return getVoiceRuntimeState(options).suppressVoiceWakeUntilMs;
}
export function setSuppressVoiceWakeUntilMs(v, options = {}) {
  getVoiceRuntimeState(options).suppressVoiceWakeUntilMs = Number(v) || 0;
}

// ===== Mic capture =====
export function createMicCapturePath() {
  return path.join(ROOT, `mic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
}

export function cleanupAudioArtifacts() {
  try {
    const entries = fs.readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^speech_\d+\.mp3$/i.test(entry.name) && !/^mic_[a-z0-9_-]+\.wav$/i.test(entry.name)) continue;
      try { fs.unlinkSync(path.join(ROOT, entry.name)); } catch {}
    }
  } catch {}
}

export function recordMic(outFile, seconds = 3) {
  const safeSeconds = Math.max(1, Math.min(8, Number.isFinite(seconds) ? seconds : 3));
  const result = spawnSync("sox", ["-t", "waveaudio", "-d", outFile, "trim", "0", String(safeSeconds)], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Mic capture failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Mic capture failed with exit code ${String(result.status)}`);
  }
}

// ===== STT (Bug Fix 1: configurable model via NOVA_STT_MODEL env var) =====
export async function transcribe(micFile, wakeWordHint = "nova", userContextId = "") {
  const scopedUserLabel = String(userContextId || "").trim() || "missing-user-context";
  const runtime = loadOpenAIIntegrationRuntime({ userContextId });
  if (!runtime?.apiKey) {
    throw new Error(`Voice STT blocked: missing scoped OpenAI key for userContextId=${scopedUserLabel}`);
  }
  const openai = getOpenAIClient(runtime);
  const normalizedWake = String(wakeWordHint || "nova")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "nova";
  const displayWake = normalizedWake.charAt(0).toUpperCase() + normalizedWake.slice(1);
  const r = await openai.audio.transcriptions.create({
    file: fs.createReadStream(micFile),
    model: STT_MODEL,
    prompt: `The wake word is ${displayWake}. Prioritize correctly transcribing '${displayWake}' if spoken.`,
  });
  return r.text;
}

// ===== Playback control =====
export function stopSpeaking(options = {}) {
  const state = getVoiceRuntimeState(options);
  if (state.currentPlayer) {
    state.currentPlayer.kill("SIGKILL");
    state.currentPlayer = null;
    _broadcastState("idle", resolveVoiceEventUserContextId(options));
  }
}

function normalizeTtsText(input) {
  let text = String(input || "");
  if (!text) return "";

  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

export async function speak(text, voiceId = "default", options = {}) {
  const fishAudio = getFishAudioClient();
  if (!fishAudio) {
    throw new Error("Voice TTS unavailable: missing or invalid FISH_API_KEY.");
  }
  const out = path.join(ROOT, `speech_${Date.now()}.mp3`);
  const referenceId = VOICE_MAP[voiceId] || REFERENCE_ID;
  const normalizedText = normalizeTtsText(text) || String(text || "");
  console.log(`[TTS] Using voice: ${voiceId} -> ${referenceId}`);

  const audio = await fishAudio.textToSpeech.convert({ text: normalizedText, reference_id: referenceId });

  // Stream audio to mpv stdin for immediate playback while writing to disk for cleanup.
  const eventUserContextId = resolveVoiceEventUserContextId(options);
  const state = getVoiceRuntimeState({ userContextId: eventUserContextId });
  _broadcastState("speaking", eventUserContextId);
  const player = spawn(MPV_PATH, ["-", "--no-video", "--really-quiet", "--keep-open=no"], { stdio: ["pipe", "ignore", "ignore"] });
  state.currentPlayer = player;

  const writeStream = fs.createWriteStream(out);
  const reader = audio instanceof ReadableStream
    ? audio.getReader()
    : null;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(value);
        if (player.stdin?.writable) player.stdin.write(chunk);
        writeStream.write(chunk);
      }
    } catch (streamErr) {
      console.error("[TTS] Stream error:", streamErr?.message || streamErr);
    } finally {
      if (player.stdin?.writable) player.stdin.end();
      writeStream.end();
    }
  } else {
    const buf = Buffer.from(await new Response(audio).arrayBuffer());
    if (player.stdin?.writable) {
      player.stdin.write(buf);
      player.stdin.end();
    }
    writeStream.end(buf);
  }

  await new Promise((resolve) => { player.on("exit", resolve); });

  if (state.currentPlayer === player) state.currentPlayer = null;
  _broadcastState("idle", eventUserContextId);
  state.suppressVoiceWakeUntilMs = Date.now() + Math.max(0, VOICE_AFTER_TTS_SUPPRESS_MS);

  try { fs.unlinkSync(out); } catch {}
}

export function playThinking() {
  if (!fs.existsSync(THINK_SOUND_PATH)) return;
  spawn(MPV_PATH, [THINK_SOUND_PATH, "--no-video", "--really-quiet", "--keep-open=no"]);
}

// ===== Tone helpers =====
export function normalizeRuntimeTone(rawTone) {
  const normalized = String(rawTone || "").trim().toLowerCase();
  if (normalized === "enthusiastic") return "enthusiastic";
  if (normalized === "calm") return "calm";
  if (normalized === "direct") return "direct";
  if (normalized === "relaxed") return "relaxed";
  return "neutral";
}

export function runtimeToneDirective(tone) {
  if (tone === "enthusiastic") return "Use energetic, upbeat wording while preserving precision and factual clarity.";
  if (tone === "calm") return "Use calm, steady language and measured pacing; keep responses reassuring and clear.";
  if (tone === "direct") return "Use concise, action-first responses with minimal filler and explicit next steps.";
  if (tone === "relaxed") return "Use relaxed, easygoing phrasing that stays practical, clear, and not rushed.";
  return "Use balanced, neutral language that is concise, practical, and professional.";
}
