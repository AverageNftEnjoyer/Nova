import { classifyShortTermContextTurn, getShortTermContextPolicy } from "../short-term-context-policies/index.js";
import {
  clearReminderFollowUpState,
  readReminderFollowUpState,
  upsertReminderFollowUpState,
} from "../../../services/reminders/follow-up-state/index.js";
import {
  clearPersistentFollowUpState,
  readPersistentFollowUpState,
  upsertPersistentFollowUpState,
} from "../../../services/follow-up-state/index.js";

function normalizeId(value, fallback = "") {
  return String(value || "").trim().toLowerCase() || fallback;
}

function usesPersistentReminderState(domainId = "") {
  return normalizeId(domainId) === "reminders";
}

export function buildShortTermContextKey({ userContextId, conversationId, domainId }) {
  const user = normalizeId(userContextId);
  const convo = normalizeId(conversationId, "_default");
  const domain = normalizeId(domainId, "assistant");
  if (!user) return "";
  return `${user}::${convo}::${domain}`;
}

export function pruneShortTermContextState(nowMs = Date.now()) {
  return nowMs;
}

export function readShortTermContextState({ userContextId, conversationId, domainId }) {
  if (usesPersistentReminderState(domainId)) {
    return readReminderFollowUpState({
      userContextId,
      conversationId,
      domainId,
    });
  }
  return readPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId,
  });
}

export function clearShortTermContextState({ userContextId, conversationId, domainId }) {
  if (usesPersistentReminderState(domainId)) {
    return clearReminderFollowUpState({
      userContextId,
      conversationId,
      domainId,
    });
  }
  return clearPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId,
  });
}

export function upsertShortTermContextState({
  userContextId,
  conversationId,
  domainId,
  topicAffinityId = "",
  slots = {},
}) {
  const policy = getShortTermContextPolicy(domainId);
  if (usesPersistentReminderState(domainId)) {
    return upsertReminderFollowUpState({
      userContextId,
      conversationId,
      domainId,
      topicAffinityId,
      slots,
      ttlMs: Number(policy.ttlMs || 120000),
    });
  }
  const existing = readPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: policy.domainId,
  });
  const resolvedTopicAffinityId = String(
    topicAffinityId || policy.resolveTopicAffinityId?.("", existing || {}) || existing?.topicAffinityId || "",
  ).trim();
  return upsertPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: policy.domainId,
    topicAffinityId: resolvedTopicAffinityId,
    slots,
    ttlMs: Number(policy.ttlMs || 120000),
  });
}

export function applyShortTermContextTurnClassification({ userContextId, conversationId, domainId, text }) {
  const turn = classifyShortTermContextTurn({ domainId, text });
  if (turn.isCancel || turn.isNewTopic) {
    clearShortTermContextState({ userContextId, conversationId, domainId });
  }
  return turn;
}

export function summarizeShortTermContextForPrompt(state, maxChars = 600) {
  const ctx = state && typeof state === "object" ? state : null;
  if (!ctx) return "";
  const lines = [];
  if (ctx.topicAffinityId) lines.push(`topic_affinity_id: ${ctx.topicAffinityId}`);
  const slots = ctx.slots && typeof ctx.slots === "object" ? ctx.slots : {};
  for (const [key, value] of Object.entries(slots)) {
    if (value === undefined || value === null) continue;
    const asText = typeof value === "string" ? value : JSON.stringify(value);
    if (!asText) continue;
    lines.push(`${key}: ${asText}`);
  }
  const summary = lines.join("\n");
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}
