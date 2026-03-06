import { createSpotifyProviderRegistry } from "./provider-adapter/hud-http/index.js";

export async function runSpotifyDomainService(input = {}, deps = {}) {
  const providerId = String(input.providerId || "spotify-hud-http-adapter").trim() || "spotify-hud-http-adapter";
  const registry = deps.providerRegistry && typeof deps.providerRegistry === "object"
    ? deps.providerRegistry
    : createSpotifyProviderRegistry();
  const adapter = registry[providerId];
  if (!adapter || typeof adapter.execute !== "function") {
    return {
      attempted: false,
      ok: false,
      message: `Spotify provider adapter "${providerId}" is unavailable.`,
      code: "spotify.provider_adapter_missing",
      fallbackRecommended: true,
    };
  }
  return await adapter.execute({
    action: input.action,
    intent: input.intent,
    ctx: input.ctx,
  }, input.options);
}
