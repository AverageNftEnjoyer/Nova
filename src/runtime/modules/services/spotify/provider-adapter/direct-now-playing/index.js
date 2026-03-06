import fs from "node:fs";
import path from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { describeUnknownError, getEncryptionKeyMaterials, unwrapStoredSecret } from "../../../../llm/providers/index.js";

const SPOTIFY_TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track";

function readEnvFromDotenv(name) {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "hud", ".env.local"),
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, "utf8");
      const match = source.match(new RegExp(`^${name}=([^\\r\\n]+)$`, "m"));
      if (match?.[1]) return String(match[1]).trim();
    } catch {}
  }
  return "";
}

function readServerEnv(name, fallbackName = "") {
  const direct = String(process.env[name] || "").trim();
  if (direct) return direct;
  if (fallbackName) {
    const fallback = String(process.env[fallbackName] || "").trim();
    if (fallback) return fallback;
  }
  const fromDotenv = readEnvFromDotenv(name);
  if (fromDotenv) return fromDotenv;
  return fallbackName ? readEnvFromDotenv(fallbackName) : "";
}

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function emptyNowPlaying(connected = true) {
  return {
    connected,
    playing: false,
    progressMs: 0,
    durationMs: 0,
    trackId: "",
    trackName: "",
    artistName: "",
    albumName: "",
    albumArtUrl: "",
    deviceId: "",
    deviceName: "",
  };
}

function summarizeNowPlaying(nowPlaying) {
  if (!nowPlaying.connected) return "Spotify is not connected.";
  if (!nowPlaying.playing) return "Nothing is playing right now.";
  const track = nowPlaying.trackName || "Unknown track";
  const artist = nowPlaying.artistName || "Unknown artist";
  const device = nowPlaying.deviceName ? ` on ${nowPlaying.deviceName}` : "";
  return `Now playing ${track} by ${artist}${device}.`;
}

function toNowPlaying(payload, connected = true) {
  if (!payload || typeof payload !== "object") return emptyNowPlaying(connected);
  const item = payload.item && typeof payload.item === "object" ? payload.item : {};
  const album = item.album && typeof item.album === "object" ? item.album : {};
  const device = payload.device && typeof payload.device === "object" ? payload.device : {};
  const artists = Array.isArray(item.artists) ? item.artists : [];
  const images = Array.isArray(album.images) ? album.images : [];
  return {
    connected,
    playing: payload.is_playing === true,
    progressMs: Number.isFinite(Number(payload.progress_ms)) ? Math.max(0, Math.floor(Number(payload.progress_ms))) : 0,
    durationMs: Number.isFinite(Number(item.duration_ms)) ? Math.max(0, Math.floor(Number(item.duration_ms))) : 0,
    trackId: String(item.id || "").trim(),
    trackName: String(item.name || "").trim(),
    artistName: artists.map((artist) => String(artist?.name || "").trim()).filter(Boolean)[0] || "",
    albumName: String(album.name || "").trim(),
    albumArtUrl: images.map((image) => String(image?.url || "").trim()).filter(Boolean)[0] || "",
    deviceId: String(device.id || "").trim(),
    deviceName: String(device.name || "").trim(),
  };
}

function encryptStoredSecret(value) {
  const plainText = String(value || "").trim();
  if (!plainText) return "";
  const key = getEncryptionKeyMaterials()[0];
  if (!key) throw new Error("Spotify runtime direct lookup requires encryption material.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

async function fetchUserSpotifyConfig(userContextId) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedUserContextId) {
    throw new Error("Spotify runtime direct lookup requires userContextId.");
  }
  const supabaseUrl = readServerEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const supabaseServiceRoleKey = readServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Spotify runtime direct lookup requires Supabase server environment.");
  }
  const url = new URL(`${supabaseUrl}/rest/v1/integration_configs`);
  url.searchParams.set("select", "config");
  url.searchParams.set("user_id", `eq.${normalizedUserContextId}`);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Spotify runtime config lookup failed (${response.status}).`);
  }
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const config = row?.config && typeof row.config === "object" ? row.config : {};
  return {
    normalizedUserContextId,
    supabaseUrl,
    supabaseServiceRoleKey,
    config,
    spotify: config.spotify && typeof config.spotify === "object" ? config.spotify : {},
  };
}

async function refreshSpotifyAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    refresh_token: String(refreshToken || "").trim(),
    client_id: String(clientId || "").trim(),
    grant_type: "refresh_token",
  });
  const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = String(payload?.error_description || payload?.error || "").trim().toLowerCase();
    const error = new Error(`Spotify token refresh failed (${response.status}).`);
    if (response.status === 400 || response.status === 401) {
      error.code = "spotify.token_missing";
      error.message = detail.includes("invalid_grant")
        ? "Spotify authorization expired. Reconnect Spotify."
        : "Spotify token refresh failed. Reconnect Spotify.";
    }
    throw error;
  }
  const payload = await response.json().catch(() => null);
  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) throw new Error("Spotify token refresh returned no access token.");
  return {
    accessToken,
    refreshToken: String(payload?.refresh_token || "").trim(),
    expiresIn: Number.isFinite(Number(payload?.expires_in)) ? Number(payload.expires_in) : 3600,
  };
}

async function persistSpotifyTokens(input) {
  const {
    normalizedUserContextId,
    supabaseUrl,
    supabaseServiceRoleKey,
    config,
    spotify,
    accessToken,
    refreshToken,
    tokenExpiry,
  } = input;
  const nextConfig = {
    ...config,
    spotify: {
      ...spotify,
      accessTokenEnc: encryptStoredSecret(accessToken),
      refreshTokenEnc: refreshToken ? encryptStoredSecret(refreshToken) : String(spotify.refreshTokenEnc || "").trim(),
      tokenExpiry,
      connected: true,
    },
  };
  const url = new URL(`${supabaseUrl}/rest/v1/integration_configs`);
  url.searchParams.set("user_id", `eq.${normalizedUserContextId}`);
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ config: nextConfig }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Spotify token persistence failed (${response.status}).`);
  }
}

