import type { ToolExecutionPolicyContext } from "./types.js";

const DEFAULT_TOOL_CAPABILITIES: Record<string, string[]> = {
  read: ["filesystem.read"],
  ls: ["filesystem.read"],
  grep: ["filesystem.read"],
  write: ["filesystem.write"],
  edit: ["filesystem.write"],
  exec: ["process.exec"],
  web_search: ["network.search"],
  web_fetch: ["network.fetch"],
  memory_search: ["memory.read"],
  memory_get: ["memory.read"],
};

function parseCsvSet(values: string | undefined): Set<string> {
  if (!values) return new Set<string>();
  return new Set(
    String(values)
      .split(",")
      .map((value) => normalizeCapability(value))
      .filter(Boolean),
  );
}

const ENV_ENFORCE_CAPABILITIES =
  String(process.env.NOVA_TOOL_CAPABILITY_ENFORCE || "0").trim() === "1";
const ENV_CAPABILITY_ALLOWLIST = parseCsvSet(process.env.NOVA_TOOL_CAPABILITY_ALLOWLIST);
const ENV_CAPABILITY_DENYLIST = parseCsvSet(process.env.NOVA_TOOL_CAPABILITY_DENYLIST);

function normalizeCapability(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function combineCapabilityRules(
  base: Set<string>,
  extra: readonly string[] | undefined,
): Set<string> {
  if (!extra || extra.length === 0) return base;
  const next = new Set(base);
  for (const entry of extra) {
    const normalized = normalizeCapability(entry);
    if (normalized) next.add(normalized);
  }
  return next;
}

function capabilityMatchesRule(capability: string, rule: string): boolean {
  if (rule === "*") return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1);
    return capability.startsWith(prefix);
  }
  return capability === rule;
}

function capabilityAllowed(
  capability: string,
  allowlist: Set<string>,
  toolName: string,
): boolean {
  if (allowlist.size === 0) return false;
  if (allowlist.has("*")) return true;
  if (allowlist.has(`tool:${toolName}`)) return true;
  for (const rule of allowlist) {
    if (rule.startsWith("tool:")) continue;
    if (capabilityMatchesRule(capability, rule)) return true;
  }
  return false;
}

function capabilityDenied(
  capability: string,
  denylist: Set<string>,
  toolName: string,
): boolean {
  if (denylist.size === 0) return false;
  if (denylist.has("*")) return true;
  if (denylist.has(`tool:${toolName}`)) return true;
  for (const rule of denylist) {
    if (rule.startsWith("tool:")) continue;
    if (capabilityMatchesRule(capability, rule)) return true;
  }
  return false;
}

export function resolveToolCapabilities(
  toolName: string,
  explicitCapabilities?: readonly string[],
): string[] {
  const fromTool = Array.isArray(explicitCapabilities) ? explicitCapabilities : [];
  const source = fromTool.length > 0 ? fromTool : (DEFAULT_TOOL_CAPABILITIES[toolName] || []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of source) {
    const normalized = normalizeCapability(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function evaluateToolCapabilityPolicy(params: {
  toolName: string;
  requiredCapabilities: readonly string[];
  context?: ToolExecutionPolicyContext;
}): {
  allowed: boolean;
  reason: string;
  requiredCapabilities: string[];
  missingCapabilities: string[];
} {
  const toolName = normalizeCapability(params.toolName);
  const requiredCapabilities = resolveToolCapabilities(toolName, params.requiredCapabilities);
  const context = params.context || {};
  const enforceCapabilities =
    typeof context.enforceCapabilities === "boolean"
      ? context.enforceCapabilities
      : ENV_ENFORCE_CAPABILITIES;
  const allowlist = combineCapabilityRules(
    ENV_CAPABILITY_ALLOWLIST,
    Array.isArray(context.capabilityAllowlist) ? context.capabilityAllowlist : undefined,
  );
  const denylist = combineCapabilityRules(
    ENV_CAPABILITY_DENYLIST,
    Array.isArray(context.capabilityDenylist) ? context.capabilityDenylist : undefined,
  );

  const denied = requiredCapabilities.find((capability) =>
    capabilityDenied(capability, denylist, toolName),
  );
  if (denied) {
    return {
      allowed: false,
      reason: `Capability denied by policy: ${denied}`,
      requiredCapabilities,
      missingCapabilities: [denied],
    };
  }

  if (!enforceCapabilities || requiredCapabilities.length === 0) {
    return {
      allowed: true,
      reason: enforceCapabilities ? "no-required-capabilities" : "capability-policy-disabled",
      requiredCapabilities,
      missingCapabilities: [],
    };
  }

  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !capabilityAllowed(capability, allowlist, toolName),
  );

  if (missingCapabilities.length > 0) {
    return {
      allowed: false,
      reason:
        `Tool requires capability grant: ${missingCapabilities.join(", ")}. ` +
        "Provide NOVA_TOOL_CAPABILITY_ALLOWLIST or per-request capabilityAllowlist.",
      requiredCapabilities,
      missingCapabilities,
    };
  }

  return {
    allowed: true,
    reason: "capability-allowed",
    requiredCapabilities,
    missingCapabilities: [],
  };
}
