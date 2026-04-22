export type CheckingTransactionStatus = 'posted' | 'pending';
export type TermPositionStatus = 'active' | 'processing' | 'matured';
export type ProtectionTone = 'protected' | 'reserved' | 'monitoring';
export type SettlementMode = 'onchain' | 'mirrored';
export type SettlementEventStatus = 'completed' | 'processing' | 'mirrored';
export type BankingAccountKind = 'checking' | 'savings' | 'term-deposit';

export interface CheckingTransaction {
  id: string;
  description: string;
  category: 'credit' | 'debit' | 'transfer' | 'service';
  amountUsd: number;
  balanceAfterUsd: number;
  effectiveAt: string;
  postedAt: string;
  status: CheckingTransactionStatus;
  counterparty?: string;
}

export interface CapitalAccount {
  id: string;
  accountName: string;
  accountNumberMasked: string;
  routingNumberMasked: string;
  availableBalanceUsd: number;
  postedBalanceUsd: number;
  currency: string;
  lastUpdatedAt: string;
  transactions: CheckingTransaction[];
}

export interface BankingAccountSummary {
  id: string;
  kind: BankingAccountKind;
  accountName: string;
  accountNumberMasked: string;
  currentBalanceUsd: number;
  statusText: string;
  readOnly: boolean;
}

export interface FundingInstruction {
  id: string;
  sourceAccountId: string;
  destinationLabel: string;
  transferRail: string;
  processingWindow: string;
  cutoffTime: string;
  status: 'available' | 'scheduled';
}

export interface MaturitySchedule {
  id: string;
  termYears: number;
  label: string;
  description: string;
  reviewWindow: string;
}

export interface ProtectionStatus {
  status: ProtectionTone;
  summary: string;
  reserveCoverageLabel: string;
  protectedCapitalUsd: number;
  asOf: string;
  note: string;
}

export interface SettlementEvent {
  id: string;
  occurredAt: string;
  description: string;
  amountUsd: number;
  status: SettlementEventStatus;
  mode: SettlementMode;
  reference: string;
  txHash?: string;
  note?: string;
}

export interface TermPosition {
  id: string;
  label: string;
  principalUsd: number;
  openedAt: string;
  maturityDate: string;
  status: TermPositionStatus;
  termYears: number;
  rateLabel: string;
  protectionStatus: ProtectionTone;
  reserveStatusLabel: string;
  settlementReference: string;
  settlementMode: SettlementMode;
  sourceAccountId: string;
  vaultDestinationLabel: string;
}

export interface VaultBridgeState {
  routeTab: 'vault';
  destinationLabel: string;
  overlayActiveUsd6: string;
  overlayActiveCount: number;
  lastSyncAt: string;
  lastReference?: string;
}

export interface BankingDashboardState {
  accounts: BankingAccountSummary[];
  capitalAccount: CapitalAccount;
  fundingInstructions: FundingInstruction[];
  maturitySchedules: MaturitySchedule[];
  termPositions: TermPosition[];
  protectionStatus: ProtectionStatus;
  settlementEvents: SettlementEvent[];
  vaultBridge: VaultBridgeState;
}

export interface BankingDepositRequest {
  amountUsd: number;
  termYears: number;
  settlementMode: SettlementMode;
  txHash?: string;
  note?: string;
}

export interface BankingDepositResponse {
  state: BankingDashboardState;
  createdPosition: TermPosition;
  settlementEvent: SettlementEvent;
}
