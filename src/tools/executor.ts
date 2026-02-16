import type { AnthropicToolUseBlock, Tool, ToolResult } from "./types.js";

function stringifyInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export async function executeToolUse(
  toolUse: AnthropicToolUseBlock,
  tools: Tool[],
): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.name === toolUse.name);
  if (!tool) {
    return {
      tool_use_id: toolUse.id,
      content: `Unknown tool: ${toolUse.name}`,
      is_error: true,
    };
  }

  try {
    const output = await tool.execute(toolUse.input);
    return {
      tool_use_id: toolUse.id,
      content: output,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool_use_id: toolUse.id,
      content: `Tool execution failed: ${message}\nInput:\n${stringifyInput(toolUse.input)}`,
      is_error: true,
    };
  }
}

export function toAnthropicToolResultBlock(result: ToolResult): {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
} {
  return {
    type: "tool_result",
    tool_use_id: result.tool_use_id,
    content: result.content,
    ...(result.is_error ? { is_error: true } : {}),
  };
}
