// Retired model IDs -> current replacements (token-efficiency close-out).
//
// Rewrites every stored model choice that names a model the provider has retired (requests fail) or redirected, to
// its current replacement from src/providers/models/retired-model-aliases (sources and dates are listed there).
// The runtime and the HUD also resolve aliases at request time, so this is about what users SEE (pickers, task
// cards, mission editors) and about keeping stored data honest; nothing depends on it for correctness.
//
// Rewritten (current choices that will be used again):
//   integration_configs.config_json       openai/claude/grok/gemini .defaultModel (plain strings; see below)
//   integration_state runtime/snapshot    the same four .defaultModel fields (the runtime's copy of the config)
//   agent_tasks.model                     only queued / paused / running tasks that are not deleted
//   missions.data_json                    every "model" / "aiModel" / "defaultModel" string in the definition
//   kv_state agent-task-budget/settings   economyModels.<provider>
// Deliberately NOT rewritten (history must show what actually happened):
//   agent_tasks.model of completed / failed / cancelled / deleted tasks (their cost and results were produced by,
//     or failed on, that model; a retry still sends the replacement because the runtime resolves aliases)
//   mission_versions (saved snapshots of earlier definitions; restoring one goes through the same request-time
//     resolution), llm_usage, agent_task_budget_events, mission_run_logs / telemetry (ledgers of past calls)
//   kv_state "ui-storage" (checked: none of its synced keys stores a model ID)
//
// Secrets: config_json / value_json hold encrypted nv1: ciphertext for API keys. Only the four plain
// `defaultModel` string fields are changed; the JSON is re-serialised only for rows that change, and JSON.parse /
// JSON.stringify round-trips every string (ciphertext included) byte for byte. Nothing is decrypted or logged.
//
// Audit: one kv_state row per affected user, namespace "model-migrations", key "retired-model-ids", value
// [{ table, where, field, old, new, ts }] (appended to an existing list), plus one console line per change.
// Rows that are not valid JSON are skipped. Tables that do not exist yet are skipped. Running `run` again finds
// nothing retired and changes nothing.
import { findRetiredModel } from "../../providers/models/retired-model-aliases/index.js";

const LLM_PROVIDERS = ["openai", "claude", "grok", "gemini"];
const MODEL_KEYS = new Set(["model", "aiModel", "defaultModel"]);
const PROVIDER_KEYS = ["integration", "aiIntegration", "provider"];
const RUNNABLE_TASK_STATUSES = ["queued", "paused", "running"];
const MAX_JSON_DEPTH = 32;

export const AUDIT_NAMESPACE = "model-migrations";
export const AUDIT_KEY = "retired-model-ids";

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The replacement for a retired stored value, or null when it is not a retired model ID. */
function replacementFor(provider, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const knownProvider = LLM_PROVIDERS.includes(String(provider || "").trim().toLowerCase()) ? provider : undefined;
  const entry = findRetiredModel(knownProvider, value);
  return entry ? entry.replacement : null;
}

/** Rewrite the four provider defaultModel fields of an integrations config object in place. */
function rewriteProviderDefaults(config, onChange) {
  for (const provider of LLM_PROVIDERS) {
    const section = config[provider];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const next = replacementFor(provider, section.defaultModel);
    if (!next) continue;
    onChange(`${provider}.defaultModel`, section.defaultModel, next);
    section.defaultModel = next;
  }
}

/** Rewrite model fields anywhere in a mission definition in place (provider taken from a sibling field). */
function rewriteModelFields(node, path, onChange, depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_JSON_DEPTH) return;
  if (Array.isArray(node)) {
    node.forEach((child, index) => rewriteModelFields(child, `${path}[${index}]`, onChange, depth + 1));
    return;
  }
  const providerKey = PROVIDER_KEYS.find((key) => typeof node[key] === "string");
  const provider = providerKey ? node[providerKey] : undefined;
  for (const [key, value] of Object.entries(node)) {
    if (MODEL_KEYS.has(key) && typeof value === "string") {
      const next = replacementFor(provider, value);
      if (next) {
        onChange(path ? `${path}.${key}` : key, value, next);
        node[key] = next;
      }
    } else if (value && typeof value === "object") {
      rewriteModelFields(value, path ? `${path}.${key}` : key, onChange, depth + 1);
    }
  }
}

