// Retired model IDs -> current replacements (token-efficiency close-out). Filled in by the retired-models
// workstream; an empty-SQL stub is recorded as applied by user_version only, and the marker-based runner still
// applies it once it gains content (see isApplied in src/db/index.js).
export const migration = {
  version: 16,
  name: "retired-model-ids",
  sql: "",
}
