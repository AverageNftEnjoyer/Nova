/**
 * Opt-in LIVE conversation quality + latency check (`npm run smoke:live-latency`).
 *
 * Not part of the release chain: it calls a real LLM provider with the user's own API key and takes minutes.
 *
 *   NOVA_LIVE_LATENCY=1                run it (otherwise: prints a skip message and exits 0)
 *   NOVA_SMOKE_USER_CONTEXT_ID=<id>    optional; which user's integrations to use (default: first user that has a
 *                                      runtime integrations snapshot in the real nova.db)
 *   NOVA_DATA_DIR / NOVA_PACKAGED      optional; select the real data dir exactly like the app (resolveDataDir())
 *   NOVA_SMOKE_LATENCY_P50_MS / _P95_MS / _P99_MS   optional thresholds (defaults 7000 / 12000 / 20000)
 *
 * Safety: the real nova.db is opened READ-ONLY, only to read the provider credentials (decrypted with the real
 * DPAPI master key). The conversation itself then runs in a throwaway temp data dir seeded with that one runtime
 * snapshot (active provider key re-encrypted under the temp dir's own key), so nothing is ever written to the real
 * data dir. The assertions live in src-conversation-quality-30turn-smoke.mjs and are unchanged.
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

if (String(process.env.NOVA_LIVE_LATENCY || "").trim() !== "1") {
  console.log(
    "smoke:live-latency skipped: set NOVA_LIVE_LATENCY=1 to run the live 30-turn conversation quality/latency check.\n"
    + "  It uses the provider API key stored in your real nova.db (read-only) and makes real, billable LLM calls.\n"
    + "  Optional: NOVA_SMOKE_USER_CONTEXT_ID=<user id> to pick the user whose integrations are used.",
  );
  process.exit(0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { resolveDataDir, DB_FILENAME, openDbAt } = await load("src/db/index.js");
const secrets = await load("src/security/secrets/index.js");

// ---- Phase 1: read credentials from the REAL data dir, read-only ----
const realDir = resolveDataDir();
const realDbFile = path.join(realDir, DB_FILENAME);
if (!fs.existsSync(realDbFile)) {
  fail(`no nova.db at ${realDbFile}. Launch Nova once and connect an LLM provider (Integrations page) first.`);
}
const explicitUser = String(process.env.NOVA_SMOKE_USER_CONTEXT_ID || process.env.NOVA_USER_CONTEXT_ID || "").trim();

let userId = "";
let snapshot = null;
const realDb = openDbAt(realDbFile, { readonly: true });
try {
  const rows = realDb
    .prepare("SELECT user_id, value_json FROM integration_state WHERE integration = 'runtime' AND key = 'snapshot' ORDER BY user_id")
    .all();
  const pick = explicitUser ? rows.find((r) => r.user_id === explicitUser.toLowerCase()) || rows.find((r) => r.user_id === explicitUser) : rows[0];
  if (!pick) {
    fail(
      explicitUser
        ? `no runtime integrations snapshot for user "${explicitUser}" in ${realDbFile}.`
        : `no runtime integrations snapshot found in ${realDbFile}. Open Nova and save your LLM provider key first.`,
    );
  }
  userId = pick.user_id;
  snapshot = JSON.parse(pick.value_json);
} finally {
  realDb.close();
}

const provider = ["claude", "grok", "gemini", "openai"].includes(snapshot?.activeLlmProvider) ? snapshot.activeLlmProvider : "openai";
const integration = snapshot?.[provider] && typeof snapshot[provider] === "object" ? snapshot[provider] : {};
const storedKey = String(integration.apiKey || "").trim();
let apiKey = "";
if (storedKey) {
  try {
    apiKey = secrets.isSecretCiphertext(storedKey) ? secrets.decryptSecret(storedKey) : storedKey;
  } catch (error) {
    fail(`could not decrypt the "${provider}" API key for user "${userId}": ${error instanceof Error ? error.message : String(error)}. (Backup/restore only works on the same Windows account.)`);
  }
}
if (!String(apiKey || "").trim()) {
  fail(`no API key configured for the active provider "${provider}" (user "${userId}"). Add it on the Integrations page, then re-run.`);
}

// ---- Phase 2: switch to an isolated temp data dir seeded with only that snapshot ----
const { createIsolatedDataDir } = await load("scripts/smoke/lib/isolated-data-dir.mjs");
createIsolatedDataDir("nova-live-latency-");
secrets.resetSecretsCache();
const { getDb } = await load("src/db/index.js");
const seeded = { ...snapshot, [provider]: { ...integration, apiKey: secrets.encryptSecret(apiKey), connected: true } };
getDb()
  .prepare(
    "INSERT INTO integration_state (user_id, integration, key, value_json, updated_at) VALUES (?, 'runtime', 'snapshot', ?, ?) "
    + "ON CONFLICT(user_id, integration, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  )
  .run(userId, JSON.stringify(seeded), new Date().toISOString());

process.env.NOVA_SMOKE_USER_CONTEXT_ID = userId;
console.log(`live-latency: provider=${provider} user=${userId} (credentials read-only from ${realDbFile}; conversation runs in a temp data dir)`);

// The quality smoke keeps its assertions; it inherits the temp NOVA_DATA_DIR and the user id set above.
await load("scripts/smoke/conversation/src-conversation-quality-30turn-smoke.mjs");
