import type {
  BankingAccountSummary,
  BankingDashboardState,
  BankingDepositRequest,
  BankingDepositResponse,
  CheckingTransaction,
  SettlementEvent,
  TermPosition,
} from './types';

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

function rateLabelForTerm(termYears: number): string {
  return `${(4.15 + termYears * 0.22).toFixed(2)}% fixed`;
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
      statusText: termBalanceUsd > 0 ? 'Active term deposit' : 'No active term deposit',
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
        destinationLabel: 'Sagitta Term Deposit',
        transferRail: 'Internal transfer',
        processingWindow: 'Standard processing',
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
      destinationLabel: 'Sagitta Vault',
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
    description: 'Incoming wire',
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
    description: request.settlementMode === 'onchain' ? 'Term deposit funded' : 'Term deposit created',
    amountUsd: normalizedAmount,
    status: request.settlementMode === 'onchain' ? 'completed' : 'mirrored',
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
    maturityDate: addYears(now, request.termYears),
    status: 'active',
    termYears: request.termYears,
    rateLabel: rateLabelForTerm(request.termYears),
    protectionStatus: 'protected',
    reserveStatusLabel: 'Deposit active',
    settlementReference: reference,
    settlementMode: request.settlementMode,
    sourceAccountId: currentState.capitalAccount.id,
    vaultDestinationLabel: 'Sagitta Vault',
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

export function createBankingDeposit(request: BankingDepositRequest): BankingDepositResponse {
  const result = applyBankingDeposit(state, request);
  state = result.state;
  return {
    state: getBankingState(),
    createdPosition: clone(result.createdPosition),
    settlementEvent: clone(result.settlementEvent),
  };
}
