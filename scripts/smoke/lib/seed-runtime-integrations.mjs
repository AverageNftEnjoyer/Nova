/**
 * Seed helpers for smokes that used to write `<dataDir>/user-context/<user>/state/integrations-config.json`.
 *
 * The agent runtime no longer reads that file: per-user integration config is the nova.db row
 * `integration_state (user_id, 'runtime', 'snapshot')` that HUD's syncAgentRuntimeIntegrationsSnapshot writes.
 * These helpers write that same row through the real DB layer.
 *
 * Refuses to run unless NOVA_DATA_DIR is a throwaway directory under os.tmpdir(), so a smoke can never seed
 * the real `<repo>/.user/nova.db`.
 */
import "./isolated-data-dir.mjs";
import os from "node:os";
import path from "node:path";

import { getDb, nowIso, resolveDataDir } from "../../../src/db/index.js";

function assertIsolated() {
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(resolveDataDir()));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("seed-runtime-integrations: refusing to write outside a temp NOVA_DATA_DIR");
  }
}

function normalizeUserId(userId) {
  const id = String(userId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  if (!id) throw new Error("seed-runtime-integrations: userId is required");
  return id;
}

/** Replace the user's whole runtime integrations snapshot with `payload` (same shape the old JSON file had). */
export function seedRuntimeIntegrations(userId, payload) {
  assertIsolated();
  getDb()
    .prepare(
      `INSERT INTO integration_state (user_id, integration, key, value_json, expires_at, updated_at)
       VALUES (?, 'runtime', 'snapshot', ?, NULL, ?)
       ON CONFLICT(user_id, integration, key) DO UPDATE SET
         value_json = excluded.value_json, expires_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(normalizeUserId(userId), JSON.stringify(payload ?? {}), nowIso());
}

/** Read the user's runtime integrations snapshot back (null when none). */
export function readRuntimeIntegrations(userId) {
  const row = getDb()
    .prepare("SELECT value_json FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
    .get(normalizeUserId(userId));
  return row ? JSON.parse(row.value_json) : null;
}

/** Remove the user's runtime integrations snapshot. */
export function clearRuntimeIntegrations(userId) {
  assertIsolated();
  getDb()
    .prepare("DELETE FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
    .run(normalizeUserId(userId));
}
