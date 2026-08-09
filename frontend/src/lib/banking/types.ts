export type CheckingTransactionStatus = 'posted' | 'pending';
export type TermPositionStatus = 'not_funded' | 'funded' | 'processing' | 'active' | 'matured';
export type BankingProtocolStatus =
  | 'awaiting_circle_conversion'
  | 'circle_transfer_pending'
  | 'circle_transfer_complete'
  | 'treasury_registration_pending'
  | 'treasury_registration_failed'
  | 'fineract_created_treasury_pending'
  | 'treasury_lot_registered'
  | 'batch_pending'
  | 'batch_formed'
  | 'batch_funded'
  | 'ready_for_escrow'
  | 'handed_to_escrow'
  | 'in_execution'
  | 'compensation_required'
  | 'manual_review'
  | 'settled'
  | 'failed';
export type BankingProtocolSyncStatus =
  | 'not_configured'
  | 'pending'
  | 'registered'
  | 'batched'
  | 'treasury_registration_pending'
  | 'treasury_registration_failed'
  | 'fineract_created_treasury_pending'
  | 'protocol_synced'
  | 'compensation_required'
  | 'manual_review'
  | 'settled'
  | 'failed';
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
  entryDate?: string;
  expirationDate?: string;
  treasuryBatchId?: string;
  treasuryBatchExpectedReturnAt?: string;
  treasuryBatchSettlementDeadlineAt?: string;
  treasurySettlementStatus?: string;
  returnedAmountUsd?: number;
  bankReturnStatus?: string;
  bankReturnAttempted?: number;
  bankReturnSucceeded?: number;
  bankReturnTxHash?: string;
  treasuryLotTxHash?: string;
  treasuryBatchTxHash?: string;
  circleTransferTxHash?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
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
  treasuryBatchTxHash?: string;
  batchWalletAddress?: string;
  walletAddress?: string;
  assignedBatchWalletAddress?: string;
  batchWalletChain?: string;
  expectedFundingAmountUsd?: number;
  observedWalletBalanceUsd?: number;
  fundingTxHash?: string;
  depositManifestHash?: string;
  batchWalletBindingHash?: string;
  authorizationTxHash?: string;
  settlementTxHash?: string;
  treasurySettlementTxHash?: string;
  bankReturnTxHash?: string;
  executionContextHash?: string;
  policyContextHash?: string;
  allocationPlanHash?: string;
  metadata?: Record<string, unknown>;
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
  openTxHash?: string;
  closeTxHash?: string;
  positionId?: string;
  metadata?: Record<string, unknown>;
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

export type DistributionManifestStatus = 'draft' | 'validated' | 'blocked';
export type DistributionCoverageStatus =
  | 'not_required'
  | 'treasury_coverage_required'
  | 'treasury_coverage_available'
  | 'treasury_coverage_unavailable';
export type TreasuryCoverageSource =
  | 'treasury_buffer'
  | 'treasury_usdc_balance'
  | 'reserve_later'
  | 'none';

