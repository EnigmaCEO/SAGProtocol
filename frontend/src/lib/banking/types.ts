export type CheckingTransactionStatus = 'posted' | 'pending';
export type TermPositionStatus = 'not_funded' | 'funded' | 'processing' | 'active' | 'matured';
export type BankingProtocolStatus =
  | 'awaiting_circle_conversion'
  | 'circle_transfer_pending'
  | 'circle_transfer_complete'
  | 'treasury_lot_registered'
  | 'batch_pending'
  | 'batch_formed'
  | 'batch_funded'
  | 'ready_for_escrow'
  | 'handed_to_escrow'
  | 'in_execution'
  | 'settled'
  | 'failed';
export type BankingProtocolSyncStatus = 'not_configured' | 'pending' | 'registered' | 'batched' | 'settled' | 'failed';
export type ProtectionTone = 'protected' | 'reserved' | 'monitoring';
export type SettlementMode = 'onchain' | 'mirrored';
export type SettlementEventStatus = 'completed' | 'processing' | 'mirrored';
export type BankingAccountKind = 'checking' | 'savings' | 'term-deposit';
export type DurationClass = '3M' | '6M' | '1Y' | '2Y' | '3Y' | '4Y' | '5Y' | string;
export type OriginType = 'BANK' | 'VAULT';
export type StrategyClass = 'conservative_bank_sleeve' | 'standard_vault_sleeve' | 'institutional_bank_sleeve' | string;
export type EscrowExecutionStatus =
  | 'received'
  | 'pending_allocation'
  | 'allocation_in_progress'
  | 'allocation_validated'
  | 'authorized_allocation'
  | 'deployed'
  | 'closing'
  | 'returned'
  | 'settlement_pending'
  | 'settled'
  | 'failed';
export type AllocationLegStatus = 'proposed' | 'authorized' | 'deployed' | 'returned' | 'settled' | 'rejected';

export interface InstitutionPolicyProfile {
  institutionId: string;
  displayName: string;
  activePolicyProfileId: string;
  allowedDurationClasses: DurationClass[];
  riskPosture: string;
  allocatorVersion: string;
  policyVersion: number;
  policyConfig: Record<string, unknown>;
  policyConfigHash: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TreasuryLotSnapshot {
  termPositionId: string;
  treasuryOriginLotId: string;
  principalUsd: number;
  originInstitutionId?: string;
  policyProfileId?: string;
  policyVersion?: number;
  policyConfigHash?: string;
  durationClass?: DurationClass;
  originType?: OriginType;
  strategyClass?: StrategyClass;
  maturityDate: string;
  treasuryBatchId?: string;
  status: BankingProtocolStatus;
}

export interface EscrowExecutionOrder {
  id: string;
  batchId: string;
  sourceType: OriginType | string;
  originInstitutionId: string;
  principalReceivedUsd: number;
  durationClass: DurationClass;
  productDuration: string;
  executionHorizon: string;
  deploymentStartAt: string;
  targetReturnAt: string;
  hardCloseAt: string;
  policyProfileId: string;
  policyVersion: number;
  policyConfigHash?: string;
  strategyClass: StrategyClass;
  executionStatus: EscrowExecutionStatus;
  aaaRequestStatus: string;
  deploymentStatus: string;
  settlementStatus: string;
  routeStatus: string;
  eligibleRouteTypes: string[];
  assignedPortfolio?: string;
  assignedInvestor?: string;
  assignedVenue?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowAllocationLeg {
  legId: string;
  batchId: string;
  routeType: string;
  routeId?: string;
  adapterId?: string;
  venue?: string;
  investor?: string;
  portfolio?: string;
  principalAllocatedUsd: number;
  deployedAt?: string;
  expectedCloseAt: string;
  hardCloseAt: string;
  returnedAt?: string;
  returnedAmountUsd?: number;
  status: AllocationLegStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowAllocationPlan {
  planId: string;
  batchId: string;
  aaaDecisionId: string;
  allocatorVersion: string;
  regime: string;
  policyProfileId?: string;
  policyVersion?: number;
  marketContext: Record<string, unknown>;
  marketContextSnapshot?: Record<string, unknown>;
  performanceContextSnapshot?: Record<string, unknown>;
  universeSnapshot?: Record<string, unknown>;
  decisionContext?: Record<string, unknown>;
  planPayload?: Record<string, unknown>;
  allocationResult?: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  policyConfigHash?: string;
  proposedLegs: Array<Record<string, unknown>>;
  validationResult: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

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
  fundedAt: string;
  maturityDate: string;
  status: TermPositionStatus;
  protocolStatus: BankingProtocolStatus;
  protocolSyncStatus: BankingProtocolSyncStatus;
  protocolSyncError?: string;
  treasuryOriginLotId?: string;
  treasuryBatchId?: string;
  treasuryBatchExpectedReturnAt?: string;
  treasuryBatchSettlementDeadlineAt?: string;
  treasurySettlementStatus?: string;
  treasuryLotTxHash?: string;
  treasuryBatchTxHash?: string;
  originInstitutionId?: string;
  policyProfileId?: string;
  policyVersion?: number;
  policyConfigHash?: string;
  durationClass?: DurationClass;
  originType?: OriginType;
  strategyClass?: StrategyClass;
  escrowExecutionOrderId?: string;
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
  institutionPolicies?: InstitutionPolicyProfile[];
  treasuryLots?: TreasuryLotSnapshot[];
  escrowExecutionOrders?: EscrowExecutionOrder[];
  escrowAllocationPlans?: EscrowAllocationPlan[];
  escrowAllocationLegs?: EscrowAllocationLeg[];
}

export interface BankingDepositRequest {
  amountUsd: number;
  termYears: number;
  settlementMode: SettlementMode;
  txHash?: string;
  note?: string;
}

export interface BankingWireRequest {
  amountUsd: number;
  clientState?: BankingDashboardState;
}

export interface BankingBatchRequest {
  expectedReturnAt?: string;
  settlementDeadlineAt?: string;
  maxLots?: number;
  durationClass?: DurationClass;
  policyProfileId?: string;
  strategyClass?: StrategyClass;
  originType?: OriginType;
  clientState?: BankingDashboardState;
}

export interface BankingDepositResponse {
  state: BankingDashboardState;
  createdPosition: TermPosition;
  settlementEvent: SettlementEvent;
}

export interface BankingBatchResponse {
  state: BankingDashboardState;
  treasuryBatchId?: string;
  includedTermDepositIds: string[];
  includedVaultLotIds?: string[];
  txHash?: string;
  skippedReason?: string;
}
