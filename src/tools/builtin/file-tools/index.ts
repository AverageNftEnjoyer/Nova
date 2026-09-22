import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolExecutionPolicyContext } from "../../core/types/index.js";

const FILE_GREP_MAX_PARALLEL = Math.max(
  1,
  Math.min(24, Number.parseInt(process.env.NOVA_FILE_GREP_MAX_PARALLEL || "8", 10) || 8),
);

function assertSafePathSyntax(targetPath: string): void {
  if (targetPath.includes("\0")) throw new Error("Path contains a null byte.");
  if (process.platform !== "win32") return;
  const normalized = targetPath.replace(/\//g, "\\");
  if (normalized.startsWith("\\\\?\\") || normalized.startsWith("\\\\.\\") || normalized.startsWith("\\\\")) {
    throw new Error("Windows device and UNC paths are not allowed.");
  }
  const withoutDrive = normalized.replace(/^[a-zA-Z]:/, "");
  if (withoutDrive.includes(":")) throw new Error("Windows alternate data streams are not allowed.");
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (withoutDrive.split("\\").some((segment) => reserved.test(segment))) {
    throw new Error("Windows reserved device names are not allowed.");
  }
}

function assertCanonicalInside(absWorkspace: string, absTarget: string, targetPath: string): string {
  const relative = path.relative(absWorkspace, absTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absTarget;
}

async function resolveExistingInsideWorkspace(workspaceDir: string, targetPath: string): Promise<string> {
  assertSafePathSyntax(targetPath);
  const absWorkspace = await fs.realpath(path.resolve(workspaceDir));
  const lexicalTarget = path.resolve(absWorkspace, targetPath);
  assertCanonicalInside(absWorkspace, lexicalTarget, targetPath);
  const realTarget = await fs.realpath(lexicalTarget);
  return assertCanonicalInside(absWorkspace, realTarget, targetPath);
}

async function resolveWritableInsideWorkspace(workspaceDir: string, targetPath: string): Promise<string> {
  assertSafePathSyntax(targetPath);
  const absWorkspace = await fs.realpath(path.resolve(workspaceDir));
  const lexicalTarget = path.resolve(absWorkspace, targetPath);
  assertCanonicalInside(absWorkspace, lexicalTarget, targetPath);

  const existingTarget = await fs.lstat(lexicalTarget).catch(() => null);
  if (existingTarget) {
    if (existingTarget.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${targetPath}`);
    const realTarget = await fs.realpath(lexicalTarget);
    return assertCanonicalInside(absWorkspace, realTarget, targetPath);
  }

  let existingParent = path.dirname(lexicalTarget);
  while (existingParent !== absWorkspace) {
    const stat = await fs.lstat(existingParent).catch(() => null);
    if (stat) {
      if (stat.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${targetPath}`);
      break;
    }
    const next = path.dirname(existingParent);
    if (next === existingParent) throw new Error(`Cannot resolve parent directory for: ${targetPath}`);
    existingParent = next;
  }
  const realParent = await fs.realpath(existingParent);
  assertCanonicalInside(absWorkspace, realParent, targetPath);
  return lexicalTarget;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      directories.push(full);
      continue;
    }
    if (entry.isFile()) {
      files.push(full);
    }
  }
  const nestedFiles = await mapWithConcurrency(
    directories,
    FILE_GREP_MAX_PARALLEL,
    async (subdir): Promise<string[]> => walk(subdir),
  );
  for (const nested of nestedFiles) {
    files.push(...nested);
  }
  return files;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeConcurrency = Math.max(1, Math.min(items.length, Number(concurrency) || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

export function createFileTools(workspaceDir: string): Tool[] {
  const readTool: Tool = {
    name: "read",
    description: "Read file content from workspace. Optional line range support.",
    capabilities: ["filesystem.read"],
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    execute: async (input: { path?: string; startLine?: number; endLine?: number }) => {
      const target = await resolveExistingInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      const raw = await fs.readFile(target, "utf8");
      const start = Number(input?.startLine ?? 1);
      const end = Number(input?.endLine ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
        return raw;
      }
      const lines = raw.split(/\r?\n/);
      return lines.slice(start - 1, end).join("\n");
    },
  };

  const writeTool: Tool = {
    name: "write",
    description: "Write content to a file (create or overwrite).",
    capabilities: ["filesystem.write"],
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    execute: async (input: { path?: string; content?: string }, context?: ToolExecutionPolicyContext) => {
      if (context?.abortSignal?.aborted) throw context.abortSignal.reason || new Error("File write aborted.");
      const target = await resolveWritableInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await resolveWritableInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      if (context?.abortSignal?.aborted) throw context.abortSignal.reason || new Error("File write aborted.");
      await fs.writeFile(target, String(input?.content ?? ""), "utf8");
      return `Wrote ${target}`;
    },
  };

  const editTool: Tool = {
    name: "edit",
    description: "Replace a unique string in a file.",
    capabilities: ["filesystem.write"],
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_str: { type: "string" },
        new_str: { type: "string" },
      },
      required: ["path", "old_str", "new_str"],
      additionalProperties: false,
    },
    execute: async (
      input: { path?: string; old_str?: string; new_str?: string },
      context?: ToolExecutionPolicyContext,
    ) => {
      if (context?.abortSignal?.aborted) throw context.abortSignal.reason || new Error("File edit aborted.");
      const target = await resolveWritableInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      const oldStr = String(input?.old_str ?? "");
      const newStr = String(input?.new_str ?? "");
      const raw = await fs.readFile(target, "utf8");
      const matches = raw.split(oldStr).length - 1;
      if (matches !== 1) {
        return `edit error: old_str must appear exactly once, found ${matches}`;
      }
      if (context?.abortSignal?.aborted) throw context.abortSignal.reason || new Error("File edit aborted.");
      await fs.writeFile(target, raw.replace(oldStr, newStr), "utf8");
      return `Edited ${target}`;
    },
  };

  const lsTool: Tool = {
    name: "ls",
    description: "List directory contents.",
    capabilities: ["filesystem.read"],
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      additionalProperties: false,
    },
    execute: async (input: { path?: string }) => {
      const target = await resolveExistingInsideWorkspace(workspaceDir, String(input?.path ?? "."));
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`)
        .join("\n");
    },
  };

  const grepTool: Tool = {
    name: "grep",
    description: "Search files in workspace for a pattern.",
    capabilities: ["filesystem.read"],
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    execute: async (input: { pattern?: string; path?: string }) => {
      const pattern = String(input?.pattern ?? "");
      if (!pattern) return "grep error: pattern is required";
      const basePath = await resolveExistingInsideWorkspace(workspaceDir, String(input?.path ?? "."));
      const files = await walk(basePath);
      const re = new RegExp(pattern, "i");
      const perFileHits = await mapWithConcurrency(
        files,
        FILE_GREP_MAX_PARALLEL,
        async (file): Promise<string[]> => {
          const raw = await fs.readFile(file, "utf8").catch(() => "");
          if (!raw) return [];
          const lines = raw.split(/\r?\n/);
          const hits: string[] = [];
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i] ?? "";
            if (re.test(line)) {
              const rel = path.relative(workspaceDir, file).replace(/\\/g, "/");
              hits.push(`${rel}:${i + 1}: ${line.trim()}`);
              if (hits.length >= 200) break;
            }
          }
          return hits;
        },
      );

      const hits: string[] = [];
      for (const fileHits of perFileHits) {
        for (const hit of fileHits) {
          hits.push(hit);
          if (hits.length >= 200) break;
        }
        if (hits.length >= 200) break;
      }

      return hits.length ? hits.join("\n") : "No matches.";
    },
  };

  return [readTool, writeTool, editTool, lsTool, grepTool];
}
