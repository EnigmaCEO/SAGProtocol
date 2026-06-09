import { EscrowBatch } from '../../lib/escrow/batches';
import { getDefaultEscrowSigningAuthorities } from './escrowSigningAuthorities';
import {
  createBatchWalletBinding,
  createWalletAuditEvent,
  createWalletBindingAuditEvent,
} from './escrowWallet';
import { createBatchAuthorityBinding, createAuthorityBindingAuditEvent } from './escrowAuthorityBinding';

export type TreasuryHandoffStatus =
  | 'draft'
  | 'received'
  | 'treasury_sent'
  | 'treasury_received'
  | 'treasury_approved'
  | 'review_ready'
  | 'registered_by_escrow'
  | 'disputed'
  | 'exception';

export type TreasuryHandoffDeposit = {
  depositId: string;
  originBank: string;
  adapterType: 'fineract' | 'core_adapter' | 'manual' | 'fintech_partner';
  bankClientRef?: string;
  depositAccountRef?: string;
  amountUsd: number;
  termMonths: number;
  status: 'received' | 'batched' | 'funded' | 'active' | 'settled' | 'exception';
};

export type TreasuryHandoffPackage = {
  handoffId: string;
  proposedBatchId: string;
  /** Set to true only when both treasury.getTreasuryBatch and escrow.escrowBatchPositions confirmed this batch on-chain. Never set from DB/backend data. */
  chainConfirmed?: boolean;
  custodyMode?: 'escrow_contract_custody' | 'batch_wallet_custody';
  sourceContract?: string;
  sourceBatchId?: string;
  sourceContractBalanceUsd?: number;
  batchPositionCollateralUsd?: number;
  fundingSource?: string;
  originBanks: string[];
  deposits: TreasuryHandoffDeposit[];
  asset?: string;
  totalAmountUsd: number;
  termMonths: number;
  treasurySourceWallet?: string;
  treasuryBatchTxHash?: string;
  batchWalletAddress?: string;
  batchWalletChain?: 'arc_testnet' | 'arc_mainnet';
  batchWalletBindingHash?: string;
  expectedFundingAmountUsd?: number;
  observedWalletBalanceUsd?: number;
  fundingTxHash?: string;
  depositManifestHash: string;
  allocationPlanHash: string;
  policyContextHash: string;
  approvedByTreasury: boolean;
  approvedAt?: string;
  status: TreasuryHandoffStatus;
};

export type HandoffValidation = {
  computedDepositTotalUsd: number;
  manifestMatches: boolean;
  treasuryApproved: boolean;
  blockingReason: string | null;
};

type HandoffValidationOptions = {
  allowMissingTreasuryTxHash?: boolean;
  chainId?: number;
};

const HANDOFF_STATUSES = new Set<TreasuryHandoffStatus>([
  'draft',
  'received',
  'treasury_sent',
  'treasury_received',
  'treasury_approved',
  'review_ready',
  'registered_by_escrow',
  'disputed',
  'exception',
]);
const ADAPTER_TYPES = new Set<TreasuryHandoffDeposit['adapterType']>(['fineract', 'core_adapter', 'manual', 'fintech_partner']);
const DEPOSIT_STATUSES = new Set<TreasuryHandoffDeposit['status']>(['received', 'batched', 'funded', 'active', 'settled', 'exception']);

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeStatus(value: unknown): TreasuryHandoffStatus {
  return typeof value === 'string' && HANDOFF_STATUSES.has(value as TreasuryHandoffStatus)
    ? (value as TreasuryHandoffStatus)
    : 'received';
}

function normalizeDeposit(value: unknown): TreasuryHandoffDeposit | null {
  if (!isRecord(value)) return null;

  const depositId = normalizeString(value.depositId);
  if (!depositId) return null;

  return {
    depositId,
    originBank: normalizeString(value.originBank),
    adapterType: ADAPTER_TYPES.has(normalizeString(value.adapterType) as TreasuryHandoffDeposit['adapterType'])
      ? (normalizeString(value.adapterType) as TreasuryHandoffDeposit['adapterType'])
      : 'manual',
    bankClientRef: normalizeString(value.bankClientRef) || undefined,
    depositAccountRef: normalizeString(value.depositAccountRef) || undefined,
    amountUsd: normalizeNumber(value.amountUsd),
    termMonths: normalizeNumber(value.termMonths),
    status: DEPOSIT_STATUSES.has(normalizeString(value.status) as TreasuryHandoffDeposit['status'])
      ? (normalizeString(value.status) as TreasuryHandoffDeposit['status'])
      : 'received',
  };
}

