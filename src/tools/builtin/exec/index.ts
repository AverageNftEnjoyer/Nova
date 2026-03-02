import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../../core/types/index.js";

const execAsync = promisify(execCb);

function truncate(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function getCommandBinary(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export function createExecTool(params: {
  approvalMode: "ask" | "auto" | "off";
  safeBinaries: string[];
  timeoutMs?: number;
}): Tool {
  const safe = new Set(params.safeBinaries.map((entry) => entry.trim().toLowerCase()).filter(Boolean));

  return {
    name: "exec",
    description: "Execute shell commands in the local environment.",
    capabilities: ["process.exec"],
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    execute: async (input: { command?: string; timeoutMs?: number }) => {
      const command = String(input?.command ?? "").trim();
      if (!command) return "exec error: command is required";
      if (params.approvalMode === "off") {
        return "exec is disabled by config (approval mode: off).";
      }

      const binary = getCommandBinary(command);
      const isSafe = safe.has(binary);

      if (params.approvalMode === "ask" && !isSafe) {
        return `exec pending approval: ${command}`;
      }

      const timeoutMs = Number(input?.timeoutMs ?? params.timeoutMs ?? 30_000);
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: Number.isFinite(timeoutMs) ? timeoutMs : 30_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });

        const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n").trim();
        return truncate(out || "(no output)");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return truncate(`exec error: ${message}`);
      }
    },
  };
}
