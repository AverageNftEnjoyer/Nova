// Client-provided launch keys fence retries before either the mission or agent-task compatibility adapter enqueues.
export const migration = {
  version: 20,
  name: "deployment-idempotency",
  sql: `
ALTER TABLE deployment_runs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_runs_idem
  ON deployment_runs(user_id, deployment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`,
};
