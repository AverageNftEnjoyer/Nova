// Persist real agent-task output and the tools used during execution.
export const migration = {
  version: 9,
  name: "agent-task-results",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN result_text TEXT;
ALTER TABLE agent_tasks ADD COLUMN tool_calls TEXT;
`,
}
