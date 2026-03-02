import type { Tool } from "../../tools/core/types/index.js";

export function formatToolSummaries(tools: Tool[]): string {
  if (tools.length === 0) {
    return "- No tools available.";
  }
  return tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}
