import { kvDelete, kvGet, kvSet } from "../../../../../db/index.js";

const NAMESPACE = "reminders-follow-up";

function normalizeId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildRecordKey({ conversationId = "", domainId = "reminders" } = {}) {
  const conversation = normalizeId(conversationId);
  const domain = normalizeId(domainId || "reminders");
  return conversation && domain ? `${conversation}::${domain}` : "";
}

function cloneRecord(record) {
  if (!record || typeof record !== "object") return null;
  return {
    domainId: normalizeId(record.domainId || "reminders"),
    userContextId: normalizeId(record.userContextId),
    conversationId: normalizeId(record.conversationId),
    topicAffinityId: String(record.topicAffinityId || "").trim(),
    slots: record.slots && typeof record.slots === "object" ? { ...record.slots } : {},
    ts: Number(record.ts || 0),
    expiresAt: Number(record.expiresAt || 0),
  };
}

export function resolveReminderFollowUpStorePath(userContextId = "") {
  const uid = normalizeId(userContextId);
  return uid ? `sqlite:kv_state/${uid}/${NAMESPACE}` : "";
}

export function readReminderFollowUpState({
  userContextId = "",
  conversationId = "",
  domainId = "reminders",
  nowMs = Date.now(),
} = {}) {
  const uid = normalizeId(userContextId);
  const key = buildRecordKey({ conversationId, domainId });
  if (!uid || !key) return null;
  const record = cloneRecord(kvGet(uid, NAMESPACE, key));
  if (!record || record.expiresAt <= nowMs) {
    kvDelete(uid, NAMESPACE, key);
    return null;
  }
  return record;
}

export function clearReminderFollowUpState({ userContextId = "", conversationId = "", domainId = "reminders" } = {}) {
  const uid = normalizeId(userContextId);
  const key = buildRecordKey({ conversationId, domainId });
  return Boolean(uid && key && kvDelete(uid, NAMESPACE, key));
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
  const uid = normalizeId(userContextId);
  const conversation = normalizeId(conversationId);
  const domain = normalizeId(domainId || "reminders");
  const key = buildRecordKey({ conversationId: conversation, domainId: domain });
  if (!uid || !key) return null;
  const existing = readReminderFollowUpState({ userContextId: uid, conversationId: conversation, domainId: domain, nowMs });
  const next = {
    domainId: domain,
    userContextId: uid,
    conversationId: conversation,
    topicAffinityId: String(topicAffinityId || existing?.topicAffinityId || "").trim(),
    slots: { ...(existing?.slots || {}), ...(slots && typeof slots === "object" ? slots : {}) },
    ts: nowMs,
    expiresAt: nowMs + Math.max(1000, Number(ttlMs || 180000)),
  };
  kvSet(uid, NAMESPACE, key, next);
  return cloneRecord(next);
}
