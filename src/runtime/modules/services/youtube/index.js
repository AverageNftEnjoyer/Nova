import { createYouTubeProviderAdapter } from "./provider-adapter/index.js";

export async function runYouTubeDomainService(input = {}, deps = {}) {
  const adapter = deps.providerAdapter && typeof deps.providerAdapter.execute === "function"
    ? deps.providerAdapter
    : createYouTubeProviderAdapter();

  return await adapter.execute({
    intent: input.intent,
    ctx: input.ctx,
  }, input.options);
}
