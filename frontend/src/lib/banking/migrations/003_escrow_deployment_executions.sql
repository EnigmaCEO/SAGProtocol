CREATE TABLE IF NOT EXISTS escrow_deployment_executions (
  batch_uuid TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL,
  executed_by TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  deployment_tx_hash TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_deployment_executions_executed_at
  ON escrow_deployment_executions (executed_at DESC);
