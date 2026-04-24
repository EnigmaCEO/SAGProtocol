import crypto from 'crypto';

import type { BankingBatchRequest, BankingBatchResponse, BankingDashboardState, BankingDepositRequest } from './types';
import { CircleAdapter, normalizeCircleAmount, normalizeCircleId, normalizeCircleStatus } from './circleAdapter';
import { BankingRepository, type BankingStatus, type ProtocolStatus, type TermPositionRow } from './repository';
import { TreasuryAdapter } from './treasuryAdapter';

function n(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function termYears(term: TermPositionRow): number {
  const start = new Date(term.term_start_at).getTime();
  const end = new Date(term.term_maturity_at).getTime();
  return Math.max(1, Math.round((end - start) / (365 * 24 * 60 * 60 * 1000)));
}

function productStatus(status: BankingStatus): any {
  if (status === 'created' || status === 'awaiting_funding') return 'not_funded';
  if (status === 'funded') return 'funded';
  if (status === 'processing') return 'processing';
  if (status === 'active') return 'active';
  if (status === 'matured') return 'matured';
  return 'processing';
}

function protocolStatus(term: TermPositionRow): any {
  if (term.protocol_status === 'not_registered') return 'awaiting_circle_conversion';
  if (term.protocol_status === 'lot_registered') return 'treasury_lot_registered';
  if (term.protocol_status === 'batched') return 'batched';
  if (term.protocol_status === 'in_execution') return 'in_execution';
  if (term.protocol_status === 'settled') return 'settled';
  return term.protocol_status;
}

function protocolSyncStatus(term: TermPositionRow): any {
  if (term.protocol_sync_status === 'error') return 'failed';
  if (term.protocol_status === 'settled') return 'settled';
  if (term.protocol_status === 'in_execution' || term.protocol_status === 'batched') return 'batched';
  if (term.protocol_status === 'lot_registered') return 'registered';
  if (term.protocol_sync_status === 'synced') return 'registered';
  return 'pending';
}

function reserveStatusLabel(term: TermPositionRow): string {
  const labels: Record<ProtocolStatus, string> = {
    not_registered: 'Preparing protocol allocation',
    awaiting_circle_conversion: 'Processing funding',
    circle_transfer_pending: 'Activating term position',
    circle_transfer_complete: 'Preparing protocol allocation',
    lot_registered: 'Treasury lot registered',
    batch_pending: 'Waiting for BANK batch',
    batched: 'BANK batch created',
    in_execution: 'Active term position',
    settled: 'Settled',
    failed: 'Protocol processing needs review',
  };
  return labels[term.protocol_status] || 'Processing funding';
}

export function mapTermRow(term: TermPositionRow) {
  const years = termYears(term);
  return {
    id: term.id,
    label: `Sagitta ${years} Year Term Deposit`,
    principalUsd: n(term.amount_usd),
    openedAt: term.term_start_at,
    fundedAt: term.created_at,
    maturityDate: term.term_maturity_at,
    status: productStatus(term.banking_status),
    protocolStatus: protocolStatus(term),
    protocolSyncStatus: protocolSyncStatus(term),
    protocolSyncError: term.sync_error ?? undefined,
    treasuryOriginLotId: term.treasury_origin_lot_id ?? undefined,
    treasuryBatchId: term.treasury_batch_id ?? undefined,
    treasuryBatchExpectedReturnAt: term.treasury_batch_expected_return_at ?? undefined,
    treasuryBatchSettlementDeadlineAt: term.treasury_batch_settlement_deadline_at ?? undefined,
    treasurySettlementStatus: term.treasury_settlement_status ?? undefined,
    circleTransferId: term.circle_transfer_id ?? undefined,
    circleTransferTxHash: term.circle_transfer_tx_hash ?? undefined,
    termYears: years,
    rateLabel: `${(4.15 + years * 0.22).toFixed(2)}% fixed`,
    protectionStatus: 'protected',
    reserveStatusLabel: reserveStatusLabel(term),
    settlementReference: String(term.metadata?.settlementReference || term.id),
    settlementMode: term.circle_transfer_tx_hash ? 'onchain' : 'mirrored',
    sourceAccountId: 'capital-account-primary',
    vaultDestinationLabel: 'Treasury BANK lot',
  };
}

export class BankingService {
  constructor(
    private readonly repo = new BankingRepository(),
    private readonly circle = new CircleAdapter(),
    private readonly treasury = new TreasuryAdapter()
  ) {}

  async getDashboardState(): Promise<BankingDashboardState> {
    await this.reconcileTreasury().catch(() => {});
    const terms = await this.repo.listTermPositions();
    const activeTerms = terms.map(mapTermRow);
    const termBalance = activeTerms.reduce((sum, term) => sum + term.principalUsd, 0);
    const termsAwaitingTreasury = activeTerms.filter((term) => !term.treasuryOriginLotId).length;
    const termStatusText = termBalance <= 0
      ? 'Not funded'
      : termsAwaitingTreasury === activeTerms.length
        ? 'Funded, awaiting Treasury allocation'
        : termsAwaitingTreasury > 0
          ? 'Partially allocated to Treasury'
          : 'Active term position';
    const account = await this.repo.getOrCreateDefaultBankAccount();
    const ledger = await this.repo.getCheckingLedger();
    return {
      accounts: [
        { id: 'acct-checking', kind: 'checking', accountName: 'Checking Account', accountNumberMasked: '**** 1048', currentBalanceUsd: ledger.availableBalanceUsd, statusText: ledger.availableBalanceUsd > 0 ? 'Funds available' : 'Awaiting wire', readOnly: true },
        { id: 'acct-savings', kind: 'savings', accountName: 'Savings Account', accountNumberMasked: '**** 2214', currentBalanceUsd: 0, statusText: 'Available', readOnly: true },
        { id: 'acct-term', kind: 'term-deposit', accountName: 'Sagitta Term Deposit Account', accountNumberMasked: '**** 8831', currentBalanceUsd: termBalance, statusText: termStatusText, readOnly: false },
      ],
      capitalAccount: {
        id: 'capital-account-primary',
        accountName: 'Checking Account',
        accountNumberMasked: '**** 1048',
        routingNumberMasked: '**** 9912',
        availableBalanceUsd: ledger.availableBalanceUsd,
        postedBalanceUsd: ledger.postedBalanceUsd,
        currency: account.currency,
        lastUpdatedAt: account.updated_at,
        transactions: ledger.transactions,
      },
      fundingInstructions: [
        {
          id: 'checking-wire',
          sourceAccountId: 'capital-account-primary',
          destinationLabel: 'Checking Account',
          transferRail: 'USD wire',
          processingWindow: 'Same-day posting after receipt',
          cutoffTime: '5:00 PM ET',
          status: 'available',
        },
      ],
      maturitySchedules: [1, 2, 3, 4, 5].map((years) => ({ id: `term-${years}y`, termYears: years, label: `${years} Year${years > 1 ? 's' : ''}`, description: `${years} year term deposit`, reviewWindow: '30-day review window' })),
      termPositions: activeTerms as any,
      protectionStatus: {
        status: termBalance > 0 ? 'protected' : 'monitoring',
        summary: termBalance > 0 ? 'Term deposits are funded in Banking while protocol allocation runs in the background.' : '',
        reserveCoverageLabel: termBalance > 0 ? 'Background allocation' : '',
        protectedCapitalUsd: termBalance,
        asOf: new Date().toISOString(),
        note: 'Checking and term product state are separate from Circle and Treasury protocol state.',
      },
      settlementEvents: [],
      vaultBridge: { routeTab: 'vault', destinationLabel: 'Treasury BANK lots', overlayActiveUsd6: '0', overlayActiveCount: 0, lastSyncAt: new Date().toISOString() },
    };
  }

  async listAccounts() {
    const state = await this.getDashboardState();
    return state.accounts;
  }

  async listTermDeposits() {
    return (await this.repo.listTermPositions()).map(mapTermRow);
  }

  async getTermDeposit(id: string) {
    const term = await this.repo.getTermPosition(id);
    return term ? mapTermRow(term) : null;
  }

  async createTermDeposit(request: BankingDepositRequest) {
    if (!Number.isFinite(request.amountUsd) || request.amountUsd <= 0) {
      throw new Error('Enter a deposit amount greater than 0.');
    }
    if (!Number.isInteger(request.termYears) || request.termYears < 1 || request.termYears > 5) {
      throw new Error('Choose a term between 1 and 5 years.');
    }
    const term = await this.repo.createTermPosition({
      amountUsd: request.amountUsd,
      termYears: request.termYears,
      metadata: { settlementReference: `SGT-TD-${Date.now()}` },
    });
    await this.registerFunding(term.id).catch(async (err: any) => {
      await this.repo.updateTermSyncError(term.id, 'failed', String(err?.message || err));
    });
    const currentTerm = await this.repo.getTermPosition(term.id);
    return { state: await this.getDashboardState(), createdPosition: mapTermRow(currentTerm ?? term) as any, settlementEvent: null as any };
  }

  async getWireInstructions() {
    const account = await this.repo.getOrCreateDefaultBankAccount();
    const providerBankId = process.env.CIRCLE_SOURCE_BANK_ACCOUNT_ID || account.provider_account_id;
    if (!providerBankId) {
      return this.repo.listWireInstructions();
    }
    const payload = await this.circle.getWireInstructions(providerBankId);
    const data = payload?.data || payload;
    return [
      await this.repo.upsertWireInstructions({
        bank_account_id: account.id,
        provider_bank_id: providerBankId,
        beneficiary_name: data?.beneficiaryName || data?.beneficiary?.name,
        beneficiary_bank_name: data?.beneficiaryBankName || data?.bankName,
        beneficiary_bank_address: data?.beneficiaryBankAddress || data?.bankAddress,
        account_number: data?.accountNumber,
        routing_number: data?.routingNumber,
        swift_code: data?.swiftCode,
        tracking_ref: data?.trackingRef,
        virtual_account_number: data?.virtualAccountNumber,
        raw_payload: payload,
      }),
    ];
  }

  async createSandboxMockWire(amountUsd: number) {
    const instructions = await this.getWireInstructions();
    const trackingRef = instructions[0]?.tracking_ref || `SGT-${Date.now()}`;
    const payload = await this.circle.createSandboxMockWire({ trackingRef, amount: amountUsd });
    const account = await this.repo.getOrCreateDefaultBankAccount();
    const wire = await this.repo.upsertIncomingWire({
      bankAccountId: account.id,
      providerPaymentId: normalizeCircleId(payload),
      trackingRef,
      expectedAmount: amountUsd,
      receivedAmount: normalizeCircleAmount(payload) ?? amountUsd,
      status: normalizeCircleStatus(payload),
      rawPayload: payload,
      creditedAt: new Date().toISOString(),
    });
    return wire;
  }

  async simulateIncomingWire(amountUsd: number) {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error('amountUsd must be greater than 0');
    }
    const account = await this.repo.getOrCreateDefaultBankAccount();
    const trackingRef = `SIM-WIRE-${Date.now()}`;
    const wire = await this.repo.upsertIncomingWire({
      bankAccountId: account.id,
      providerPaymentId: trackingRef,
      trackingRef,
      expectedAmount: amountUsd,
      receivedAmount: amountUsd,
      status: 'posted',
      rawPayload: {
        source: 'local_simulation',
        event: 'incoming_wire_received',
        amount: { amount: amountUsd.toFixed(2), currency: 'USD' },
      },
      creditedAt: new Date().toISOString(),
    });
    return { wire, state: await this.getDashboardState() };
  }

  async registerFunding(termId: string) {
    const term = await this.repo.getTermPosition(termId);
    if (!term) throw new Error('Term position not found.');
    if (!['funded', 'processing', 'active'].includes(term.banking_status)) {
      throw new Error('Term position must be funded from Checking before protocol funding starts.');
    }
    const payload = await this.circle.createFirstPartyUsdcTransfer({ termPositionId: term.id, amount: n(term.amount_usd) });
    const providerTransferId = normalizeCircleId(payload) || crypto.randomUUID();
    await this.repo.upsertCircleTransfer({
      termPositionId: term.id,
      providerTransferId,
      destinationAddress: (process.env.CIRCLE_DESTINATION_ADDRESS || process.env.CIRCLE_WALLET_ADDRESS || '').trim(),
      blockchain: process.env.CIRCLE_BLOCKCHAIN?.trim() || 'ETH',
      amount: n(term.amount_usd),
      currency: 'USD',
      status: normalizeCircleStatus(payload),
      txHash: payload?.data?.transactionHash || payload?.data?.txHash || null,
      rawPayload: payload,
    });
    await this.repo.storeProtocolSyncEvent({
      entityType: 'term_position',
      entityId: term.id,
      direction: 'outbound',
      action: 'circle_conversion_started',
      status: 'pending',
      responsePayload: payload,
      idempotencyKey: `circle-conversion-started:${term.id}`,
    });
    return this.reconcileCircle();
  }

  async reconcileCircle() {
    const ready = await this.repo.listReadyForTreasuryLot();
    for (const term of ready) {
      try {
        const result = await this.treasury.registerBankOriginLot(term);
        await this.repo.markTermTreasuryLot(term.id, result.lotId, result.txHash);
        await this.repo.storeProtocolSyncEvent({
          entityType: 'term_position',
          entityId: term.id,
          direction: 'outbound',
          action: 'register_bank_origin_lot',
          status: 'synced',
          responsePayload: result,
          idempotencyKey: `treasury-lot:${term.id}`,
        });
      } catch (err: any) {
        await this.repo.updateTermSyncError(term.id, 'failed', String(err?.message || err));
      }
    }
    return this.getDashboardState();
  }

  async createBankBatch(request: BankingBatchRequest = {}): Promise<BankingBatchResponse> {
    const expectedReturnAt = request.expectedReturnAt || addDays(new Date(), 30);
    const settlementDeadlineAt = request.settlementDeadlineAt || addDays(new Date(), 45);
    const eligible = await this.repo.listEligibleBankLots(settlementDeadlineAt, request.maxLots || 25);
    if (eligible.length === 0) {
      return { state: await this.getDashboardState(), includedTermDepositIds: [], skippedReason: 'No eligible BANK lots.' };
    }
    const result = await this.treasury.createBankBatch(eligible, expectedReturnAt, settlementDeadlineAt);
    await this.repo.markTermBatch(eligible.map((term) => term.id), result.batchId, expectedReturnAt, settlementDeadlineAt, result.txHash);
    return {
      state: await this.getDashboardState(),
      treasuryBatchId: result.batchId,
      includedTermDepositIds: eligible.map((term) => term.id),
      txHash: result.txHash,
    };
  }

  async reconcileTreasury() {
    const terms = (await this.repo.listTermPositions()).filter((term) => term.treasury_batch_id);
    for (const term of terms) {
      try {
        const batch = await this.treasury.getTreasuryBatch(term.treasury_batch_id!);
        const status = Number(batch.status ?? batch[8] ?? 0);
        const expectedReturnAt = Number(batch.expectedReturnAt ?? batch[5] ?? 0);
        const settlementDeadlineAt = Number(batch.settlementDeadlineAt ?? batch[6] ?? 0);
        const actualReturnedAt = Number(batch.actualReturnedAt ?? batch[7] ?? 0);

        if (status === 3 && term.protocol_status !== 'settled') {
          const settledAt = actualReturnedAt > 0 ? new Date(actualReturnedAt * 1000).toISOString() : new Date().toISOString();
          await this.repo.markTermBatch(
            [term.id],
            term.treasury_batch_id!,
            expectedReturnAt > 0 ? new Date(expectedReturnAt * 1000).toISOString() : (term.treasury_batch_expected_return_at ?? new Date().toISOString()),
            settlementDeadlineAt > 0 ? new Date(settlementDeadlineAt * 1000).toISOString() : (term.treasury_batch_settlement_deadline_at ?? new Date().toISOString()),
          );
          await this.repo.updateTermProtocolSettled(term.id, settledAt);
        }
      } catch {}
    }
  }

  async ingestCircleWebhook(rawBody: string, signature: string | undefined, keyId?: string) {
    const payload = JSON.parse(rawBody || '{}');
    const signatureValid = await this.circle.verifyWebhookSignature(rawBody, signature, keyId);
    const event = await this.repo.ingestWebhook({
      provider: 'circle',
      providerEventId: payload?.id || payload?.eventId || null,
      eventType: payload?.type || payload?.eventType || 'unknown',
      signatureValid,
      payload,
    });
    try {
      const providerTransferId = normalizeCircleId(payload);
      if (providerTransferId && String(payload?.type || '').includes('transfer')) {
        await this.repo.updateTransferByProviderId(providerTransferId, normalizeCircleStatus(payload), payload?.data?.transactionHash || null, payload);
      }
      await this.repo.markWebhookProcessed(event.id);
    } catch (err: any) {
      await this.repo.markWebhookProcessed(event.id, String(err?.message || err));
    }
    return event;
  }
}

export function bankingService() {
  return new BankingService();
}
