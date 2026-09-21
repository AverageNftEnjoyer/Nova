// V.64: Add attached_files column to agent_tasks for file drag-and-drop context
export const migration = {
  version: 6,
  name: "agent-task-files",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN attached_files TEXT;
`,
};
