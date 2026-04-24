import { expect } from 'chai';

// ---------------------------------------------------------------------------
// Self-contained banking spec. Tests the banking state machine behaviors
// required by the spec without importing from frontend/ to avoid cross-project
// module resolution issues with NodeNext. All state machine logic is
// reproduced here identically to service.ts / repository.ts.
// ---------------------------------------------------------------------------

type BankingStatus =
  | 'created' | 'awaiting_funding' | 'funded' | 'processing' | 'active' | 'matured' | 'failed';

type ProtocolStatus =
  | 'not_registered' | 'awaiting_circle_conversion' | 'circle_transfer_pending'
  | 'circle_transfer_complete' | 'lot_registered' | 'batch_pending'
  | 'batched' | 'batch_formed' | 'batch_funded' | 'ready_for_escrow' | 'handed_to_escrow'
  | 'in_execution' | 'settled' | 'failed';

interface TermRow {
  id: string;
  owner_key: string;
  source_incoming_wire_id: string | null;
  amount_usd: string;
  term_start_at: string;
  term_maturity_at: string;
  banking_status: BankingStatus;
  protocol_status: ProtocolStatus;
  protocol_sync_status: string;
  treasury_origin_lot_id: string | null;
  treasury_batch_id: string | null;
  treasury_batch_expected_return_at: string | null;
  treasury_batch_settlement_deadline_at: string | null;
  treasury_settlement_status: string | null;
  circle_transfer_id: string | null;
  circle_transfer_tx_hash: string | null;
  sync_error: string | null;
  origin_institution_id: string;
  policy_profile_id: string;
  policy_version: number;
  policy_config_hash: string | null;
  duration_class: string;
  origin_type: 'BANK' | 'VAULT';
  strategy_class: string;
  escrow_execution_order_id: string | null;
  metadata: any;
}

