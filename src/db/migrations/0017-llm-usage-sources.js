// Token-efficiency close-out: two more llm_usage sources, so every LLM API call can land in the ledger.
//   'utility'   one-off helper calls that are not a chat turn, an agent task or a mission run: mission
//               suggestions (nova-suggest), provider model tests, the Gmail summary.
//   'embedding' embedding API calls of the memory index (input tokens only).
// SQLite cannot alter a CHECK constraint, so the table is rebuilt (same columns, same WITHOUT ROWID key,
// same indexes); all existing rows are copied unchanged.
export const migration = {
  version: 17,
  name: "llm-usage-sources",
  sql: `
CREATE TABLE llm_usage_v17 (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ts TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('chat', 'agent-task', 'mission', 'utility', 'embedding')),
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

INSERT INTO llm_usage_v17 (user_id, id, ts, source, ref_id, provider, model, input_tokens, output_tokens,
  cached_input_tokens, cache_write_input_tokens, cost_usd)
SELECT user_id, id, ts, source, ref_id, provider, model, input_tokens, output_tokens,
  cached_input_tokens, cache_write_input_tokens, cost_usd
FROM llm_usage;

DROP TABLE llm_usage;
ALTER TABLE llm_usage_v17 RENAME TO llm_usage;

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_ts ON llm_usage(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_source_ref ON llm_usage(user_id, source, ref_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage(ts);
`,
}
