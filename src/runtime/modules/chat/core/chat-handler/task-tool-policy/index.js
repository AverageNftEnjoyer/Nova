import { createHash } from "node:crypto";

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
  "phantom_capabilities",
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

function classifyTool(toolName, availableTools) {
  const normalized = String(toolName || "").trim().toLowerCase();
  const tool = availableTools.find((candidate) => String(candidate?.name || "").trim().toLowerCase() === normalized);
  const capabilities = Array.isArray(tool?.capabilities)
    ? tool.capabilities.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (tool?.riskLevel === "dangerous") return { risk: "dangerous", capabilities };
  if (tool?.riskLevel === "elevated") return { risk: "elevated", capabilities };
  if (tool?.riskLevel === "safe") return { risk: "safe", capabilities };
  if (SAFE_TOOL_NAMES.has(normalized)) return { risk: "safe", capabilities };
  if (ELEVATED_TOOL_NAMES.has(normalized)) return { risk: "elevated", capabilities };
  return { risk: "dangerous", capabilities };
}

export class AgentTaskApprovalRequiredError extends Error {
  constructor(toolName, approvalKey = "") {
    super(`Approval required before running elevated tool "${toolName}".`);
    this.name = "AgentTaskApprovalRequiredError";
    this.code = "AGENT_TASK_APPROVAL_REQUIRED";
    this.toolName = String(toolName || "unknown");
    this.approvalKey = String(approvalKey || this.toolName);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function createTaskApprovalKey(toolName, input) {
  const normalizedName = String(toolName || "unknown").trim().toLowerCase();
  const hash = createHash("sha256").update(JSON.stringify(stableValue(input ?? {}))).digest("hex");
  return `${normalizedName}:${hash}`;
}

export function resolveTaskToolPolicy(
  permissionMode,
  toolName,
  availableTools,
  approvedTools = [],
  toolInput = {},
) {
  const mode = String(permissionMode || "default");
  const normalizedName = String(toolName || "").trim().toLowerCase();
  const { risk, capabilities } = classifyTool(normalizedName, availableTools);
  const writesFiles = capabilities.includes("filesystem.write") || normalizedName === "write" || normalizedName === "edit";

  if (risk === "dangerous") {
    return { action: "deny", reason: "Dangerous tools are disabled for Agent Tasks by platform policy." };
  }
  if (risk === "safe") return { action: "allow", reason: "safe" };
  const requiredApprovalKey = createTaskApprovalKey(normalizedName, toolInput);
  if (approvedTools.map((entry) => String(entry || "").trim().toLowerCase()).includes(requiredApprovalKey)) {
    return { action: "allow", reason: "explicit-task-approval", approvalKey: requiredApprovalKey };
  }
  if (mode === "bypass") return { action: "allow", reason: "bypass-elevated" };
  if (mode === "accept-edits" && writesFiles) return { action: "allow", reason: "accepted-file-edit" };
  if (mode === "default" || mode === "accept-edits") {
    return { action: "approval", reason: "Elevated operation requires user approval." };
  }
  if (mode === "plan-mode") {
    return { action: "deny", reason: "Plan mode is read-only." };
  }
  return { action: "deny", reason: "Don't ask mode denies operations that would require approval." };
}

export function assertTaskToolAllowed(
  permissionMode,
  toolName,
  availableTools,
  approvedTools = [],
  executionFenceCheck,
  toolInput = {},
  consumeTaskApproval,
  reserveTaskEffect,
) {
  if (typeof executionFenceCheck === "function") executionFenceCheck();
  const decision = resolveTaskToolPolicy(permissionMode, toolName, availableTools, approvedTools, toolInput);
  if (decision.action === "approval") {
    throw new AgentTaskApprovalRequiredError(toolName, createTaskApprovalKey(toolName, toolInput));
  }
  if (decision.action === "deny") {
    const error = new Error(`Tool "${toolName}" blocked: ${decision.reason}`);
    error.code = "AGENT_TASK_TOOL_DENIED";
    throw error;
  }
  if (decision.reason === "explicit-task-approval" && typeof consumeTaskApproval === "function") {
    consumeTaskApproval(decision.approvalKey);
    const index = approvedTools.indexOf(decision.approvalKey);
    if (index >= 0) approvedTools.splice(index, 1);
  }
  if (
    classifyTool(toolName, availableTools).risk === "elevated"
    && typeof reserveTaskEffect === "function"
  ) {
    reserveTaskEffect(`tool:${createTaskApprovalKey(toolName, toolInput)}`);
  }
  return {
    allowElevatedTools: true,
    allowDangerousTools: false,
    source: decision.reason === "safe" ? "agent-task" : "agent-task-approved",
  };
}

export function assertAgentTaskExternalAction(ctx, actionName, { readOnly = false } = {}) {
  if (ctx?.autonomousTask !== true) return;
  if (typeof ctx?.executionFenceCheck === "function") ctx.executionFenceCheck();
  if (readOnly) return;
  const mode = String(ctx?.permissionMode || "default");
  const normalizedAction = String(actionName || "external action");
  const requiredApprovalKey = createTaskApprovalKey(normalizedAction, {
    text: String(ctx?.raw_text || ""),
  });
  const approved = Array.isArray(ctx?.approvedTools)
    && ctx.approvedTools.map((entry) => String(entry || "").trim().toLowerCase())
      .includes(requiredApprovalKey);
  if (approved) {
    if (typeof ctx?.consumeTaskApproval === "function") ctx.consumeTaskApproval(requiredApprovalKey);
    const index = ctx.approvedTools.indexOf(requiredApprovalKey);
    if (index >= 0) ctx.approvedTools.splice(index, 1);
    if (typeof ctx?.reserveTaskEffect === "function") {
      ctx.reserveTaskEffect(`external:${requiredApprovalKey}`);
    }
    return;
  }
  if (mode === "bypass") {
    if (typeof ctx?.reserveTaskEffect === "function") {
      ctx.reserveTaskEffect(`external:${requiredApprovalKey}`);
    }
    return;
  }
  if (mode === "default" || mode === "accept-edits") {
    throw new AgentTaskApprovalRequiredError(normalizedAction, requiredApprovalKey);
  }
  const error = new Error(`Agent Task permission mode "${mode}" blocks ${normalizedAction}.`);
  error.code = "AGENT_TASK_TOOL_DENIED";
  throw error;
}
