import { spawn } from "node:child_process";
import type { Tool, ToolExecutionPolicyContext } from "../../core/types/index.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;

function getCommandBinary(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function executeCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(`exec error: ${signal.reason instanceof Error ? signal.reason.message : "command aborted"}`);
      return;
    }

    // This tool intentionally accepts shell syntax (pipes, redirects and compound
    // commands), so a shell is required here. All structured subprocesses elsewhere
    // use argument arrays with shell:false.
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return;
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      const clipped = chunk.subarray(0, remaining);
      outputBytes += clipped.length;
      if (target === "stdout") stdout += clipped.toString();
      else stderr += clipped.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));

    const finish = (message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
      // Output cap: exec entry in src/tools/core/output-caps (applied by the executor).
      resolve(message || output || "(no output)");
    };
    const onAbort = () => {
      aborted = true;
      killProcessTree(child.pid ?? 0);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid ?? 0);
    }, timeoutMs);

    child.on("error", (error) => finish(`exec error: ${error.message}`));
    child.on("close", (code) => {
      if (aborted) finish("exec error: command aborted");
      else if (timedOut) finish(`exec error: command timed out after ${timeoutMs}ms`);
      else if (code !== 0) finish(`exec error: command exited with code ${String(code)}\n${[stdout.trim(), stderr.trim()].filter(Boolean).join("\n")}`);
      else finish();
    });
  });
}

export function createExecTool(params: {
  approvalMode: "ask" | "auto" | "off";
  safeBinaries: string[];
  workspaceDir: string;
  timeoutMs?: number;
}): Tool {
  const safe = new Set(params.safeBinaries.map((entry) => entry.trim().toLowerCase()).filter(Boolean));

  return {
    name: "exec",
    description: "Execute a shell command in the current task workspace.",
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
    execute: async (
      input: { command?: string; timeoutMs?: number },
      context?: ToolExecutionPolicyContext,
    ) => {
      const command = String(input?.command ?? "").trim();
      if (!command) return "exec error: command is required";
      if (params.approvalMode === "off") return "exec is disabled by config (approval mode: off).";

      const binary = getCommandBinary(command);
      const explicitlyApproved = String(context?.source || "") === "agent-task-approved";
      if (params.approvalMode === "ask" && !safe.has(binary) && !explicitlyApproved) {
        return `exec pending approval: ${command}`;
      }

      const requestedTimeout = Number(input?.timeoutMs ?? params.timeoutMs ?? 30_000);
      const timeoutMs = Number.isFinite(requestedTimeout)
        ? Math.max(1_000, Math.min(120_000, requestedTimeout))
        : 30_000;
      return executeCommand(command, params.workspaceDir, timeoutMs, context?.abortSignal);
    },
  };
}
