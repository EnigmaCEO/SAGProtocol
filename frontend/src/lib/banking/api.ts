import type {
  BankingAccountSummary,
  BankingDashboardState,
  CapitalAccount,
  CheckingTransaction,
  FundingInstruction,
  MaturitySchedule,
  ProtectionStatus,
  SettlementEvent,
  SettlementMode,
  TermPosition,
} from './types';

export interface BankingApiMeta {
  generated_at: string;
  mode: 'mock';
}

export interface BankingApiEnvelope<T> {
  data: T;
  meta: BankingApiMeta;
}

export interface ApiCapitalAccountTransaction {
  id: string;
  description: string;
  category: CheckingTransaction['category'];
  amount_usd: number;
  balance_after_usd: number;
  posted_at: string;
  status: CheckingTransaction['status'];
}

export interface ApiCapitalAccount {
  id: string;
  object: 'capital_account';
  kind: 'checking' | 'savings' | 'term_deposit';
  account_name: string;
  account_number_masked: string;
  currency: string;
  current_balance_usd: number;
  status: string;
  available_balance_usd?: number;
  posted_balance_usd?: number;
  routing_number_masked?: string;
  last_updated_at?: string;
  recent_transactions?: ApiCapitalAccountTransaction[];
  linked_term_position_ids?: string[];
}

export interface ApiFundingInstruction {
  id: string;
  object: 'funding_instruction';
  capital_account_id: string;
  destination_label: string;
  rail: string;
  amount_usd: number;
  currency: string;
  status: 'created' | 'available' | 'completed';
  processing_window: string;
  cutoff_time: string;
  reference: string;
  created_at: string;
  expires_at: string;
}

export interface ApiTermPosition {
  id: string;
  object: 'term_position';
  capital_account_id: string;
  label: string;
  principal_usd: number;
  term_years: number;
  status: TermPosition['status'];
  protocol_status: TermPosition['protocolStatus'];
  protocol_sync_status: TermPosition['protocolSyncStatus'];
  protocol_sync_error?: string;
  opened_at: string;
  funded_at: string;
  maturity_date: string;
  rate_label: string;
  protection_status: TermPosition['protectionStatus'];
  reserve_status: string;
  settlement_reference: string;
  settlement_mode: SettlementMode;
  treasury_origin_lot_id?: string;
  treasury_batch_id?: string;
  treasury_expected_return_at?: string;
  treasury_settlement_deadline_at?: string;
  treasury_settlement_status?: string;
}

export interface ApiMaturitySchedule {
  id: string;
  object: 'maturity_schedule';
  term_years: number;
  label: string;
  description: string;
  review_window: string;
}

export interface ApiSettlementEvent {
  id: string;
  object: 'settlement_event';
  occurred_at: string;
  description: string;
  amount_usd: number;
  status: SettlementEvent['status'];
  mode: SettlementMode;
  reference: string;
  tx_hash?: string;
  note?: string;
}

export interface ApiProtectionStatus {
  object: 'protection_status';
  status: ProtectionStatus['status'];
  summary: string;
  reserve_coverage_label: string;
  protected_capital_usd: number;
  active_term_positions: number;
  as_of: string;
  note: string;
}

export interface FundingInstructionCreateRequest {
  capital_account_id?: string;
  amount_usd?: number;
  rail?: 'wire' | 'ach' | 'internal_transfer';
}

function buildMeta(): BankingApiMeta {
  return {
    generated_at: new Date().toISOString(),
    mode: 'mock',
  };
}

export function buildEnvelope<T>(data: T): BankingApiEnvelope<T> {
  return {
    data,
    meta: buildMeta(),
  };
}

function mapTransaction(transaction: CheckingTransaction): ApiCapitalAccountTransaction {
  return {
    id: transaction.id,
    description: transaction.description,
    category: transaction.category,
    amount_usd: transaction.amountUsd,
    balance_after_usd: transaction.balanceAfterUsd,
    posted_at: transaction.postedAt,
    status: transaction.status,
  };
}

function summaryKind(kind: BankingAccountSummary['kind']): ApiCapitalAccount['kind'] {
  return kind === 'term-deposit' ? 'term_deposit' : kind;
}

function summaryStatus(summary: BankingAccountSummary, state: BankingDashboardState): string {
  if (summary.kind !== 'term-deposit') {
    if (summary.kind === 'checking') {
      if (summary.currentBalanceUsd > 0) return 'funds_available';
      return state.capitalAccount.transactions.some((transaction) => transaction.category === 'credit')
        ? 'wire_received'
        : 'awaiting_wire';
    }
    return summary.currentBalanceUsd > 0 ? 'available' : summary.statusText.toLowerCase();
  }

  const fundedPositions = state.termPositions.filter((position) => position.status !== 'not_funded');
  if (fundedPositions.length === 0) return 'not_funded';
  if (fundedPositions.some((position) => position.status === 'active')) return 'active_term_position';
  if (fundedPositions.some((position) => position.status === 'processing')) return 'processing';
  return 'funded';
}

function mapSummaryAccount(summary: BankingAccountSummary, state: BankingDashboardState): ApiCapitalAccount {
  const base: ApiCapitalAccount = {
    id: summary.id,
    object: 'capital_account',
    kind: summaryKind(summary.kind),
    account_name: summary.accountName,
    account_number_masked: summary.accountNumberMasked,
    currency: 'USD',
    current_balance_usd: summary.currentBalanceUsd,
    status: summaryStatus(summary, state),
  };

  if (summary.kind === 'term-deposit') {
    base.linked_term_position_ids = state.termPositions.map((position) => position.id);
  }

  return base;
}

