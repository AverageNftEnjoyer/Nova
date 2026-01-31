// ===== imports (ESM) =====
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { execSync, exec, spawn } from "child_process";
import OpenAI from "openai";
import { FishAudioClient } from "fish-audio";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { loadMemory, extractFacts } from "./memory.js";

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
  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "interrupt") {
        console.log("[HUD] Interrupt received.");
        stopSpeaking();
        return;
      }

      if (data.type === "hud_message" && data.content) {
        console.log("[HUD →]", data.content);
        stopSpeaking();
        await handleInput(data.content, { voice: data.voice !== false });
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

// ===== conversation memory =====
function buildSystemPrompt() {
  const facts = loadMemory();
  let prompt =
    "Your name is Nova. You are articulate, expressive, and natural. You may speak in long, well-structured sentences when appropriate. Maintain a confident assistant tone.";

  if (facts.length > 0) {
    prompt += `\n\nYou remember these things about the user:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
  }

  return prompt;
}

const messages = [
  { role: "system", content: buildSystemPrompt() }
];

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
  broadcastState("thinking");
  broadcastMessage("user", text);
  if (useVoice) playThinking();

  messages.push({ role: "user", content: text });

  // Refresh system prompt with latest memory
  messages[0].content = buildSystemPrompt();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    temperature: 0.75,
    max_tokens: 250
  });

  const reply = completion.choices[0].message.content.trim();
  messages.push({ role: "assistant", content: reply });

  broadcastMessage("assistant", reply);

  if (useVoice) {
    await speak(reply);
  } else {
    broadcastState("idle");
  }

  // Extract facts in the background (don't block)
  extractFacts(openai, text, reply).catch(() => {});

  if (messages.length > 18) {
    messages.splice(1, messages.length - 12);
  }
}

// ===== startup delay =====
await new Promise(r => setTimeout(r, 15000));
console.log("Nova online.");
broadcastState("idle");

// ===== main loop (HARD WAKE-WORD GATE) =====
while (true) {
  try {
    broadcastState("listening");
    recordMic(3);

    const text = await transcribe();
    if (!text) {
      broadcastState("idle");
      continue;
    }

    const normalized = text.toLowerCase();

    if (!normalized.includes("nova")) {
      broadcastState("idle");
      continue;
    }

    stopSpeaking();
    console.log("Heard:", text);
    await handleInput(text);

  } catch (e) {
    console.error("Loop error:", e);
    broadcastState("idle");
  }
}
