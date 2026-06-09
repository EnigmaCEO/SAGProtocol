import type {
  BankingAccountSummary,
  BankingBatchRequest,
  BankingBatchResponse,
  BankingDashboardState,
  BankingDepositRequest,
  BankingDepositResponse,
  BankingWireRequest,
  CheckingTransaction,
  SettlementEvent,
  TermPosition,
} from './types';
import { escrowBatchUuid } from '../escrow/ids';

export const BANKING_STORAGE_KEY = 'sagitta.banking.state.v1';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function usdToUsd6(value: number): string {
  return String(Math.round(value * 1_000_000));
}

function addYears(date: Date, years: number): string {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next.toISOString();
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function nextReference(): string {
  const suffix = Math.floor(Date.now() / 1000).toString().slice(-6);
  return `SGT-TD-${suffix}`;
}

function nextPositionId(): string {
  return `term-${Date.now()}`;
}

function nextTransactionId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

function fnv1a32(input: string, seed: number) {
  let hash = seed >>> 0;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function demoHash(value: unknown) {
  const source = JSON.stringify(value ?? {});
  const hex = [
    fnv1a32(source, 0x811c9dc5),
    fnv1a32(source, 0x12345678),
    fnv1a32(source, 0x9e3779b9),
    fnv1a32(source, 0xa5a5a5a5),
    fnv1a32(source, 0x7f4a7c15),
    fnv1a32(source, 0x34567890),
    fnv1a32(source, 0x2468ace0),
    fnv1a32(source, 0x13579bdf),
  ].join('');

  return `0x${hex}`;
}

function createDemoEscrowWalletAddress(treasuryBatchId: string) {
  const source = `escrow-${treasuryBatchId}:${treasuryBatchId}`;
  const hex = [
    fnv1a32(source, 0x811c9dc5),
    fnv1a32(source, 0x12345678),
    fnv1a32(source, 0x9e3779b9),
    fnv1a32(source, 0xa5a5a5a5),
    fnv1a32(source, 0x7f4a7c15),
  ].join('');

  return `0x${hex.slice(0, 40)}`;
}

function createDemoBindingHash(payload: Record<string, unknown>) {
  return demoHash(payload);
}

function rateLabelForTerm(termYears: number): string {
  return `${(4.15 + termYears * 0.22).toFixed(2)}% variable interest`;
}

function buildAccounts(checkingBalanceUsd: number, termBalanceUsd: number): BankingAccountSummary[] {
  return [
    {
      id: 'acct-checking',
      kind: 'checking',
      accountName: 'Checking Account',
      accountNumberMasked: '**** 1048',
      currentBalanceUsd: checkingBalanceUsd,
      statusText: 'Available',
      readOnly: true,
    },
    {
      id: 'acct-savings',
      kind: 'savings',
      accountName: 'Savings Account',
      accountNumberMasked: '**** 2214',
      currentBalanceUsd: 0,
      statusText: 'Available',
      readOnly: true,
    },
    {
      id: 'acct-term',
      kind: 'term-deposit',
      accountName: 'Sagitta Term Deposit Account',
      accountNumberMasked: '**** 8831',
      currentBalanceUsd: termBalanceUsd,
      statusText: termBalanceUsd > 0 ? 'Funded, awaiting Treasury allocation' : 'Not funded',
      readOnly: false,
    },
  ];
}

export function createSeedBankingState(): BankingDashboardState {
  const now = new Date();
  return {
    accounts: buildAccounts(0, 0),
    capitalAccount: {
      id: 'capital-account-primary',
      accountName: 'Checking Account',
      accountNumberMasked: '**** 1048',
      routingNumberMasked: '**** 9912',
      availableBalanceUsd: 0,
      postedBalanceUsd: 0,
      currency: 'USD',
      lastUpdatedAt: now.toISOString(),
      transactions: [],
    },
    fundingInstructions: [
      {
        id: 'funding-standard',
        sourceAccountId: 'capital-account-primary',
        destinationLabel: 'Checking Account',
        transferRail: 'USD wire',
        processingWindow: 'Same-day posting after receipt',
        cutoffTime: '5:00 PM ET',
        status: 'available',
      },
    ],
    maturitySchedules: [
      { id: 'term-1y', termYears: 1, label: '1 Year', description: '1 year term deposit', reviewWindow: '30-day review window' },
      { id: 'term-2y', termYears: 2, label: '2 Years', description: '2 year term deposit', reviewWindow: '30-day review window' },
      { id: 'term-3y', termYears: 3, label: '3 Years', description: '3 year term deposit', reviewWindow: '30-day review window' },
      { id: 'term-4y', termYears: 4, label: '4 Years', description: '4 year term deposit', reviewWindow: '30-day review window' },
      { id: 'term-5y', termYears: 5, label: '5 Years', description: '5 year term deposit', reviewWindow: '30-day review window' },
    ],
    termPositions: [],
    protectionStatus: {
      status: 'monitoring',
      summary: '',
      reserveCoverageLabel: '',
      protectedCapitalUsd: 0,
      asOf: now.toISOString(),
      note: '',
    },
    settlementEvents: [],
    vaultBridge: {
      routeTab: 'vault',
      destinationLabel: 'Treasury BANK lots',
      overlayActiveUsd6: '0',
      overlayActiveCount: 0,
      lastSyncAt: now.toISOString(),
    },
  };
}

export function applyIncomingWire(currentState: BankingDashboardState, amountUsd: number): BankingDashboardState {
  const normalizedAmount = roundUsd(Number(amountUsd));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return clone(currentState);
  }

  const now = new Date().toISOString();
  const nextCheckingBalance = roundUsd(currentState.capitalAccount.availableBalanceUsd + normalizedAmount);
  const wireTransaction: CheckingTransaction = {
    id: nextTransactionId('txn-wire'),
    description: 'Incoming USD wire received',
    category: 'credit',
    amountUsd: normalizedAmount,
    balanceAfterUsd: nextCheckingBalance,
    effectiveAt: now,
    postedAt: now,
    status: 'posted',
    counterparty: 'External bank transfer',
  };

  return {
    ...clone(currentState),
    accounts: buildAccounts(
      nextCheckingBalance,
      currentState.termPositions.reduce((sum, position) => sum + position.principalUsd, 0)
    ),
    capitalAccount: {
      ...currentState.capitalAccount,
      availableBalanceUsd: nextCheckingBalance,
      postedBalanceUsd: nextCheckingBalance,
      lastUpdatedAt: now,
      transactions: [wireTransaction, ...currentState.capitalAccount.transactions].slice(0, 8),
    },
  };
}

export function applyBankingDeposit(
  currentState: BankingDashboardState,
  request: BankingDepositRequest
): BankingDepositResponse {
  const normalizedAmount = roundUsd(Number(request.amountUsd));

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Enter a deposit amount greater than 0.');
  }

  if (!Number.isInteger(request.termYears) || request.termYears < 1 || request.termYears > 5) {
    throw new Error('Choose a term between 1 and 5 years.');
  }

  if (normalizedAmount > currentState.capitalAccount.availableBalanceUsd) {
    throw new Error('Insufficient available balance in the checking account.');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const reference = nextReference();
  const nextAvailableBalance = roundUsd(currentState.capitalAccount.availableBalanceUsd - normalizedAmount);

  const transaction: CheckingTransaction = {
    id: nextTransactionId('txn-deposit'),
    description: `Transfer to Sagitta ${request.termYears} Year Term Deposit`,
    category: 'transfer',
    amountUsd: -normalizedAmount,
    balanceAfterUsd: nextAvailableBalance,
    effectiveAt: nowIso,
    postedAt: nowIso,
    status: 'posted',
    counterparty: 'Sagitta Term Deposit',
  };

  const settlementEvent: SettlementEvent = {
    id: nextTransactionId('set'),
    occurredAt: nowIso,
    description: 'Term deposit funded from Checking',
    amountUsd: normalizedAmount,
    status: 'processing',
    mode: request.settlementMode,
    reference,
    txHash: request.txHash,
    note: request.note,
  };

  const termPosition: TermPosition = {
    id: nextPositionId(),
    label: `Sagitta ${request.termYears} Year Term Deposit`,
    principalUsd: normalizedAmount,
    openedAt: nowIso,
    fundedAt: nowIso,
    maturityDate: addYears(now, request.termYears),
    status: 'funded',
    protocolStatus: 'awaiting_circle_conversion',
    protocolSyncStatus: 'pending',
    termYears: request.termYears,
    rateLabel: rateLabelForTerm(request.termYears),
    protectionStatus: 'protected',
    reserveStatusLabel: 'Processing funding',
    settlementReference: reference,
    settlementMode: request.settlementMode,
    sourceAccountId: currentState.capitalAccount.id,
    vaultDestinationLabel: 'Treasury BANK lots',
  };

  const nextTermBalance = roundUsd(
    currentState.termPositions.reduce((sum, position) => sum + position.principalUsd, 0) + normalizedAmount
  );

  const nextState: BankingDashboardState = {
    ...clone(currentState),
    accounts: buildAccounts(nextAvailableBalance, nextTermBalance),
    capitalAccount: {
      ...currentState.capitalAccount,
      availableBalanceUsd: nextAvailableBalance,
      postedBalanceUsd: nextAvailableBalance,
      lastUpdatedAt: nowIso,
      transactions: [transaction, ...currentState.capitalAccount.transactions].slice(0, 8),
    },
    termPositions: [termPosition, ...currentState.termPositions],
    settlementEvents: [settlementEvent, ...currentState.settlementEvents].slice(0, 8),
    protectionStatus: {
      ...currentState.protectionStatus,
      protectedCapitalUsd: roundUsd(currentState.protectionStatus.protectedCapitalUsd + normalizedAmount),
      asOf: nowIso,
    },
    vaultBridge: {
      ...currentState.vaultBridge,
      overlayActiveUsd6:
        request.settlementMode === 'mirrored'
          ? (BigInt(currentState.vaultBridge.overlayActiveUsd6) + BigInt(usdToUsd6(normalizedAmount))).toString()
          : currentState.vaultBridge.overlayActiveUsd6,
      overlayActiveCount:
        request.settlementMode === 'mirrored'
          ? currentState.vaultBridge.overlayActiveCount + 1
          : currentState.vaultBridge.overlayActiveCount,
      lastSyncAt: nowIso,
      lastReference: settlementEvent.reference,
    },
  };

  return {
    state: nextState,
    createdPosition: clone(termPosition),
    settlementEvent: clone(settlementEvent),
  };
}

let state: BankingDashboardState = createSeedBankingState();

export function getBankingState(): BankingDashboardState {
  return clone(state);
}

export async function getSyncedBankingState(): Promise<BankingDashboardState> {
  return getBankingState();
}

export function setBankingState(nextState: BankingDashboardState): BankingDashboardState {
  state = clone(nextState);
  return getBankingState();
}

function resolveRequestState(clientState?: BankingDashboardState): BankingDashboardState {
  return clientState ? clone(clientState) : state;
}

export function receiveBankingWire(request: BankingWireRequest): BankingDashboardState {
  const nextState = applyIncomingWire(resolveRequestState(request.clientState), request.amountUsd);
  state = nextState;
  return getBankingState();
}

export async function createBankingDeposit(
  request: BankingDepositRequest & { clientState?: BankingDashboardState }
): Promise<BankingDepositResponse> {
  const result = applyBankingDeposit(resolveRequestState(request.clientState), request);
  state = result.state;
  const syncedPosition = state.termPositions.find((position) => position.id === result.createdPosition.id) ?? result.createdPosition;

  return {
    state: getBankingState(),
    createdPosition: clone(syncedPosition),
    settlementEvent: clone(result.settlementEvent),
  };
}

export async function createBankingTreasuryBatch(request: BankingBatchRequest = {}): Promise<BankingBatchResponse> {
  const currentState = resolveRequestState(request.clientState);
  const expectedReturnAt = request.expectedReturnAt || addDays(new Date(), 30);
  const settlementDeadlineAt = request.settlementDeadlineAt || addDays(new Date(), 45);
  const batchRequest = { ...request, expectedReturnAt, settlementDeadlineAt };
  const eligibleTerms = currentState.termPositions.filter(
    (p) => p.treasuryOriginLotId && !p.treasuryBatchId,
  );
  const batchResult: { status: 'batched' | 'no_eligible_lots' | 'error'; batchId?: string; txHash?: string; includedTermDepositIds: string[]; error?: string } =
    eligibleTerms.length === 0
      ? { status: 'no_eligible_lots', includedTermDepositIds: [], error: 'No eligible BANK lots for batch.' }
      : {
          status: 'batched',
          batchId: String(Date.now()),
          txHash: '0xdemo' + Math.random().toString(16).slice(2, 18),
          includedTermDepositIds: eligibleTerms.map((p) => p.id),
        };
  const nextState = clone(currentState);
  const nowIso = new Date().toISOString();

  if (batchResult.status === 'batched' && batchResult.batchId) {
    nextState.termPositions = nextState.termPositions.map((position) => {
      if (!batchResult.includedTermDepositIds.includes(position.id)) return position;
      return {
        ...position,
        treasuryBatchId: batchResult.batchId,
        treasuryBatchTxHash: batchResult.txHash,
        treasuryBatchExpectedReturnAt: expectedReturnAt,
        treasuryBatchSettlementDeadlineAt: settlementDeadlineAt,
        treasurySettlementStatus: 'active',
        protocolStatus: 'in_execution',
        protocolSyncStatus: 'batched',
        protocolSyncError: undefined,
        reserveStatusLabel: 'Treasury batch funded',
      };
    });

    const principalUsd = nextState.termPositions
      .filter((position) => batchResult.includedTermDepositIds.includes(position.id))
      .reduce((sum, position) => sum + position.principalUsd, 0);
    const sourceTerm = eligibleTerms[0];
    const treasuryBatchId = batchResult.batchId;
    const escrowBatchId = escrowBatchUuid({ chainId: 1337, treasuryAddress: '0x0000000000000000000000000000000000000000', sourceBatchId: treasuryBatchId, openedAt: 0 });
    const batchWalletAddress = createDemoEscrowWalletAddress(treasuryBatchId);
    const termMonths = Math.max(1, (sourceTerm?.termYears ?? 1) * 12);
    const durationClass = sourceTerm?.durationClass ?? `${sourceTerm?.termYears ?? 1}Y`;
    const policyProfileId = sourceTerm?.policyProfileId ?? 'bank-conservative-v1';
    const policyVersion = sourceTerm?.policyVersion ?? 1;
    const policyConfigHash = sourceTerm?.policyConfigHash;
    const strategyClass = sourceTerm?.strategyClass ?? 'conservative_bank_sleeve';
    const sourceType = sourceTerm?.originType ?? 'BANK';
    const originInstitutionId = sourceTerm?.originInstitutionId ?? 'sagitta-demo-bank';
    const executionContextHash = demoHash({
      version: 1,
      type: 'execution_receipt',
      treasuryBatchId,
      sourceType,
      originInstitutionId,
      principalReceivedUsd: principalUsd,
      durationClass,
      targetReturnAt: expectedReturnAt,
      hardCloseAt: settlementDeadlineAt,
      policyProfileId,
      policyVersion,
      policyConfigHash: policyConfigHash ?? null,
      strategyClass,
    });
    const depositManifestHash = demoHash({
      version: 1,
      type: 'treasury_deposit_manifest',
      treasuryBatchId,
      sourceType,
      originInstitutionId,
      principalReceivedUsd: principalUsd,
      executionContextHash,
    });
    const allocationPlanHash = demoHash({
      version: 1,
      type: 'treasury_allocation_plan',
      treasuryBatchId,
      principalReceivedUsd: principalUsd,
      strategyClass,
      policyProfileId,
      policyVersion,
    });
    const policyContextHash = demoHash({
      version: 1,
      type: 'treasury_policy_context',
      treasuryBatchId,
      policyProfileId,
      policyVersion,
      policyConfigHash: policyConfigHash ?? null,
      strategyClass,
    });
    const bindingCanonicalPayload = {
      batchId: escrowBatchId,
      treasuryBatchId,
      walletAddress: batchWalletAddress,
      totalAmountUsd: roundUsd(principalUsd),
      asset: 'USDC',
      termMonths,
      depositManifestHash,
      allocationPlanHash,
      policyContextHash,
      chainId: 'arc_testnet',
    };
    const batchWalletBinding = {
      bindingId: `${escrowBatchId}-wallet-binding`,
      bindingHash: createDemoBindingHash(bindingCanonicalPayload),
      canonicalPayload: bindingCanonicalPayload,
      bindingStatus: 'binding_locked',
    };

    const settlementEvent: SettlementEvent = {
      id: nextTransactionId('set-batch'),
      occurredAt: nowIso,
      description: 'Treasury BANK batch funded',
      amountUsd: roundUsd(principalUsd),
      status: 'completed',
      mode: 'onchain',
      reference: `treasury-batch-${batchResult.batchId}`,
      txHash: batchResult.txHash,
    };

    nextState.settlementEvents = [
      settlementEvent,
      ...nextState.settlementEvents,
    ].slice(0, 8);

    const escrowOrder = {
      id: `escrow-order-${treasuryBatchId}`,
      batchId: treasuryBatchId,
      sourceType,
      originInstitutionId,
      principalReceivedUsd: roundUsd(principalUsd),
      durationClass,
      productDuration: durationClass,
      executionHorizon: '30D',
      deploymentStartAt: nowIso,
      targetReturnAt: expectedReturnAt,
      hardCloseAt: settlementDeadlineAt,
      policyProfileId,
      policyVersion,
      policyConfigHash,
      strategyClass,
      executionStatus: 'received',
      aaaRequestStatus: 'not_requested',
      deploymentStatus: 'not_started',
      settlementStatus: 'not_started',
      routeStatus: 'queued',
      eligibleRouteTypes: ['external_investor', 'staking', 'private_credit'],
      treasuryBatchTxHash: batchResult.txHash,
      batchWalletAddress,
      walletAddress: batchWalletAddress,
      assignedBatchWalletAddress: batchWalletAddress,
      batchWalletChain: 'arc_testnet',
      expectedFundingAmountUsd: roundUsd(principalUsd),
      depositManifestHash,
      allocationPlanHash,
      policyContextHash,
      batchWalletBindingHash: batchWalletBinding.bindingHash,
      executionContextHash,
      metadata: {
        treasuryBatchTxHash: batchResult.txHash,
        executionContextHash,
        originTermIds: batchResult.includedTermDepositIds,
        expectedFundingAmountUsd: roundUsd(principalUsd),
        asset: 'USDC',
        escrowBatchId,
        batchWalletAddress,
        batchWalletChain: 'arc_testnet',
        depositManifestHash,
        allocationPlanHash,
        policyContextHash,
        batchWalletBinding,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    } as NonNullable<BankingDashboardState['escrowExecutionOrders']>[number];
    const existingOrders = nextState.escrowExecutionOrders ?? [];
    const existingIndex = existingOrders.findIndex((order) => order.batchId === treasuryBatchId);
    nextState.escrowExecutionOrders =
      existingIndex === -1
        ? [escrowOrder, ...existingOrders]
        : existingOrders.map((order, index) => (index === existingIndex ? { ...order, ...escrowOrder, metadata: { ...order.metadata, ...escrowOrder.metadata } } : order));
  } else {
    nextState.termPositions = nextState.termPositions.map((position) => {
      if (!position.treasuryOriginLotId || position.treasuryBatchId) return position;
      return {
        ...position,
        protocolSyncError: batchResult.error,
      };
    });
  }

  state = nextState;
  return {
    state: getBankingState(),
    treasuryBatchId: batchResult.batchId,
    includedTermDepositIds: batchResult.includedTermDepositIds,
    txHash: batchResult.txHash,
    skippedReason: batchResult.status === 'batched' ? undefined : batchResult.error,
  };
}
