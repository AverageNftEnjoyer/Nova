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
// - The state is read from nova.db on every call (one indexed row), with no cache, so a connection made mid-session
//   shows up on the next turn.
// - Coinbase is "connected" only when its stored key pair actually decrypts (the same test the Coinbase tools
//   apply). The decryptability result is cached per ciphertext pair (a sha256 of the stored strings, never the
//   plaintext): each stored pair is decrypted at most once per process while it decrypts, and a failure is retried
//   after DECRYPT_FAILURE_TTL_MS (so a transient master-key problem does not hide the tools until restart).
// - The same connected state also feeds one per-user line of the STATIC system prompt
//   (resolveUnconnectedIntegrationsForPrompt): integrations whose tools are enabled but not connected, so the model
//   tells the user to connect them in Integrations instead of improvising. It changes only on connect/disconnect.

import { createHash } from "node:crypto";

import { getDb } from "../../../../../../db/index.js";
import { decryptSecret, isSecretCiphertext } from "../../../../../../security/secrets/index.js";

const DECRYPT_FAILURE_TTL_MS = 60_000;
const DECRYPT_CACHE_MAX = 256;
const decryptabilityCache = new Map();

/** Integration-bound tool name prefixes and the stored-state test for "connected". */
export const INTEGRATION_BOUND_TOOLS = Object.freeze([
  Object.freeze({
    integration: "coinbase",
    label: "Coinbase",
    covers: "Coinbase balances, portfolio, prices from the account, transactions and reports",
    prefix: "coinbase_",
    // Same test as FileBackedCoinbaseCredentialProvider (src/integrations/coinbase/credentials): connected flag plus
    // a stored key pair that unwraps (decrypts, or is a non-ciphertext value). A pair that no longer decrypts hides
    // the tools, which could only report DISCONNECTED.
    isConnected: (state) => state?.connected === true
      && hasStoredValue(state?.apiKey)
      && hasStoredValue(state?.apiSecret)
      && isStoredSecretPairUsable(state.apiKey, state.apiSecret),
  }),
  Object.freeze({
    integration: "gmail",
    label: "Gmail",
    covers: "email, the inbox, unread or recent messages, replies and forwards",
    prefix: "gmail_",
    // Same test as the gmail tools' runtime parse (src/tools/builtin/gmail-tools).
    isConnected: (state) => state?.connected === true,
  }),
  Object.freeze({
    integration: "phantom",
    label: "Phantom",
    covers: "the Phantom wallet",
    prefix: "phantom_",
    // Same flag the phantom_capabilities tool reports.
    isConnected: (state) => state?.connected === true,
  }),
]);

function hasStoredValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** unwrapStoredSecret semantics (providers/runtime): ciphertext must decrypt; any other non-empty value is usable. */
function unwrapsToValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!isSecretCiphertext(raw)) return true;
  return decryptSecret(raw).length > 0;
}

/**
 * Whether both stored values unwrap to a value, cached by a hash of the two stored strings. Only a boolean is kept;
 * the decrypted text is dropped immediately. Successes are cached for the process (a ciphertext never changes its
 * plaintext); failures for DECRYPT_FAILURE_TTL_MS.
 */
export function isStoredSecretPairUsable(apiKey, apiSecret, { now = Date.now() } = {}) {
  const cacheKey = createHash("sha256").update(`${String(apiKey)}\u0000${String(apiSecret)}`).digest("hex");
  const cached = decryptabilityCache.get(cacheKey);
  if (cached && (cached.usable || now - cached.checkedAtMs < DECRYPT_FAILURE_TTL_MS)) return cached.usable;
  let usable = false;
  try {
    usable = unwrapsToValue(apiKey) && unwrapsToValue(apiSecret);
  } catch {
    usable = false;
  }
  decryptabilityCache.delete(cacheKey);
  decryptabilityCache.set(cacheKey, { usable, checkedAtMs: now });
  if (decryptabilityCache.size > DECRYPT_CACHE_MAX) decryptabilityCache.delete(decryptabilityCache.keys().next().value);
  return usable;
}

/** Test hook: forget cached decryptability results. */
export function resetStoredSecretPairCache() {
  decryptabilityCache.clear();
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

/**
 * Integrations whose tools are enabled in this runtime but that the user has not connected, as
 * [{ integration, label, covers }] in INTEGRATION_BOUND_TOOLS order. Feeds the static system prompt, so it depends
 * only on stored state and the (process-constant) enabled tool names: stable per user until they connect or
 * disconnect.
 */
export function resolveUnconnectedIntegrationsForPrompt(userContextId, { enabledToolNames = [], ...options } = {}) {
  const enabled = (Array.isArray(enabledToolNames) ? enabledToolNames : []).map((n) => String(n || "").trim().toLowerCase());
  const connected = resolveConnectedToolIntegrations(userContextId, options);
  return INTEGRATION_BOUND_TOOLS
    .filter((entry) => enabled.some((name) => name.startsWith(entry.prefix)) && !connected.has(entry.integration))
    .map((entry) => ({ integration: entry.integration, label: entry.label, covers: entry.covers }));
}
