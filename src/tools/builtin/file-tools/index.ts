import fs from "node:fs/promises";
import path from "node:path";
import {
  GREP_LINE_MAX_CHARS,
  READ_DEFAULT_WINDOW_LINES,
  TOOL_OUTPUT_LIMITS,
  TOOL_OUTPUT_MARKER_MAX_CHARS,
  formatTruncationMarker,
} from "../../core/output-caps/index.js";
import type { Tool, ToolExecutionPolicyContext } from "../../core/types/index.js";

const FILE_GREP_MAX_PARALLEL = Math.max(
  1,
  Math.min(24, Number.parseInt(process.env.NOVA_FILE_GREP_MAX_PARALLEL || "8", 10) || 8),
);

// `read` cuts by whole lines so its marker can name the next startLine. Body + marker stay inside the registry cap,
// so the executor's central cap never cuts a read result a second time.
const READ_BODY_MAX_CHARS = TOOL_OUTPUT_LIMITS.read.maxChars - TOOL_OUTPUT_MARKER_MAX_CHARS;

function readLineWindow(raw: string, startLine: unknown, endLine: unknown): string {
  const lines = raw.split(/\r?\n/);
  const totalLines = raw.endsWith("\n") ? lines.length - 1 : lines.length;
  let start = startLine === undefined || startLine === null ? 1 : Number(startLine);
  let end = endLine === undefined || endLine === null ? Number.NaN : Number(endLine);
  let hasEnd = !Number.isNaN(end);
  if (!Number.isFinite(start) || start < 1 || (hasEnd && (!Number.isFinite(end) || end < start))) {
    // Invalid range: fall back to the default window from the top (it used to return the whole file).
    start = 1;
    end = Number.NaN;
    hasEnd = false;
  }
  start = Math.floor(start);
  if (!hasEnd && start === 1 && totalLines <= READ_DEFAULT_WINDOW_LINES && raw.length <= READ_BODY_MAX_CHARS) {
    return raw;
  }
  if (start > Math.max(totalLines, 1)) {
    return `read error: startLine ${start} is past the end of the file (${totalLines} lines).`;
  }

  const rangeEnd = hasEnd
    ? Math.min(Math.floor(end), lines.length)
    : Math.min(start + READ_DEFAULT_WINDOW_LINES - 1, lines.length);
  const kept: string[] = [];
  let chars = 0;
  let cutLine: { line: number; shown: number; total: number } | null = null;
  for (let index = start - 1; index < rangeEnd; index += 1) {
    const line = lines[index] ?? "";
    const added = (kept.length > 0 ? 1 : 0) + line.length;
    if (chars + added > READ_BODY_MAX_CHARS) {
      if (kept.length === 0) {
        // A single line longer than the whole budget (minified code, one-line JSON): return its start.
        kept.push(line.slice(0, READ_BODY_MAX_CHARS));
        cutLine = { line: index + 1, shown: READ_BODY_MAX_CHARS, total: line.length };
      }
      break;
    }
    kept.push(line);
    chars += added;
  }

  const body = kept.join("\n");
  const lastShown = start + kept.length - 1;
  const requestedEnd = hasEnd ? Math.min(Math.floor(end), totalLines) : totalLines;
  if (cutLine) {
    const next = cutLine.line < totalLines ? ` Call read with startLine=${cutLine.line + 1} to continue after it.` : "";
    return body + formatTruncationMarker(
      `showing the first ${cutLine.shown} of ${cutLine.total} chars of line ${cutLine.line} (file has ${totalLines} lines).`,
      `The line is too long to return in full; use grep for the part you need.${next}`,
    );
  }
  if (lastShown >= requestedEnd) return body;
  const notShown = requestedEnd - lastShown;
  if (hasEnd) {
    return body + formatTruncationMarker(
      `showing lines ${start}-${lastShown} of the requested ${start}-${requestedEnd} (file has ${totalLines} lines); ${notShown} lines not shown (${TOOL_OUTPUT_LIMITS.read.maxChars}-char limit).`,
      `Call read with startLine=${lastShown + 1} and endLine=${requestedEnd} to continue.`,
    );
  }
  return body + formatTruncationMarker(
    `showing lines ${start}-${lastShown} of ${totalLines}; ${notShown} more lines not shown.`,
    `Call read with startLine=${lastShown + 1} (and optionally endLine) to continue.`,
  );
}

// Chars kept before the first match when a long grep line is cut, so the match shows with some leading context.
const GREP_LINE_CONTEXT_BEFORE_MATCH = 100;

/**
 * One matched line as grep shows it. Lines up to GREP_LINE_MAX_CHARS come back whole (trimmed); a longer line is cut
 * to a window around the first match plus a deterministic note, e.g.
 * `...<300 chars>... [line cut: chars 4901-5200 of 250000]`.
 */
export function formatGrepLine(line: string, re: RegExp): string {
  const text = line.trim();
  if (text.length <= GREP_LINE_MAX_CHARS) return text;
  const matchIndex = re.exec(text)?.index ?? 0;
  const start = Math.max(0, Math.min(matchIndex - GREP_LINE_CONTEXT_BEFORE_MATCH, text.length - GREP_LINE_MAX_CHARS));
  const end = start + GREP_LINE_MAX_CHARS;
  const window = text.slice(start, end);
  return `${start > 0 ? "..." : ""}${window}${end < text.length ? "..." : ""} [line cut: chars ${start + 1}-${end} of ${text.length}]`;
}

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
      return readLineWindow(raw, input?.startLine, input?.endLine);
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
              hits.push(`${rel}:${i + 1}: ${formatGrepLine(line, re)}`);
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
