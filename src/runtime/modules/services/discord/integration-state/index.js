import fs from "node:fs";
import path from "node:path";
import { sessionRuntime } from "../../../infrastructure/config/index.js";
import { USER_CONTEXT_ROOT } from "../../../../core/constants/index.js";
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

function normalizeWebhookList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const normalized = String(unwrapStoredSecret(entry) || "").trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildScopedIntegrationsPath(userContextId = "") {
  const normalized = normalizeContextId(userContextId) || "anonymous";
  return path.join(USER_CONTEXT_ROOT, normalized, "state", "integrations-config.json");
}

function normalizeState(raw = {}, statePath = "") {
  const discord = raw?.discord && typeof raw.discord === "object" ? raw.discord : {};
  return {
    connected: discord.connected === true,
    webhookUrls: normalizeWebhookList(discord.webhookUrls),
    sourcePath: String(statePath || ""),
  };
}

export function createDiscordIntegrationStateAdapter(deps = {}) {
  const readFileSync = typeof deps.readFileSync === "function" ? deps.readFileSync : fs.readFileSync;
  return Object.freeze({
    id: "discord-integration-state-adapter",
    normalizeContextId,
    buildScopedIntegrationsPath,
    getState(userContextId = "") {
      const normalizedUserContextId = normalizeContextId(userContextId);
      const statePath = buildScopedIntegrationsPath(normalizedUserContextId);
      try {
        const raw = readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw);
        return normalizeState(parsed, statePath);
      } catch {
        return normalizeState({}, statePath);
      }
    },
  });
}
