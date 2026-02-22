import type { ToolsConfig } from "../../config/types.js";
import { createCoinbaseTools } from "../builtin/coinbase-tools.js";
import type { MemoryIndexManager } from "../../memory/manager.js";
import { createExecTool } from "../builtin/exec.js";
import { createFileTools } from "../builtin/file-tools.js";
import { createMemoryTools } from "../builtin/memory-tools.js";
import type { Tool } from "./types.js";
import { createWebFetchTool } from "../web/web-fetch.js";
import { createWebSearchTool } from "../web/web-search.js";

export function createToolRegistry(
  config: ToolsConfig,
  params: { workspaceDir: string; memoryManager: MemoryIndexManager | null },
): Tool[] {
  const enabled = new Set(config.enabledTools.map((name) => name.trim()).filter(Boolean));
  const registry: Tool[] = [];

  const fileTools = createFileTools(params.workspaceDir);
  for (const tool of fileTools) {
    if (enabled.has(tool.name)) registry.push(tool);
  }

  if (enabled.has("exec")) {
    registry.push(
      createExecTool({
        approvalMode: config.execApprovalMode,
        safeBinaries: config.safeBinaries,
      }),
    );
  }

  if (enabled.has("web_search")) {
    registry.push(
      createWebSearchTool({
        provider: config.webSearchProvider,
        apiKey: config.webSearchApiKey,
      }),
    );
  }

  if (enabled.has("web_fetch")) {
    registry.push(createWebFetchTool());
  }

  if (params.memoryManager && (enabled.has("memory_search") || enabled.has("memory_get"))) {
    for (const tool of createMemoryTools(params.memoryManager)) {
      if (enabled.has(tool.name)) {
        registry.push(tool);
      }
    }
  }

  if (
    enabled.has("coinbase_capabilities") ||
    enabled.has("coinbase_spot_price") ||
    enabled.has("coinbase_portfolio_snapshot") ||
    enabled.has("coinbase_recent_transactions") ||
    enabled.has("coinbase_portfolio_report")
  ) {
    for (const tool of createCoinbaseTools({ workspaceDir: params.workspaceDir })) {
      if (enabled.has(tool.name)) {
        registry.push(tool);
      }
    }
  }

  return registry;
}
