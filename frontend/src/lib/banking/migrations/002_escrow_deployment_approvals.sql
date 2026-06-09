-- Deployment approval evidence, keyed only by the immutable escrow batch UUID.
-- One approval per batch; duplicates are rejected at the application layer.
CREATE TABLE IF NOT EXISTS escrow_deployment_approvals (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_uuid                  text        NOT NULL UNIQUE,
  approval_id                 text        NOT NULL,
  deployment_approval_hash    text        NOT NULL,
  destination_approval_hash   text        NOT NULL,
  allocation_plan_hash        text        NOT NULL,
  policy_context_hash         text        NOT NULL,
  destination_registry_version text       NOT NULL DEFAULT '',
  approved_by                 text        NOT NULL,
  approved_at                 timestamptz NOT NULL,
  status                      text        NOT NULL DEFAULT 'deployment_approved',
  payload                     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_deployment_approvals_batch_uuid
  ON escrow_deployment_approvals (batch_uuid);
