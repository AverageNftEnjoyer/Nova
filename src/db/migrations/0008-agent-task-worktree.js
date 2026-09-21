// V.64: Add worktree support to agent tasks for isolated git working directories
export const migration = {
  version: 8,
  name: "agent-task-worktree",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN worktree_path TEXT;
ALTER TABLE agent_tasks ADD COLUMN branch_name TEXT;
`,
}
