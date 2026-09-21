import { sessionRuntime } from "../../../infrastructure/config/index.js";
import { getDb } from "../../../../../db/index.js";
import { unwrapStoredSecret } from "../../../../../providers/runtime/index.js";

function normalizeContextId(value = "") {
  if (sessionRuntime && typeof sessionRuntime.normalizeUserContextId === "function") {
    return String(sessionRuntime.normalizeUserContextId(value) || "").trim();
  }
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function requireContextId(value = "", operation = "telegram_integration_state") {
  const normalized = normalizeContextId(value);
  if (!normalized) throw new Error(`${operation} requires userContextId.`);
  return normalized;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const normalized = String(entry || "").trim();
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
  }
  return out;
}

function buildScopedIntegrationsPath(userContextId = "") {
  const normalizedUserContextId = requireContextId(userContextId, "buildScopedIntegrationsPath");
  return `sqlite:integration_state/${normalizedUserContextId}/runtime/snapshot`;
}

function normalizeState(raw = {}, statePath = "") {
  const telegram = raw?.telegram && typeof raw.telegram === "object" ? raw.telegram : {};
  return {
    connected: telegram.connected === true,
    providerId: String(telegram.providerId || "").trim(),
    apiBaseUrl: String(telegram.apiBaseUrl || "").trim().replace(/\/+$/, ""),
    botToken: String(unwrapStoredSecret(telegram.botToken) || "").trim(),
    chatIds: normalizeStringList(telegram.chatIds),
    sourcePath: String(statePath || ""),
  };
}

export function createTelegramIntegrationStateAdapter(deps = {}) {
  const readSnapshot = typeof deps.readSnapshot === "function"
    ? deps.readSnapshot
    : (userId) => {
        const row = getDb()
          .prepare("SELECT value_json FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
          .get(userId);
        return row ? JSON.parse(row.value_json) : {};
      };
  return Object.freeze({
    id: "telegram-integration-state-adapter",
    normalizeContextId,
    buildScopedIntegrationsPath,
    getState(userContextId = "") {
      const normalizedUserContextId = requireContextId(userContextId, "telegram.getState");
      const statePath = buildScopedIntegrationsPath(normalizedUserContextId);
      try {
        const parsed = readSnapshot(normalizedUserContextId);
        return normalizeState(parsed, statePath);
      } catch {
        return normalizeState({}, statePath);
      }
    },
  });
}
