import type { ToolsConfig } from "../../../config/types/index.js";
import { createCoinbaseTools } from "../../builtin/coinbase-tools/index.js";
import { createGmailTools } from "../../builtin/gmail-tools/index.js";
import type { MemoryIndexManager } from "../../../memory/manager/index.js";
import { createExecTool } from "../../builtin/exec/index.js";
import { createBrowserAgentTool } from "../../builtin/browser-agent/index.js";
import { createFileTools } from "../../builtin/file-tools/index.js";
import { createMemoryTools } from "../../builtin/memory-tools/index.js";
import type { Tool } from "../types/index.js";
import { createWebFetchTool } from "../../web/web-fetch/index.js";
import { createWebSearchTool } from "../../web/web-search/index.js";

const COINBASE_TOOL_NAMES = [
  "coinbase_capabilities",
  "coinbase_spot_price",
  "coinbase_portfolio_snapshot",
  "coinbase_recent_transactions",
  "coinbase_portfolio_report",
] as const;

const GMAIL_TOOL_NAMES = [
  "gmail_capabilities",
  "gmail_list_accounts",
  "gmail_scope_check",
  "gmail_list_messages",
  "gmail_get_message",
  "gmail_daily_summary",
  "gmail_classify_importance",
  "gmail_forward_message",
  "gmail_reply_draft",
] as const;

function normalizeToolName(name: string): string {
  return String(name || "").trim().toLowerCase();
}

function hasAnyEnabled(enabled: Set<string>, toolNames: readonly string[]): boolean {
  return toolNames.some((name) => enabled.has(name));
}

export function createToolRegistry(
  config: ToolsConfig,
  params: { workspaceDir: string; memoryManager: MemoryIndexManager | null },
): Tool[] {
  const enabled = new Set(config.enabledTools.map(normalizeToolName).filter(Boolean));
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

  if (enabled.has("browser_agent")) {
    registry.push(createBrowserAgentTool());
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

  if (hasAnyEnabled(enabled, COINBASE_TOOL_NAMES)) {
    for (const tool of createCoinbaseTools({ workspaceDir: params.workspaceDir })) {
      if (enabled.has(tool.name)) {
        registry.push(tool);
      }
    }
  }

  if (hasAnyEnabled(enabled, GMAIL_TOOL_NAMES)) {
    for (const tool of createGmailTools({ workspaceDir: params.workspaceDir })) {
      if (enabled.has(tool.name)) {
        registry.push(tool);
      }
    }
  }

  return registry;
}
