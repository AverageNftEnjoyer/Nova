import { kvDelete, kvGet, kvSet } from "../../../../../db/index.js";

const DEFAULT_APPROVAL_TTL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.NOVA_POLICY_APPROVAL_TTL_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000,
);
const NAMESPACE = "policy-approvals";

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function buildApprovalKey({ conversationId = "", sessionKey = "" } = {}) {
  const conversation = normalizeId(conversationId);
  const session = String(sessionKey || "").trim();
  if (conversation && session) return `${conversation}::${session}`;
  return conversation || session;
}

export function grantPolicyApproval({
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  source = "hud_confirmation",
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
} = {}) {
  const uid = normalizeId(userContextId);
  const key = buildApprovalKey({ conversationId, sessionKey });
  if (!uid || !key) return false;
  const nowMs = Date.now();
  kvSet(uid, NAMESPACE, key, {
    approvedAt: nowMs,
    expiresAt: nowMs + Math.max(30_000, Number(ttlMs || DEFAULT_APPROVAL_TTL_MS)),
    source: String(source || "hud_confirmation").trim().toLowerCase(),
    consumedAt: 0,
  });
  return true;
}

export function consumePolicyApproval({ userContextId = "", conversationId = "", sessionKey = "" } = {}) {
  const uid = normalizeId(userContextId);
  const key = buildApprovalKey({ conversationId, sessionKey });
  if (!uid || !key) return false;
  const record = kvGet(uid, NAMESPACE, key);
  const nowMs = Date.now();
  if (!record || typeof record !== "object" || Number(record.expiresAt || 0) <= nowMs) {
    kvDelete(uid, NAMESPACE, key);
    return false;
  }
  if (Number(record.consumedAt || 0) > 0) return false;
  kvSet(uid, NAMESPACE, key, { ...record, consumedAt: nowMs });
  return true;
}
