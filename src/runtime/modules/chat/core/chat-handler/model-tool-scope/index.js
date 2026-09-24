// Tool list sent to the model, scoped by the user's connected integrations (token-efficiency Stage 3).
//
// Integration-bound tools (coinbase_*, gmail_*, phantom_*) can only return a "not connected" error when their
// integration isn't connected, yet their schemas cost ~1.7k tokens on every tool-loop call. They are left out of
// the list the MODEL sees until the integration is connected.
//
// - Only the model-facing list is scoped. `availableTools` (execution, task policy, the domain workers and their
//   provider adapters) is unchanged, so every "not connected" reply a worker or lane gives today stays the same.
// - Cache safety: the result depends only on the user's stored integration state, never on the turn's text, and
//   keeps the registry order. The same user gets a byte-identical list on every turn until they connect or
//   disconnect an integration; that change is a deliberate one-time prefix cache miss.
// - The state is read from nova.db on every call (one indexed row, no secret is decrypted), with no cache, so a
//   connection made mid-session shows up on the next turn.

import { getDb } from "../../../../../../db/index.js";

/** Integration-bound tool name prefixes and the stored-state test for "connected". */
export const INTEGRATION_BOUND_TOOLS = Object.freeze([
  Object.freeze({
    integration: "coinbase",
    prefix: "coinbase_",
    // Same test as FileBackedCoinbaseCredentialProvider (src/integrations/coinbase/credentials), minus the
    // decryption: a stored key pair that fails to decrypt keeps the tools, and they report DISCONNECTED as before.
    isConnected: (state) => state?.connected === true && hasStoredValue(state?.apiKey) && hasStoredValue(state?.apiSecret),
  }),
  Object.freeze({
    integration: "gmail",
    prefix: "gmail_",
    // Same test as the gmail tools' runtime parse (src/tools/builtin/gmail-tools).
    isConnected: (state) => state?.connected === true,
  }),
  Object.freeze({
    integration: "phantom",
    prefix: "phantom_",
    // Same flag the phantom_capabilities tool reports.
    isConnected: (state) => state?.connected === true,
  }),
]);

function hasStoredValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

/** The user's runtime integrations snapshot (the row HUD's syncAgentRuntimeIntegrationsSnapshot writes), or null. */
export function readRuntimeIntegrationsSnapshot(userContextId) {
  const userId = normalizeUserContextId(userContextId);
  if (!userId) return null;
  const row = getDb()
    .prepare("SELECT value_json FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
    .get(userId);
  if (!row) return null;
  const parsed = JSON.parse(String(row.value_json || "null"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Names of the integrations whose tools may be shown to the model. A missing user, a missing snapshot or a read
 * error means none are connected: the tools could not work in that state either.
 */
export function resolveConnectedToolIntegrations(userContextId, { readSnapshot = readRuntimeIntegrationsSnapshot } = {}) {
  const connected = new Set();
  let snapshot = null;
  try {
    snapshot = readSnapshot(userContextId);
  } catch {
    snapshot = null;
  }
  if (!snapshot || typeof snapshot !== "object") return connected;
  for (const entry of INTEGRATION_BOUND_TOOLS) {
    if (entry.isConnected(snapshot[entry.integration])) connected.add(entry.integration);
  }
  return connected;
}

function integrationForToolName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const entry = INTEGRATION_BOUND_TOOLS.find((candidate) => normalized.startsWith(candidate.prefix));
  return entry ? entry.integration : "";
}

/** Drops the tools of integrations not in `connectedIntegrations`. Keeps order; never mutates the input. */
export function selectModelTools(availableTools, connectedIntegrations) {
  const tools = Array.isArray(availableTools) ? availableTools : [];
  const connected = connectedIntegrations instanceof Set ? connectedIntegrations : new Set();
  return tools.filter((tool) => {
    const integration = integrationForToolName(tool?.name);
    return !integration || connected.has(integration);
  });
}

/** The tool list to send to the model for this user's turn (see the header). */
export function resolveModelToolsForUser(availableTools, userContextId, options = {}) {
  return selectModelTools(availableTools, resolveConnectedToolIntegrations(userContextId, options));
}
