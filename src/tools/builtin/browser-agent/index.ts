import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../../core/types/index.js";

const execFileAsync = promisify(execFileCb);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 1_024;
const SESSION_RE = /^browser:[a-z0-9_-]{1,96}:[a-z0-9._-]{1,128}$/i;
const COMMAND_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
const RESERVED_GLOBAL_FLAGS = new Set([
  "--session",
  "--json",
  "--headed",
  "--allowed-domains",
  "--action-policy",
  "--confirm-actions",
]);

function isReservedFlagArg(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  for (const flag of RESERVED_GLOBAL_FLAGS) {
    if (normalized === flag || normalized.startsWith(`${flag}=`)) return true;
  }
  return false;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function normalizeTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(parsed)));
}

function normalizeMaxOutputChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_OUTPUT_CHARS;
  return Math.min(MAX_OUTPUT_CHARS, Math.max(1_000, Math.floor(parsed)));
}

function normalizeCsv(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(",");
}

function normalizeArgs(values: unknown): { args: string[]; error?: string } {
  if (!Array.isArray(values)) return { args: [] };
  if (values.length > MAX_ARGS) {
    return { args: [], error: `browser_agent error: args supports at most ${MAX_ARGS} entries.` };
  }
  const args = values.map((value) => String(value ?? ""));
  for (const value of args) {
    if (value.length > MAX_ARG_LENGTH) {
      return {
        args: [],
        error: `browser_agent error: each arg must be at most ${MAX_ARG_LENGTH} characters.`,
      };
    }
    if (isReservedFlagArg(value)) {
      return {
        args: [],
        error: `browser_agent error: do not pass ${value} in args; use dedicated input fields.`,
      };
    }
  }
  return { args };
}

export function createBrowserAgentTool(): Tool {
  return {
    name: "browser_agent",
    description: "Run an agent-browser command in a scoped browser session.",
    riskLevel: "elevated",
    capabilities: ["automation.browser.execute"],
    input_schema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description:
            "Required scoped session key in format browser:<userContextId>:<conversationId>.",
        },
        command: {
          type: "string",
          description: "agent-browser command token (examples: open, snapshot, click, wait, close).",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Additional command arguments.",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds (max 120000).",
        },
        json: {
          type: "boolean",
          description: "When true (default), adds --json for machine-readable output.",
        },
        headed: {
          type: "boolean",
          description: "When true, runs browser in headed mode.",
        },
        allowedDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domain allowlist passed via --allowed-domains.",
        },
        actionPolicyPath: {
          type: "string",
          description: "Optional action policy JSON path passed via --action-policy.",
        },
        confirmActions: {
          type: "array",
          items: { type: "string" },
          description: "Optional action categories requiring confirmation.",
        },
        maxOutputChars: {
          type: "number",
          description: "Maximum output characters in tool response (default 12000, max 32000).",
        },
      },
      required: ["session", "command"],
      additionalProperties: false,
    },
    execute: async (input: {
      session?: string;
      command?: string;
      args?: string[];
      timeoutMs?: number;
      json?: boolean;
      headed?: boolean;
      allowedDomains?: string[];
      actionPolicyPath?: string;
      confirmActions?: string[];
      maxOutputChars?: number;
    }) => {
      const session = String(input?.session ?? "").trim();
      if (!session) return "browser_agent error: session is required.";
      if (!SESSION_RE.test(session)) {
        return "browser_agent error: session must match browser:<userContextId>:<conversationId>.";
      }

      const command = String(input?.command ?? "").trim();
      if (!COMMAND_RE.test(command)) {
        return "browser_agent error: command must match /^[a-z][a-z0-9_-]{0,63}$/i.";
      }

      const normalizedArgs = normalizeArgs(input?.args);
      if (normalizedArgs.error) return normalizedArgs.error;
      const args = normalizedArgs.args;

      const argv: string[] = ["--session", session];
      if (input?.json !== false) argv.push("--json");
      if (input?.headed === true) argv.push("--headed");

      const allowedDomainsCsv = normalizeCsv(input?.allowedDomains);
      if (allowedDomainsCsv) argv.push("--allowed-domains", allowedDomainsCsv);

      const actionPolicyPath = String(input?.actionPolicyPath ?? "").trim();
      if (actionPolicyPath) argv.push("--action-policy", actionPolicyPath);

      const confirmActionsCsv = normalizeCsv(input?.confirmActions);
      if (confirmActionsCsv) argv.push("--confirm-actions", confirmActionsCsv);

      argv.push(command, ...args);

      const timeoutMs = normalizeTimeoutMs(input?.timeoutMs);
      const maxOutputChars = normalizeMaxOutputChars(input?.maxOutputChars);

      try {
        const { stdout, stderr } = await execFileAsync("agent-browser", argv, {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: process.env,
        });
        const output = [String(stdout || "").trim(), String(stderr || "").trim()]
          .filter(Boolean)
          .join("\n")
          .trim();
        return truncate(output || "(no output)", maxOutputChars);
      } catch (err) {
        const error = err as {
          code?: string | number;
          stdout?: string;
          stderr?: string;
          message?: string;
          signal?: string;
        };
        if (String(error?.code || "").toUpperCase() === "ENOENT") {
          return "browser_agent error: agent-browser binary not found. Install agent-browser first.";
        }
        const parts = [
          `browser_agent error: ${error?.message || "command failed"}`,
          String(error?.stdout || "").trim(),
          String(error?.stderr || "").trim(),
        ]
          .filter(Boolean)
          .join("\n")
          .trim();
        return truncate(parts || "browser_agent error: command failed", maxOutputChars);
      }
    },
  };
}
