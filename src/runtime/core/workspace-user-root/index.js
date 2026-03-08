import fs from "node:fs";
import path from "node:path";

export const RESERVED_SRC_USER_ENTRY = ".user";
export const RESERVED_SRC_USER_SENTINEL = [
  "Reserved path: Nova user state must live at /.user, never at /src/.user.",
  "Do not replace this file with a directory.",
  "",
].join("\n");

function normalizePathForCompare(value) {
  return path.resolve(String(value || ""))
    .replace(/\//g, path.sep)
    .toLowerCase();
}

function isSamePathOrChild(candidatePath, parentPath) {
  const normalizedCandidate = normalizePathForCompare(candidatePath);
  const normalizedParent = normalizePathForCompare(parentPath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

export function resolveWorkspaceRoot(startDir = process.cwd()) {
  const fallback = path.resolve(String(startDir || process.cwd() || "."));
  let current = fallback;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, "hud")) && fs.existsSync(path.join(current, "src"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return fallback;
}

export function resolveReservedSrcUserPath(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || process.cwd() || ".")), "src", RESERVED_SRC_USER_ENTRY);
}

export function assertPathIsNotUnderReservedSrcUserPath(candidatePath, workspaceRoot, label = "path") {
  const reservedPath = resolveReservedSrcUserPath(workspaceRoot);
  if (isSamePathOrChild(candidatePath, reservedPath)) {
    throw new Error(`${label} may not resolve under ${reservedPath}. Nova user state must stay under ${path.join(path.resolve(workspaceRoot), ".user")}.`);
  }
}

export function enforceWorkspaceUserStateInvariant(workspaceRootInput = process.cwd(), options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootInput);
  const reservedSrcUserPath = resolveReservedSrcUserPath(workspaceRoot);
  const userDataRoot = path.join(workspaceRoot, ".user");
  const userContextRoot = path.join(userDataRoot, "user-context");
  const ensureSentinel = options?.ensureSentinel !== false;

  if (fs.existsSync(reservedSrcUserPath)) {
    const stat = fs.lstatSync(reservedSrcUserPath);
    if (stat.isDirectory()) {
      throw new Error(`Invalid duplicate user state root detected at ${reservedSrcUserPath}. Use ${userDataRoot} only.`);
    }
    if (!stat.isFile()) {
      throw new Error(`Reserved workspace path ${reservedSrcUserPath} must remain a file.`);
    }
  } else if (ensureSentinel) {
    fs.writeFileSync(reservedSrcUserPath, RESERVED_SRC_USER_SENTINEL, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  return {
    workspaceRoot,
    reservedSrcUserPath,
    userDataRoot,
    userContextRoot,
  };
}
