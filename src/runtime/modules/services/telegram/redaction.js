const TELEGRAM_BOT_TOKEN_SEGMENT_REGEX = /\/bot([0-9]{6,}:[A-Za-z0-9_-]{20,})/gi;

export function redactTelegramBotToken(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "telegram:bot-token:redacted";
  const [botId = "", secret = ""] = raw.split(":");
  if (!botId || !secret) return "telegram:bot-token:redacted";
  const suffix = secret.slice(-4);
  return `telegram:bot-token:${botId}:***${suffix || ""}`;
}

export function redactTelegramSecrets(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  return raw.replace(TELEGRAM_BOT_TOKEN_SEGMENT_REGEX, (_match, token) => `/bot${redactTelegramBotToken(token)}`);
}
