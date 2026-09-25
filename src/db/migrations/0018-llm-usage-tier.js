// Token-efficiency Stage 6 (tiered model routing): the routing tier of each ledgered LLM call, so /analytics can show
// spend by tier. 'trivial' / 'standard' / 'hard' (src/runtime/modules/model-routing); NULL for rows written before
// this migration and for calls outside the routing scheme (embeddings, provider model tests, ChatKit).
// A nullable ADD COLUMN: no table rebuild, existing rows unchanged (tier NULL).
export const migration = {
  version: 18,
  name: "llm-usage-tier",
  sql: `
ALTER TABLE llm_usage ADD COLUMN tier TEXT CHECK (tier IS NULL OR tier IN ('trivial', 'standard', 'hard'));
`,
};
