import fs from "fs";
import path from "path";
import {
  IDENTITY_AUDIT_FILE_NAME,
  IDENTITY_FILE_NAME,
  IDENTITY_SEED_FILE_NAME,
  createEmptyIdentitySnapshot,
  normalizeIdentitySnapshot,
  resolveDefaultIdentityRoot,
} from "./constants.js";

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
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function resolveIdentityPaths({ userContextId = "", workspaceDir = "", rootDir = "" } = {}) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedUserContextId) {
    return {
      userContextId: "",
      userContextDir: "",
      profileDir: "",
      logsDir: "",
      snapshotPath: "",
      seedPath: "",
      auditPath: "",
    };
  }
  const explicitWorkspaceDir = String(workspaceDir || "").trim();
  const baseRoot =
    explicitWorkspaceDir ||
    String(rootDir || "").trim() ||
    path.join(path.resolve(resolveDefaultIdentityRoot()), "..", normalizedUserContextId);
  const userContextDir = explicitWorkspaceDir
    ? path.resolve(explicitWorkspaceDir)
    : path.resolve(path.join(resolveDefaultIdentityRoot(), normalizedUserContextId));
  if (baseRoot && !explicitWorkspaceDir) {
    const rootResolved = path.resolve(baseRoot);
    if (rootResolved.endsWith(path.sep + normalizedUserContextId)) {
      // already scoped
    }
  }
  const profileDir = path.join(userContextDir, "profile");
  const logsDir = path.join(userContextDir, "logs");
  return {
    userContextId: normalizedUserContextId,
    userContextDir,
    profileDir,
    logsDir,
    snapshotPath: path.join(profileDir, IDENTITY_FILE_NAME),
    seedPath: path.join(profileDir, IDENTITY_SEED_FILE_NAME),
    auditPath: path.join(logsDir, IDENTITY_AUDIT_FILE_NAME),
  };
}

export function loadIdentitySeed(paths) {
  const rawSeed = readJsonFile(paths?.seedPath || "");
  if (!rawSeed || typeof rawSeed !== "object") return null;
  const schemaVersion = Number(rawSeed.schemaVersion || 0);
  if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) return null;
  return rawSeed;
}

function archiveCorruptSnapshot(snapshotPath, nowMs) {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return "";
  const corruptPath = `${snapshotPath}.corrupt.${nowMs}`;
  try {
    fs.renameSync(snapshotPath, corruptPath);
    return corruptPath;
  } catch {
    return "";
  }
}

export function loadIdentitySnapshot(paths, nowMs = Date.now()) {
  const userContextId = String(paths?.userContextId || "").trim();
  if (!userContextId || !paths?.snapshotPath) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      snapshotPath: "",
      createdFresh: true,
      recoveredCorruptPath: "",
    };
  }

  const raw = readJsonFile(paths.snapshotPath);
  if (!raw) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId, nowMs }),
      snapshotPath: paths.snapshotPath,
      createdFresh: true,
      recoveredCorruptPath: "",
    };
  }

  const normalized = normalizeIdentitySnapshot(raw, { userContextId, nowMs });
  return {
    snapshot: normalized,
    snapshotPath: paths.snapshotPath,
    createdFresh: false,
    recoveredCorruptPath: "",
  };
}

export function recoverOrCreateIdentitySnapshot(paths, nowMs = Date.now()) {
  const direct = loadIdentitySnapshot(paths, nowMs);
  if (!paths?.snapshotPath) return direct;
  if (direct.createdFresh && fs.existsSync(paths.snapshotPath)) {
    const recoveredCorruptPath = archiveCorruptSnapshot(paths.snapshotPath, nowMs);
    return {
      ...direct,
      recoveredCorruptPath,
    };
  }
  return direct;
}

export function persistIdentitySnapshot(paths, snapshot) {
  if (!paths?.snapshotPath || !snapshot) return;
  writeJsonFile(paths.snapshotPath, snapshot);
}

export function appendIdentityAuditEvent(paths, event) {
  if (!paths?.auditPath || !event || typeof event !== "object") return;
  try {
    fs.mkdirSync(path.dirname(paths.auditPath), { recursive: true });
    fs.appendFileSync(paths.auditPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Best effort audit trail.
  }
}