function mapCheckingAccount(capitalAccount: CapitalAccount, state: BankingDashboardState): ApiCapitalAccount {
  return {
    id: capitalAccount.id,
    object: 'capital_account',
    kind: 'checking',
    account_name: capitalAccount.accountName,
    account_number_masked: capitalAccount.accountNumberMasked,
    currency: capitalAccount.currency,
    current_balance_usd: capitalAccount.availableBalanceUsd,
    status: capitalAccount.availableBalanceUsd > 0
      ? 'funds_available'
      : capitalAccount.transactions.some((transaction) => transaction.category === 'credit')
        ? 'wire_received'
        : 'awaiting_wire',
    available_balance_usd: capitalAccount.availableBalanceUsd,
    posted_balance_usd: capitalAccount.postedBalanceUsd,
    routing_number_masked: capitalAccount.routingNumberMasked,
    last_updated_at: capitalAccount.lastUpdatedAt,
    recent_transactions: capitalAccount.transactions.slice(0, 5).map(mapTransaction),
    linked_term_position_ids: state.termPositions.map((position) => position.id),
  };
}

export function mapCapitalAccounts(state: BankingDashboardState): ApiCapitalAccount[] {
  return state.accounts.map((summary) => {
    if (summary.kind === 'checking') {
      return mapCheckingAccount(state.capitalAccount, state);
    }
    return mapSummaryAccount(summary, state);
  });
}

export function getCapitalAccountRecord(
  state: BankingDashboardState,
  accountId: string
): ApiCapitalAccount | null {
  if (accountId === state.capitalAccount.id || accountId === 'acct-checking') {
    return mapCheckingAccount(state.capitalAccount, state);
  }

  const summary = state.accounts.find((account) => account.id === accountId);
  if (!summary) return null;
  return mapSummaryAccount(summary, state);
}

function nextReference(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

export function createFundingInstructionRecord(
  state: BankingDashboardState,
  request: FundingInstructionCreateRequest = {}
): ApiFundingInstruction {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const template: FundingInstruction | undefined = state.fundingInstructions[0];

  return {
    id: nextReference('fi'),
    object: 'funding_instruction',
    capital_account_id: request.capital_account_id || state.capitalAccount.id,
    destination_label: template?.destinationLabel || 'Checking Account',
    rail: request.rail || 'wire',
    amount_usd: typeof request.amount_usd === 'number' ? request.amount_usd : 1000,
    currency: state.capitalAccount.currency,
    status: 'created',
    processing_window: template?.processingWindow || 'Same-day posting',
    cutoff_time: template?.cutoffTime || '5:00 PM ET',
    reference: nextReference('wire'),
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

export function mapTermPosition(position: TermPosition): ApiTermPosition {
  return {
    id: position.id,
    object: 'term_position',
    capital_account_id: position.sourceAccountId,
    label: position.label,
    principal_usd: position.principalUsd,
    term_years: position.termYears,
    status: position.status,
    protocol_status: position.protocolStatus,
    protocol_sync_status: position.protocolSyncStatus,
    protocol_sync_error: position.protocolSyncError,
    opened_at: position.openedAt,
    funded_at: position.fundedAt,
    maturity_date: position.maturityDate,
    rate_label: position.rateLabel,
    protection_status: position.protectionStatus,
    reserve_status: position.reserveStatusLabel,
    settlement_reference: position.settlementReference,
    settlement_mode: position.settlementMode,
    treasury_origin_lot_id: position.treasuryOriginLotId,
    treasury_batch_id: position.treasuryBatchId,
    treasury_expected_return_at: position.treasuryBatchExpectedReturnAt,
    treasury_settlement_deadline_at: position.treasuryBatchSettlementDeadlineAt,
    treasury_settlement_status: position.treasurySettlementStatus,
  };
}

export function getTermPositionRecord(
  state: BankingDashboardState,
  positionId: string
): ApiTermPosition | null {
  const position = state.termPositions.find((item) => item.id === positionId);
  return position ? mapTermPosition(position) : null;
}

export function mapMaturitySchedule(schedule: MaturitySchedule): ApiMaturitySchedule {
  return {
    id: schedule.id,
    object: 'maturity_schedule',
    term_years: schedule.termYears,
    label: schedule.label,
    description: schedule.description,
    review_window: schedule.reviewWindow,
  };
}

export function mapSettlementEvent(event: SettlementEvent): ApiSettlementEvent {
  return {
    id: event.id,
    object: 'settlement_event',
    occurred_at: event.occurredAt,
    description: event.description,
    amount_usd: event.amountUsd,
    status: event.status,
    mode: event.mode,
    reference: event.reference,
    tx_hash: event.txHash,
    note: event.note,
  };
}

export function mapProtectionStatus(
  state: BankingDashboardState,
  protectionStatus: ProtectionStatus = state.protectionStatus
): ApiProtectionStatus {
  return {
    object: 'protection_status',
    status: protectionStatus.status,
    summary: protectionStatus.summary || 'Protection status will update after a funded term deposit becomes active.',
    reserve_coverage_label: protectionStatus.reserveCoverageLabel || 'Pending first active term deposit',
    protected_capital_usd: protectionStatus.protectedCapitalUsd,
    active_term_positions: state.termPositions.filter((position) => position.status !== 'not_funded').length,
    as_of: protectionStatus.asOf,
    note: protectionStatus.note || 'This object is intended for partner-bank servicing and customer status sync.',
  };
}
