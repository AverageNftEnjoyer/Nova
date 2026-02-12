// ===== imports (ESM) =====
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { execSync, exec, spawn } from "child_process";
import OpenAI from "openai";
import { FishAudioClient } from "fish-audio";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import {
  buildSystemPrompt,
  countTokens,
  extractFacts
} from "./memory.js";
import { startMetricsBroadcast, getSystemMetrics } from "./metrics.js";

// ===== __dirname fix =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== load shared .env from project root =====
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const INTEGRATIONS_CONFIG_PATH = path.join(__dirname, "..", "hud", "data", "integrations-config.json");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
const OPENAI_MODEL_PRICING_USD_PER_1M = {
  "gpt-5.2": { input: 1.75, output: 14.0 },
  "gpt-5.2-pro": { input: 12.0, output: 96.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.6, output: 2.4 }
};
const CLAUDE_MODEL_PRICING_USD_PER_1M = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 }
};

const openAiClientCache = new Map();

function loadOpenAIIntegrationRuntime() {
  try {
    const raw = fs.readFileSync(INTEGRATIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const integration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const apiKey = typeof integration.apiKey === "string" && integration.apiKey.trim()
      ? integration.apiKey.trim()
      : "";
    const baseURL = typeof integration.baseUrl === "string" && integration.baseUrl.trim()
      ? integration.baseUrl.trim()
      : DEFAULT_OPENAI_BASE_URL;
    const model = typeof integration.defaultModel === "string" && integration.defaultModel.trim()
      ? integration.defaultModel.trim()
      : DEFAULT_CHAT_MODEL;

    return { apiKey, baseURL, model };
  } catch {
    return { apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL };
  }
}

function loadIntegrationsRuntime() {
  try {
    const raw = fs.readFileSync(INTEGRATIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const openaiIntegration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const claudeIntegration = parsed?.claude && typeof parsed.claude === "object" ? parsed.claude : {};
    const activeProvider = parsed?.activeLlmProvider === "claude" ? "claude" : "openai";
    return {
      activeProvider,
      openai: {
        connected: Boolean(openaiIntegration.connected),
        apiKey: typeof openaiIntegration.apiKey === "string" ? openaiIntegration.apiKey.trim() : "",
        baseURL: typeof openaiIntegration.baseUrl === "string" && openaiIntegration.baseUrl.trim()
          ? openaiIntegration.baseUrl.trim()
          : DEFAULT_OPENAI_BASE_URL,
        model: typeof openaiIntegration.defaultModel === "string" && openaiIntegration.defaultModel.trim()
          ? openaiIntegration.defaultModel.trim()
          : DEFAULT_CHAT_MODEL
      },
      claude: {
        connected: Boolean(claudeIntegration.connected),
        apiKey: typeof claudeIntegration.apiKey === "string" ? claudeIntegration.apiKey.trim() : "",
        baseURL: typeof claudeIntegration.baseUrl === "string" && claudeIntegration.baseUrl.trim()
          ? claudeIntegration.baseUrl.trim().replace(/\/+$/, "")
          : DEFAULT_CLAUDE_BASE_URL,
        model: typeof claudeIntegration.defaultModel === "string" && claudeIntegration.defaultModel.trim()
          ? claudeIntegration.defaultModel.trim()
          : DEFAULT_CLAUDE_MODEL
      }
    };
  } catch {
    return {
      activeProvider: "openai",
      openai: { connected: false, apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL },
      claude: { connected: false, apiKey: "", baseURL: DEFAULT_CLAUDE_BASE_URL, model: DEFAULT_CLAUDE_MODEL }
    };
  }
}

function getActiveChatRuntime(integrations) {
  if (integrations.activeProvider === "claude") {
    return {
      provider: "claude",
      apiKey: integrations.claude.apiKey,
      baseURL: integrations.claude.baseURL,
      model: integrations.claude.model
    };
  }
  return {
    provider: "openai",
    apiKey: integrations.openai.apiKey,
    baseURL: integrations.openai.baseURL,
    model: integrations.openai.model
  };
}

function toClaudeBase(baseURL) {
  const trimmed = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_CLAUDE_BASE_URL;
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

async function claudeMessagesCreate({ apiKey, baseURL, model, system, userText, maxTokens = 300, temperature = 0.75 }) {
  const endpoint = `${toClaudeBase(baseURL)}/v1/messages`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: userText }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Claude request failed (${res.status})`;
    throw new Error(message);
  }
  const text = Array.isArray(data?.content)
    ? data.content.filter((c) => c?.type === "text").map((c) => c?.text || "").join("\n").trim()
    : "";
  return {
    text,
    usage: {
      promptTokens: Number(data?.usage?.input_tokens || 0),
      completionTokens: Number(data?.usage?.output_tokens || 0)
    }
  };
}

function getOpenAIClient(runtime) {
  const key = `${runtime.baseURL}|${runtime.apiKey}`;
  if (openAiClientCache.has(key)) return openAiClientCache.get(key);
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseURL });
  openAiClientCache.set(key, client);
  return client;
}

function resolveModelPricing(model) {
  const exact = OPENAI_MODEL_PRICING_USD_PER_1M[model] || CLAUDE_MODEL_PRICING_USD_PER_1M[model];
  if (exact) return exact;
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 };
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 };
  return null;
}

function estimateTokenCostUsd(model, promptTokens = 0, completionTokens = 0) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}

const fishAudio = new FishAudioClient({
  apiKey: process.env.FISH_API_KEY
});

// ===== reference voices (from .env) =====
const REFERENCE_ID = process.env.REFERENCE_ID;
const PETER_ID = process.env.PETER_ID;
const MORD_ID = process.env.MORD_ID;
const ULTRON_ID = process.env.ULTRON_ID;

// Map voice IDs to Fish Audio reference IDs
const VOICE_MAP = {
  default: REFERENCE_ID,
  peter: PETER_ID,
  mord: MORD_ID,
  ultron: ULTRON_ID,
};

// Current voice preference (updated when HUD sends ttsVoice)
let currentVoice = "default";
// Whether TTS is enabled (updated when HUD sends voiceEnabled setting)
let voiceEnabled = true;
// Whether Nova is muted (stops listening entirely when true)
let muted = false;

// ===== paths =====
const ROOT = __dirname;
const MPV = path.join(ROOT, "mpv", "mpv.exe");
const MIC = path.join(ROOT, "mic.wav");
const THINK_SOUND = path.join(ROOT, "thinking.mp3");

// ===== WebSocket HUD server =====
const wss = new WebSocketServer({ port: 8765 });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

function broadcastState(state) {
  broadcast({ type: "state", state, ts: Date.now() });
}

function broadcastMessage(role, content, source = "hud") {
  broadcast({ type: "message", role, content, source, ts: Date.now() });
}

// ===== handle incoming HUD messages =====
wss.on("connection", (ws) => {
  // Always push one snapshot to new clients so boot UI doesn't miss one-shot telemetry.
  void getSystemMetrics()
    .then((metrics) => {
      if (!metrics || ws.readyState !== 1) return;
      ws.send(JSON.stringify({
        type: "system_metrics",
        metrics,
        ts: Date.now(),
      }));
    })
    .catch(() => {});

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "interrupt") {
        console.log("[HUD] Interrupt received.");
        stopSpeaking();
        return;
      }

      if (data.type === "request_system_metrics") {
        const metrics = await getSystemMetrics();
        if (metrics && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "system_metrics",
            metrics,
            ts: Date.now(),
          }));
        }
        return;
      }

      if (data.type === "greeting") {
        console.log("[HUD] Greeting requested. voiceEnabled:", data.voiceEnabled);
        // Update voice preference if provided
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] Preference updated to:", currentVoice);
        }
        if (!busy) {
          busy = true;
          try {
            const greetingText = data.text || "Hello! What are we working on today?";
            if (data.voiceEnabled !== false) {
              broadcastState("speaking");
              await speak(greetingText, currentVoice);
            } else {
              // Voice disabled - just broadcast text message
              broadcastMessage("assistant", greetingText);
            }
            broadcastState("idle");
          } finally {
            busy = false;
          }
        }
        return;
      }

      if (data.type === "hud_message" && data.content) {
        // Update stored voice preference if provided
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] Preference updated to:", currentVoice);
        }
        console.log("[HUD →]", data.content, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
        stopSpeaking();
        busy = true;
        try {
          await handleInput(data.content, { voice: data.voice !== false, ttsVoice: data.ttsVoice || currentVoice });
        } finally {
          busy = false;
        }
      }

      // Allow HUD to update voice preferences without sending a message
      if (data.type === "set_voice") {
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] TTS voice set to:", currentVoice);
        }
        if (typeof data.voiceEnabled === "boolean") {
          voiceEnabled = data.voiceEnabled;
          console.log("[Voice] Voice responses enabled:", voiceEnabled);
        }
      }

      // Mute/unmute - stops listening entirely
      if (data.type === "set_mute") {
        muted = data.muted === true;
        console.log("[Nova] Muted:", muted);
        broadcastState(muted ? "muted" : "idle");
      }
    } catch (e) {
      console.error("[WS] Bad message from HUD:", e.message);
    }
  });
});

// ===== mic =====
function recordMic(seconds = 3) {
  execSync(
    `sox -t waveaudio -d "${MIC}" trim 0 ${seconds}`,
    { stdio: "ignore" }
  );
}

// ===== STT =====
async function transcribe() {
  const runtime = loadOpenAIIntegrationRuntime();
  const openai = getOpenAIClient(runtime);
  const r = await openai.audio.transcriptions.create({
    file: fs.createReadStream(MIC),
    model: "gpt-4o-transcribe"
  });
  return r.text;
}

// ===== speech control =====
let currentPlayer = null;
let busy = false; // prevents main loop from overriding HUD-driven states

function stopSpeaking() {
  if (currentPlayer) {
    currentPlayer.kill("SIGKILL");
    currentPlayer = null;
    broadcastState("idle");
  }
}

// ===== TTS (long-form safe) =====
async function speak(text, voiceId = "default") {
  const out = path.join(ROOT, `speech_${Date.now()}.mp3`);
  const referenceId = VOICE_MAP[voiceId] || REFERENCE_ID;
  console.log(`[TTS] Using voice: ${voiceId} → ${referenceId}`);

  const audio = await fishAudio.textToSpeech.convert({
    text,
    reference_id: referenceId
  });

  fs.writeFileSync(out, Buffer.from(await new Response(audio).arrayBuffer()));

  broadcastState("speaking");

  currentPlayer = spawn(MPV, [
    out,
    "--no-video",
    "--really-quiet",
    "--keep-open=no"
  ]);

  await new Promise(resolve => {
    currentPlayer.on("exit", resolve);
  });

  currentPlayer = null;
  broadcastState("idle");

  try { fs.unlinkSync(out); } catch {}
}

// ===== thinking sound (chat only) =====
function playThinking() {
  if (!fs.existsSync(THINK_SOUND)) return;
  spawn(MPV, [THINK_SOUND, "--no-video", "--really-quiet", "--keep-open=no"]);
}

// ===== token enforcement =====
const MAX_PROMPT_TOKENS = 600; // identity(300) + working(200) + buffer

function enforceTokenBound(systemPrompt, userMessage) {
  const systemTokens = countTokens(systemPrompt);
  const userTokens = countTokens(userMessage);
  const total = systemTokens + userTokens;

  if (total > MAX_PROMPT_TOKENS) {
    console.warn(`[Token] Prompt exceeds ${MAX_PROMPT_TOKENS} tokens (${total}). Truncating.`);
  }

  return { systemTokens, userTokens, total };
}

// ===== command ACKs =====
const COMMAND_ACKS = [
  "On it.",
  "Right away.",
  "Working on that now."
];

// ===== input handler =====
async function handleInput(text, opts = {}) {
  const integrationsRuntime = loadIntegrationsRuntime();
  const openaiRuntime = integrationsRuntime.openai;
  const activeChatRuntime = getActiveChatRuntime(integrationsRuntime);
  if (!activeChatRuntime.apiKey) {
    throw new Error(`Missing ${activeChatRuntime.provider === "claude" ? "Claude" : "OpenAI"} API key. Configure Integrations first.`);
  }
  const openai = openaiRuntime.apiKey ? getOpenAIClient(openaiRuntime) : null;
  const selectedChatModel = activeChatRuntime.model || (activeChatRuntime.provider === "claude" ? DEFAULT_CLAUDE_MODEL : DEFAULT_CHAT_MODEL);

  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const source = opts.source || "hud";
  const n = text.toLowerCase().trim();

  // ===== ABSOLUTE SHUTDOWN =====
  if (
    n === "nova shutdown" ||
    n === "nova shut down" ||
    n === "shutdown nova"
  ) {
    stopSpeaking();
    await speak(
      "Shutting down now. If you need me again, just restart the system.",
      ttsVoice
    );
    process.exit(0);
  }

  // ===== SPOTIFY =====
  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    stopSpeaking();

    // Ask GPT to extract the Spotify intent
    const spotifySystemPrompt = `You parse Spotify commands. Given user input, respond with ONLY a JSON object:
{
  "action": "open" | "play" | "pause" | "next" | "previous",
  "query": "search query if playing something, otherwise empty string",
  "type": "track" | "artist" | "playlist" | "album" | "genre",
  "response": "short friendly acknowledgment to say to the user"
}
Examples:
- "open spotify" → { "action": "open", "query": "", "type": "track", "response": "Opening Spotify." }
- "play some jazz" → { "action": "play", "query": "jazz", "type": "genre", "response": "Putting on some jazz for you." }
- "play my liked songs on spotify" → { "action": "play", "query": "liked songs", "type": "playlist", "response": "Playing your liked songs." }
- "play Drake" → { "action": "play", "query": "Drake", "type": "artist", "response": "Playing Drake." }
- "play Bohemian Rhapsody" → { "action": "play", "query": "Bohemian Rhapsody", "type": "track", "response": "Playing Bohemian Rhapsody." }
- "play my chill playlist" → { "action": "play", "query": "chill", "type": "playlist", "response": "Playing your chill playlist." }
- "next song" → { "action": "next", "query": "", "type": "track", "response": "Skipping to the next track." }
- "pause the music" → { "action": "pause", "query": "", "type": "track", "response": "Pausing the music." }
Output ONLY valid JSON, nothing else.`
    let spotifyRaw = "";
    if (activeChatRuntime.provider === "claude") {
      const claudeResponse = await claudeMessagesCreate({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: spotifySystemPrompt,
        userText: text,
        maxTokens: 220,
        temperature: 0
      });
      spotifyRaw = claudeResponse.text;
    } else {
      const spotifyParse = await openai.chat.completions.create({
        model: selectedChatModel,
        temperature: 0,
        max_tokens: 150,
        messages: [
          { role: "system", content: spotifySystemPrompt },
          { role: "user", content: text }
        ]
      });
      spotifyRaw = spotifyParse.choices[0].message.content.trim();
    }

    try {
      const intent = JSON.parse(spotifyRaw);

      if (useVoice) await speak(intent.response, ttsVoice);
      else broadcastMessage("assistant", intent.response, source);

      if (intent.action === "open") {
        exec("start spotify:");
      } else if (intent.action === "pause") {
        // Simulate media key press for pause
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
      } else if (intent.action === "next") {
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB0)"');
      } else if (intent.action === "previous") {
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB1)"');
      } else if (intent.action === "play" && intent.query) {
        // Use Spotify URI search to play content
        const encoded = encodeURIComponent(intent.query);
        if (intent.type === "artist") {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        } else if (intent.type === "playlist") {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        } else {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        }
      } else {
        exec("start spotify:");
      }
    } catch (e) {
      console.error("[Spotify] Parse error:", e.message);
      const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
      if (useVoice) await speak(ack, ttsVoice);
      else broadcastMessage("assistant", ack, source);
      exec("start spotify:");
    }

    broadcastState("idle");
    return;
  }

  // ===== CHAT =====
  // One request = one prompt build (no session accumulation)
  broadcastState("thinking");
  broadcastMessage("user", text, source);
  if (useVoice) playThinking();

  // Build fresh system prompt with selective memory injection
  const { prompt: systemPrompt, tokenBreakdown } = buildSystemPrompt({
    includeIdentity: true,
    includeWorkingContext: true
  });

  // Enforce token bounds before model call
  const tokenInfo = enforceTokenBound(systemPrompt, text);
  console.log(`[Memory] Tokens - identity: ${tokenBreakdown.identity}, context: ${tokenBreakdown.working_context}, user: ${tokenInfo.userTokens}`);

  // Build ephemeral messages array (no RAM accumulation)
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text }
  ];

  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;
  if (activeChatRuntime.provider === "claude") {
    const claudeCompletion = await claudeMessagesCreate({
      apiKey: activeChatRuntime.apiKey,
      baseURL: activeChatRuntime.baseURL,
      model: selectedChatModel,
      system: systemPrompt,
      userText: text,
      maxTokens: 250,
      temperature: 0.75
    });
    reply = claudeCompletion.text;
    promptTokens = claudeCompletion.usage.promptTokens;
    completionTokens = claudeCompletion.usage.completionTokens;
  } else {
    const openaiCompletion = await openai.chat.completions.create({
      model: selectedChatModel,
      messages,
      temperature: 0.75,
      max_tokens: 250
    });
    reply = openaiCompletion.choices[0].message.content.trim();
    promptTokens = openaiCompletion.usage?.prompt_tokens || 0;
    completionTokens = openaiCompletion.usage?.completion_tokens || 0;
  }

  const totalTokens = promptTokens + completionTokens;
  const estimatedCostUsd = estimateTokenCostUsd(selectedChatModel, promptTokens, completionTokens);
  console.log(
    `[LLM] provider=${activeChatRuntime.provider} model=${selectedChatModel} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}` +
    `${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`
  );
  broadcast({
    type: "usage",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    ts: Date.now()
  });

  broadcastMessage("assistant", reply, source);

  if (useVoice) {
    await speak(reply, ttsVoice);
  } else {
    broadcastState("idle");
  }

  // Extract facts in the background (don't block) - saves to disk, not RAM
  if (openai) {
    extractFacts(openai, text, reply, selectedChatModel).catch(() => {});
  }
}

// ===== System metrics broadcast =====
startMetricsBroadcast(broadcast, 2000);

// ===== startup delay =====
await new Promise(r => setTimeout(r, 15000));
console.log("Nova online.");
broadcastState("idle");

// ===== main loop (HARD WAKE-WORD GATE) =====
while (true) {
  try {
    // Skip entirely if muted - no listening, no tokens
    if (muted) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Skip voice loop iteration if HUD is driving the conversation
    if (busy) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Check muted again before broadcasting listening state
    if (muted) continue;
    broadcastState("listening");
    recordMic(3);

    // Re-check after recording (HUD message may have arrived during the 3s block)
    if (busy || muted) continue;

    const text = await transcribe();
    if (!text || busy || muted) {
      if (!busy && !muted) broadcastState("idle");
      // Broadcast empty transcript to clear HUD
      if (!busy && !muted) broadcast({ type: "transcript", text: "", ts: Date.now() });
      continue;
    }

    // Broadcast what was heard so the HUD can show it
    broadcast({ type: "transcript", text, ts: Date.now() });

    const normalized = text.toLowerCase();

    if (!normalized.includes("nova")) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }

    // Clear transcript once we start processing
    broadcast({ type: "transcript", text: "", ts: Date.now() });

    stopSpeaking();
    console.log("Heard:", text);
    busy = true;
    try {
      await handleInput(text, { voice: voiceEnabled, ttsVoice: currentVoice, source: "voice" });
    } finally {
      busy = false;
    }

  } catch (e) {
    console.error("Loop error:", e);
    busy = false;
    if (!muted) broadcastState("idle");
  }
}
