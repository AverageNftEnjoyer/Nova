import {
  evaluateToolCapabilityPolicy,
  resolveToolCapabilities,
} from "../capability-policy/index.js";
import { classifyToolRisk, evaluateToolPolicy } from "../risk-policy/index.js";
import type {
  AnthropicToolUseBlock,
  Tool,
  ToolExecutionPolicyContext,
  ToolResult,
} from "../types/index.js";

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
  policyContext?: ToolExecutionPolicyContext,
): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.name === toolUse.name);
  if (!tool) {
    return {
      tool_use_id: toolUse.id,
      content: `Unknown tool: ${toolUse.name}`,
      is_error: true,
    };
  }

  const risk = classifyToolRisk(tool.name, tool.riskLevel);
  const policy = evaluateToolPolicy({
    toolName: tool.name,
    risk,
    context: policyContext,
  });
  if (!policy.allowed) {
    console.warn(
      `[ToolPolicy] blocked tool=${tool.name} risk=${risk} source=${String(policyContext?.source || "unknown")}`,
    );
    return {
      tool_use_id: toolUse.id,
      content: `Tool blocked by policy: ${policy.reason}`,
      is_error: true,
    };
  }

  const requiredCapabilities = resolveToolCapabilities(tool.name, tool.capabilities);
  const capabilityPolicy = evaluateToolCapabilityPolicy({
    toolName: tool.name,
    requiredCapabilities,
    context: policyContext,
  });
  if (!capabilityPolicy.allowed) {
    console.warn(
      `[ToolCapability] blocked tool=${tool.name}` +
      ` required=${requiredCapabilities.join("|") || "none"}` +
      ` source=${String(policyContext?.source || "unknown")}`,
    );
    return {
      tool_use_id: toolUse.id,
      content: `Tool blocked by capability policy: ${capabilityPolicy.reason}`,
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
