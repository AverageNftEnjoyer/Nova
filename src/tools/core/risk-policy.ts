import type { ToolExecutionPolicyContext, ToolRiskLevel } from "./types.js";

const SAFE_TOOL_NAMES = new Set([
  "read",
  "ls",
  "grep",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "coinbase_capabilities",
  "coinbase_spot_price",
  "coinbase_portfolio_snapshot",
  "coinbase_recent_transactions",
  "coinbase_portfolio_report",
  "gmail_capabilities",
  "gmail_list_accounts",
  "gmail_scope_check",
  "gmail_list_messages",
  "gmail_get_message",
  "gmail_daily_summary",
  "gmail_classify_importance",
]);

const ELEVATED_TOOL_NAMES = new Set([
  "write",
  "edit",
  "exec",
  "browser_agent",
  "gmail_forward_message",
  "gmail_reply_draft",
]);

// Keep this aligned with upstream dangerous tool semantics.
const DANGEROUS_TOOL_NAMES = new Set([
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "whatsapp_login",
  "spawn",
  "shell",
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
]);

function parseCsvSet(values: string | undefined): Set<string> {
  if (!values) return new Set<string>();
  return new Set(
    String(values)
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

const ENV_ALLOW_ELEVATED_TOOLS =
  String(process.env.NOVA_TOOL_ALLOW_ELEVATED || "1").trim() !== "0";
const ENV_ALLOW_DANGEROUS_TOOLS =
  String(process.env.NOVA_TOOL_ALLOW_DANGEROUS || "0").trim() === "1";
const ENV_ELEVATED_ALLOWLIST = parseCsvSet(process.env.NOVA_TOOL_ELEVATED_ALLOWLIST);
const ENV_DANGEROUS_ALLOWLIST = parseCsvSet(process.env.NOVA_TOOL_DANGEROUS_ALLOWLIST);

function normalizeToolName(toolName: string): string {
  return String(toolName || "").trim().toLowerCase();
}

function combineAllowlists(
  base: Set<string>,
  extra: readonly string[] | undefined,
): Set<string> {
  if (!extra || extra.length === 0) return base;
  const next = new Set(base);
  for (const entry of extra) {
    const normalized = normalizeToolName(entry);
    if (normalized) next.add(normalized);
  }
  return next;
}

function toolNameMatchesRule(toolName: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === "*") return true;
  if (rule.endsWith("*")) return toolName.startsWith(rule.slice(0, -1));
  return toolName === rule;
}

function allowlistIncludesTool(allowlist: Set<string>, toolName: string): boolean {
  if (allowlist.size === 0) return false;
  for (const rule of allowlist) {
    if (toolNameMatchesRule(toolName, rule)) return true;
  }
  return false;
}

export function classifyToolRisk(toolName: string, explicitRisk?: ToolRiskLevel): ToolRiskLevel {
  if (explicitRisk === "safe" || explicitRisk === "elevated" || explicitRisk === "dangerous") {
    return explicitRisk;
  }
  const normalized = normalizeToolName(toolName);
  if (SAFE_TOOL_NAMES.has(normalized)) return "safe";
  if (ELEVATED_TOOL_NAMES.has(normalized)) return "elevated";
  if (DANGEROUS_TOOL_NAMES.has(normalized)) return "dangerous";
  // Unknown tools fail closed.
  return "dangerous";
}

export function evaluateToolPolicy(params: {
  toolName: string;
  risk: ToolRiskLevel;
  context?: ToolExecutionPolicyContext;
}): { allowed: boolean; reason: string; risk: ToolRiskLevel } {
  const toolName = normalizeToolName(params.toolName);
  const risk = params.risk;
  const context = params.context || {};
  const allowElevatedTools =
    typeof context.allowElevatedTools === "boolean"
      ? context.allowElevatedTools
      : ENV_ALLOW_ELEVATED_TOOLS;
  const allowDangerousTools =
    typeof context.allowDangerousTools === "boolean"
      ? context.allowDangerousTools
      : ENV_ALLOW_DANGEROUS_TOOLS;
  const elevatedAllowlist = combineAllowlists(
    ENV_ELEVATED_ALLOWLIST,
    Array.isArray(context.elevatedAllowlist) ? context.elevatedAllowlist : undefined,
  );
  const dangerousAllowlist = combineAllowlists(
    ENV_DANGEROUS_ALLOWLIST,
    Array.isArray(context.dangerousAllowlist) ? context.dangerousAllowlist : undefined,
  );

  if (risk === "safe") {
    return { allowed: true, reason: "safe", risk };
  }

  if (risk === "elevated") {
    if (allowElevatedTools || allowlistIncludesTool(elevatedAllowlist, toolName)) {
      return { allowed: true, reason: "elevated-allowed", risk };
    }
    return {
      allowed: false,
      reason:
        "Tool is elevated-risk and blocked by policy. Set NOVA_TOOL_ALLOW_ELEVATED=1 or allowlist it.",
      risk,
    };
  }

  if (allowDangerousTools || allowlistIncludesTool(dangerousAllowlist, toolName)) {
    return { allowed: true, reason: "dangerous-allowed", risk };
  }

  return {
    allowed: false,
    reason:
      "Tool is dangerous and blocked by policy. Explicit elevation is required (NOVA_TOOL_ALLOW_DANGEROUS=1 or allowlist).",
    risk,
  };
}
