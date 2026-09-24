// Token-efficiency Stage 4: per-task budgets with graceful degradation.
//
// cost_budget_usd / token_budget: the task's own budget; NULL = use the user's global default (kv_state namespace
// "agent-task-budget", see src/runtime/modules/agent-tasks/budget-settings). token_budget counts total tokens
// (input, cached input included, plus output).
// budget_state: 'ok' | 'warning' (>= 80% spent) | 'degraded' (context trimmed + economy model) |
// 'exhausted' (paused with pause_reason = 'budget' before a call that would go over).
export const migration = {
  version: 14,
  name: "agent-task-budgets",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN cost_budget_usd REAL;
ALTER TABLE agent_tasks ADD COLUMN token_budget INTEGER;
ALTER TABLE agent_tasks ADD COLUMN budget_state TEXT NOT NULL DEFAULT 'ok'
  CHECK (budget_state IN ('ok', 'warning', 'degraded', 'exhausted'));
`,
}