function migrateRetiredModelIds(db) {
  const ts = new Date().toISOString();
  /** userId -> audit entries */
  const audit = new Map();
  const record = (userId, table, where, field, oldValue, newValue) => {
    const entries = audit.get(userId) || [];
    entries.push({ table, where, field, old: oldValue, new: newValue, ts });
    audit.set(userId, entries);
    console.log(`[Migration 16] ${table} user=${userId} ${where} ${field}: ${oldValue} -> ${newValue}`);
  };

  if (tableExists(db, "integration_configs")) {
    const update = db.prepare("UPDATE integration_configs SET config_json = ? WHERE user_id = ?");
    for (const row of db.prepare("SELECT user_id, config_json FROM integration_configs").all()) {
      const config = parseJsonObject(row.config_json);
      if (!config) continue;
      let changed = false;
      rewriteProviderDefaults(config, (field, oldValue, newValue) => {
        changed = true;
        record(row.user_id, "integration_configs", "config_json", field, oldValue, newValue);
      });
      if (changed) update.run(JSON.stringify(config), row.user_id);
    }
  }

  if (tableExists(db, "integration_state")) {
    const update = db.prepare(
      "UPDATE integration_state SET value_json = ? WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'",
    );
    const rows = db
      .prepare("SELECT user_id, value_json FROM integration_state WHERE integration = 'runtime' AND key = 'snapshot'")
      .all();
    for (const row of rows) {
      const snapshot = parseJsonObject(row.value_json);
      if (!snapshot) continue;
      let changed = false;
      rewriteProviderDefaults(snapshot, (field, oldValue, newValue) => {
        changed = true;
        record(row.user_id, "integration_state", "runtime/snapshot", field, oldValue, newValue);
      });
      if (changed) update.run(JSON.stringify(snapshot), row.user_id);
    }
  }

  if (tableExists(db, "agent_tasks")) {
    const placeholders = RUNNABLE_TASK_STATUSES.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id, id, agent, model FROM agent_tasks WHERE status IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .all(...RUNNABLE_TASK_STATUSES);
    const update = db.prepare("UPDATE agent_tasks SET model = ? WHERE user_id = ? AND id = ?");
    for (const row of rows) {
      const next = replacementFor(row.agent, row.model);
      if (!next) continue;
      update.run(next, row.user_id, row.id);
      record(row.user_id, "agent_tasks", `id=${row.id}`, "model", row.model, next);
    }
  }

  if (tableExists(db, "missions")) {
    const update = db.prepare("UPDATE missions SET data_json = ? WHERE user_id = ? AND id = ?");
    for (const row of db.prepare("SELECT user_id, id, data_json FROM missions").all()) {
      const mission = parseJsonObject(row.data_json);
      if (!mission) continue;
      let changed = false;
      rewriteModelFields(mission, "", (field, oldValue, newValue) => {
        changed = true;
        record(row.user_id, "missions", `id=${row.id}`, field, oldValue, newValue);
      });
      if (changed) update.run(JSON.stringify(mission), row.user_id, row.id);
    }
  }

  if (tableExists(db, "kv_state")) {
    const rows = db
      .prepare("SELECT user_id, value_json FROM kv_state WHERE namespace = 'agent-task-budget' AND key = 'settings'")
      .all();
    const update = db.prepare(
      "UPDATE kv_state SET value_json = ? WHERE user_id = ? AND namespace = 'agent-task-budget' AND key = 'settings'",
    );
    for (const row of rows) {
      const settings = parseJsonObject(row.value_json);
      const economyModels = settings?.economyModels;
      if (!economyModels || typeof economyModels !== "object" || Array.isArray(economyModels)) continue;
      let changed = false;
      for (const provider of LLM_PROVIDERS) {
        const next = replacementFor(provider, economyModels[provider]);
        if (!next) continue;
        record(row.user_id, "kv_state", "agent-task-budget/settings", `economyModels.${provider}`, economyModels[provider], next);
        economyModels[provider] = next;
        changed = true;
      }
      if (changed) update.run(JSON.stringify(settings), row.user_id);
    }

    const readAudit = db.prepare("SELECT value_json FROM kv_state WHERE user_id = ? AND namespace = ? AND key = ?");
    const writeAudit = db.prepare(
      "INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id, namespace, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    );
    for (const [userId, entries] of audit) {
      const existingRow = readAudit.get(userId, AUDIT_NAMESPACE, AUDIT_KEY);
      let existing = [];
      if (existingRow) {
        try {
          const parsed = JSON.parse(existingRow.value_json);
          if (Array.isArray(parsed)) existing = parsed;
        } catch {
          existing = [];
        }
      }
      writeAudit.run(userId, AUDIT_NAMESPACE, AUDIT_KEY, JSON.stringify([...existing, ...entries]), ts);
    }
  }

  let total = 0;
  for (const entries of audit.values()) total += entries.length;
  if (total > 0) console.log(`[Migration 16] Replaced ${total} retired model ID(s); audit in kv_state ${AUDIT_NAMESPACE}/${AUDIT_KEY}.`);
  return total;
}

export const migration = {
  version: 16,
  name: "retired-model-ids",
  sql: "",
  run: migrateRetiredModelIds,
};
