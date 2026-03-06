import { createSpotifyProviderRegistry, resolveSpotifyProviderId } from "./provider-adapter/index.js";

export async function runSpotifyDomainService(input = {}, deps = {}) {
  const providerId = resolveSpotifyProviderId(input);
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
