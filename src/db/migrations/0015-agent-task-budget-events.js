// Token-efficiency close-out: budget event history for agent tasks.
//
// One row per budget event of a task (the warning -> degraded -> exhausted sequence, plus the user's raise-budget
// action), so /analytics can show what happened over time instead of only each task's current budget_state.
// kind: 'warning' | 'degraded' | 'exhausted' (runtime, src/runtime/modules/agent-tasks) | 'raised' (user, HUD).
// state: the task's budget_state right after the event. Amounts are the spend / effective budget at that moment.
// Written and read through src/db/agent-task-budget-events.js; pruned with the llm_usage retention period.
export const migration = {
  version: 15,
  name: "agent-task-budget-events",
  sql: `
CREATE TABLE IF NOT EXISTS agent_task_budget_events (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('warning', 'degraded', 'exhausted', 'raised')),
  state TEXT NOT NULL CHECK (state IN ('ok', 'warning', 'degraded', 'exhausted')),
  spent_usd REAL NOT NULL DEFAULT 0,
  spent_tokens INTEGER NOT NULL DEFAULT 0,
  cost_budget_usd REAL,
  token_budget INTEGER,
  model TEXT NOT NULL DEFAULT '',
  economy_model TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_agent_task_budget_events_user_ts ON agent_task_budget_events(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_events_user_task ON agent_task_budget_events(user_id, task_id, ts);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_events_ts ON agent_task_budget_events(ts);
`,
}