export function getComputedHandoffDepositTotal(handoff: TreasuryHandoffPackage) {
  return handoff.deposits.reduce((sum, deposit) => sum + deposit.amountUsd, 0);
}

export function getHandoffValidation(handoff: TreasuryHandoffPackage, options: HandoffValidationOptions = {}): HandoffValidation {
  const computedDepositTotalUsd = getComputedHandoffDepositTotal(handoff);
  const manifestMatches = computedDepositTotalUsd === handoff.totalAmountUsd;
  const treasuryApproved = handoff.approvedByTreasury;
  const missingFields: string[] = [];

  const custodyMode = handoff.custodyMode ?? 'escrow_contract_custody';

  if (!handoff.handoffId) missingFields.push('treasuryBatchId');
  if (!handoff.proposedBatchId) missingFields.push('batchId');
  if (!handoff.deposits.length) missingFields.push('source entries');
  if (!handoff.originBanks.length) missingFields.push('origin sources');
  if (!handoff.totalAmountUsd) missingFields.push('totalAmountUsd');
  if (!handoff.asset) missingFields.push('asset');
  if (!handoff.termMonths) missingFields.push('termMonths');
  if (custodyMode === 'escrow_contract_custody') {
    if (!handoff.sourceContract) missingFields.push('escrow contract address');
    if (!handoff.sourceBatchId) missingFields.push('source batch id');
  }
  // For batch_wallet_custody: wallet address is NOT required at registration — it is
  // created by the wallet-factory service after Batch Authority Binding is anchored.
  if (!handoff.treasuryBatchTxHash && !options.allowMissingTreasuryTxHash) missingFields.push('tx hash');
  if (!handoff.depositManifestHash) missingFields.push('manifest hash');

  let blockingReason: string | null = null;
  if (!treasuryApproved) {
    blockingReason = 'Treasury batch has not been approved.';
  } else if (missingFields.length > 0) {
    blockingReason = `Missing field: ${missingFields.join(', ')}.`;
  } else if (!manifestMatches) {
    blockingReason = `Source total mismatch. Expected $${handoff.totalAmountUsd.toLocaleString('en-US')}, computed $${computedDepositTotalUsd.toLocaleString('en-US')}.`;
  }

  return {
    computedDepositTotalUsd,
    manifestMatches,
    treasuryApproved,
    blockingReason,
  };
}

export function canRegisterHandoff(handoff: TreasuryHandoffPackage) {
  return getHandoffValidation(handoff).blockingReason === null;
}

