import { createHash } from "node:crypto";
import { describeUnknownError } from "../../../../llm/providers/index.js";
import { sanitizeYouTubeSource, sanitizeYouTubeTopic } from "../../media/youtube-agent/intent-utils/index.js";

const DEFAULT_BRIDGE_TIMEOUT_MS = 7_500;
const DEFAULT_BRIDGE_RETRY_COUNT = 1;
const TRANSIENT_RETRY_DELAY_MS = 180;

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
  const headers = {
    "Content-Type": "application/json",
  };
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

function getBridgeTimeoutMs(options = {}) {
  return toBoundedInt(
    options.requestTimeoutMs ?? process.env.NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS,
    DEFAULT_BRIDGE_TIMEOUT_MS,
    1000,
    30_000,
  );
}

function getBridgeRetryCount(options = {}) {
  return toBoundedInt(
    options.retryCount ?? process.env.NOVA_INTEGRATION_BRIDGE_RETRY_COUNT,
    DEFAULT_BRIDGE_RETRY_COUNT,
    0,
    2,
  );
}

async function fetchWithTimeoutAndRetry(url, init, options = {}) {
  const timeoutMs = getBridgeTimeoutMs(options);
  const retryCount = getBridgeRetryCount(options);

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
      const shouldRetry = attempt <= retryCount;
      if (!shouldRetry) throw err;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error("Integration bridge request failed.");
}

export async function runSpotifyViaHudApi(action, intent, ctx, options = {}) {
  const token = String(ctx?.supabaseAccessToken || "").trim();
  const normalizedUserContextId = String(ctx?.userContextId || "").trim();
  if (action === "open") {
    return { attempted: false, ok: false, message: "", code: "", fallbackRecommended: true };
  }
  if (!normalizedUserContextId) {
    return {
      attempted: false,
      ok: false,
      message: "I need your user context before I can reach Spotify.",
      code: "spotify.unauthorized",
      fallbackRecommended: true,
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
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) {
      return {
        attempted: true,
        ok: true,
        message: String(data?.message || "").trim(),
        code: "",
        fallbackRecommended: data?.fallbackRecommended === true,
        nowPlaying: data?.nowPlaying || null,
      };
    }
    return {
      attempted: true,
      ok: false,
      message: String(data?.error || "").trim() || `Spotify playback request failed (${res.status}).`,
      code: String(data?.code || "").trim(),
      fallbackRecommended: data?.fallbackRecommended === true,
      nowPlaying: data?.nowPlaying || null,
    };
  } catch (err) {
    const errorCode = isAbortError(err) ? "spotify.timeout" : "spotify.network";
    return {
      attempted: true,
      ok: false,
      message: describeUnknownError(err),
      code: errorCode,
      fallbackRecommended: true,
    };
  }
}

export async function runYouTubeHomeControlViaHudApi(intent, ctx, options = {}) {
  const token = String(ctx?.supabaseAccessToken || "").trim();
  const normalizedUserContextId = String(ctx?.userContextId || "").trim();
  if (!token || !normalizedUserContextId) {
    return {
      attempted: false,
      ok: false,
      message: "I need your authenticated Nova session before I can control YouTube.",
      code: "youtube.unauthorized",
    };
  }
  const headers = buildAuthorizedHeaders(token, options);
  const body = {
    action: intent.action === "refresh" ? "refresh" : "set_topic",
    topic: intent.topic ? sanitizeYouTubeTopic(intent.topic) : undefined,
    preferredSources: Array.isArray(intent.preferredSources)
      ? intent.preferredSources.map((entry) => sanitizeYouTubeSource(entry)).filter(Boolean).slice(0, 4)
      : [],
    strictTopic: intent.strictTopic === true,
    strictSources: intent.strictSources === true,
    userContextId: normalizedUserContextId,
  };
  try {
    const res = await fetchWithTimeoutAndRetry(
      `${resolveHudApiBaseUrl(options.hudApiBaseUrl)}/api/integrations/youtube/home-control`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      options,
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) {
      const selected = data?.selected && typeof data.selected === "object" ? data.selected : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      return {
        attempted: true,
        ok: true,
        message: String(data?.message || "").trim(),
        topic: String(data?.topic || "").trim(),
        commandNonce: Number.isFinite(Number(data?.commandNonce)) ? Number(data.commandNonce) : 0,
        preferredSources: Array.isArray(data?.preferredSources)
          ? data.preferredSources.map((entry) => sanitizeYouTubeSource(entry)).filter(Boolean).slice(0, 4)
          : [],
        strictTopic: data?.strictTopic === true,
        strictSources: data?.strictSources === true,
        items: items
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry;
            const videoId = String(item.videoId || "").trim();
            if (!videoId) return null;
            return {
              videoId,
              title: String(item.title || "").trim(),
              channelId: String(item.channelId || "").trim(),
              channelTitle: String(item.channelTitle || "").trim(),
              publishedAt: String(item.publishedAt || "").trim(),
              thumbnailUrl: String(item.thumbnailUrl || "").trim(),
              description: String(item.description || "").trim(),
              score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
              reason: String(item.reason || "").trim(),
            };
          })
          .filter(Boolean)
          .slice(0, 8),
        selected: selected
          ? {
              videoId: String(selected.videoId || "").trim(),
              title: String(selected.title || "").trim(),
              channelId: String(selected.channelId || "").trim(),
              channelTitle: String(selected.channelTitle || "").trim(),
              publishedAt: String(selected.publishedAt || "").trim(),
              thumbnailUrl: String(selected.thumbnailUrl || "").trim(),
              description: String(selected.description || "").trim(),
              score: Number.isFinite(Number(selected.score)) ? Number(selected.score) : 0,
              reason: String(selected.reason || "").trim(),
            }
          : null,
        code: "",
      };
    }
    return {
      attempted: true,
      ok: false,
      message: String(data?.error || "").trim() || `YouTube control request failed (${res.status}).`,
      code: String(data?.code || "").trim(),
      topic: String(data?.topic || "").trim(),
      commandNonce: Number.isFinite(Number(data?.commandNonce)) ? Number(data.commandNonce) : 0,
      preferredSources: [],
      strictTopic: false,
      strictSources: false,
      items: [],
      selected: null,
    };
  } catch (err) {
    const errorCode = isAbortError(err) ? "youtube.timeout" : "youtube.network";
    return {
      attempted: true,
      ok: false,
      message: describeUnknownError(err),
      code: errorCode,
      topic: "",
      commandNonce: 0,
      preferredSources: [],
      strictTopic: false,
      strictSources: false,
      items: [],
      selected: null,
    };
  }
}
