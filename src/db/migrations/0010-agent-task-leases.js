// Durable runtime ownership for real agent-task execution and crash recovery.
export const migration = {
  version: 10,
  name: "agent-task-leases",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN lease_owner TEXT;
ALTER TABLE agent_tasks ADD COLUMN lease_expires_at TEXT;
ALTER TABLE agent_tasks ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease ON agent_tasks(status, lease_expires_at);
`,
}