export function normalizeHandoffPackage(value: unknown): TreasuryHandoffPackage | null {
  if (!isRecord(value)) return null;

  const deposits = Array.isArray(value.deposits)
    ? value.deposits.map(normalizeDeposit).filter((deposit): deposit is TreasuryHandoffDeposit => Boolean(deposit))
    : [];
  const providedOriginBanks = Array.isArray(value.originBanks)
    ? value.originBanks.map(normalizeString).filter(Boolean)
    : [];
  const originBanks = providedOriginBanks.length > 0
    ? providedOriginBanks
    : Array.from(new Set(deposits.map((deposit) => deposit.originBank).filter(Boolean)));

  return {
    handoffId: normalizeString(value.handoffId),
    proposedBatchId: normalizeString(value.proposedBatchId),
    custodyMode:
      normalizeString(value.custodyMode) === 'escrow_contract_custody' || normalizeString(value.custodyMode) === 'batch_wallet_custody'
        ? (normalizeString(value.custodyMode) as TreasuryHandoffPackage['custodyMode'])
        : undefined,
    sourceContract: normalizeString(value.sourceContract) || undefined,
    sourceBatchId: normalizeString(value.sourceBatchId) || undefined,
    sourceContractBalanceUsd: value.sourceContractBalanceUsd == null ? undefined : normalizeNumber(value.sourceContractBalanceUsd),
    batchPositionCollateralUsd: value.batchPositionCollateralUsd == null ? undefined : normalizeNumber(value.batchPositionCollateralUsd),
    fundingSource: normalizeString(value.fundingSource) || undefined,
    originBanks,
    deposits,
    asset: normalizeString(value.asset) || 'USDC',
    totalAmountUsd: normalizeNumber(value.totalAmountUsd),
    termMonths: normalizeNumber(value.termMonths),
    treasurySourceWallet: normalizeString(value.treasurySourceWallet) || undefined,
    treasuryBatchTxHash: normalizeString(value.treasuryBatchTxHash) || undefined,
    batchWalletAddress: normalizeString(value.batchWalletAddress) || undefined,
    batchWalletChain:
      normalizeString(value.batchWalletChain) === 'arc_mainnet' || normalizeString(value.batchWalletChain) === 'arc_testnet'
        ? (normalizeString(value.batchWalletChain) as TreasuryHandoffPackage['batchWalletChain'])
        : undefined,
    batchWalletBindingHash: normalizeString(value.batchWalletBindingHash) || undefined,
    expectedFundingAmountUsd: value.expectedFundingAmountUsd == null ? undefined : normalizeNumber(value.expectedFundingAmountUsd),
    observedWalletBalanceUsd: value.observedWalletBalanceUsd == null ? undefined : normalizeNumber(value.observedWalletBalanceUsd),
    fundingTxHash: normalizeString(value.fundingTxHash) || undefined,
    depositManifestHash: normalizeString(value.depositManifestHash),
    allocationPlanHash: normalizeString(value.allocationPlanHash),
    policyContextHash: normalizeString(value.policyContextHash),
    approvedByTreasury: Boolean(value.approvedByTreasury),
    approvedAt: normalizeString(value.approvedAt) || undefined,
    status: normalizeStatus(value.status),
  };
}

export function parseHandoffPackage(raw: string): TreasuryHandoffPackage {
  const parsed = JSON.parse(raw);
  const handoff = normalizeHandoffPackage(parsed);
  if (!handoff) {
    throw new Error('Handoff package must be a JSON object.');
  }
  return handoff;
}

function createTreasuryBatchException(
  handoff: TreasuryHandoffPackage,
  validation: HandoffValidation,
  createdAt: string
): NonNullable<EscrowBatch['exception']> {
  return {
    type: 'treasury_batch_reconciliation_exception',
    expectedAmountUsd: handoff.totalAmountUsd,
    observedAmountUsd: validation.computedDepositTotalUsd,
    requiredAction: 'Reconcile Treasury batch values and hashes.',
    blockingStep: 'Treasury batch registration',
    expectedBatchWallet: handoff.batchWalletAddress ?? '',
    lastCheckedAt: createdAt,
    resolutionAction: 'Mark disputed or resolve the exception with Treasury evidence.',
  };
}

