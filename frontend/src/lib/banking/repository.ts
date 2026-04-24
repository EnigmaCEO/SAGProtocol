import { query, withTransaction } from './db';

export type BankingStatus =
  | 'created'
  | 'awaiting_funding'
  | 'funded'
  | 'processing'
  | 'active'
  | 'matured'
  | 'failed';

export type ProtocolStatus =
  | 'not_registered'
  | 'awaiting_circle_conversion'
  | 'circle_transfer_pending'
  | 'circle_transfer_complete'
  | 'lot_registered'
  | 'batch_pending'
  | 'batched'
  | 'in_execution'
  | 'settled'
  | 'failed';

export interface BankAccountRow {
  id: string;
  owner_key: string;
  provider: string;
  provider_account_id: string | null;
  status: string;
  currency: string;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface WireInstructionsRow {
  id: string;
  bank_account_id: string;
  provider: string;
  provider_bank_id: string;
  beneficiary_name: string | null;
  beneficiary_bank_name: string | null;
  beneficiary_bank_address: string | null;
  account_number: string | null;
  routing_number: string | null;
  swift_code: string | null;
  tracking_ref: string | null;
  virtual_account_number: string | null;
  raw_payload: any;
  created_at: string;
  updated_at: string;
}

export interface IncomingWireRow {
  id: string;
  bank_account_id: string;
  provider: string;
  provider_payment_id: string | null;
  tracking_ref: string | null;
  expected_amount: string | null;
  received_amount: string | null;
  currency: string;
  status: string;
  initiated_at: string | null;
  credited_at: string | null;
  raw_payload: any;
}

export interface TermPositionRow {
  id: string;
  owner_key: string;
  source_incoming_wire_id: string | null;
  amount_usd: string;
  term_start_at: string;
  term_maturity_at: string;
  banking_status: BankingStatus;
  protocol_status: ProtocolStatus;
  protocol_sync_status: 'unsynced' | 'syncing' | 'synced' | 'error';
  treasury_origin_lot_id: string | null;
  treasury_batch_id: string | null;
  treasury_batch_expected_return_at: string | null;
  treasury_batch_settlement_deadline_at: string | null;
  treasury_settlement_status: string | null;
  circle_transfer_id: string | null;
  circle_transfer_tx_hash: string | null;
  sync_error: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface CircleTransferRow {
  id: string;
  term_position_id: string | null;
  provider_transfer_id: string | null;
  destination_address: string;
  blockchain: string;
  amount: string;
  currency: string;
  status: string;
  tx_hash: string | null;
  raw_payload: any;
}

export interface CheckingLedger {
  availableBalanceUsd: number;
  postedBalanceUsd: number;
  transactions: Array<{
    id: string;
    description: string;
    category: 'credit' | 'debit' | 'transfer' | 'service';
    amountUsd: number;
    balanceAfterUsd: number;
    effectiveAt: string;
    postedAt: string;
    status: 'posted' | 'pending';
    counterparty?: string;
  }>;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPostedWireStatus(status: string): boolean {
  return ['paid', 'confirmed', 'complete', 'completed', 'posted'].includes(status.toLowerCase());
}

function termYearsLabel(term: TermPositionRow): string {
  const start = new Date(term.term_start_at).getTime();
  const end = new Date(term.term_maturity_at).getTime();
  const years = Math.max(1, Math.round((end - start) / (365 * 24 * 60 * 60 * 1000)));
  return `${years} Year${years > 1 ? 's' : ''} Term Deposit`;
}

export class BankingRepository {
  async getOrCreateDefaultBankAccount(ownerKey = 'default'): Promise<BankAccountRow> {
    const existing = await query<BankAccountRow>(
      `SELECT * FROM bank_accounts WHERE owner_key = $1 AND provider = 'circle' ORDER BY created_at ASC LIMIT 1`,
      [ownerKey]
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await query<BankAccountRow>(
      `INSERT INTO bank_accounts (owner_key, provider, status, currency)
       VALUES ($1, 'circle', 'created', 'USD')
       RETURNING *`,
      [ownerKey]
    );
    return created.rows[0];
  }

  async upsertWireInstructions(input: Partial<WireInstructionsRow> & { bank_account_id: string; provider_bank_id: string; raw_payload: any }): Promise<WireInstructionsRow> {
    const result = await query<WireInstructionsRow>(
      `INSERT INTO wire_instructions (
        bank_account_id, provider, provider_bank_id, beneficiary_name, beneficiary_bank_name,
        beneficiary_bank_address, account_number, routing_number, swift_code, tracking_ref,
        virtual_account_number, raw_payload
      ) VALUES ($1, 'circle', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (provider, provider_bank_id) DO UPDATE SET
        beneficiary_name = EXCLUDED.beneficiary_name,
        beneficiary_bank_name = EXCLUDED.beneficiary_bank_name,
        beneficiary_bank_address = EXCLUDED.beneficiary_bank_address,
        account_number = EXCLUDED.account_number,
        routing_number = EXCLUDED.routing_number,
        swift_code = EXCLUDED.swift_code,
        tracking_ref = EXCLUDED.tracking_ref,
        virtual_account_number = EXCLUDED.virtual_account_number,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING *`,
      [
        input.bank_account_id,
        input.provider_bank_id,
        input.beneficiary_name ?? null,
        input.beneficiary_bank_name ?? null,
        input.beneficiary_bank_address ?? null,
        input.account_number ?? null,
        input.routing_number ?? null,
        input.swift_code ?? null,
        input.tracking_ref ?? null,
        input.virtual_account_number ?? null,
        json(input.raw_payload),
      ]
    );
    return result.rows[0];
  }

  async listWireInstructions(): Promise<WireInstructionsRow[]> {
    return (await query<WireInstructionsRow>(`SELECT * FROM wire_instructions ORDER BY created_at DESC`)).rows;
  }

  async createTermPosition(input: { ownerKey?: string; amountUsd: number; termYears: number; metadata?: any }): Promise<TermPositionRow> {
    const start = new Date();
    const maturity = new Date(start);
    maturity.setFullYear(maturity.getFullYear() + input.termYears);
    return withTransaction(async (client) => {
      const postedWireResult = await client.query(
        `SELECT COALESCE(SUM(received_amount), 0) AS total
         FROM incoming_wires
         WHERE status IN ('paid', 'confirmed', 'complete', 'completed', 'posted')
           AND received_amount IS NOT NULL`
      );
      const fundedTermResult = await client.query(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
         FROM term_positions
         WHERE banking_status IN ('funded', 'processing', 'active', 'matured')`
      );
      const available = num(postedWireResult.rows[0]?.total) - num(fundedTermResult.rows[0]?.total);
      if (input.amountUsd > available) {
        throw new Error('Insufficient available balance in the checking account.');
      }

      const result = await client.query(
        `INSERT INTO term_positions (
          owner_key, amount_usd, term_start_at, term_maturity_at,
          banking_status, protocol_status, protocol_sync_status, metadata
        ) VALUES ($1, $2, $3, $4, 'funded', 'awaiting_circle_conversion', 'unsynced', $5::jsonb)
        RETURNING *`,
        [input.ownerKey ?? 'default', input.amountUsd, start.toISOString(), maturity.toISOString(), json(input.metadata)]
      );
      const term = result.rows[0];
      await client.query(
        `INSERT INTO protocol_sync_events (
          entity_type, entity_id, direction, action, status, request_payload,
          response_payload, idempotency_key
        ) VALUES ('term_position', $1, 'internal', 'term_position_funded', 'synced', $2::jsonb, '{}'::jsonb, $3)
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [term.id, json({ amountUsd: input.amountUsd, sourceAccount: 'checking' }), `term-position-funded:${term.id}`]
      );
      return term;
    });
  }

  async listTermPositions(): Promise<TermPositionRow[]> {
    return (await query<TermPositionRow>(`SELECT * FROM term_positions ORDER BY created_at DESC`)).rows;
  }

  async getTermPosition(id: string): Promise<TermPositionRow | null> {
    return (await query<TermPositionRow>(`SELECT * FROM term_positions WHERE id = $1`, [id])).rows[0] ?? null;
  }

  async upsertIncomingWire(input: {
    bankAccountId: string;
    providerPaymentId?: string | null;
    trackingRef?: string | null;
    expectedAmount?: number | null;
    receivedAmount?: number | null;
    currency?: string;
    status: string;
    creditedAt?: string | null;
    rawPayload: any;
  }): Promise<IncomingWireRow> {
    const result = await query<IncomingWireRow>(
      `INSERT INTO incoming_wires (
        bank_account_id, provider, provider_payment_id, tracking_ref, expected_amount,
        received_amount, currency, status, initiated_at, credited_at, raw_payload
      ) VALUES ($1, 'circle', $2, $3, $4, $5, $6, $7, now(), $8, $9::jsonb)
      ON CONFLICT (provider, provider_payment_id) DO UPDATE SET
        received_amount = COALESCE(EXCLUDED.received_amount, incoming_wires.received_amount),
        status = EXCLUDED.status,
        credited_at = COALESCE(EXCLUDED.credited_at, incoming_wires.credited_at),
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING *`,
      [
        input.bankAccountId,
        input.providerPaymentId ?? input.trackingRef,
        input.trackingRef ?? null,
        input.expectedAmount ?? null,
        input.receivedAmount ?? null,
        input.currency ?? 'USD',
        input.status,
        input.creditedAt ?? null,
        json(input.rawPayload),
      ]
    );
    const wire = result.rows[0];
    if (isPostedWireStatus(wire.status)) {
      await this.storeProtocolSyncEvent({
        entityType: 'incoming_wire',
        entityId: wire.id,
        direction: 'internal',
        action: 'incoming_wire_received',
        status: 'synced',
        responsePayload: { amountUsd: num(wire.received_amount), bankAccountId: wire.bank_account_id },
        idempotencyKey: `incoming-wire-received:${wire.id}`,
      });
    }
    return wire;
  }

  async getCheckingLedger(): Promise<CheckingLedger> {
    const wires = (await query<IncomingWireRow>(
      `SELECT * FROM incoming_wires
       WHERE received_amount IS NOT NULL
       ORDER BY COALESCE(credited_at, created_at) ASC`
    )).rows;
    const terms = (await query<TermPositionRow>(
      `SELECT * FROM term_positions
       WHERE banking_status IN ('funded', 'processing', 'active', 'matured')
       ORDER BY created_at ASC`
    )).rows;

    const entries = [
      ...wires.map((wire) => ({
        id: wire.id,
        description: isPostedWireStatus(wire.status) ? 'Incoming USD wire received' : 'Incoming USD wire pending',
        category: 'credit' as const,
        amountUsd: num(wire.received_amount),
        effectiveAt: wire.credited_at ?? wire.initiated_at ?? new Date().toISOString(),
        postedAt: wire.credited_at ?? wire.initiated_at ?? new Date().toISOString(),
        status: isPostedWireStatus(wire.status) ? 'posted' as const : 'pending' as const,
        counterparty: 'External bank transfer',
      })),
      ...terms.map((term) => ({
        id: `term-funding-${term.id}`,
        description: `Transfer to Sagitta ${termYearsLabel(term)}`,
        category: 'transfer' as const,
        amountUsd: -num(term.amount_usd),
        effectiveAt: term.created_at,
        postedAt: term.created_at,
        status: 'posted' as const,
        counterparty: 'Sagitta Term Deposit Account',
      })),
    ].sort((left, right) => new Date(left.postedAt).getTime() - new Date(right.postedAt).getTime());

    let postedBalance = 0;
    const withBalances = entries.map((entry) => {
      if (entry.status === 'posted') postedBalance = num((postedBalance + entry.amountUsd).toFixed(2));
      return { ...entry, balanceAfterUsd: postedBalance };
    });
    const availableBalance = num(postedBalance.toFixed(2));

    return {
      availableBalanceUsd: availableBalance,
      postedBalanceUsd: availableBalance,
      transactions: withBalances.slice().reverse().slice(0, 8),
    };
  }

  async upsertCircleTransfer(input: {
    termPositionId: string;
    providerTransferId: string;
    destinationAddress: string;
    blockchain: string;
    amount: number;
    currency: string;
    status: string;
    txHash?: string | null;
    rawPayload: any;
  }): Promise<CircleTransferRow> {
    const result = await query<CircleTransferRow>(
      `INSERT INTO circle_transfers (
        term_position_id, provider_transfer_id, destination_address, blockchain,
        amount, currency, status, tx_hash, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (provider_transfer_id) DO UPDATE SET
        status = EXCLUDED.status,
        tx_hash = COALESCE(EXCLUDED.tx_hash, circle_transfers.tx_hash),
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING *`,
      [
        input.termPositionId,
        input.providerTransferId,
        input.destinationAddress,
        input.blockchain,
        input.amount,
        input.currency,
        input.status,
        input.txHash ?? null,
        json(input.rawPayload),
      ]
    );
    await query(
      `UPDATE term_positions
       SET circle_transfer_id = $1,
           circle_transfer_tx_hash = COALESCE($2, circle_transfer_tx_hash),
           banking_status = CASE WHEN $3 IN ('complete', 'completed', 'confirmed') THEN 'processing' ELSE banking_status END,
           protocol_status = CASE WHEN $3 IN ('complete', 'completed', 'confirmed') THEN 'circle_transfer_complete' ELSE 'circle_transfer_pending' END,
           updated_at = now()
       WHERE id = $4`,
      [result.rows[0].id, input.txHash ?? null, input.status, input.termPositionId]
    );
    return result.rows[0];
  }

  async markTermTreasuryLot(id: string, lotId: string, txHash?: string): Promise<TermPositionRow> {
    const result = await query<TermPositionRow>(
      `UPDATE term_positions
       SET treasury_origin_lot_id = $2,
           protocol_status = 'lot_registered',
           protocol_sync_status = 'synced',
           sync_error = NULL,
           metadata = metadata || $3::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, lotId, json({ treasuryLotTxHash: txHash })]
    );
    return result.rows[0];
  }

  async markTermBatch(ids: string[], batchId: string, expectedReturnAt: string, settlementDeadlineAt: string, txHash?: string): Promise<void> {
    if (ids.length === 0) return;
    await query(
      `UPDATE term_positions
       SET treasury_batch_id = $2,
           treasury_batch_expected_return_at = $3,
           treasury_batch_settlement_deadline_at = $4,
           treasury_settlement_status = 'active',
           banking_status = 'active',
           protocol_status = 'in_execution',
           protocol_sync_status = 'synced',
           metadata = metadata || $5::jsonb,
           updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [ids, batchId, expectedReturnAt, settlementDeadlineAt, json({ treasuryBatchTxHash: txHash })]
    );
  }

  async listReadyForTreasuryLot(): Promise<TermPositionRow[]> {
    return (await query<TermPositionRow>(
      `SELECT * FROM term_positions
       WHERE treasury_origin_lot_id IS NULL
         AND banking_status IN ('funded', 'processing')
         AND protocol_status IN ('circle_transfer_complete', 'failed')
       ORDER BY created_at ASC`
    )).rows;
  }

  async listEligibleBankLots(settlementDeadlineAt: string, maxLots: number): Promise<TermPositionRow[]> {
    return (await query<TermPositionRow>(
      `SELECT * FROM term_positions
       WHERE treasury_origin_lot_id IS NOT NULL
         AND treasury_batch_id IS NULL
         AND term_maturity_at >= $1
         AND protocol_status IN ('lot_registered', 'batch_pending')
       ORDER BY created_at ASC
       LIMIT $2`,
      [settlementDeadlineAt, maxLots]
    )).rows;
  }

  async storeProtocolSyncEvent(input: {
    entityType: string;
    entityId: string;
    direction: string;
    action: string;
    status: string;
    requestPayload?: any;
    responsePayload?: any;
    error?: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    await query(
      `INSERT INTO protocol_sync_events (
        entity_type, entity_id, direction, action, status, request_payload,
        response_payload, error, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.entityType,
        input.entityId,
        input.direction,
        input.action,
        input.status,
        json(input.requestPayload),
        json(input.responsePayload),
        input.error ?? null,
        input.idempotencyKey,
      ]
    );
  }

  async ingestWebhook(input: { provider: string; providerEventId?: string | null; eventType: string; signatureValid: boolean; payload: any }) {
    return (await query(
      `INSERT INTO webhook_events (provider, provider_event_id, event_type, signature_valid, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (provider, provider_event_id) DO UPDATE SET payload = webhook_events.payload
       RETURNING *`,
      [input.provider, input.providerEventId ?? `${input.eventType}:${JSON.stringify(input.payload).slice(0, 128)}`, input.eventType, input.signatureValid, json(input.payload)]
    )).rows[0];
  }

  async markWebhookProcessed(id: string, error?: string | null): Promise<void> {
    await query(
      `UPDATE webhook_events
       SET processed = $2, processed_at = now(), error = $3
       WHERE id = $1`,
      [id, !error, error ?? null]
    );
  }

  async updateTermProtocolSettled(id: string, settledAt: string): Promise<void> {
    await query(
      `UPDATE term_positions
       SET protocol_status = 'settled',
           protocol_sync_status = 'synced',
           treasury_settlement_status = $2,
           sync_error = NULL,
           updated_at = now()
       WHERE id = $1`,
      [id, `settled ${settledAt}`]
    );
  }

  async updateTermSyncError(id: string, protocolStatus: ProtocolStatus, error: string): Promise<void> {
    await query(
      `UPDATE term_positions
       SET protocol_status = $2, protocol_sync_status = 'error', sync_error = $3, updated_at = now()
       WHERE id = $1`,
      [id, protocolStatus, error]
    );
  }

  async updateTransferByProviderId(providerTransferId: string, status: string, txHash: string | null, rawPayload: any): Promise<void> {
    await withTransaction(async (client) => {
      const transfer = await client.query(
        `UPDATE circle_transfers
         SET status = $2, tx_hash = COALESCE($3, tx_hash), raw_payload = $4::jsonb, updated_at = now()
         WHERE provider_transfer_id = $1
         RETURNING *`,
        [providerTransferId, status, txHash, json(rawPayload)]
      );
      if (transfer.rows[0]?.term_position_id) {
        await client.query(
          `UPDATE term_positions
           SET banking_status = CASE WHEN $2 IN ('complete', 'completed', 'confirmed') THEN 'processing' ELSE banking_status END,
               protocol_status = CASE WHEN $2 IN ('complete', 'completed', 'confirmed') THEN 'circle_transfer_complete' ELSE protocol_status END,
               circle_transfer_tx_hash = COALESCE($3, circle_transfer_tx_hash),
               updated_at = now()
           WHERE id = $1`,
          [transfer.rows[0].term_position_id, status, txHash]
        );
      }
    });
  }
}
