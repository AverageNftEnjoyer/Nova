import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
  ENABLE_PROVIDER_FALLBACK,
  ROUTING_PREFERENCE,
  ROUTING_ALLOW_ACTIVE_OVERRIDE,
  ROUTING_PREFERRED_PROVIDERS,
} from "../../../../../core/constants/index.js";
import { cachedLoadIntegrationsRuntime } from "../../../../context/persona-context/index.js";
import { getOpenAIClient, resolveConfiguredChatRuntime } from "../../../../llm/providers/index.js";
import { ensureRuntimeIntegrationsSnapshot } from "../operator-runtime-snapshot/index.js";

export async function selectChatRuntimeForTurn(input = {}, deps = {}) {
  const {
    userContextId = "",
    supabaseAccessToken = "",
    canRunToolLoop = false,
    sessionKey = "",
    source = "hud",
    latencyTelemetry = null,
  } = input;
  const {
    ensureRuntimeIntegrationsSnapshotRef = ensureRuntimeIntegrationsSnapshot,
    cachedLoadIntegrationsRuntimeRef = cachedLoadIntegrationsRuntime,
    resolveConfiguredChatRuntimeRef = resolveConfiguredChatRuntime,
    getOpenAIClientRef = getOpenAIClient,
  } = deps;

  const providerResolutionStartedAt = Date.now();
  await ensureRuntimeIntegrationsSnapshotRef({
    userContextId,
    supabaseAccessToken,
  });
  const integrationsRuntime = cachedLoadIntegrationsRuntimeRef({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntimeRef(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    preference: ROUTING_PREFERENCE,
    requiresToolCalling: canRunToolLoop,
    allowActiveProviderOverride: ENABLE_PROVIDER_FALLBACK && ROUTING_ALLOW_ACTIVE_OVERRIDE,
    preferredProviders: ROUTING_PREFERRED_PROVIDERS,
  });
  if (latencyTelemetry && typeof latencyTelemetry.addStage === "function") {
    latencyTelemetry.addStage("provider_resolution", Date.now() - providerResolutionStartedAt);
  }

  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude"
      ? "Claude"
      : activeChatRuntime.provider === "grok"
        ? "Grok"
        : activeChatRuntime.provider === "gemini"
          ? "Gemini"
          : "OpenAI";
    throw new Error(`Missing ${providerName} API key for active provider "${activeChatRuntime.provider}". Configure Integrations first.`);
  }
  if (!activeChatRuntime.connected) {
    throw new Error(`Active provider "${activeChatRuntime.provider}" is not enabled. Enable it or switch activeLlmProvider.`);
  }

  const activeOpenAiCompatibleClient = activeChatRuntime.provider === "claude"
    ? null
    : getOpenAIClientRef({ apiKey: activeChatRuntime.apiKey, baseURL: activeChatRuntime.baseURL });
  const selectedChatModel = activeChatRuntime.model
    || (activeChatRuntime.provider === "claude" ? DEFAULT_CLAUDE_MODEL
      : activeChatRuntime.provider === "grok" ? DEFAULT_GROK_MODEL
      : activeChatRuntime.provider === "gemini" ? DEFAULT_GEMINI_MODEL
      : DEFAULT_CHAT_MODEL);

  console.log(
    `[RuntimeSelection] session=${sessionKey} provider=${activeChatRuntime.provider}` +
    ` model=${selectedChatModel} source=${source}` +
    ` route=${String(activeChatRuntime.routeReason || "n/a")}` +
    ` candidates=${Array.isArray(activeChatRuntime.rankedCandidates) ? activeChatRuntime.rankedCandidates.join(">") : activeChatRuntime.provider}`,
  );

  return {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
  };
}

