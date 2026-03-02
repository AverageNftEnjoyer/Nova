/**
 * Personality Profile — Storage
 *
 * Reads and writes personality-profile.json per user context.
 * Mirrors the identity storage pattern for consistency.
 */

import fs from "fs";
import path from "path";
import { PERSONALITY_FILE_NAME, PERSONALITY_AUDIT_FILE_NAME } from "../constants/index.js";
import { USER_CONTEXT_ROOT } from "../../../core/constants/index.js";

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function resolvePersonalityPaths({ userContextId = "", workspaceDir = "" } = {}) {
  const uid = normalizeUserContextId(userContextId);
  if (!uid) return { userContextId: "", profilePath: "", auditPath: "" };

  const userContextDir = workspaceDir
    ? path.resolve(workspaceDir)
    : path.resolve(path.join(String(USER_CONTEXT_ROOT || ""), uid));

  return {
    userContextId: uid,
    profilePath: path.join(userContextDir, "profile", PERSONALITY_FILE_NAME),
    auditPath: path.join(userContextDir, "logs", PERSONALITY_AUDIT_FILE_NAME),
  };
}

export function loadPersonalityProfile(paths) {
  if (!paths?.profilePath) return null;
  const raw = readJsonFile(paths.profilePath);
  return raw && typeof raw === "object" ? raw : null;
}

export function persistPersonalityProfile(paths, profile) {
  if (!paths?.profilePath || !profile) return;
  writeJsonFile(paths.profilePath, profile);
}

export function appendPersonalityAuditEvent(paths, event) {
  if (!paths?.auditPath || !event || typeof event !== "object") return;
  try {
    fs.mkdirSync(path.dirname(paths.auditPath), { recursive: true });
    fs.appendFileSync(paths.auditPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Best-effort audit trail — never throw.
  }
}
