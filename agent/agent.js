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
import { startTelegramBot, getTelegramHistory } from "./telegram.js";
import { startMetricsBroadcast } from "./metrics.js";

// ===== __dirname fix =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== load shared .env from project root =====
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ===== clients =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const fishAudio = new FishAudioClient({
  apiKey: process.env.FISH_API_KEY
});

// ===== reference voice (from .env) =====
const REFERENCE_ID = process.env.REFERENCE_ID;

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

function broadcastMessage(role, content) {
  broadcast({ type: "message", role, content, ts: Date.now() });
}

// ===== handle incoming HUD messages =====
wss.on("connection", (ws) => {
  // Send Telegram history on connect
  try {
    const history = getTelegramHistory(50);
    if (history.length > 0) {
      ws.send(JSON.stringify({ type: "history_sync", messages: history }));
    }
  } catch (e) {
    console.error("[WS] Failed to send history:", e.message);
  }

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "interrupt") {
        console.log("[HUD] Interrupt received.");
        stopSpeaking();
        return;
      }

      if (data.type === "greeting") {
        console.log("[HUD] Greeting requested.");
        if (!busy) {
          busy = true;
          try {
            broadcastState("speaking");
            await speak(data.text || "Hello! What are we working on today?");
            broadcastState("idle");
          } finally {
            busy = false;
          }
        }
        return;
      }

      if (data.type === "hud_message" && data.content) {
        console.log("[HUD →]", data.content);
        stopSpeaking();
        busy = true;
        try {
          await handleInput(data.content, { voice: data.voice !== false });
        } finally {
          busy = false;
        }
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
async function speak(text) {
  const out = path.join(ROOT, `speech_${Date.now()}.mp3`);

  const audio = await fishAudio.textToSpeech.convert({
    text,
    reference_id: REFERENCE_ID
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
  const useVoice = opts.voice !== false;
  const n = text.toLowerCase().trim();

  // ===== ABSOLUTE SHUTDOWN =====
  if (
    n === "nova shutdown" ||
    n === "nova shut down" ||
    n === "shutdown nova"
  ) {
    stopSpeaking();
    await speak(
      "Shutting down now. If you need me again, just restart the system."
    );
    process.exit(0);
  }

  // ===== PARTY MODE =====
  if (n.includes("party time") || n.includes("party mode")) {
    stopSpeaking();
    broadcast({ type: "party", ts: Date.now() });
    if (useVoice) await speak("Let's go!");
    else broadcastMessage("assistant", "Let's go!");
    broadcastState("idle");
    return;
  }

  // ===== SPOTIFY =====
  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    stopSpeaking();

    // Ask GPT to extract the Spotify intent
    const spotifyParse = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content: `You parse Spotify commands. Given user input, respond with ONLY a JSON object:
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
        },
        { role: "user", content: text }
      ]
    });

    try {
      const intent = JSON.parse(spotifyParse.choices[0].message.content.trim());

      if (useVoice) await speak(intent.response);
      else broadcastMessage("assistant", intent.response);

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
      if (useVoice) await speak(ack);
      else broadcastMessage("assistant", ack);
      exec("start spotify:");
    }

    broadcastState("idle");
    return;
  }

  // ===== CHAT =====
  // One request = one prompt build (no session accumulation)
  broadcastState("thinking");
  broadcastMessage("user", text);
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

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    temperature: 0.75,
    max_tokens: 250
  });

  const reply = completion.choices[0].message.content.trim();

  broadcastMessage("assistant", reply);

  if (useVoice) {
    await speak(reply);
  } else {
    broadcastState("idle");
  }

  // Extract facts in the background (don't block) - saves to disk, not RAM
  extractFacts(openai, text, reply).catch(() => {});
}

// ===== Telegram bot =====
startTelegramBot(broadcast, openai);

// ===== System metrics broadcast =====
startMetricsBroadcast(broadcast, 1500);

// ===== startup delay =====
await new Promise(r => setTimeout(r, 15000));
console.log("Nova online.");
broadcastState("idle");

// ===== main loop (HARD WAKE-WORD GATE) =====
while (true) {
  try {
    // Skip voice loop iteration if HUD is driving the conversation
    if (busy) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    broadcastState("listening");
    recordMic(3);

    // Re-check after recording (HUD message may have arrived during the 3s block)
    if (busy) continue;

    const text = await transcribe();
    if (!text || busy) {
      if (!busy) broadcastState("idle");
      // Broadcast empty transcript to clear HUD
      if (!busy) broadcast({ type: "transcript", text: "", ts: Date.now() });
      continue;
    }

    // Broadcast what was heard so the HUD can show it
    broadcast({ type: "transcript", text, ts: Date.now() });

    const normalized = text.toLowerCase();

    if (!normalized.includes("nova")) {
      if (!busy) broadcastState("idle");
      continue;
    }

    // Clear transcript once we start processing
    broadcast({ type: "transcript", text: "", ts: Date.now() });

    stopSpeaking();
    console.log("Heard:", text);
    busy = true;
    try {
      await handleInput(text);
    } finally {
      busy = false;
    }

  } catch (e) {
    console.error("Loop error:", e);
    busy = false;
    broadcastState("idle");
  }
}
