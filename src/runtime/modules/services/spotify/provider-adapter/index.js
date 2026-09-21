import { createSpotifyHudHttpAdapter } from "./hud-http/index.js";

const DEFAULT_PROVIDER_ID = "spotify-hud-http-adapter";

export function resolveSpotifyProviderId(input = {}) {
  const explicitProviderId = String(input.providerId || "").trim();
  if (explicitProviderId) return explicitProviderId;
  return DEFAULT_PROVIDER_ID;
}

export function createSpotifyProviderRegistry() {
  return Object.freeze({
    [DEFAULT_PROVIDER_ID]: createSpotifyHudHttpAdapter(),
  });
}
