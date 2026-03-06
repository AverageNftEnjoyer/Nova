import { redactWebhookTarget } from "../../redaction.js";

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function resolveDiscordWebhookPolicy() {
  return Object.freeze({
    timeoutMs: parseBoundedInt(process.env.NOVA_DISCORD_SEND_TIMEOUT_MS, 10_000, 500, 45_000),
    maxRetries: parseBoundedInt(process.env.NOVA_DISCORD_SEND_MAX_RETRIES, 2, 0, 4),
    retryBaseMs: parseBoundedInt(process.env.NOVA_DISCORD_SEND_RETRY_BASE_MS, 700, 100, 10_000),
    retryJitterMs: parseBoundedInt(process.env.NOVA_DISCORD_SEND_RETRY_JITTER_MS, 250, 0, 4_000),
  });
}

function isPrivateOrLocalHost(hostname = "") {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isValidDiscordChannelId(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return /^\d{8,24}$/.test(normalized);
}

export function isValidDiscordWebhookUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (isPrivateOrLocalHost(parsed.hostname)) return false;
  const host = parsed.hostname.toLowerCase();
  if (!["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"].includes(host)) return false;
  if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(parsed.pathname)) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function parseRetryAfterMs(headers) {
  const raw = String(headers?.get?.("retry-after") || "").trim();
  if (!raw) return null;
  const numericSeconds = Number(raw);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) return Math.floor(numericSeconds * 1000);
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return delta;
  }
  return null;
}

function computeRetryDelayMs(attempt, policy, retryAfterMs = null) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(30_000, Math.max(100, Math.floor(retryAfterMs)));
  }
  const exponential = policy.retryBaseMs * (2 ** Math.max(0, attempt - 1));
  const jitter = policy.retryJitterMs > 0 ? Math.floor(Math.random() * (policy.retryJitterMs + 1)) : 0;
  return Math.min(30_000, Math.max(policy.retryBaseMs, Math.floor(exponential + jitter)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendDiscordWebhookTarget(input = {}) {
  const {
    webhookUrl = "",
    payload = {},
    fetchImpl = globalThis.fetch,
    policy = resolveDiscordWebhookPolicy(),
  } = input;

  const redactedTarget = redactWebhookTarget(webhookUrl);
  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    return {
      ok: false,
      code: "discord_target_invalid_webhook",
      status: 0,
      retryable: false,
      attempts: 0,
      target: redactedTarget,
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      code: "discord_provider_fetch_missing",
      status: 0,
      retryable: false,
      attempts: 0,
      target: redactedTarget,
    };
  }

  const maxAttempts = Math.max(1, policy.maxRetries + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return {
          ok: true,
          code: "discord_delivery_ok",
          status: Number(response.status || 204),
          retryable: false,
          attempts: attempt,
          target: redactedTarget,
        };
      }

      const status = Number(response.status || 0);
      const retryable = isRetryableStatus(status);
      if (retryable && attempt < maxAttempts) {
        await sleep(computeRetryDelayMs(attempt, policy, parseRetryAfterMs(response.headers)));
        continue;
      }

      return {
        ok: false,
        code: retryable ? "discord_provider_http_retry_exhausted" : "discord_provider_http_non_retryable",
        status,
        retryable,
        attempts: attempt,
        target: redactedTarget,
      };
    } catch (error) {
      clearTimeout(timeout);
      const aborted = Boolean(controller.signal.aborted);
      if (attempt < maxAttempts) {
        await sleep(computeRetryDelayMs(attempt, policy, null));
        continue;
      }
      return {
        ok: false,
        code: aborted ? "discord_provider_timeout" : "discord_provider_network_error",
        status: 0,
        retryable: true,
        attempts: attempt,
        target: redactedTarget,
        error: String(error instanceof Error ? error.message : "discord_provider_network_error"),
      };
    }
  }

  return {
    ok: false,
    code: "discord_provider_unknown_failure",
    status: 0,
    retryable: false,
    attempts: Math.max(1, policy.maxRetries + 1),
    target: redactedTarget,
  };
}