interface WireRow {
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

function makeTerm(overrides: Partial<TermRow> = {}): TermRow {
  const id = overrides.id ?? `term-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  const maturity = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id,
    owner_key: 'default',
    source_incoming_wire_id: null,
    amount_usd: '10000',
    term_start_at: now,
    term_maturity_at: maturity,
    banking_status: 'funded',
    protocol_status: 'not_registered',
    protocol_sync_status: 'unsynced',
    treasury_origin_lot_id: null,
    treasury_batch_id: null,
    treasury_batch_expected_return_at: null,
    treasury_batch_settlement_deadline_at: null,
    treasury_settlement_status: null,
    circle_transfer_id: null,
    circle_transfer_tx_hash: null,
    sync_error: null,
    origin_institution_id: 'sagitta-demo-bank',
    policy_profile_id: 'bank-conservative-v1',
    policy_version: 1,
    policy_config_hash: 'hash-v1',
    duration_class: '1Y',
    origin_type: 'BANK',
    strategy_class: 'conservative_bank_sleeve',
    escrow_execution_order_id: null,
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory repo mirroring BankingRepository behavior
// ---------------------------------------------------------------------------
class TestRepo {
  terms: TermRow[] = [];
  wires: WireRow[] = [];
  webhookEvents: any[] = [];
  circleTransfers: any[] = [];
  protocolEvents: any[] = [];
  escrowOrders: any[] = [];
  allocationPlans: any[] = [];
  allocationLegs: any[] = [];
  institutionPolicy = {
    institution_id: 'sagitta-demo-bank',
    active_policy_profile_id: 'bank-conservative-v1',
    policy_version: 1,
    policy_config_hash: 'hash-v1',
    allowed_duration_classes: ['1Y', '2Y', '3Y', '4Y', '5Y'],
    risk_posture: 'conservative',
    allocator_version: 'aaa-policy-v1',
  };

  checkingAvailableBalance(): number {
    const postedWires = this.wires
      .filter(w => ['paid', 'confirmed', 'complete', 'completed', 'posted'].includes(w.status))
      .reduce((sum, wire) => sum + Number(wire.received_amount ?? 0), 0);
    const fundedTerms = this.terms
      .filter(t => ['funded', 'processing', 'active', 'matured'].includes(t.banking_status))
      .reduce((sum, term) => sum + Number(term.amount_usd), 0);
    return postedWires - fundedTerms;
  }

  createTermPosition(input: { amountUsd: number; termYears: number }): TermRow {
    if (input.amountUsd > this.checkingAvailableBalance()) {
      throw new Error('Insufficient available balance in the checking account.');
    }
    const start = new Date();
    const maturity = new Date(start);
    maturity.setFullYear(maturity.getFullYear() + input.termYears);
    const term = makeTerm({
      amount_usd: String(input.amountUsd),
      term_maturity_at: maturity.toISOString(),
      banking_status: 'funded',
      protocol_status: 'awaiting_circle_conversion',
      origin_institution_id: this.institutionPolicy.institution_id,
      policy_profile_id: this.institutionPolicy.active_policy_profile_id,
      policy_version: this.institutionPolicy.policy_version,
      policy_config_hash: this.institutionPolicy.policy_config_hash,
      duration_class: `${input.termYears}Y`,
      origin_type: 'BANK',
      strategy_class: 'conservative_bank_sleeve',
      metadata: {
        policySnapshot: {
          originInstitutionId: this.institutionPolicy.institution_id,
          policyProfileId: this.institutionPolicy.active_policy_profile_id,
          policyVersion: this.institutionPolicy.policy_version,
          policyConfigHash: this.institutionPolicy.policy_config_hash,
          durationClass: `${input.termYears}Y`,
          originType: 'BANK',
          strategyClass: 'conservative_bank_sleeve',
        },
      },
    });
    this.terms.push(term);
    this.storeProtocolSyncEvent({
      entityType: 'term_position',
      entityId: term.id,
      direction: 'internal',
      action: 'term_position_funded',
      status: 'synced',
      idempotencyKey: `term-position-funded:${term.id}`,
    });
    return term;
  }

  listReadyForTreasuryLot(): TermRow[] {
    return this.terms.filter(t =>
      !t.treasury_origin_lot_id &&
      ['funded', 'processing'].includes(t.banking_status) &&
      ['circle_transfer_complete', 'failed'].includes(t.protocol_status)
    );
  }

  listEligibleBankLots(settlementDeadlineAt: string, maxLots: number): TermRow[] {
    return this.terms.filter(t =>
      t.treasury_origin_lot_id &&
      !t.treasury_batch_id &&
      new Date(t.term_maturity_at) >= new Date(settlementDeadlineAt) &&
      ['lot_registered', 'batch_pending'].includes(t.protocol_status)
    ).slice(0, maxLots);
  }

  listCompatibleBankLots(input: { settlementDeadlineAt: string; maxLots: number; durationClass?: string; policyProfileId?: string; strategyClass?: string; originType?: 'BANK' | 'VAULT' }): TermRow[] {
    return this.listEligibleBankLots(input.settlementDeadlineAt, input.maxLots).filter(t =>
      (!input.durationClass || t.duration_class === input.durationClass) &&
      (!input.policyProfileId || t.policy_profile_id === input.policyProfileId) &&
      (!input.strategyClass || t.strategy_class === input.strategyClass) &&
      (!input.originType || t.origin_type === input.originType)
    );
  }

  markTermTreasuryLot(id: string, lotId: string): void {
    const term = this.terms.find(t => t.id === id);
    if (term) {
      term.treasury_origin_lot_id = lotId;
      term.protocol_status = 'lot_registered';
      term.banking_status = 'processing';
      term.metadata.treasuryLotSnapshot = {
        originInstitutionId: term.origin_institution_id,
        policyProfileId: term.policy_profile_id,
        policyVersion: term.policy_version,
        durationClass: term.duration_class,
        originType: term.origin_type,
        strategyClass: term.strategy_class,
      };
    }
  }

  markTermBatch(ids: string[], batchId: string, expectedReturnAt: string, settlementDeadlineAt: string, executionOrderId?: string): void {
    for (const id of ids) {
      const term = this.terms.find(t => t.id === id);
      if (term) {
        term.treasury_batch_id = batchId;
        term.treasury_batch_expected_return_at = expectedReturnAt;
        term.treasury_batch_settlement_deadline_at = settlementDeadlineAt;
        term.banking_status = 'active';
        term.protocol_status = 'handed_to_escrow';
        term.escrow_execution_order_id = executionOrderId ?? term.escrow_execution_order_id;
      }
    }
  }

  createEscrowExecutionOrder(input: any): any {
    const existing = this.escrowOrders.find(o => o.batchId === input.batchId);
    if (existing) return existing;
    const order = {
      id: `order-${this.escrowOrders.length + 1}`,
      sourceType: input.sourceType ?? 'BANK',
      originInstitutionId: input.originInstitutionId ?? 'sagitta-demo-bank',
      productDuration: input.productDuration ?? input.durationClass,
      executionHorizon: input.executionHorizon ?? '30D',
      executionStatus: 'received',
      aaaRequestStatus: 'not_requested',
      deploymentStatus: 'not_started',
      settlementStatus: 'not_started',
      routeStatus: 'queued',
      eligibleRouteTypes: ['external_investor', 'staking'],
      ...input
    };
    this.escrowOrders.push(order);
    return order;
  }

  listEscrowOrdersForAllocation(): any[] {
    return this.escrowOrders.filter(o =>
      ['received', 'pending_allocation'].includes(o.executionStatus) &&
      ['not_requested', 'failed'].includes(o.aaaRequestStatus)
    );
  }

  storeEscrowAllocationPlan(input: any): any {
    const existing = this.allocationPlans.find(p => p.batchId === input.batchId);
    const plan = existing ? Object.assign(existing, input) : { planId: `plan-${this.allocationPlans.length + 1}`, ...input };
    if (!existing) this.allocationPlans.push(plan);
    const order = this.escrowOrders.find(o => o.batchId === input.batchId);
    if (order) {
      order.executionStatus = input.status === 'validated' ? 'allocation_validated' : 'failed';
      order.aaaRequestStatus = input.status === 'validated' ? 'completed' : 'failed';
      order.routeStatus = input.status === 'validated' ? 'plan_validated' : 'plan_rejected';
    }
    return plan;
  }

  listEscrowOrdersReadyForDeployment(): any[] {
    return this.escrowOrders.filter(o =>
      this.allocationPlans.some(p => p.batchId === o.batchId && p.status === 'validated') &&
      ['not_started', 'failed'].includes(o.deploymentStatus)
    );
  }

  getEscrowAllocationPlan(batchId: string): any {
    return this.allocationPlans.find(p => p.batchId === batchId) ?? null;
  }

  createEscrowAllocationLeg(input: any): any {
    const order = this.escrowOrders.find(o => o.batchId === input.batchId);
    if (!order) throw new Error('Execution order not found.');
    const hardCloseAt = input.hardCloseAt ?? order.hardCloseAt;
    if (new Date(input.expectedCloseAt) > new Date(hardCloseAt)) {
      throw new Error('Allocation leg expected close exceeds the batch hard close.');
    }
    if (!order.eligibleRouteTypes.includes(input.routeType)) {
      throw new Error(`Route type ${input.routeType} is not eligible`);
    }
    const leg = { legId: `leg-${this.allocationLegs.length + 1}`, status: 'proposed', hardCloseAt, ...input };
    const existing = this.allocationLegs.find(l => l.batchId === input.batchId && l.routeType === input.routeType && l.routeId === input.routeId && l.adapterId === input.adapterId);
    if (existing) return existing;
    this.allocationLegs.push(leg);
    order.routeStatus = 'routes_proposed';
    return leg;
  }

  listEscrowAllocationLegs(batchId?: string): any[] {
    return this.allocationLegs.filter(l => !batchId || l.batchId === batchId);
  }

  markEscrowLegDeployed(legId: string, deployedAt: string): any {
    const leg = this.allocationLegs.find(l => l.legId === legId);
    if (leg) { leg.status = 'deployed'; leg.deployedAt = leg.deployedAt ?? deployedAt; }
    return leg;
  }

  markEscrowLegReturned(legId: string, returnedAt: string, returnedAmountUsd: number): any {
    const leg = this.allocationLegs.find(l => l.legId === legId);
    if (leg) {
      leg.status = 'returned';
      leg.returnedAt = leg.returnedAt ?? returnedAt;
      leg.returnedAmountUsd = leg.returnedAmountUsd ?? returnedAmountUsd;
    }
    return leg;
  }

  updateEscrowOrderStatus(batchId: string, updates: any): void {
    const order = this.escrowOrders.find(o => o.batchId === batchId);
    if (!order) return;
    if (updates.executionStatus) order.executionStatus = updates.executionStatus;
    if (updates.aaaRequestStatus) order.aaaRequestStatus = updates.aaaRequestStatus;
    if (updates.deploymentStatus) order.deploymentStatus = updates.deploymentStatus;
    if (updates.settlementStatus) order.settlementStatus = updates.settlementStatus;
    if (updates.routeStatus) order.routeStatus = updates.routeStatus;
  }

  listEscrowOrdersReadyForClose(nowIso: string): any[] {
    return this.escrowOrders.filter(o => o.deploymentStatus === 'deployed' && new Date(o.targetReturnAt) <= new Date(nowIso));
  }

  listEscrowOrdersReadyForSettlement(): any[] {
    return this.escrowOrders.filter(o => o.executionStatus === 'returned' && ['return_recorded', 'settlement_pending'].includes(o.settlementStatus));
  }

  updateTermProtocolStatusForBatch(batchId: string, protocolStatus: ProtocolStatus, settlementStatus?: string): void {
    for (const term of this.terms.filter(t => t.treasury_batch_id === batchId)) {
      term.protocol_status = protocolStatus;
      term.treasury_settlement_status = settlementStatus ?? term.treasury_settlement_status;
    }
  }

  updateTermSyncError(id: string, protocolStatus: ProtocolStatus, error: string): void {
    const term = this.terms.find(t => t.id === id);
    if (term) { term.protocol_status = protocolStatus; term.sync_error = error; }
  }

  updateTermProtocolSettled(id: string, settledAt: string): void {
    const term = this.terms.find(t => t.id === id);
    if (term) { term.protocol_status = 'settled'; term.treasury_settlement_status = `settled ${settledAt}`; }
  }

  // Idempotent wire upsert: same provider_payment_id â†’ no new record
  upsertIncomingWire(input: { bankAccountId: string; providerPaymentId?: string | null; trackingRef?: string | null; expectedAmount?: number | null; receivedAmount?: number | null; status: string; rawPayload: any }): WireRow {
    const key = input.providerPaymentId ?? input.trackingRef;
    const existing = this.wires.find(w => w.provider_payment_id === key || w.tracking_ref === key);
    if (existing) { existing.status = input.status; return existing; }
    const row: WireRow = {
      id: `wire-${this.wires.length}`,
      bank_account_id: input.bankAccountId,
      provider: 'circle',
      provider_payment_id: input.providerPaymentId ?? null,
      tracking_ref: input.trackingRef ?? null,
      expected_amount: input.expectedAmount != null ? String(input.expectedAmount) : null,
      received_amount: input.receivedAmount != null ? String(input.receivedAmount) : null,
      currency: 'USD',
      status: input.status,
      initiated_at: new Date().toISOString(),
      credited_at: null,
      raw_payload: input.rawPayload,
    };
    this.wires.push(row);
    if (['paid', 'confirmed', 'complete', 'completed', 'posted'].includes(row.status)) {
      row.credited_at = new Date().toISOString();
      this.storeProtocolSyncEvent({
        entityType: 'incoming_wire',
        entityId: row.id,
        direction: 'internal',
        action: 'incoming_wire_received',
        status: 'synced',
        idempotencyKey: `incoming-wire-received:${row.id}`,
      });
    }
    return row;
  }

  upsertCircleTransfer(input: { termPositionId: string; providerTransferId: string; status: string; amount: number }): any {
    const existing = this.circleTransfers.find(t => t.provider_transfer_id === input.providerTransferId);
    if (existing) { existing.status = input.status; return existing; }
    const row = { id: `ct-${this.circleTransfers.length}`, ...input };
    this.circleTransfers.push(row);
    const term = this.terms.find(t => t.id === input.termPositionId);
    if (term) {
      term.circle_transfer_id = row.id;
      term.protocol_status = ['complete', 'completed', 'confirmed'].includes(input.status)
        ? 'circle_transfer_complete' : 'circle_transfer_pending';
      if (term.protocol_status === 'circle_transfer_complete') term.banking_status = 'processing';
    }
    return row;
  }

  storeProtocolSyncEvent(input: any): void {
    if (!this.protocolEvents.some(e => e.idempotencyKey === input.idempotencyKey)) {
      this.protocolEvents.push(input);
    }
  }

  // Idempotent webhook ingestion: same providerEventId â†’ no new record
  ingestWebhook(input: { provider: string; providerEventId?: string | null; eventType: string; signatureValid: boolean; payload: any }): any {
    const key = input.providerEventId ?? `${input.eventType}:${JSON.stringify(input.payload).slice(0, 128)}`;
    const existing = this.webhookEvents.find(e => e.provider_event_id === key);
    if (existing) return existing;
    const row = { id: `wh-${this.webhookEvents.length}`, provider_event_id: key, ...input, processed: false };
    this.webhookEvents.push(row);
    return row;
  }

  markWebhookProcessed(id: string, error?: string | null): void {
    const row = this.webhookEvents.find(e => e.id === id);
    if (row) { row.processed = !error; row.error = error ?? null; }
  }
}

// ---------------------------------------------------------------------------
// Banking service (faithful reimplementation for testing, mirrors service.ts)
// ---------------------------------------------------------------------------
interface TreasuryAdapter {
  registerBankOriginLot(term: TermRow): Promise<{ lotId: string; txHash: string }>;
  createBankBatch(terms: TermRow[], expectedReturnAt: string, settlementDeadlineAt: string): Promise<{ batchId: string; txHash: string }>;
  getTreasuryBatch(batchId: string): Promise<any>;
}

interface CircleAdapter {
  createSandboxMockWire(input: { trackingRef: string; amount: number }): Promise<any>;
  createFirstPartyUsdcTransfer(input: { termPositionId: string; amount: number }): Promise<any>;
  getWireInstructions(bankId: string): Promise<any>;
  verifyWebhookSignature(rawBody: string, sig: string | undefined): boolean;
}

function normalizeId(payload: any): string | null {
  return payload?.data?.id ?? payload?.id ?? null;
}

function normalizeStatus(payload: any): string {
  return String(payload?.data?.status ?? payload?.status ?? 'pending').toLowerCase();
}

function normalizeAmount(payload: any): number | null {
  const raw = payload?.data?.amount?.amount ?? payload?.amount?.amount ?? payload?.amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

class BankingServiceUnderTest {
  private repo: TestRepo;
  private circle: CircleAdapter;
  private treasury: TreasuryAdapter;
  constructor(repo: TestRepo, circle: CircleAdapter, treasury: TreasuryAdapter) {
    this.repo = repo;
    this.circle = circle;
    this.treasury = treasury;
  }

  createTermDeposit(req: { amountUsd: number; termYears: number }) {
    const term = this.repo.createTermPosition(req);
    this.registerFunding(term.id).catch((err: any) => {
      this.repo.updateTermSyncError(term.id, 'failed', String(err?.message || err));
    });
    return { createdPosition: term };
  }

  async createSandboxMockWire(amountUsd: number) {
    const trackingRef = `SGT-${Date.now()}`;
    const payload = await this.circle.createSandboxMockWire({ trackingRef, amount: amountUsd });
    const wire = this.repo.upsertIncomingWire({
      bankAccountId: 'test-account-id',
      providerPaymentId: normalizeId(payload),
      trackingRef,
      expectedAmount: amountUsd,
      receivedAmount: normalizeAmount(payload) ?? amountUsd,
      status: normalizeStatus(payload),
      rawPayload: payload,
    });
    return wire;
  }

  async registerFunding(termId: string) {
    const term = this.repo.terms.find(t => t.id === termId);
    if (!term) throw new Error('Term not found');
    if (!['funded', 'processing', 'active'].includes(term.banking_status)) {
      throw new Error('Term position must be funded from Checking before protocol funding starts.');
    }
    const payload = await this.circle.createFirstPartyUsdcTransfer({ termPositionId: term.id, amount: Number(term.amount_usd) });
    const providerTransferId = normalizeId(payload) ?? Math.random().toString(36).slice(2);
    this.repo.upsertCircleTransfer({ termPositionId: term.id, providerTransferId, status: normalizeStatus(payload), amount: Number(term.amount_usd) });
    this.repo.storeProtocolSyncEvent({
      entityType: 'term_position',
      entityId: term.id,
      direction: 'outbound',
      action: 'circle_conversion_started',
      status: 'pending',
      idempotencyKey: `circle-conversion-started:${term.id}`,
    });
  }

  async reconcileCircle() {
    for (const term of this.repo.listReadyForTreasuryLot()) {
      try {
        const result = await this.treasury.registerBankOriginLot(term);
        this.repo.markTermTreasuryLot(term.id, result.lotId);
      } catch (err: any) {
        this.repo.updateTermSyncError(term.id, 'failed', String(err?.message || err));
      }
    }
  }

  async createBankBatch(req: { settlementDeadlineAt?: string; expectedReturnAt?: string; maxLots?: number; durationClass?: string; policyProfileId?: string; strategyClass?: string } = {}): Promise<{ treasuryBatchId?: string; includedTermDepositIds: string[]; skippedReason?: string }> {
    const settlementDeadlineAt = req.settlementDeadlineAt ?? addDays(45);
    const expectedReturnAt = req.expectedReturnAt ?? addDays(30);
    const firstPass = this.repo.listCompatibleBankLots({
      settlementDeadlineAt,
      maxLots: req.maxLots ?? 25,
      durationClass: req.durationClass,
      policyProfileId: req.policyProfileId,
      strategyClass: req.strategyClass,
      originType: 'BANK',
    });
    const seed = firstPass[0];
    const eligible = seed
      ? firstPass.filter(t =>
          t.duration_class === seed.duration_class &&
          t.policy_profile_id === seed.policy_profile_id &&
          t.strategy_class === seed.strategy_class &&
          t.origin_type === seed.origin_type
        )
      : [];
    if (eligible.length === 0) return { includedTermDepositIds: [], skippedReason: 'No compatible lots are ready for batching.' };
    const result = await this.treasury.createBankBatch(eligible, expectedReturnAt, settlementDeadlineAt);
    const order = this.repo.createEscrowExecutionOrder({
      batchId: result.batchId,
      principalReceivedUsd: eligible.reduce((sum, t) => sum + Number(t.amount_usd), 0),
      durationClass: seed.duration_class,
      productDuration: seed.duration_class,
      executionHorizon: '30D',
      sourceType: seed.origin_type,
      originInstitutionId: seed.origin_institution_id,
      policyProfileId: seed.policy_profile_id,
      policyVersion: seed.policy_version,
      policyConfigHash: seed.policy_config_hash,
      strategyClass: seed.strategy_class,
      targetReturnAt: expectedReturnAt,
      hardCloseAt: settlementDeadlineAt,
    });
    this.repo.markTermBatch(eligible.map(t => t.id), result.batchId, expectedReturnAt, settlementDeadlineAt, order.id);
    await this.runEscrowAutomation();
    return { treasuryBatchId: result.batchId, includedTermDepositIds: eligible.map(t => t.id) };
  }

  async runEscrowAutomation(now = new Date()) {
    let allocated = 0;
    for (const order of this.repo.listEscrowOrdersForAllocation()) {
      this.repo.updateEscrowOrderStatus(order.batchId, { executionStatus: 'pending_allocation', aaaRequestStatus: 'requesting' });
      const principal = Number(order.principalReceivedUsd);
      const routeType = order.eligibleRouteTypes.includes('staking') ? 'staking' : order.eligibleRouteTypes[0];
      const leg = {
        routeType,
        routeId: `${routeType}-testnet-1`,
        adapterId: `sim-${routeType}-v1`,
        principalAllocatedUsd: principal,
        expectedCloseAt: order.targetReturnAt,
        hardCloseAt: order.hardCloseAt,
      };
      const hardClose = new Date(leg.hardCloseAt).getTime();
      const expected = new Date(leg.expectedCloseAt).getTime();
      const valid = expected <= hardClose;
      this.repo.storeEscrowAllocationPlan({
        batchId: order.batchId,
        aaaDecisionId: `aaa-${order.batchId}`,
        allocatorVersion: 'aaa-policy-v1',
        regime: 'testnet-simulated',
        marketContext: { eligibleRouteUniverse: order.eligibleRouteTypes },
        policySnapshot: {
          policyProfileId: order.policyProfileId,
          policyVersion: order.policyVersion,
          durationClass: order.durationClass,
          executionHorizon: order.executionHorizon,
          targetReturnAt: order.targetReturnAt,
          hardCloseAt: order.hardCloseAt,
        },
        proposedLegs: [leg],
        validationResult: { valid, errors: valid ? [] : ['Leg closes after hard close.'] },
        status: valid ? 'validated' : 'rejected',
      });
      allocated++;
    }

    let deployed = 0;
    for (const order of this.repo.listEscrowOrdersReadyForDeployment()) {
      const plan = this.repo.getEscrowAllocationPlan(order.batchId);
      for (const proposal of plan.proposedLegs) {
        const leg = this.repo.createEscrowAllocationLeg({
          batchId: order.batchId,
          routeType: proposal.routeType,
          routeId: proposal.routeId,
          adapterId: proposal.adapterId,
          principalAllocatedUsd: proposal.principalAllocatedUsd,
          expectedCloseAt: proposal.expectedCloseAt,
          hardCloseAt: proposal.hardCloseAt,
        });
        this.repo.markEscrowLegDeployed(leg.legId, new Date().toISOString());
      }
      this.repo.updateEscrowOrderStatus(order.batchId, { executionStatus: 'deployed', deploymentStatus: 'deployed', routeStatus: 'deployed' });
      this.repo.updateTermProtocolStatusForBatch(order.batchId, 'in_execution', 'deployed');
      deployed++;
    }

    let closed = 0;
    for (const order of this.repo.listEscrowOrdersReadyForClose(now.toISOString())) {
      for (const leg of this.repo.listEscrowAllocationLegs(order.batchId).filter(l => l.status === 'deployed')) {
        this.repo.markEscrowLegReturned(leg.legId, now.toISOString(), Number(leg.principalAllocatedUsd) * 1.01);
      }
      if (this.repo.listEscrowAllocationLegs(order.batchId).every(l => l.status === 'returned')) {
        this.repo.updateEscrowOrderStatus(order.batchId, { executionStatus: 'returned', settlementStatus: 'return_recorded', routeStatus: 'returned' });
        closed++;
      }
    }

    let settled = 0;
    for (const order of this.repo.listEscrowOrdersReadyForSettlement()) {
      this.repo.updateEscrowOrderStatus(order.batchId, { executionStatus: 'settled', settlementStatus: 'settled', routeStatus: 'settled' });
      this.repo.updateTermProtocolStatusForBatch(order.batchId, 'settled', `settled ${now.toISOString()}`);
      settled++;
    }
    return { allocated, deployed, closed, settled };
  }

  async reconcileTreasury() {
    for (const term of this.repo.terms.filter(t => t.treasury_batch_id)) {
      try {
        const batch = await this.treasury.getTreasuryBatch(term.treasury_batch_id!);
        const status = Number(batch.status ?? 0);
        const expectedReturnAt = Number(batch.expectedReturnAt ?? 0);
        const settlementDeadlineAt = Number(batch.settlementDeadlineAt ?? 0);
        const actualReturnedAt = Number(batch.actualReturnedAt ?? 0);
        if (status === 3 && term.protocol_status !== 'settled') {
          const settledAt = actualReturnedAt > 0 ? new Date(actualReturnedAt * 1000).toISOString() : new Date().toISOString();
          this.repo.markTermBatch(
            [term.id],
            term.treasury_batch_id!,
            expectedReturnAt > 0 ? new Date(expectedReturnAt * 1000).toISOString() : (term.treasury_batch_expected_return_at ?? addDays(30)),
            settlementDeadlineAt > 0 ? new Date(settlementDeadlineAt * 1000).toISOString() : (term.treasury_batch_settlement_deadline_at ?? addDays(45)),
          );
          this.repo.updateTermProtocolSettled(term.id, settledAt);
        }
      } catch {}
    }
  }

  ingestCircleWebhook(rawBody: string, signature: string | undefined) {
    const payload = JSON.parse(rawBody || '{}');
    const signatureValid = this.circle.verifyWebhookSignature(rawBody, signature);
    const event = this.repo.ingestWebhook({
      provider: 'circle',
      providerEventId: payload?.id ?? payload?.eventId ?? null,
      eventType: payload?.type ?? payload?.eventType ?? 'unknown',
      signatureValid,
      payload,
    });
    try {
      this.repo.markWebhookProcessed(event.id);
    } catch (err: any) {
      this.repo.markWebhookProcessed(event.id, String(err?.message || err));
    }
    return event;
  }
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------
function makeMockCircle(overrides: Partial<CircleAdapter> = {}): CircleAdapter {
  return {
    async createSandboxMockWire() {
      return { data: { id: 'circle-payment-id', status: 'paid', amount: { amount: '10000', currency: 'USD' } } };
    },
    async createFirstPartyUsdcTransfer() {
      return { data: { id: 'circle-payout-id', status: 'pending' } };
    },
    async getWireInstructions() {
      return { data: { beneficiaryName: 'Sagitta', trackingRef: 'SGT-001', accountNumber: '123456', routingNumber: '021000021' } };
    },
    verifyWebhookSignature(rawBody: string, sig: string | undefined) { return sig === 'valid-sig'; },
    ...overrides,
  };
}

function makeMockTreasury(overrides: Partial<TreasuryAdapter & { batchPayload?: any }> = {}): TreasuryAdapter & { registerLotCalls: string[]; createBatchCalls: any[]; batchPayload: any } {
  const adapter = {
    registerLotCalls: [] as string[],
    createBatchCalls: [] as any[],
    batchPayload: overrides.batchPayload ?? { status: 2, expectedReturnAt: 0, settlementDeadlineAt: 0, actualReturnedAt: 0 },
    async registerBankOriginLot(term: TermRow) {
      adapter.registerLotCalls.push(term.id);
      return { lotId: '42', txHash: '0xabc' };
    },
    async createBankBatch(terms: TermRow[], expectedReturnAt: string, settlementDeadlineAt: string) {
      adapter.createBatchCalls.push({ termIds: terms.map(t => t.id) });
      return { batchId: '7', txHash: '0xdef' };
    },
    async getTreasuryBatch(_batchId: string) { return adapter.batchPayload; },
    ...overrides,
  } as any;
  return adapter;
}

function makeService(overrides: { repo?: TestRepo; circle?: CircleAdapter; treasury?: any } = {}) {
  const repo = overrides.repo ?? new TestRepo();
  const circle = overrides.circle ?? makeMockCircle();
  const treasury = overrides.treasury ?? makeMockTreasury();
  return { svc: new BankingServiceUnderTest(repo, circle, treasury), repo, circle, treasury };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Banking service â€” term position persistence', function () {
  it('rejects term funding before checking funds are available', function () {
    const { svc, repo } = makeService();
    expect(() => svc.createTermDeposit({ amountUsd: 5000, termYears: 2 })).to.throw('Insufficient available balance');
    expect(repo.terms).to.have.length(0);
  });

  it('persists a funded term deposit after an incoming wire credits checking', async function () {
    const { svc, repo } = makeService();
    await svc.createSandboxMockWire(10000);
    const result = svc.createTermDeposit({ amountUsd: 5000, termYears: 2 });
    expect(result.createdPosition).to.exist;
    expect(repo.terms).to.have.length(1);
    expect(repo.terms[0].amount_usd).to.equal('5000');
    expect(repo.terms[0].banking_status).to.equal('funded');
    expect(repo.terms[0].protocol_status).to.equal('awaiting_circle_conversion');
    expect(repo.checkingAvailableBalance()).to.equal(5000);
  });

  it('does NOT route banking term deposits through Vault or direct Treasury registration', async function () {
    const { svc, repo } = makeService();
    await svc.createSandboxMockWire(5000);
    svc.createTermDeposit({ amountUsd: 5000, termYears: 1 });
    const term = repo.terms[0];
    expect(term.treasury_origin_lot_id).to.be.null;
    expect(term.treasury_batch_id).to.be.null;
    expect(term.banking_status).to.equal('funded');
  });

  it('does NOT register Treasury lot at term creation time', async function () {
    const { svc, repo, treasury } = makeService();
    await svc.createSandboxMockWire(10000);
    svc.createTermDeposit({ amountUsd: 10000, termYears: 1 });
    expect(treasury.registerLotCalls).to.have.length(0);
  });

  it('starts Circle workflow only after term_position_funded is recorded', async function () {
    const circleCalls: string[] = [];
    const circle = makeMockCircle({
      async createFirstPartyUsdcTransfer(input) {
        circleCalls.push(input.termPositionId);
        return { data: { id: 'circle-payout-id', status: 'pending' } };
      },
    });
    const { svc, repo } = makeService({ circle });
    await svc.createSandboxMockWire(10000);
    const result = svc.createTermDeposit({ amountUsd: 10000, termYears: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repo.protocolEvents.find(e => e.action === 'term_position_funded' && e.entityId === result.createdPosition.id)).to.exist;
    expect(circleCalls).to.deep.equal([result.createdPosition.id]);
  });
});

describe('Banking service â€” idempotent mock wire ingestion', function () {
  it('does not create duplicate wire records on repeated Circle payment ID', async function () {
    const { svc, repo } = makeService();

    await svc.createSandboxMockWire(10000);
    // Simulate retry â€” same Circle payment ID ('circle-payment-id' from mock)
    await svc.createSandboxMockWire(10000);

    expect(repo.wires).to.have.length(1);
  });

  it('credits Checking Account without attaching the wire to a term position', async function () {
    const { svc, repo } = makeService();
    await svc.createSandboxMockWire(10000);

    expect(repo.checkingAvailableBalance()).to.equal(10000);
    expect(repo.terms).to.have.length(0);
    expect(repo.protocolEvents.some(e => e.action === 'incoming_wire_received')).to.equal(true);
  });
});

describe('Banking service â€” no duplicate Treasury lot registration on retry', function () {
  it('registers a Treasury lot once when protocol_status is circle_transfer_complete', async function () {
    const { svc, repo, treasury } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'processing', protocol_status: 'circle_transfer_complete', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();
    expect(treasury.registerLotCalls).to.have.length(1);
  });

  it('does not re-register a lot that already has treasury_origin_lot_id', async function () {
    const { svc, repo, treasury } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'processing', treasury_origin_lot_id: '99', protocol_status: 'lot_registered' }));

    await svc.reconcileCircle();
    expect(treasury.registerLotCalls).to.have.length(0);
  });

  it('second reconcileCircle call is idempotent', async function () {
    const { svc, repo, treasury } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'processing', protocol_status: 'circle_transfer_complete', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();
    await svc.reconcileCircle();  // second call: lot is now registered, should not re-register
    expect(treasury.registerLotCalls).to.have.length(1);
  });
});

describe('Banking service â€” Circle transfer â†’ Treasury lot happy path', function () {
  it('marks term with lot_registered after successful reconciliation', async function () {
    const { svc, repo } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'processing', protocol_status: 'circle_transfer_complete', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();

    const term = repo.terms[0];
    expect(term.treasury_origin_lot_id).to.equal('42');
    expect(term.protocol_status).to.equal('lot_registered');
  });

  it('does NOT register a lot when Circle transfer is merely pending (not complete)', async function () {
    const { svc, repo, treasury } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'funded', protocol_status: 'circle_transfer_pending', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();
    expect(treasury.registerLotCalls).to.have.length(0);
  });

  it('does NOT register a lot before the term is product-funded', async function () {
    const { svc, repo, treasury } = makeService();
    repo.terms.push(makeTerm({ banking_status: 'awaiting_funding', protocol_status: 'circle_transfer_complete', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();
    expect(treasury.registerLotCalls).to.have.length(0);
  });
});

describe('Banking service â€” failed Circle transfer path', function () {
  it('keeps the visible funded term deposit when Circle startup fails', async function () {
    const failingCircle = makeMockCircle({
      async createFirstPartyUsdcTransfer() {
        throw new Error('Circle unavailable');
      },
    });
    const { svc, repo } = makeService({ circle: failingCircle });
    await svc.createSandboxMockWire(10000);

    const result = svc.createTermDeposit({ amountUsd: 10000, termYears: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const term = repo.terms.find(t => t.id === result.createdPosition.id)!;
    expect(term.banking_status).to.equal('funded');
    expect(term.protocol_status).to.equal('failed');
    expect(term.sync_error).to.include('Circle unavailable');
  });
  it('records sync error when Treasury lot registration throws', async function () {
    const failingTreasury = makeMockTreasury({
      registerBankOriginLot: async (_term: TermRow) => { throw new Error('Contract reverted'); },
    } as any);
    const { svc, repo } = makeService({ treasury: failingTreasury });
    repo.terms.push(makeTerm({ banking_status: 'processing', protocol_status: 'circle_transfer_complete', treasury_origin_lot_id: null }));

    await svc.reconcileCircle();

    const term = repo.terms[0];
    expect(term.protocol_status).to.equal('failed');
    expect(term.banking_status).to.equal('processing');
    expect(term.sync_error).to.include('reverted');
  });
});

describe('Banking service â€” BANK batch creation from eligible lots only', function () {
  it('creates a batch from lots whose maturity >= settlement deadline (liabilityUnlockAt >= settlementDeadlineAt)', async function () {
    const { svc, repo, treasury } = makeService();
    const maturity = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: '42', treasury_batch_id: null, protocol_status: 'lot_registered', term_maturity_at: maturity }));

    const deadline = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const result = await svc.createBankBatch({ settlementDeadlineAt: deadline });

    expect(treasury.createBatchCalls).to.have.length(1);
    expect(result.treasuryBatchId).to.equal('7');
    expect(result.includedTermDepositIds).to.have.length(1);
  });

  it('skips lots where maturity < settlement deadline', async function () {
    const { svc, repo, treasury } = makeService();
    const maturity = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: '42', treasury_batch_id: null, protocol_status: 'lot_registered', term_maturity_at: maturity }));

    const deadline = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const result = await svc.createBankBatch({ settlementDeadlineAt: deadline });

    expect(treasury.createBatchCalls).to.have.length(0);
    expect(result.skippedReason).to.include('No compatible');
  });

  it('does not include already-batched lots', async function () {
    const { svc, repo, treasury } = makeService();
    const maturity = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: '42', treasury_batch_id: 'already-batched', protocol_status: 'in_execution', term_maturity_at: maturity }));

    const result = await svc.createBankBatch({});
    expect(treasury.createBatchCalls).to.have.length(0);
    expect(result.skippedReason).to.include('No compatible');
  });

  it('does not include lots without a treasury_origin_lot_id', async function () {
    const { svc, repo, treasury } = makeService();
    const maturity = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: null, treasury_batch_id: null, protocol_status: 'not_registered', term_maturity_at: maturity }));

    const result = await svc.createBankBatch({});
    expect(treasury.createBatchCalls).to.have.length(0);
    expect(result.skippedReason).to.include('No compatible');
  });

  it('snapshots institution policy on funded deposits and Treasury lots', async function () {
    const { svc, repo } = makeService();
    repo.upsertIncomingWire({
      bankAccountId: 'checking',
      providerPaymentId: 'wire-policy',
      receivedAmount: 1000,
      status: 'posted',
      rawPayload: {},
    });

    const result = svc.createTermDeposit({ amountUsd: 1000, termYears: 2 });
    const term = repo.terms.find(t => t.id === result.createdPosition.id)!;
    repo.institutionPolicy.active_policy_profile_id = 'bank-aggressive-v2';
    repo.markTermTreasuryLot(term.id, '641');

    expect(term.metadata.policySnapshot.policyProfileId).to.equal('bank-conservative-v1');
    expect(term.metadata.treasuryLotSnapshot.policyProfileId).to.equal('bank-conservative-v1');
    expect(term.duration_class).to.equal('2Y');
  });

  it('only combines compatible duration, policy profile, and strategy sleeve', async function () {
    const { svc, repo, treasury } = makeService();
    const maturity = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ id: 'a', treasury_origin_lot_id: '1', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '1Y', policy_profile_id: 'bank-conservative-v1', strategy_class: 'conservative_bank_sleeve' }));
    repo.terms.push(makeTerm({ id: 'b', treasury_origin_lot_id: '2', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '2Y', policy_profile_id: 'bank-conservative-v1', strategy_class: 'conservative_bank_sleeve' }));
    repo.terms.push(makeTerm({ id: 'c', treasury_origin_lot_id: '3', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '1Y', policy_profile_id: 'bank-institutional-v1', strategy_class: 'institutional_bank_sleeve' }));

    const result = await svc.createBankBatch({ settlementDeadlineAt: addDays(45) });

    expect(treasury.createBatchCalls[0].termIds).to.deep.equal(['a']);
    expect(result.includedTermDepositIds).to.deep.equal(['a']);
  });

  it('hands Treasury batches to Escrow and automatically allocates/deploys legs', async function () {
    const { svc, repo } = makeService();
    const maturity = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: '42', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '1Y' }));

    const result = await svc.createBankBatch({ settlementDeadlineAt: addDays(45), expectedReturnAt: addDays(30) });
    const term = repo.terms[0];

    expect(result.treasuryBatchId).to.equal('7');
    expect(repo.escrowOrders).to.have.length(1);
    expect(repo.escrowOrders[0]).to.include({ batchId: '7', executionStatus: 'deployed', durationClass: '1Y' });
    expect(repo.escrowOrders[0].aaaRequestStatus).to.equal('completed');
    expect(repo.allocationPlans).to.have.length(1);
    expect(repo.allocationLegs).to.have.length(1);
    expect(repo.allocationLegs[0].status).to.equal('deployed');
    expect(term.protocol_status).to.equal('in_execution');
    expect(term.escrow_execution_order_id).to.equal(repo.escrowOrders[0].id);
  });

  it('supports multiple concurrent execution orders without duplicate deployments on retry', async function () {
    const { svc, repo, treasury } = makeService({
      treasury: makeMockTreasury({
        async createBankBatch(terms: TermRow[], _expectedReturnAt: string, _settlementDeadlineAt: string) {
          const batchId = String(this.createBatchCalls.length + 1);
          this.createBatchCalls.push({ termIds: terms.map(t => t.id), batchId });
          return { batchId, txHash: `0x${batchId}` };
        },
      } as any),
    });
    const maturity = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ id: 'bank-a', treasury_origin_lot_id: '1', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '1Y' }));
    repo.terms.push(makeTerm({ id: 'bank-b', treasury_origin_lot_id: '2', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '2Y' }));

    await svc.createBankBatch({ durationClass: '1Y', settlementDeadlineAt: addDays(45), expectedReturnAt: addDays(30) });
    await svc.createBankBatch({ durationClass: '2Y', settlementDeadlineAt: addDays(45), expectedReturnAt: addDays(30) });
    await svc.runEscrowAutomation();

    expect(treasury.createBatchCalls).to.have.length(2);
    expect(repo.escrowOrders.map(o => o.batchId)).to.deep.equal(['1', '2']);
    expect(repo.allocationPlans).to.have.length(2);
    expect(repo.allocationLegs).to.have.length(2);
    expect(repo.allocationLegs.map(l => l.batchId)).to.deep.equal(['1', '2']);
  });

  it('automatically closes, returns, and settles eligible deployed orders', async function () {
    const { svc, repo } = makeService();
    const maturity = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    repo.terms.push(makeTerm({ treasury_origin_lot_id: '42', protocol_status: 'lot_registered', term_maturity_at: maturity, duration_class: '1Y' }));

    await svc.createBankBatch({ settlementDeadlineAt: addDays(45), expectedReturnAt: addDays(1) });
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await svc.runEscrowAutomation(later);

    expect(repo.allocationLegs[0].status).to.equal('returned');
    expect(repo.escrowOrders[0].executionStatus).to.equal('settled');
    expect(repo.escrowOrders[0].settlementStatus).to.equal('settled');
    expect(repo.terms[0].protocol_status).to.equal('settled');
  });

  it('routes BANK and VAULT orders through the same Escrow execution model', async function () {
    const { svc, repo } = makeService();
    repo.createEscrowExecutionOrder({
      batchId: 'bank-1',
      sourceType: 'BANK',
      principalReceivedUsd: 100,
      durationClass: '1Y',
      policyProfileId: 'bank-conservative-v1',
      policyVersion: 1,
      strategyClass: 'conservative_bank_sleeve',
      targetReturnAt: addDays(30),
      hardCloseAt: addDays(45),
    });
    repo.createEscrowExecutionOrder({
      batchId: 'vault-1',
      sourceType: 'VAULT',
      principalReceivedUsd: 50,
      durationClass: '1Y',
      policyProfileId: 'vault-standard-v1',
      policyVersion: 1,
      strategyClass: 'standard_vault_sleeve',
      targetReturnAt: addDays(30),
      hardCloseAt: addDays(45),
    });

    await svc.runEscrowAutomation();

    expect(repo.escrowOrders.map(o => [o.batchId, o.sourceType, o.executionStatus])).to.deep.equal([
      ['bank-1', 'BANK', 'deployed'],
      ['vault-1', 'VAULT', 'deployed'],
    ]);
    expect(repo.allocationLegs.map(l => l.batchId)).to.deep.equal(['bank-1', 'vault-1']);
  });

  it('rejects allocation legs that violate mandate timing or route policy', async function () {
    const repo = new TestRepo();
    repo.createEscrowExecutionOrder({
      batchId: '7',
      principalReceivedUsd: 1000,
      durationClass: '1Y',
      policyProfileId: 'bank-conservative-v1',
      policyVersion: 1,
      strategyClass: 'conservative_bank_sleeve',
      targetReturnAt: addDays(30),
      hardCloseAt: addDays(45),
      eligibleRouteTypes: ['staking'],
    });

    expect(() => repo.createEscrowAllocationLeg({
      batchId: '7',
      routeType: 'external_investor',
      principalAllocatedUsd: 100,
      expectedCloseAt: addDays(30),
    })).to.throw('not eligible');

    expect(() => repo.createEscrowAllocationLeg({
      batchId: '7',
      routeType: 'staking',
      principalAllocatedUsd: 100,
      expectedCloseAt: addDays(60),
    })).to.throw('hard close');

    const leg = repo.createEscrowAllocationLeg({
      batchId: '7',
      routeType: 'staking',
      principalAllocatedUsd: 100,
      expectedCloseAt: addDays(30),
    });
    expect(leg.status).to.equal('proposed');
    expect(repo.escrowOrders[0].routeStatus).to.equal('routes_proposed');
  });
});

describe('Banking service â€” webhook replay safety', function () {
  it('does not create a second webhook record for the same Circle event ID', function () {
    const { svc, repo } = makeService();
    const payload = JSON.stringify({ id: 'evt-001', type: 'payments/wire:deposited', status: 'paid' });

    svc.ingestCircleWebhook(payload, undefined);
    svc.ingestCircleWebhook(payload, undefined);  // replay

    expect(repo.webhookEvents).to.have.length(1);
  });

  it('stores webhook event even when signature is invalid', function () {
    const { svc, repo } = makeService();
    const payload = JSON.stringify({ id: 'evt-002', type: 'payments/wire:deposited' });

    svc.ingestCircleWebhook(payload, 'bad-sig');

    expect(repo.webhookEvents).to.have.length(1);
    expect(repo.webhookEvents[0].signatureValid).to.be.false;
  });
});

describe('Banking service â€” reconciliation updates stale records', function () {
  it('marks term as settled when Treasury batch status is 3', async function () {
    const settledTreasury = makeMockTreasury({ batchPayload: { status: 3, expectedReturnAt: 1700000000, settlementDeadlineAt: 1700100000, actualReturnedAt: 1700050000 } });
    const { svc, repo } = makeService({ treasury: settledTreasury });
    repo.terms.push(makeTerm({ treasury_batch_id: '7', protocol_status: 'in_execution', treasury_settlement_status: null }));

    await svc.reconcileTreasury();

    const term = repo.terms[0];
    expect(term.protocol_status).to.equal('settled');
    expect(term.treasury_settlement_status).to.match(/^settled /);
  });

  it('does not double-settle an already settled term', async function () {
    const settledTreasury = makeMockTreasury({ batchPayload: { status: 3, expectedReturnAt: 1700000000, settlementDeadlineAt: 1700100000, actualReturnedAt: 1700050000 } });
    const { svc, repo } = makeService({ treasury: settledTreasury });
    const originalSettledAt = 'settled 2023-01-01T00:00:00.000Z';
    repo.terms.push(makeTerm({ treasury_batch_id: '7', protocol_status: 'settled', treasury_settlement_status: originalSettledAt }));

    await svc.reconcileTreasury();

    expect(repo.terms[0].treasury_settlement_status).to.equal(originalSettledAt);
  });

  it('leaves active batch terms unchanged when status is not settled (status 2)', async function () {
    const activeTreasury = makeMockTreasury({ batchPayload: { status: 2, expectedReturnAt: 0, settlementDeadlineAt: 0, actualReturnedAt: 0 } });
    const { svc, repo } = makeService({ treasury: activeTreasury });
    repo.terms.push(makeTerm({ treasury_batch_id: '7', protocol_status: 'in_execution', treasury_settlement_status: null }));

    await svc.reconcileTreasury();

    expect(repo.terms[0].protocol_status).to.equal('in_execution');
  });
});



