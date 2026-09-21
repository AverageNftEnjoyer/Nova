import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertPathIsNotUnderReservedSrcUserPath,
  resolveWorkspaceRoot as resolveWorkspaceRootFrom,
} from "../runtime/core/workspace-user-root/index.js";

export const DB_FILENAME = "nova.db";

/**
 * Workspace root (the directory holding both `hud/` and `src/`).
 * Reuses the runtime's own resolver so the agent runtime and the Next server agree.
 */
export function resolveWorkspaceRoot(startDir = process.cwd()) {
  return resolveWorkspaceRootFrom(startDir);
}

function resolvePackagedDataDir() {
  const appData = String(process.env.APPDATA || "").trim();
  const base = appData || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "Nova");
}

function runIcacls(args) {
  const root = String(process.env.SystemRoot || process.env.windir || "").trim();
  const exe = root ? path.join(root, "System32", "icacls.exe") : "icacls.exe";
  return execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
}

function canReadAndWrite(dir) {
  const probe = path.join(dir, `.acl-probe-${process.pid}-${Date.now()}`);
  try {
    fs.readdirSync(dir);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort (Windows only): drop inherited permissions on `dir` and grant Full Control only to the current
 * user, SYSTEM and Administrators, so other local Windows accounts can neither read nor modify Nova's data
 * (chat, notes, nova.db). Well-known accounts are granted by SID so it works on any Windows language.
 * Never throws and logs nothing; if the current user can no longer write afterwards, inheritance is restored.
 * Returns true when the restriction is in place.
 */
export function restrictDirToCurrentUser(dir) {
  if (process.platform !== "win32") return false;
  try {
    const name = String(process.env.USERNAME || "").trim();
    if (!name) return false;
    const domain = String(process.env.USERDOMAIN || "").trim();
    const account = domain ? `${domain}\\${name}` : name;
    runIcacls([dir, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
    if (canReadAndWrite(dir)) return true;
    runIcacls([dir, "/inheritance:e"]);
    return false;
  } catch {
    try {
      if (!canReadAndWrite(dir)) runIcacls([dir, "/inheritance:e"]);
    } catch {
      // best effort only
    }
    return false;
  }
}

/**
 * Where nova.db and keys/ live.
 *   1. NOVA_DATA_DIR (absolute; relative values are resolved against cwd)
 *   2. NOVA_PACKAGED=1 -> %APPDATA%/Nova (never inside the install dir)
 *   3. <workspaceRoot>/.user (dev; gitignored)
 * The directory is created if missing. `src/.user` is a forbidden location.
 */
export function resolveDataDir() {
  const override = String(process.env.NOVA_DATA_DIR || "").trim();
  let dir;
  if (override) {
    dir = path.resolve(override);
  } else if (String(process.env.NOVA_PACKAGED || "").trim() === "1") {
    dir = resolvePackagedDataDir();
  } else {
    dir = path.join(resolveWorkspaceRoot(), ".user");
  }
  assertPathIsNotUnderReservedSrcUserPath(dir, resolveWorkspaceRoot(), "Nova data directory");
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Only a directory this call created is locked down; an existing directory keeps the user's own permissions.
  if (!existed) restrictDirToCurrentUser(dir);
  return dir;
}
