import {
  COINBASE_FOLLOW_UP_TTL_MS,
} from "../constants/index.js";
import {
  clearShortTermContextState,
  readShortTermContextState,
  upsertShortTermContextState,
} from "../../../../core/short-term-context-engine/index.js";
import {
  clearPersistentFollowUpState,
  readPersistentFollowUpState,
  upsertPersistentFollowUpState,
} from "../../../../../services/follow-up-state/index.js";

const COINBASE_FOLLOW_UP_DOMAIN_ID = "coinbase_followup";

export function getCoinbaseFollowUpKey(userContextId, conversationId) {
  const user = String(userContextId || "").trim().toLowerCase();
  const convo = String(conversationId || "").trim().toLowerCase() || "_default";
  return `${user}::${convo}`;
}

function parseCoinbaseFollowUpKey(key = "") {
  const [userContextId = "", conversationId = "_default"] = String(key || "").trim().toLowerCase().split("::");
  return { userContextId, conversationId };
}

export function readCoinbaseFollowUpState(key) {
  const { userContextId, conversationId } = parseCoinbaseFollowUpKey(key);
  const record = readPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: COINBASE_FOLLOW_UP_DOMAIN_ID,
  });
  const errorCode = String(record?.slots?.errorCode || "").trim().toUpperCase();
  if (!errorCode) return null;
  return {
    ts: Number(record?.ts || 0),
    errorCode,
    guidance: String(record?.slots?.guidance || "").trim(),
    safeMessage: String(record?.slots?.safeMessage || "").trim(),
  };
}

export function updateCoinbaseFollowUpState(key, payload) {
  const { userContextId, conversationId } = parseCoinbaseFollowUpKey(key);
  if (!userContextId) return;
  if (payload?.ok) {
    clearPersistentFollowUpState({
      userContextId,
      conversationId,
      domainId: COINBASE_FOLLOW_UP_DOMAIN_ID,
    });
    return;
  }
  const errorCode = String(payload?.errorCode || "").trim().toUpperCase();
  if (!errorCode) return;
  upsertPersistentFollowUpState({
    userContextId,
    conversationId,
    domainId: COINBASE_FOLLOW_UP_DOMAIN_ID,
    topicAffinityId: COINBASE_FOLLOW_UP_DOMAIN_ID,
    slots: {
      errorCode,
      guidance: String(payload?.guidance || "").trim(),
      safeMessage: String(payload?.safeMessage || "").trim(),
    },
    ttlMs: COINBASE_FOLLOW_UP_TTL_MS,
  });
}

export function buildFollowUpReplyFromState(followUp) {
  const code = String(followUp?.errorCode || "").trim().toUpperCase();
  if (!code) return "";
  if (code === "CONSENT_REQUIRED") {
    return [
      "I can only use the Coinbase consent flag saved in your privacy settings.",
      "If you already enabled it, refresh/reconnect once and retry `recent transactions` or `weekly pnl`.",
      "If not, set `Transaction Consent Granted` ON (or `Require Consent` OFF) in Integrations -> Coinbase -> Privacy Controls first.",
    ].join("\n");
  }
  if (code === "DISCONNECTED") {
    return "Coinbase is disconnected for this runtime user context. Reconnect in Integrations, then retry.";
  }
  if (code === "AUTH_FAILED" || code === "AUTH_UNSUPPORTED") {
    return "Coinbase private auth is failing for this runtime context (key/scopes/allowlist/private key). Re-save credentials and reconnect, then retry.";
  }
  if (code === "RATE_LIMITED") {
    return "Coinbase is rate limiting requests right now. Wait briefly, then retry.";
  }
  return String(followUp?.safeMessage || "").trim() || "Coinbase is currently unavailable for this request.";
}

export function readCryptoTopicAffinity(userContextId, conversationId) {
  return readShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
  });
}

export function clearCryptoTopicAffinity(userContextId, conversationId) {
  clearShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
  });
}

export function updateCryptoTopicAffinity(userContextId, conversationId, update) {
  const slots = { ...(update && typeof update === "object" ? update : {}) };
  const topicAffinityId = String(slots.topicAffinityId || "").trim();
  delete slots.topicAffinityId;
  return upsertShortTermContextState({
    userContextId,
    conversationId,
    domainId: "crypto",
    topicAffinityId,
    slots,
  });
}

function directiveToRemovedSection(directive) {
  const value = String(directive || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("include_recent_net_cash_flow: false")) return "recent net cash-flow PnL proxy";
  if (value.startsWith("include_timestamp: false")) return "timestamp";
  if (value.startsWith("include_freshness: false")) return "freshness";
  return "";
}

export function mergeRemovedSections(existing, directives) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const directive of directives || []) {
    const section = directiveToRemovedSection(directive);
    if (section && !out.includes(section)) out.push(section);
  }
  return out.slice(-8);
}
