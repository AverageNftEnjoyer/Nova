#!/usr/bin/env node

const args = process.argv.slice(2)

function readArg(flag, fallback = "") {
  const index = args.indexOf(flag)
  if (index < 0) return fallback
  return args[index + 1] ?? fallback
}

const message = readArg("--message") || readArg("-m")
const chatIdsRaw = readArg("--chatIds") || process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || ""
const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN")
  process.exit(1)
}

if (!message.trim()) {
  console.error("Usage: node scripts/send-telegram-notification.mjs --message \"Your message\" [--chatIds \"id1,id2\"]")
  process.exit(1)
}

const chatIds = chatIdsRaw
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)

if (chatIds.length === 0) {
  console.error("No chat IDs provided. Set TELEGRAM_CHAT_IDS or pass --chatIds")
  process.exit(1)
}

const endpoint = `https://api.telegram.org/bot${token}/sendMessage`

const results = await Promise.all(
  chatIds.map(async (chatId) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    })

    const body = await res.json().catch(() => undefined)
    return {
      chatId,
      ok: res.ok,
      status: res.status,
      body,
    }
  }),
)

console.log(JSON.stringify({ ok: results.some((r) => r.ok), results }, null, 2))
