#!/usr/bin/env node

function readArg(name) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return ""
  return process.argv[idx + 1] || ""
}

const integration = readArg("--integration").trim().toLowerCase()
const message = readArg("--message").trim()

if (!integration || !["telegram", "discord"].includes(integration)) {
  console.error('Missing/invalid --integration. Use "telegram" or "discord".')
  process.exit(1)
}

if (!message) {
  console.error('Usage: node scripts/send-notification.mjs --integration "telegram|discord" --message "Your message" [--targets "a,b"]')
  process.exit(1)
}

const targetsRaw = readArg("--targets").trim()
const targets = targetsRaw
  ? targetsRaw.split(",").map((v) => v.trim()).filter(Boolean)
  : []

if (integration === "telegram") {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const envTargets = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  const chatIds = targets.length ? targets : envTargets

  if (!token) {
    console.error("Missing TELEGRAM_BOT_TOKEN")
    process.exit(1)
  }
  if (chatIds.length === 0) {
    console.error('No Telegram targets. Pass --targets "id1,id2" or set TELEGRAM_CHAT_IDS')
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
      return { target: chatId, ok: res.ok, status: res.status }
    }),
  )
  const ok = results.some((r) => r.ok)
  console.log(JSON.stringify({ integration, ok, results }, null, 2))
  process.exit(ok ? 0 : 1)
}

const envTargets = (process.env.DISCORD_WEBHOOK_URLS || process.env.DISCORD_WEBHOOK_URL || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
const webhookUrls = targets.length ? targets : envTargets

if (webhookUrls.length === 0) {
  console.error('No Discord targets. Pass --targets "url1,url2" or set DISCORD_WEBHOOK_URLS')
  process.exit(1)
}

const results = await Promise.all(
  webhookUrls.map(async (webhookUrl) => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    })
    return { target: webhookUrl, ok: res.ok, status: res.status }
  }),
)
const ok = results.some((r) => r.ok)
console.log(JSON.stringify({ integration, ok, results }, null, 2))
process.exit(ok ? 0 : 1)