export interface DistributionRule {
  id: string;
  rule_key: string;
  rule_version: number;
  status: 'active' | 'inactive' | 'deprecated';
  bank_fee_bps_apy: number;
  treasury_fee_bps_apy: number;
  depositor_rate_bps_apy: number;
  shortfall_policy: 'block_manifest' | 'allow_with_warning' | 'treasury_cover_shortfall';
  surplus_policy: 'treasury_retained_for_now' | 'distribute_pro_rata';
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface DistributionManifestInstitutionRow {
  institution_id: string;
  institution_name: string | null;
  settlement_account_id: string | null;
  // External Treasury payout destination
  settlement_wallet_address: string | null;
  payout_destination_type: string | null;
  payout_status: string | null;
  payout_approval_status: string | null;
  payout_destination_hash: string | null;
  // Fineract settlement clearing ref (internal ledger)
  fineract_settlement_account_ref: string | null;
  principal_total: string;
  depositor_yield_total: string;
  bank_fee_total: string;
  institution_settlement_total: string;
  eligibility_status: 'eligible' | 'ineligible';
  eligibility_reason: string;
}

export interface DistributionManifestAccountRow {
  institution_id: string;
  term_position_id: string;
  owner_key: string;
  fineract_account_id: number | null;
  principal: string;
  term_days: number;
  principal_days: string;
  depositor_yield: string;
  bank_fee_share: string;
  treasury_fee_share: string;
  settlement_status: string;
}

export interface DistributionManifestPayload {
  manifest_id: string;
  escrow_batch_id: string;
  source_batch_id: string;
  treasury_batch_id: string | null;
  rule_key: string;
  rule_version: number;
  calculated_at: string;
  settlement_source: string;
  depositor_yield_source: string;
  total_principal: string;
  total_returned: string;
  total_gross_yield: string;
  depositor_principal_total: string;
  depositor_yield_total: string;
  bank_fee_total: string;
  treasury_fee_total: string;
  treasury_fee_target_usd?: string;
  treasury_fee_retained_usd?: string;
  treasury_fee_foregone_usd?: string;
  treasury_cash_coverage_used_usd?: string;
  institution_settlement_total: string;
  surplus_amount: string;
  shortfall_amount: string;
  coverage_status: DistributionCoverageStatus;
  treasury_coverage_required_usd: string;
  treasury_coverage_available_usd: string | null;
  treasury_coverage_source: TreasuryCoverageSource;
  treasury_coverage_reason: string | null;
  external_institution_transfer_gap_usd: string;
  net_treasury_impact_usd: string;
  institution_rows: DistributionManifestInstitutionRow[];
  account_rows: DistributionManifestAccountRow[];
  validation_errors: string[];
}

export interface DistributionManifestRecord {
  id: string;
  manifest_id: string;
  source_batch_id: string;
  treasury_batch_id: string | null;
  escrow_batch_id: string;
  rule_id: string;
  rule_version: number;
  status: DistributionManifestStatus;
  principal_usd: string;
  returned_usd: string;
  gross_yield_usd: string;
  depositor_principal_usd: string;
  depositor_yield_usd: string;
  bank_fee_usd: string;
  treasury_fee_usd: string;
  surplus_usd: string;
  shortfall_usd: string;
  coverage_status: DistributionCoverageStatus;
  treasury_coverage_required_usd: string;
  treasury_coverage_available_usd: string | null;
  treasury_coverage_source: TreasuryCoverageSource;
  treasury_coverage_reason: string | null;
  external_institution_transfer_gap_usd: string;
  net_treasury_impact_usd: string;
  institution_count: number;
  account_count: number;
  manifest_hash: string;
  manifest_payload: DistributionManifestPayload;
  validation_errors: string[];
  created_at: string;
  updated_at: string;
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
  returnedAmountUsd?: number;
  bankReturnStatus?: string;
  bankReturnAttempted?: number;
  bankReturnSucceeded?: number;
  bankReturnTxHash?: string;
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
  /** Opaque customer reference supplied by the partner bank. Never contains PII. */
  customerRef?: string;
  /** Institution that owns this deposit — routes to the correct Fineract client. */
  institutionId?: string;
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

export type DistributionExecutionStatus =
  | 'pending'
  | 'executing'
  | 'failed_before_payout'
  | 'payout_pending'
  | 'payout_failed'
  | 'payout_completed'
  | 'completed'
  | 'failed'
  | 'partially_completed';

export type DistributionExecutionLineType =
  | 'circle_payout'
  | 'treasury_coverage'
  | 'institution_settlement_clearing_credit'
  | 'customer_maturity_credit'
  | 'bank_fee_credit'
  | 'treasury_fee_retained'
  | 'evidence_writeback';

export type DistributionExecutionLineStatus = 'pending' | 'completed' | 'failed' | 'skipped';

export interface DistributionExecution {
  id: string;
  execution_id: string;
  escrow_batch_id: string;
  manifest_id: string;
  manifest_hash: string;
  rail_type: string;
  rail_reference: string | null;
  treasury_coverage_used_usd: string | null;
  external_institution_transfer_gap_usd: string | null;
  institution_settlement_total_usd: string | null;
  treasury_fee_retained_usd: string | null;
  net_treasury_impact_usd: string | null;
  status: DistributionExecutionStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  execution_payload: Record<string, unknown> | null;
  execution_receipt: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DistributionExecutionLine {
  id: string;
  execution_id: string;
  line_type: DistributionExecutionLineType;
  institution_id: string | null;
  term_position_id: string | null;
  fineract_account_id: string | null;
  amount_usd: string | null;
  status: DistributionExecutionLineStatus;
  external_ref: string | null;
  fineract_ref: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankingBatchResponse {
  state: BankingDashboardState;
  treasuryBatchId?: string;
  includedTermDepositIds: string[];
  includedVaultLotIds?: string[];
  txHash?: string;
  skippedReason?: string;
}
