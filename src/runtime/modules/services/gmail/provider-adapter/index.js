function normalizeText(value = "") {
  return String(value || "").trim();
}

function parseToolPayload(raw) {
  const text = normalizeText(raw);
  if (!text) {
    return {
      ok: false,
      errorCode: "EMPTY_TOOL_RESPONSE",
      safeMessage: "I couldn't verify Gmail data right now.",
      guidance: "Retry in a moment.",
    };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  return {
    ok: false,
    errorCode: "NON_JSON_TOOL_RESPONSE",
    safeMessage: "I couldn't verify Gmail data right now.",
    guidance: "Retry in a moment.",
  };
}

export async function executeGmailProviderTool(runtimeTools, availableTools, toolName, input) {
  if (typeof runtimeTools?.executeToolUse !== "function") {
    return {
      ok: false,
      errorCode: "TOOL_RUNTIME_UNAVAILABLE",
      safeMessage: "I couldn't verify Gmail data because the tool runtime is unavailable.",
      guidance: "Retry after Nova runtime initializes tools.",
    };
  }
  const exists = Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "") === toolName);
  if (!exists) {
    return {
      ok: false,
      errorCode: "TOOL_NOT_ENABLED",
      safeMessage: `I couldn't verify Gmail data because ${toolName} is not enabled.`,
      guidance: "Enable Gmail tools in NOVA_ENABLED_TOOLS and restart Nova.",
    };
  }
  try {
    const result = await runtimeTools.executeToolUse(
      {
        id: `tool_${toolName}_${Date.now()}`,
        name: toolName,
        input,
        type: "tool_use",
      },
      availableTools,
    );
    return parseToolPayload(result?.content || "");
  } catch (err) {
    return {
      ok: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      safeMessage: "I couldn't verify Gmail data because tool execution failed.",
      guidance: err instanceof Error ? err.message : "Retry in a moment.",
    };
  }
}
