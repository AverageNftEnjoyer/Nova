import path from "node:path";
import { CoinbaseDataStore } from "../../dist/integrations/coinbase/index.js";

const dbPath = path.resolve(
  process.env.NOVA_COINBASE_DB_PATH || path.join(process.cwd(), ".agent", "coinbase", "coinbase.sqlite"),
);

const store = new CoinbaseDataStore(dbPath);
store.close();

console.log(`[coinbase:migrate] schema ensured at ${dbPath}`);