export function createEscrowBatchFromHandoff(handoff: TreasuryHandoffPackage, options: HandoffValidationOptions = {}): EscrowBatch {
  const createdAt = new Date().toISOString();
  const validation = getHandoffValidation(handoff, options);

  const walletAddress = handoff.batchWalletAddress ?? '';
  const wallet: EscrowBatch['wallet'] = {
    address: walletAddress,
    walletAddress: walletAddress || undefined,
    walletType: walletAddress ? 'batch_multisig' : undefined,
    provider: walletAddress ? 'manual' : 'unknown',
    chain: handoff.batchWalletChain ?? 'arc_testnet',
    custodyMode: walletAddress ? 'role_based_multisig' : 'manual',
    threshold: walletAddress ? 2 : undefined,
    signerAuthorities: walletAddress ? getDefaultEscrowSigningAuthorities() : undefined,
    fundingStatus: walletAddress
      ? (handoff.observedWalletBalanceUsd == null ? 'created' : 'funded')
      : 'not_created',
    fundingTxHash: handoff.fundingTxHash,
    createdAt: walletAddress ? handoff.approvedAt ?? createdAt : undefined,
    createdBy: walletAddress ? 'Treasury Service' : undefined,
  };

  const batch: EscrowBatch = {
    batchId: handoff.proposedBatchId,
    chainConfirmed: handoff.chainConfirmed === true,
    status: validation.blockingReason ? 'exception' : handoff.chainConfirmed ? 'wallet_created' : 'treasury_handoff_pending',
    exceptionReason: validation.blockingReason ?? undefined,
    custodyMode: handoff.custodyMode ?? 'escrow_contract_custody',
    sourceContract: handoff.sourceContract,
    sourceBatchId: handoff.sourceBatchId ?? handoff.handoffId,
    sourceContractBalanceUsd: handoff.sourceContractBalanceUsd,
    batchPositionCollateralUsd: handoff.batchPositionCollateralUsd,
    fundingSource: handoff.fundingSource ?? 'InvestmentEscrow contract',
    wallet,
    originBanks: handoff.originBanks,
    deposits: handoff.deposits,
    asset: handoff.asset || 'USDC',
    totalAmountUsd: handoff.totalAmountUsd,
    expectedFundingAmountUsd: handoff.expectedFundingAmountUsd ?? handoff.totalAmountUsd,
    observedWalletBalanceUsd: handoff.observedWalletBalanceUsd,
    termMonths: handoff.termMonths,
    treasuryHandoff: {
      handoffId: handoff.handoffId,
      approvedByTreasury: handoff.approvedByTreasury,
      approvedAt: handoff.approvedAt,
      treasurySourceWallet: handoff.treasurySourceWallet,
      depositManifestHash: handoff.depositManifestHash,
    },
    aaaAllocation: {
      planId: '',
      allocationPlanHash: '',
      policyContextHash: '',
      portfolioRegistryVersion: '',
      targetYieldBps: 0,
      status: 'missing',
    },
    deploymentApproval: { status: 'missing' },
    deploymentLegs: [],
    destinationApprovals: [],
    deploymentExecutions: [],
    fundingConfirmations: [],
    signingRequests: [],
    performance: { projectedYieldUsd: 0, currentValueUsd: 0, varianceBps: 0 },
    settlement: { maturityDate: '', status: 'not_due', walletRetirementStatus: 'not_eligible' },
    exception: validation.blockingReason ? createTreasuryBatchException(handoff, validation, createdAt) : undefined,
    auditTrail: [
      {
        eventId: `${handoff.handoffId || handoff.proposedBatchId}-treasury-sent`,
        timestamp: handoff.approvedAt ?? createdAt,
        actor: 'Treasury Service',
        eventType: 'Treasury batch sent',
        description: `Treasury sent batch ${handoff.handoffId} to Escrow for reconciliation.`,
        txHash: handoff.treasuryBatchTxHash,
        reference: handoff.depositManifestHash,
      },
      {
        eventId: `${handoff.handoffId || handoff.proposedBatchId}-container-created`,
        timestamp: createdAt,
        actor: 'Escrow Service',
        eventType: validation.blockingReason ? 'Escrow batch container created with exception' : 'Real batch materialized',
        description: validation.blockingReason
          ? `Escrow created a batch container with an exception: ${validation.blockingReason}`
          : `Escrow created batch container ${handoff.proposedBatchId} from Treasury batch ${handoff.handoffId}.`,
        reference: handoff.proposedBatchId,
      },
    ],
  };

  if (validation.blockingReason) return batch;

  // Only create the authority binding when both Treasury batch and Escrow position are confirmed
  // on-chain. DB-only execution orders must not produce a signable binding.
  if (!handoff.chainConfirmed) return batch;

  const authorityBinding = createBatchAuthorityBinding(handoff, batch.batchId, createdAt, options.chainId);
  const binding = walletAddress ? createBatchWalletBinding(batch, wallet, wallet.createdAt ?? createdAt) : undefined;
  const lockedBinding = binding && handoff.batchWalletBindingHash
    ? { ...binding, bindingHash: handoff.batchWalletBindingHash }
    : binding;

  return {
    ...batch,
    status: 'wallet_created',
    batchWalletBinding: lockedBinding,
    batchAuthorityBinding: authorityBinding,
    auditTrail: [
      ...batch.auditTrail,
      createAuthorityBindingAuditEvent(batch.batchId, authorityBinding),
      ...(walletAddress ? [createWalletAuditEvent(batch, wallet, wallet.createdAt ?? createdAt)] : []),
      ...(lockedBinding ? [createWalletBindingAuditEvent(batch, lockedBinding)] : []),
    ],
  };
}
