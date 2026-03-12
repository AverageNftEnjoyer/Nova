import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 7_500;
const DEFAULT_RETRY_COUNT = 1;
const TRANSIENT_RETRY_DELAY_MS = 180;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function toBoundedInt(value, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveHudApiBaseUrl(input) {
  return String(input || process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

function resolveRuntimeSharedToken(input) {
  const explicit = normalizeText(input || process.env.NOVA_RUNTIME_SHARED_TOKEN);
  if (explicit) return explicit;
  const encryptionKey = normalizeText(process.env.NOVA_ENCRYPTION_KEY);
  if (!encryptionKey) return "";
  return createHash("sha256")
    .update(`nova-runtime-shared-token:${encryptionKey}`)
    .digest("hex");
}

function resolveRuntimeSharedTokenHeader(input) {
  return (
    normalizeText(input || process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER).toLowerCase()
    || "x-nova-runtime-token"
  );
}

function buildJsonHeaders(options = {}) {
  const headers = { "Content-Type": "application/json" };
  const sharedToken = resolveRuntimeSharedToken(options.runtimeSharedToken);
  const sharedHeader = resolveRuntimeSharedTokenHeader(options.runtimeSharedTokenHeader);
  if (sharedToken) headers[sharedHeader] = sharedToken;
  return headers;
}

function buildAuthorizedHeaders(token, options = {}) {
  return {
    ...buildJsonHeaders(options),
    Authorization: `Bearer ${token}`,
  };
}

function getTimeoutMs(options = {}) {
  return toBoundedInt(
    options.requestTimeoutMs ?? process.env.NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1000,
    30_000,
  );
}

function getRetryCount(options = {}) {
  return toBoundedInt(
    options.retryCount ?? process.env.NOVA_INTEGRATION_BRIDGE_RETRY_COUNT,
    DEFAULT_RETRY_COUNT,
    0,
    2,
  );
}

function isTransientStatus(status) {
  return Number(status) === 429 || Number(status) >= 500;
}

async function fetchWithTimeoutAndRetry(url, init, options = {}) {
  const timeoutMs = getTimeoutMs(options);
  const retryCount = getRetryCount(options);
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryCount) {
    attempt += 1;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: abortController.signal,
      });
      if (attempt <= retryCount && isTransientStatus(res.status)) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt > retryCount) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Calendar HUD adapter request failed.");
}

async function parseJsonSafe(response) {
  return response.json();
}

export function createGoogleCalendarHudHttpAdapter() {
  return Object.freeze({
    id: "google-calendar-hud-http-adapter",
    async list(input = {}, options = {}) {
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const token = normalizeText(ctx.supabaseAccessToken);
      const userContextId = normalizeText(input.userContextId || ctx.userContextId);
      if (!userContextId) {
        return {
          attempted: false,
          ok: false,
          code: "calendar.user_context_required",
          message: "Calendar Google event access requires userContextId.",
        };
      }
      const params = new URLSearchParams({
        userContextId,
        start: new Date(input.startAt || Date.now()).toISOString(),
        end: new Date(input.endAt || Date.now()).toISOString(),
      });
      const headers = token ? buildAuthorizedHeaders(token, options) : buildJsonHeaders(options);
      try {
        const res = await fetchWithTimeoutAndRetry(
          `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/calendar/google-events?${params.toString()}`,
          { method: "GET", headers },
          options,
        );
        const data = await parseJsonSafe(res);
        return {
          attempted: true,
          ok: res.ok && data?.ok === true,
          code: normalizeText(data?.code),
          message: normalizeText(data?.error || data?.message) || `Google Calendar list request failed (${res.status}).`,
          events: Array.isArray(data?.events) ? data.events : [],
        };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          code: "calendar.google_events_network",
          message: error instanceof Error ? error.message : "Google Calendar request failed.",
          events: [],
        };
      }
    },
    async create(input = {}, options = {}) {
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const token = normalizeText(ctx.supabaseAccessToken);
      const userContextId = normalizeText(input.userContextId || ctx.userContextId);
      const headers = token ? buildAuthorizedHeaders(token, options) : buildJsonHeaders(options);
      try {
        const res = await fetchWithTimeoutAndRetry(
          `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/calendar/google-events`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              userContextId,
              title: input.title,
              description: input.description,
              startAt: input.startAt,
              endAt: input.endAt,
              timeZone: input.timeZone,
            }),
          },
          options,
        );
        const data = await parseJsonSafe(res);
        return {
          attempted: true,
          ok: res.ok && data?.ok === true,
          code: normalizeText(data?.code),
          message: normalizeText(data?.error || data?.message) || `Google Calendar create request failed (${res.status}).`,
          event: data?.event || null,
        };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          code: "calendar.google_event_create_network",
          message: error instanceof Error ? error.message : "Google Calendar create request failed.",
          event: null,
        };
      }
    },
    async update(input = {}, options = {}) {
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const token = normalizeText(ctx.supabaseAccessToken);
      const headers = token ? buildAuthorizedHeaders(token, options) : buildJsonHeaders(options);
      const eventId = encodeURIComponent(normalizeText(input.eventId));
      try {
        const res = await fetchWithTimeoutAndRetry(
          `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/calendar/google-events/${eventId}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              userContextId: normalizeText(input.userContextId || ctx.userContextId),
              title: input.title,
              description: input.description,
              startAt: input.startAt,
              endAt: input.endAt,
              timeZone: input.timeZone,
            }),
          },
          options,
        );
        const data = await parseJsonSafe(res);
        return {
          attempted: true,
          ok: res.ok && data?.ok === true,
          code: normalizeText(data?.code),
          message: normalizeText(data?.error || data?.message) || `Google Calendar update request failed (${res.status}).`,
          event: data?.event || null,
        };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          code: "calendar.google_event_update_network",
          message: error instanceof Error ? error.message : "Google Calendar update request failed.",
          event: null,
        };
      }
    },
    async delete(input = {}, options = {}) {
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const token = normalizeText(ctx.supabaseAccessToken);
      const headers = token ? buildAuthorizedHeaders(token, options) : buildJsonHeaders(options);
      const eventId = encodeURIComponent(normalizeText(input.eventId));
      try {
        const res = await fetchWithTimeoutAndRetry(
          `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/calendar/google-events/${eventId}`,
          {
            method: "DELETE",
            headers,
            body: JSON.stringify({
              userContextId: normalizeText(input.userContextId || ctx.userContextId),
            }),
          },
          options,
        );
        const data = await parseJsonSafe(res);
        return {
          attempted: true,
          ok: res.ok && data?.ok === true,
          code: normalizeText(data?.code),
          message: normalizeText(data?.error || data?.message) || `Google Calendar delete request failed (${res.status}).`,
        };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          code: "calendar.google_event_delete_network",
          message: error instanceof Error ? error.message : "Google Calendar delete request failed.",
        };
      }
    },
  });
}
