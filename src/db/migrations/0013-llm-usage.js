// Token-efficiency Stage 0: cache-aware agent task usage and the per-call LLM usage ledger.
//
// Token meaning (same everywhere): input_tokens / agent_tasks.tokens_in is the TOTAL input for the call(s),
// cached and cache-write tokens included. cached_input_tokens and cache_write_input_tokens are subsets of it.
// Uncached input = input - cached - cache_write; it is computed when read, never stored.
//
// llm_usage holds one row per LLM API call (chat, agent tasks, missions). cost_usd is NULL for a model with no
// known pricing (unlike agent_tasks.cost_usd, which keeps its 0-for-unknown convention). Rows are pruned after a
// retention period (src/db/llm-usage.js); idx_llm_usage_ts serves that cross-user prune.
export const migration = {
  version: 13,
  name: "llm-usage",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN cache_write_input_tokens INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS llm_usage (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ts TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('chat', 'agent-task', 'mission')),
  ref_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_ts ON llm_usage(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_source_ref ON llm_usage(user_id, source, ref_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage(ts);
`,
}
