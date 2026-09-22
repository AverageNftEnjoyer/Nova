// At-most-once reservations for externally visible Agent Task side effects.
export const migration = {
  version: 12,
  name: "agent-task-effects",
  sql: `
CREATE TABLE IF NOT EXISTS agent_task_effects (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id, effect_key),
  FOREIGN KEY (user_id, task_id) REFERENCES agent_tasks(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
`,
}
