CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key text NOT NULL DEFAULT 'default',
  provider text NOT NULL DEFAULT 'circle',
  provider_account_id text,
  status text NOT NULL DEFAULT 'created',
  currency text NOT NULL DEFAULT 'USD',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS wire_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  provider text NOT NULL DEFAULT 'circle',
  provider_bank_id text NOT NULL,
  beneficiary_name text,
  beneficiary_bank_name text,
  beneficiary_bank_address text,
  account_number text,
  routing_number text,
  swift_code text,
  tracking_ref text,
  virtual_account_number text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_bank_id)
);

CREATE TABLE IF NOT EXISTS incoming_wires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  provider text NOT NULL DEFAULT 'circle',
  provider_payment_id text,
  tracking_ref text,
  expected_amount numeric(20, 6),
  received_amount numeric(20, 6),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'created',
  initiated_at timestamptz,
  credited_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (provider, tracking_ref)
);

CREATE TABLE IF NOT EXISTS term_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key text NOT NULL DEFAULT 'default',
  source_incoming_wire_id uuid REFERENCES incoming_wires(id),
  amount_usd numeric(20, 6) NOT NULL,
  term_start_at timestamptz NOT NULL,
  term_maturity_at timestamptz NOT NULL,
  banking_status text NOT NULL DEFAULT 'created',
  protocol_status text NOT NULL DEFAULT 'not_registered',
  protocol_sync_status text NOT NULL DEFAULT 'unsynced',
  treasury_origin_lot_id numeric(78, 0),
  treasury_batch_id numeric(78, 0),
  treasury_batch_expected_return_at timestamptz,
  treasury_batch_settlement_deadline_at timestamptz,
  treasury_settlement_status text,
  circle_transfer_id uuid,
  circle_transfer_tx_hash text,
  sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treasury_origin_lot_id)
);

CREATE TABLE IF NOT EXISTS circle_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_position_id uuid REFERENCES term_positions(id),
  provider_transfer_id text,
  destination_address text NOT NULL,
  blockchain text NOT NULL,
  amount numeric(20, 6) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'created',
  tx_hash text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_transfer_id)
);

ALTER TABLE term_positions
  ADD CONSTRAINT fk_term_circle_transfer
  FOREIGN KEY (circle_transfer_id) REFERENCES circle_transfers(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS protocol_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  direction text NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_term_positions_status
  ON term_positions (banking_status, protocol_status, protocol_sync_status);

CREATE INDEX IF NOT EXISTS idx_incoming_wires_status
  ON incoming_wires (status);

CREATE INDEX IF NOT EXISTS idx_circle_transfers_status
  ON circle_transfers (status);
