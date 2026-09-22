// Managed task attachments, approval state, and deferred deletion lifecycle.
export const migration = {
  version: 11,
  name: "agent-task-execution-context",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN pause_reason TEXT;
ALTER TABLE agent_tasks ADD COLUMN pending_approval_json TEXT;
ALTER TABLE agent_tasks ADD COLUMN approved_tools_json TEXT;
ALTER TABLE agent_tasks ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS agent_task_attachments (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id, id),
  FOREIGN KEY (user_id, task_id) REFERENCES agent_tasks(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_agent_task_attachments_task
  ON agent_task_attachments(user_id, task_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_deferred_delete
  ON agent_tasks(status, deleted_at, lease_expires_at);
`,
}