async function fetchNowPlaying(accessToken) {
  return fetch(SPOTIFY_NOW_PLAYING_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
}

async function runDirectSpotifyNowPlaying(userContextId) {
  try {
    const scopedConfig = await fetchUserSpotifyConfig(userContextId);
    const { normalizedUserContextId, supabaseUrl, supabaseServiceRoleKey, config, spotify } = scopedConfig;
    if (spotify.connected !== true) {
      return {
        attempted: true,
        ok: false,
        message: "Spotify is not connected.",
        code: "spotify.not_connected",
        nowPlaying: emptyNowPlaying(false),
      };
    }

    let accessToken = unwrapStoredSecret(spotify.accessTokenEnc);
    const refreshToken = unwrapStoredSecret(spotify.refreshTokenEnc);
    const clientId = String(spotify.oauthClientId || "").trim();
    if (!accessToken) {
      if (!refreshToken || !clientId) {
        return {
          attempted: true,
          ok: false,
          message: "No Spotify refresh token available. Reconnect Spotify.",
          code: "spotify.token_missing",
          nowPlaying: emptyNowPlaying(false),
        };
      }
      const refreshed = await refreshSpotifyAccessToken(refreshToken, clientId);
      accessToken = refreshed.accessToken;
      await persistSpotifyTokens({
        normalizedUserContextId,
        supabaseUrl,
        supabaseServiceRoleKey,
        config,
        spotify,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken,
        tokenExpiry: Date.now() + Math.max(refreshed.expiresIn - 60, 60) * 1000,
      });
    }

    let response = await fetchNowPlaying(accessToken);
    if (response.status === 401 && refreshToken && clientId) {
      const refreshed = await refreshSpotifyAccessToken(refreshToken, clientId);
      accessToken = refreshed.accessToken;
      await persistSpotifyTokens({
        normalizedUserContextId,
        supabaseUrl,
        supabaseServiceRoleKey,
        config,
        spotify,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken,
        tokenExpiry: Date.now() + Math.max(refreshed.expiresIn - 60, 60) * 1000,
      });
      response = await fetchNowPlaying(accessToken);
    }
    if (response.status === 204 || response.status === 404) {
      const nowPlaying = emptyNowPlaying(true);
      return {
        attempted: true,
        ok: true,
        message: summarizeNowPlaying(nowPlaying),
        code: "",
        nowPlaying,
      };
    }
    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        message: `Spotify now playing failed (${response.status}).`,
        code: response.status === 401 ? "spotify.unauthorized" : "spotify.network",
        nowPlaying: emptyNowPlaying(true),
      };
    }

    const payload = await response.json().catch(() => null);
    const nowPlaying = toNowPlaying(payload, true);
    return {
      attempted: true,
      ok: true,
      message: summarizeNowPlaying(nowPlaying),
      code: "",
      nowPlaying,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      message: describeUnknownError(error),
      code: String(error?.code || "spotify.network"),
      nowPlaying: emptyNowPlaying(false),
    };
  }
}

export function createSpotifyDirectNowPlayingAdapter() {
  return Object.freeze({
    id: "spotify-direct-now-playing-adapter",
    async execute(input = {}) {
      const action = String(input.action || "").trim();
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      if (action !== "now_playing") {
        return {
          attempted: false,
          ok: false,
          message: `Spotify direct adapter cannot execute "${action}".`,
          code: "spotify.unsupported_action",
          fallbackRecommended: false,
          nowPlaying: emptyNowPlaying(false),
        };
      }
      return runDirectSpotifyNowPlaying(ctx.userContextId);
    },
  });
}
