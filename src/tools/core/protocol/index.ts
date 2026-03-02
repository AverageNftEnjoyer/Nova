import type { Tool } from "../types/index.js";

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Tool["input_schema"];
}

export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAiToolCallLike {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export function toAnthropicToolDefinitions(tools: Tool[]): AnthropicToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema:
      tool.input_schema && typeof tool.input_schema === "object"
        ? tool.input_schema
        : { type: "object" },
  }));
}

export function toOpenAiToolDefinitions(tools: Tool[]): OpenAiToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters:
        tool.input_schema && typeof tool.input_schema === "object"
          ? (tool.input_schema as Record<string, unknown>)
          : { type: "object", properties: {} },
    },
  }));
}

function parseToolCallArguments(raw: string): Record<string, unknown> {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _raw: trimmed };
  } catch {
    return { _raw: trimmed };
  }
}

export function openAiToolCallToAnthropicToolUse(
  toolCall: OpenAiToolCallLike,
  fallbackId: string,
): {
  id: string;
  name: string;
  input: Record<string, unknown>;
  type: "tool_use";
} {
  return {
    id: String(toolCall?.id || fallbackId).trim() || fallbackId,
    name: String(toolCall?.function?.name || "").trim(),
    input: parseToolCallArguments(String(toolCall?.function?.arguments || "")),
    type: "tool_use",
  };
}
