import { createSpotifyDirectNowPlayingAdapter } from "./direct-now-playing/index.js";
import { createSpotifyHudHttpAdapter } from "./hud-http/index.js";

const DEFAULT_PROVIDER_ID = "spotify-hud-http-adapter";
const DIRECT_NOW_PLAYING_PROVIDER_ID = "spotify-direct-now-playing-adapter";

export function resolveSpotifyProviderId(input = {}) {
  const explicitProviderId = String(input.providerId || "").trim();
  if (explicitProviderId) return explicitProviderId;

  const action = String(input.action || "").trim();
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const token = String(ctx.supabaseAccessToken || "").trim();

  if (action === "now_playing" && !token) {
    return DIRECT_NOW_PLAYING_PROVIDER_ID;
  }
  return DEFAULT_PROVIDER_ID;
}

export function createSpotifyProviderRegistry() {
  return Object.freeze({
    [DEFAULT_PROVIDER_ID]: createSpotifyHudHttpAdapter(),
    [DIRECT_NOW_PLAYING_PROVIDER_ID]: createSpotifyDirectNowPlayingAdapter(),
  });
}
