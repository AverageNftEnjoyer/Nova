import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../../core/types/index.js";

function assertInsideWorkspace(workspaceDir: string, targetPath: string): string {
  const absWorkspace = path.resolve(workspaceDir);
  const absTarget = path.resolve(absWorkspace, targetPath);
  const relative = path.relative(absWorkspace, absTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absTarget;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
      continue;
    }
    if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
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
      const target = assertInsideWorkspace(workspaceDir, String(input?.path ?? ""));
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
    execute: async (input: { path?: string; content?: string }) => {
      const target = assertInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      await fs.mkdir(path.dirname(target), { recursive: true });
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
    execute: async (input: { path?: string; old_str?: string; new_str?: string }) => {
      const target = assertInsideWorkspace(workspaceDir, String(input?.path ?? ""));
      const oldStr = String(input?.old_str ?? "");
      const newStr = String(input?.new_str ?? "");
      const raw = await fs.readFile(target, "utf8");
      const matches = raw.split(oldStr).length - 1;
      if (matches !== 1) {
        return `edit error: old_str must appear exactly once, found ${matches}`;
      }
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
      const target = assertInsideWorkspace(workspaceDir, String(input?.path ?? "."));
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
      const basePath = assertInsideWorkspace(workspaceDir, String(input?.path ?? "."));
      const files = await walk(basePath);
      const re = new RegExp(pattern, "i");
      const hits: string[] = [];

      for (const file of files) {
        const raw = await fs.readFile(file, "utf8").catch(() => "");
        if (!raw) continue;
        const lines = raw.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? "";
          if (re.test(line)) {
            const rel = path.relative(workspaceDir, file).replace(/\\/g, "/");
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
          if (hits.length >= 200) break;
        }
        if (hits.length >= 200) break;
      }

      return hits.length ? hits.join("\n") : "No matches.";
    },
  };

  return [readTool, writeTool, editTool, lsTool, grepTool];
}
