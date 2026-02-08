import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildSystemPrompt,
  countTokens,
  extractFacts
} from "./memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_PATH = path.join(__dirname, "..", "telegram_history.json");

// Load chat history from disk
function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { messages: [] };
  }
}

// Save message to history
function saveMessage(msg) {
  const history = loadHistory();
  history.messages.push(msg);
  // Keep last 100 messages
  if (history.messages.length > 100) {
    history.messages = history.messages.slice(-100);
  }
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// Get recent messages for sync
export function getTelegramHistory(limit = 50) {
  const history = loadHistory();
  return history.messages.slice(-limit);
}

// Token enforcement
const MAX_PROMPT_TOKENS = 600;

function enforceTokenBound(systemPrompt, userMessage) {
  const systemTokens = countTokens(systemPrompt);
  const userTokens = countTokens(userMessage);
  const total = systemTokens + userTokens;

  if (total > MAX_PROMPT_TOKENS) {
    console.warn(`[Telegram] Prompt exceeds ${MAX_PROMPT_TOKENS} tokens (${total})`);
  }

  return { systemTokens, userTokens, total };
}

/**
 * Initialize and start the Telegram bot.
 * @param {Function} broadcast - WebSocket broadcast function from agent.js
 * @param {Object} openai - OpenAI client instance from agent.js
 */
export function startTelegramBot(broadcast, openai) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error("[Telegram] No TELEGRAM_BOT_TOKEN in .env - bot disabled");
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  console.log("[Telegram] Bot starting...");

  bot.on("polling_error", (err) => {
    console.error("[Telegram] Polling error:", err.message);
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Skip if it's a command (handled separately)
    if (text.startsWith("/")) return;

    console.log(`[Telegram] ${msg.from.first_name}: ${text}`);

    const userMsg = {
      type: "message",
      role: "user",
      content: text,
      source: "telegram",
      sender: msg.from.first_name || "User",
      ts: Date.now()
    };

    // Save to history and broadcast to HUD
    saveMessage(userMsg);
    broadcast(userMsg);

    // Show typing indicator
    bot.sendChatAction(chatId, "typing");

    try {
      // Build fresh system prompt with memory
      const { prompt: systemPrompt, tokenBreakdown } = buildSystemPrompt({
        includeIdentity: true,
        includeWorkingContext: true
      });

      // Enforce token bounds
      const tokenInfo = enforceTokenBound(systemPrompt, text);
      console.log(`[Telegram] Tokens - identity: ${tokenBreakdown.identity}, context: ${tokenBreakdown.working_context}, user: ${tokenInfo.userTokens}`);

      // Build ephemeral messages (no RAM accumulation)
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages,
        temperature: 0.75,
        max_tokens: 500
      });

      const reply = completion.choices[0].message.content.trim();

      // Send reply to Telegram
      await bot.sendMessage(chatId, reply);

      const assistantMsg = {
        type: "message",
        role: "assistant",
        content: reply,
        source: "telegram",
        ts: Date.now()
      };

      // Save to history and broadcast to HUD
      saveMessage(assistantMsg);
      broadcast(assistantMsg);

      // Extract facts in background (saves to disk)
      extractFacts(openai, text, reply).catch(() => {});

      console.log(`[Telegram] Nova: ${reply.substring(0, 50)}...`);

    } catch (error) {
      console.error("[Telegram] Error:", error.message);
      await bot.sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
    }
  });

  // Handle /start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Hey! I'm Nova. You can message me anytime and I'll remember important things about our conversations.");
  });

  // Handle /memory command - show current memory
  bot.onText(/\/memory/, async (msg) => {
    const chatId = msg.chat.id;
    const { prompt, tokenBreakdown } = buildSystemPrompt({
      includeIdentity: false,
      includeWorkingContext: true
    });

    const response = prompt
      ? `Current memory (${tokenBreakdown.working_context} tokens):\n\n${prompt}`
      : "No memory stored yet.";

    await bot.sendMessage(chatId, response);
  });

  console.log("[Telegram] Bot ready and listening");

  return bot;
}
