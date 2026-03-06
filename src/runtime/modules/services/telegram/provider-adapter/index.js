import { describeUnknownError } from "../../../llm/providers/index.js";
import { redactTelegramSecrets } from "../redaction.js";

const PROVIDER_HTTP_HEADERS = Object.freeze({
  "Content-Type": "application/json",
});

function clampInt(value, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function mapProviderHttpError(status) {
  const numericStatus = Number(status || 0);
  if (numericStatus === 401) return "telegram.provider_unauthorized";
  if (numericStatus === 403) return "telegram.provider_forbidden";
  if (numericStatus === 404) return "telegram.provider_not_found";
  if (numericStatus === 409) return "telegram.provider_conflict";
  if (numericStatus === 429) return "telegram.provider_rate_limited";
  if (numericStatus >= 500) return "telegram.provider_unavailable";
  return "telegram.provider_http_error";
}

function extractProviderMessage(body, status) {
  if (body && typeof body === "object" && typeof body.description === "string" && body.description.trim()) {
    return redactTelegramSecrets(body.description.trim());
  }
  return redactTelegramSecrets(`Telegram provider request failed (${Number(status || 0)}).`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeProviderRequest(input = {}) {
  const {
    url = "",
    body = {},
    timeoutMs = 10_000,
    retryCount = 1,
    retryBaseMs = 150,
  } = input;

  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return {
      ok: false,
      status: 0,
      errorCode: "telegram.provider_invalid_request",
      errorMessage: "Telegram provider URL is required.",
      responseBody: null,
      attempts: 0,
    };
  }

  const boundedTimeoutMs = clampInt(timeoutMs, 10_000, 1000, 30_000);
  const boundedRetryCount = clampInt(retryCount, 1, 0, 3);
  const boundedRetryBaseMs = clampInt(retryBaseMs, 150, 25, 1500);

  let attempt = 0;
  while (attempt <= boundedRetryCount) {
    attempt += 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), boundedTimeoutMs);
    try {
      const response = await fetch(normalizedUrl, {
        method: "POST",
        headers: { ...PROVIDER_HTTP_HEADERS },
        body: JSON.stringify(body || {}),
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const responseBody = await response.json().catch(() => null);
      const providerOk = response.ok && responseBody?.ok === true;
      if (providerOk) {
        return {
          ok: true,
          status: Number(response.status || 200),
          errorCode: "",
          errorMessage: "",
          responseBody,
          attempts: attempt,
        };
      }
      const statusCode = Number(response.status || 0);
      const errorCode = mapProviderHttpError(statusCode);
      const errorMessage = extractProviderMessage(responseBody, statusCode);
      const retryable = statusCode === 429 || statusCode >= 500;
      if (retryable && attempt <= boundedRetryCount) {
        await sleep(boundedRetryBaseMs * attempt);
        continue;
      }
      return {
        ok: false,
        status: statusCode,
        errorCode,
        errorMessage,
        responseBody,
        attempts: attempt,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const timeoutError = String(error?.name || "").trim().toLowerCase() === "aborterror";
      if (attempt <= boundedRetryCount) {
        await sleep(boundedRetryBaseMs * attempt);
        continue;
      }
        return {
          ok: false,
          status: 0,
          errorCode: timeoutError ? "telegram.provider_timeout" : "telegram.provider_network_error",
          errorMessage: redactTelegramSecrets(describeUnknownError(error)),
          responseBody: null,
          attempts: attempt,
        };
    }
  }

  return {
    ok: false,
    status: 0,
    errorCode: "telegram.provider_network_error",
    errorMessage: "Telegram provider request failed after retries.",
    responseBody: null,
    attempts: boundedRetryCount + 1,
  };
}

export function createTelegramBotApiAdapter() {
  return Object.freeze({
    id: "telegram-bot-api",
    async sendMessage(input = {}) {
      const baseUrl = normalizeBaseUrl(input.apiBaseUrl);
      const botToken = String(input.botToken || "").trim();
      const chatId = String(input.chatId || "").trim();
      const text = String(input.text || "").trim();
      if (!baseUrl || !botToken || !chatId || !text) {
        return {
          ok: false,
          status: 0,
          errorCode: "telegram.provider_invalid_request",
          errorMessage: "Missing Telegram provider send-message fields.",
          responseBody: null,
          attempts: 0,
        };
      }
      const payload = {
        chat_id: chatId,
        text,
        parse_mode: String(input.parseMode || "").trim() || undefined,
        disable_notification: input.disableNotification === true,
      };
      return await executeProviderRequest({
        url: `${baseUrl}/bot${botToken}/sendMessage`,
        body: payload,
        timeoutMs: input.timeoutMs,
        retryCount: input.retryCount,
        retryBaseMs: input.retryBaseMs,
      });
    },
    async getStatus(input = {}) {
      const baseUrl = normalizeBaseUrl(input.apiBaseUrl);
      const botToken = String(input.botToken || "").trim();
      if (!baseUrl || !botToken) {
        return {
          ok: false,
          status: 0,
          errorCode: "telegram.provider_invalid_request",
          errorMessage: "Missing Telegram provider status fields.",
          responseBody: null,
          attempts: 0,
        };
      }
      return await executeProviderRequest({
        url: `${baseUrl}/bot${botToken}/getMe`,
        body: {},
        timeoutMs: input.timeoutMs,
        retryCount: input.retryCount,
        retryBaseMs: input.retryBaseMs,
      });
    },
  });
}

export function createTelegramProviderRegistry() {
  return Object.freeze({
    "telegram-bot-api": createTelegramBotApiAdapter(),
  });
}
