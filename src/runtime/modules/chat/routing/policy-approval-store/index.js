import fs from "fs";
import path from "path";
import { USER_CONTEXT_ROOT } from "../../../../core/constants/index.js";

const DEFAULT_APPROVAL_TTL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.NOVA_POLICY_APPROVAL_TTL_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000,
);
const MAX_APPROVAL_RECORDS = Math.max(
  10,
  Number.parseInt(process.env.NOVA_POLICY_APPROVAL_MAX_RECORDS || "200", 10) || 200,
);

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSessionKey(value) {
  return String(value || "").trim();
}

function buildApprovalKey({ conversationId = "", sessionKey = "" } = {}) {
  const normalizedConversationId = normalizeId(conversationId);
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (normalizedConversationId && normalizedSessionKey) {
    return `${normalizedConversationId}::${normalizedSessionKey}`;
  }
  if (normalizedConversationId) return normalizedConversationId;
  if (normalizedSessionKey) return normalizedSessionKey;
  return "";
}

function resolveUserStateDir(userContextId = "") {
  const normalizedUserContextId = normalizeId(userContextId);
  if (!normalizedUserContextId) return "";
  return path.join(USER_CONTEXT_ROOT, normalizedUserContextId, "state");
}

function resolveStorePath(userContextId = "") {
  const stateDir = resolveUserStateDir(userContextId);
  if (!stateDir) return "";
  return path.join(stateDir, "policy-approvals.json");
}

function ensureStoreFile(storePath) {
  if (!storePath) return false;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, "{}", "utf8");
    return true;
  } catch {
    return false;
  }
}

function loadStore(storePath) {
  if (!storePath) return {};
  if (!ensureStoreFile(storePath)) return {};
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(storePath, store) {
  if (!storePath) return;
  if (!ensureStoreFile(storePath)) return;
  try {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  } catch {}
}

function normalizeStoreShape(store = {}) {
  const source = store && typeof store === "object" ? store : {};
  const records = source.records && typeof source.records === "object" ? source.records : {};
  return {
    version: 1,
    records: { ...records },
  };
}

function pruneStore(store, nowMs = Date.now()) {
  const normalized = normalizeStoreShape(store);
  const entries = Object.entries(normalized.records)
    .filter(([key, value]) => {
      if (!key || !value || typeof value !== "object") return false;
      const expiresAt = Number(value.expiresAt || 0);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    })
    .sort((a, b) => Number((b[1] && b[1].approvedAt) || 0) - Number((a[1] && a[1].approvedAt) || 0))
    .slice(0, MAX_APPROVAL_RECORDS);

  const nextRecords = {};
  for (const [key, value] of entries) nextRecords[key] = value;
  normalized.records = nextRecords;
  return normalized;
}

export function grantPolicyApproval({
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  source = "hud_confirmation",
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
} = {}) {
  const normalizedUserContextId = normalizeId(userContextId);
  const key = buildApprovalKey({ conversationId, sessionKey });
  const storePath = resolveStorePath(normalizedUserContextId);
  if (!normalizedUserContextId || !key || !storePath) return false;

  const nowMs = Date.now();
  const nextTtlMs = Math.max(30_000, Number(ttlMs || DEFAULT_APPROVAL_TTL_MS));
  const store = pruneStore(loadStore(storePath), nowMs);
  store.records[key] = {
    approvedAt: nowMs,
    expiresAt: nowMs + nextTtlMs,
    source: String(source || "hud_confirmation").trim().toLowerCase(),
    consumedAt: 0,
  };
  saveStore(storePath, store);
  return true;
}

export function consumePolicyApproval({
  userContextId = "",
  conversationId = "",
  sessionKey = "",
} = {}) {
  const normalizedUserContextId = normalizeId(userContextId);
  const key = buildApprovalKey({ conversationId, sessionKey });
  const storePath = resolveStorePath(normalizedUserContextId);
  if (!normalizedUserContextId || !key || !storePath) return false;

  const nowMs = Date.now();
  const store = pruneStore(loadStore(storePath), nowMs);
  const record = store.records[key];
  if (!record || typeof record !== "object") {
    saveStore(storePath, store);
    return false;
  }
  if (Number(record.consumedAt || 0) > 0) {
    saveStore(storePath, store);
    return false;
  }
  record.consumedAt = nowMs;
  store.records[key] = record;
  saveStore(storePath, store);
  return true;
}

