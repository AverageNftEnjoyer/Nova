import { describeUnknownError } from "../../../../llm/providers/index.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

export function parseCoinbaseToolPayload(raw) {
  const text = normalizeText(raw);
  if (!text) {
    return {
      ok: false,
      errorCode: "EMPTY_TOOL_RESPONSE",
      safeMessage: "I couldn't verify Coinbase data right now.",
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
    safeMessage: "I couldn't verify Coinbase data right now.",
    guidance: "Retry in a moment.",
  };
}

export async function executeCoinbaseProviderTool(runtimeTools, availableTools, toolName, input) {
  if (typeof runtimeTools?.executeToolUse !== "function") {
    return {
      ok: false,
      errorCode: "TOOL_RUNTIME_UNAVAILABLE",
      safeMessage: "I couldn't verify Coinbase data because the tool runtime is unavailable.",
      guidance: "Retry after Nova runtime initializes tools.",
    };
  }
  const exists = Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "") === toolName);
  if (!exists) {
    return {
      ok: false,
      errorCode: "TOOL_NOT_ENABLED",
      safeMessage: `I couldn't verify Coinbase data because ${toolName} is not enabled.`,
      guidance: "Enable Coinbase tools in NOVA_ENABLED_TOOLS and restart Nova.",
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
    return parseCoinbaseToolPayload(result?.content || "");
  } catch (err) {
    return {
      ok: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      safeMessage: "I couldn't verify Coinbase data because tool execution failed.",
      guidance: describeUnknownError(err),
    };
  }
}
