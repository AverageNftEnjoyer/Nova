// V.64: Task context groups for shared context between related agent tasks
export const migration = {
  version: 7,
  name: "task-contexts",
  sql: `
-- Context groups for organizing related tasks
CREATE TABLE IF NOT EXISTS task_contexts (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_task_contexts_name ON task_contexts(user_id, name);

-- Assignment of tasks to context groups
CREATE TABLE IF NOT EXISTS task_context_assignments (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id),
  FOREIGN KEY (user_id, task_id) REFERENCES agent_tasks(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, context_id) REFERENCES task_contexts(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_assignments_context ON task_context_assignments(user_id, context_id);
`,
};
