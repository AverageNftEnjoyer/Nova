import path from "node:path";
import { coinbaseDbPathForUserContext, CoinbaseDataStore } from "../../dist/integrations/coinbase/index.js";

const userContextId = String(process.env.NOVA_USER_CONTEXT_ID || "").trim().toLowerCase();
const dbPath = process.env.NOVA_COINBASE_DB_PATH
  ? path.resolve(process.env.NOVA_COINBASE_DB_PATH)
  : userContextId
    ? coinbaseDbPathForUserContext(userContextId, process.cwd())
    : "";

if (!dbPath) {
  console.error("[coinbase:migrate] Missing target DB path. Set NOVA_COINBASE_DB_PATH or NOVA_USER_CONTEXT_ID.");
  process.exit(1);
}

const store = new CoinbaseDataStore(dbPath);
store.close();

console.log(`[coinbase:migrate] schema ensured at ${dbPath}`);
