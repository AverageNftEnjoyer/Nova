import { createHash } from "node:crypto";
import { describeUnknownError } from "../../../../llm/providers/index.js";

const DEFAULT_TIMEOUT_MS = 7_500;
const DEFAULT_RETRY_COUNT = 1;
const TRANSIENT_RETRY_DELAY_MS = 180;

function toBoundedInt(value, defaultValue, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveHudApiBaseUrl(input) {
  return String(input || process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

function resolveRuntimeSharedToken(input) {
  const explicit = String(input || process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim();
  if (explicit) return explicit;
  const encryptionKey = String(process.env.NOVA_ENCRYPTION_KEY || "").trim();
  if (!encryptionKey) return "";
  return createHash("sha256")
    .update(`nova-runtime-shared-token:${encryptionKey}`)
    .digest("hex");
}

function resolveRuntimeSharedTokenHeader(input) {
  return (
    String(input || process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token")
      .trim()
      .toLowerCase()
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

function isTransientStatus(status) {
  return Number(status) === 429 || Number(status) >= 500;
}

function isAbortError(err) {
  return String(err?.name || "").trim().toLowerCase() === "aborterror";
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
    } catch (err) {
      lastError = err;
      if (attempt > retryCount) throw err;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error("Spotify HUD adapter request failed.");
}

export function createSpotifyHudHttpAdapter() {
  return Object.freeze({
    id: "spotify-hud-http-adapter",
    async execute(input = {}, options = {}) {
      const action = String(input.action || "").trim();
      const intent = input.intent && typeof input.intent === "object" ? input.intent : {};
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const token = String(ctx?.supabaseAccessToken || "").trim();
      const normalizedUserContextId = String(ctx?.userContextId || "").trim();

      if (action === "open") {
        return { attempted: false, ok: false, message: "", code: "" };
      }
      if (!normalizedUserContextId) {
        return {
          attempted: false,
          ok: false,
          message: "I need your user context before I can reach Spotify.",
          code: "spotify.unauthorized",
        };
      }

      const headers = token ? buildAuthorizedHeaders(token, options) : buildJsonHeaders(options);
      const body = {
        action,
        query: String(intent?.query || "").trim(),
        userContextId: normalizedUserContextId,
      };
      if (intent?.type) body.type = intent.type;
      if (intent?.positionMs != null) body.positionMs = Number(intent.positionMs);
      if (intent?.volumePercent != null) body.volumePercent = Number(intent.volumePercent);
      if (intent?.shuffleOn != null) body.shuffleOn = Boolean(intent.shuffleOn);
      if (intent?.repeatMode) body.repeatMode = String(intent.repeatMode);
      if (intent?.deviceId) body.deviceId = String(intent.deviceId);
      if (intent?.deviceName) body.deviceName = String(intent.deviceName);

      try {
        const res = await fetchWithTimeoutAndRetry(
          `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/integrations/spotify/playback`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          },
          options,
        );
        const data = await res.json();
        if (res.ok && data?.ok === true) {
          return {
            attempted: true,
            ok: true,
            message: String(data?.message || "").trim(),
            code: "",
            nowPlaying: data?.nowPlaying || null,
          };
        }
        return {
          attempted: true,
          ok: false,
          message: String(data?.error || "").trim() || `Spotify playback request failed (${res.status}).`,
          code: String(data?.code || "").trim(),
          nowPlaying: data?.nowPlaying || null,
        };
      } catch (err) {
        const errorCode = isAbortError(err) ? "spotify.timeout" : "spotify.network";
        return {
          attempted: true,
          ok: false,
          message: describeUnknownError(err),
          code: errorCode,
        };
      }
    },
  });
}

export function createSpotifyProviderRegistry() {
  return Object.freeze({
    "spotify-hud-http-adapter": createSpotifyHudHttpAdapter(),
  });
}
