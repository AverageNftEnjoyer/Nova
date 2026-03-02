import { classifyShortTermContextTurn, getShortTermContextPolicy } from "./short-term-context-policies.js";

const stateByScopedDomain = new Map();

function normalizeId(value, fallback = "") {
  return String(value || "").trim().toLowerCase() || fallback;
}

export function buildShortTermContextKey({ userContextId, conversationId, domainId }) {
  const user = normalizeId(userContextId);
  const convo = normalizeId(conversationId, "_default");
  const domain = normalizeId(domainId, "assistant");
  if (!user) return "";
  return `${user}::${convo}::${domain}`;
}

export function pruneShortTermContextState(nowMs = Date.now()) {
  for (const [key, state] of stateByScopedDomain.entries()) {
    if (!state || !Number.isFinite(Number(state.ts))) {
      stateByScopedDomain.delete(key);
      continue;
    }
    const policy = getShortTermContextPolicy(state.domainId);
    const ttlMs = Math.max(1000, Number(policy.ttlMs || 120000));
    if (nowMs - Number(state.ts || 0) > ttlMs) {
      stateByScopedDomain.delete(key);
    }
  }
}

export function readShortTermContextState({ userContextId, conversationId, domainId }) {
  pruneShortTermContextState();
  const key = buildShortTermContextKey({ userContextId, conversationId, domainId });
  if (!key) return null;
  const value = stateByScopedDomain.get(key);
  return value ? { ...value, slots: { ...(value.slots || {}) } } : null;
}

export function clearShortTermContextState({ userContextId, conversationId, domainId }) {
  const key = buildShortTermContextKey({ userContextId, conversationId, domainId });
  if (!key) return false;
  return stateByScopedDomain.delete(key);
}

export function upsertShortTermContextState({
  userContextId,
  conversationId,
  domainId,
  topicAffinityId = "",
  slots = {},
}) {
  const key = buildShortTermContextKey({ userContextId, conversationId, domainId });
  if (!key) return null;
  const policy = getShortTermContextPolicy(domainId);
  const existing = stateByScopedDomain.get(key) || {};
  const resolvedTopicAffinityId = String(
    topicAffinityId || policy.resolveTopicAffinityId?.("", existing) || existing.topicAffinityId || "",
  ).trim();
  const next = {
    domainId: policy.domainId,
    userContextId: normalizeId(userContextId),
    conversationId: normalizeId(conversationId, "_default"),
    topicAffinityId: resolvedTopicAffinityId,
    slots: {
      ...(existing.slots || {}),
      ...(slots && typeof slots === "object" ? slots : {}),
    },
    ts: Date.now(),
  };
  stateByScopedDomain.set(key, next);
  return { ...next, slots: { ...next.slots } };
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

