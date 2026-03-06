import fs from "node:fs";
import path from "node:path";

import { USER_CONTEXT_ROOT } from "../../../../core/constants/index.js";

const STORE_FILE_NAME = "reminders-follow-up-state.json";
const STORE_VERSION = 1;
const MAX_RECORDS = Math.max(
  20,
  Number.parseInt(process.env.NOVA_REMINDERS_FOLLOW_UP_MAX_RECORDS || "200", 10) || 200,
);

function normalizeId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTopicAffinityId(value = "") {
  return String(value || "").trim();
}

function normalizeSlots(slots = {}) {
  return slots && typeof slots === "object" ? { ...slots } : {};
}

function buildRecordKey({ conversationId = "", domainId = "reminders" } = {}) {
  const normalizedConversationId = normalizeId(conversationId);
  const normalizedDomainId = normalizeId(domainId || "reminders");
  if (!normalizedConversationId || !normalizedDomainId) return "";
  return `${normalizedConversationId}::${normalizedDomainId}`;
}

function resolveUserStateDir(userContextId = "") {
  const normalizedUserContextId = normalizeId(userContextId);
  if (!normalizedUserContextId) return "";
  return path.join(USER_CONTEXT_ROOT, normalizedUserContextId, "state");
}

export function resolveReminderFollowUpStorePath(userContextId = "") {
  const stateDir = resolveUserStateDir(userContextId);
  if (!stateDir) return "";
  return path.join(stateDir, STORE_FILE_NAME);
}

function ensureStoreFile(storePath = "") {
  if (!storePath) return false;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, JSON.stringify({ version: STORE_VERSION, records: {} }, null, 2), "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeStore(store = {}) {
  const source = store && typeof store === "object" ? store : {};
  const records = source.records && typeof source.records === "object" ? source.records : {};
  return {
    version: STORE_VERSION,
    records: { ...records },
  };
}

function loadStore(storePath = "") {
  if (!storePath || !ensureStoreFile(storePath)) return { version: STORE_VERSION, records: {} };
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return { version: STORE_VERSION, records: {} };
  }
}

function saveStore(storePath = "", store = {}) {
  if (!storePath || !ensureStoreFile(storePath)) return false;
  try {
    fs.writeFileSync(storePath, JSON.stringify(normalizeStore(store), null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function pruneStore(store = {}, nowMs = Date.now()) {
  const normalizedStore = normalizeStore(store);
  const entries = Object.entries(normalizedStore.records)
    .filter(([key, value]) => {
      if (!key || !value || typeof value !== "object") return false;
      const expiresAt = Number(value.expiresAt || 0);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    })
    .sort((a, b) => Number((b[1] && b[1].ts) || 0) - Number((a[1] && a[1].ts) || 0))
    .slice(0, MAX_RECORDS);

  normalizedStore.records = Object.fromEntries(entries);
  return normalizedStore;
}

function cloneRecord(record = null) {
  if (!record || typeof record !== "object") return null;
  return {
    domainId: normalizeId(record.domainId || "reminders"),
    userContextId: normalizeId(record.userContextId),
    conversationId: normalizeId(record.conversationId),
    topicAffinityId: normalizeTopicAffinityId(record.topicAffinityId),
    slots: normalizeSlots(record.slots),
    ts: Number(record.ts || 0),
    expiresAt: Number(record.expiresAt || 0),
  };
}

export function readReminderFollowUpState({
  userContextId = "",
  conversationId = "",
  domainId = "reminders",
  nowMs = Date.now(),
} = {}) {
  const storePath = resolveReminderFollowUpStorePath(userContextId);
  const key = buildRecordKey({ conversationId, domainId });
  if (!storePath || !key) return null;
  const store = pruneStore(loadStore(storePath), nowMs);
  saveStore(storePath, store);
  return cloneRecord(store.records[key] || null);
}

export function clearReminderFollowUpState({
  userContextId = "",
  conversationId = "",
  domainId = "reminders",
  nowMs = Date.now(),
} = {}) {
  const storePath = resolveReminderFollowUpStorePath(userContextId);
  const key = buildRecordKey({ conversationId, domainId });
  if (!storePath || !key) return false;
  const store = pruneStore(loadStore(storePath), nowMs);
  const existed = Object.prototype.hasOwnProperty.call(store.records, key);
  if (existed) delete store.records[key];
  saveStore(storePath, store);
  return existed;
}

export function upsertReminderFollowUpState({
  userContextId = "",
  conversationId = "",
  domainId = "reminders",
  topicAffinityId = "",
  slots = {},
  ttlMs = 180000,
  nowMs = Date.now(),
} = {}) {
  const normalizedUserContextId = normalizeId(userContextId);
  const normalizedConversationId = normalizeId(conversationId);
  const normalizedDomainId = normalizeId(domainId || "reminders");
  const storePath = resolveReminderFollowUpStorePath(normalizedUserContextId);
  const key = buildRecordKey({
    conversationId: normalizedConversationId,
    domainId: normalizedDomainId,
  });
  if (!storePath || !key) return null;

  const nextTtlMs = Math.max(1000, Number(ttlMs || 180000));
  const store = pruneStore(loadStore(storePath), nowMs);
  const existing = cloneRecord(store.records[key] || null);
  const nextRecord = {
    domainId: normalizedDomainId,
    userContextId: normalizedUserContextId,
    conversationId: normalizedConversationId,
    topicAffinityId: normalizeTopicAffinityId(topicAffinityId || existing?.topicAffinityId || ""),
    slots: {
      ...(existing?.slots || {}),
      ...normalizeSlots(slots),
    },
    ts: nowMs,
    expiresAt: nowMs + nextTtlMs,
  };
  store.records[key] = nextRecord;
  saveStore(storePath, store);
  return cloneRecord(nextRecord);
}
