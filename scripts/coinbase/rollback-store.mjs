import path from "node:path";
import Database from "better-sqlite3";
import { coinbaseDbPathForUserContext } from "../../dist/integrations/coinbase/index.js";

if (String(process.env.NOVA_ALLOW_DESTRUCTIVE || "").trim() !== "1") {
  console.error(
    "[coinbase:rollback] blocked. Set NOVA_ALLOW_DESTRUCTIVE=1 to confirm destructive rollback.",
  );
  process.exit(1);
}

const userContextId = String(process.env.NOVA_USER_CONTEXT_ID || "").trim().toLowerCase();
const dbPath = process.env.NOVA_COINBASE_DB_PATH
  ? path.resolve(process.env.NOVA_COINBASE_DB_PATH)
  : userContextId
    ? coinbaseDbPathForUserContext(userContextId, process.cwd())
    : "";

if (!dbPath) {
  console.error("[coinbase:rollback] Missing target DB path. Set NOVA_COINBASE_DB_PATH or NOVA_USER_CONTEXT_ID.");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec(`
  DROP TABLE IF EXISTS coinbase_oauth_tokens;
  DROP TABLE IF EXISTS coinbase_audit_log;
  DROP TABLE IF EXISTS coinbase_idempotency_keys;
  DROP TABLE IF EXISTS coinbase_report_history;
  DROP TABLE IF EXISTS coinbase_snapshots;
  DROP TABLE IF EXISTS coinbase_connection_metadata;
`);
db.close();

console.log(`[coinbase:rollback] dropped Coinbase tables from ${dbPath}`);
