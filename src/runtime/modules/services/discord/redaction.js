const DISCORD_WEBHOOK_PATTERN = /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/gi;

export function redactWebhookTarget(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "discord:webhook:unknown";
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = String(parts[2] || "").trim();
    if (!id) return "discord:webhook:redacted";
    const prefix = id.slice(0, 3);
    const suffix = id.slice(-3);
    return `discord:webhook:${prefix}***${suffix}`;
  } catch {
    return "discord:webhook:invalid";
  }
}

export function redactDiscordSecrets(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  return raw.replace(DISCORD_WEBHOOK_PATTERN, (token) => redactWebhookTarget(token));
}

