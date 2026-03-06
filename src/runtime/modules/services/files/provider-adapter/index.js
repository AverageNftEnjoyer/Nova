import { describeUnknownError } from "../../../llm/providers/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasTool(availableTools = [], name = "") {
  const toolName = normalizeText(name).toLowerCase();
  if (!toolName) return false;
  return normalizeArray(availableTools).some((tool) => normalizeText(tool?.name).toLowerCase() === toolName);
}

export function createFilesProviderAdapter(deps = {}) {
  return {
    id: "workspace-file-tools-adapter",
    providerId: "tool_runtime",
    async runFileTool(input = {}) {
      const runtimeTools = input.runtimeTools || deps.runtimeTools || null;
      const availableTools = input.availableTools || deps.availableTools || [];
      const toolName = normalizeText(input.toolName).toLowerCase();
      const toolInput = input.toolInput && typeof input.toolInput === "object" ? input.toolInput : {};

      if (!toolName) {
        return {
          ok: false,
          code: "files.tool_missing",
          message: "Files tool call requires a tool name.",
          providerId: "tool_runtime",
          adapterId: "workspace-file-tools-adapter",
          content: "",
        };
      }
      if (typeof runtimeTools?.executeToolUse !== "function") {
        return {
          ok: false,
          code: "files.tool_runtime_unavailable",
          message: "Files lane requires runtime tool execution.",
          providerId: "tool_runtime",
          adapterId: "workspace-file-tools-adapter",
          content: "",
        };
      }
      if (!hasTool(availableTools, toolName)) {
        return {
          ok: false,
          code: "files.tool_not_enabled",
          message: `Files lane requires the ${toolName} tool to be enabled.`,
          providerId: "tool_runtime",
          adapterId: "workspace-file-tools-adapter",
          content: "",
        };
      }

      try {
        const result = await runtimeTools.executeToolUse(
          {
            id: `tool_files_${toolName}_${Date.now()}`,
            name: toolName,
            input: toolInput,
            type: "tool_use",
          },
          availableTools,
        );
        const content = String(result?.content || "").trim();
        return {
          ok: true,
          code: "files.tool_ok",
          message: "Files tool call completed.",
          providerId: "tool_runtime",
          adapterId: "workspace-file-tools-adapter",
          content,
        };
      } catch (error) {
        return {
          ok: false,
          code: "files.tool_execution_failed",
          message: describeUnknownError(error),
          providerId: "tool_runtime",
          adapterId: "workspace-file-tools-adapter",
          content: "",
        };
      }
    },
  };
}
