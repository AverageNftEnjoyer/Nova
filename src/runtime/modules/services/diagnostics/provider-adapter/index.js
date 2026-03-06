function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createDiagnosticsProviderAdapter(deps = {}) {
  return {
    id: "runtime-diagnostics-provider-adapter",
    providerId: "runtime_diagnostics",
    collectRuntimeSnapshot(input = {}) {
      const llmCtx = input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {};
      const turnPolicy = llmCtx.turnPolicy && typeof llmCtx.turnPolicy === "object" ? llmCtx.turnPolicy : {};
      const executionPolicy = llmCtx.executionPolicy && typeof llmCtx.executionPolicy === "object" ? llmCtx.executionPolicy : {};
      const latencyTelemetry = llmCtx.latencyTelemetry && typeof llmCtx.latencyTelemetry === "object"
        ? llmCtx.latencyTelemetry
        : {};
      const availableTools = normalizeArray(llmCtx.availableTools);

      return {
        ok: true,
        providerId: normalizeText(deps.providerId, "runtime_diagnostics"),
        adapterId: normalizeText(deps.adapterId, "runtime-diagnostics-provider-adapter"),
        snapshot: {
          model: normalizeText(llmCtx.selectedChatModel),
          provider: normalizeText(llmCtx.activeChatRuntime?.provider),
          canRunToolLoop: llmCtx.canRunToolLoop === true,
          canRunWebSearch: llmCtx.canRunWebSearch === true,
          canRunWebFetch: llmCtx.canRunWebFetch === true,
          availableToolCount: availableTools.length,
          availableToolNames: availableTools
            .slice(0, 12)
            .map((tool) => normalizeText(tool?.name))
            .filter(Boolean),
          turnPolicy: {
            likelyNeedsToolRuntime: turnPolicy.likelyNeedsToolRuntime === true,
            likelyNeedsFreshInfo: turnPolicy.likelyNeedsFreshInfo === true,
            weatherIntent: turnPolicy.weatherIntent === true,
            cryptoIntent: turnPolicy.cryptoIntent === true,
          },
          executionPolicy: {
            canRunToolLoop: executionPolicy.canRunToolLoop === true,
            canRunWebSearch: executionPolicy.canRunWebSearch === true,
            canRunWebFetch: executionPolicy.canRunWebFetch === true,
            selectedToolCount: Number(executionPolicy.selectedToolCount || 0),
          },
          latencyStages: latencyTelemetry.stages && typeof latencyTelemetry.stages === "object"
            ? latencyTelemetry.stages
            : {},
        },
      };
    },
  };
}
