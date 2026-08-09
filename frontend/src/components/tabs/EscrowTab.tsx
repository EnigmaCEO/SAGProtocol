import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  FileCheck,
  Filter,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import EvidencePopover, { EvidenceRow } from './EvidencePopover';
import MetricCard from '../ui/MetricCard';
import PageHeader from '../ui/PageHeader';
import { EscrowBatch, EscrowBatchStatus } from '../../lib/escrow/batches';
import { useProtocolChain } from '../../context/ProtocolChainContext';
import { getRuntimeAddress, isValidAddress } from '../../lib/runtime-addresses';
import {
  LifecycleStep,
  getBatchBlockingReason,
  getLifecycleSteps,
} from './escrowBatchState';
import {
  ReadinessRowState,
  getBatchReadiness,
  getComputedDepositTotal,
  getFundingValidation,
  getManifestValidation,
  hasValidAuthorityBinding,
  isAuthorityBindingAnchored,
  isBatchDeploymentReady,
} from './escrowBatchValidation';
import {
  TreasuryHandoffPackage,
  createEscrowBatchFromHandoff,
} from './escrowHandoff';
import { fetchInstitutions } from '../../hooks/useBankingData';
import {
  canExecuteDeployment,
  getDeploymentExecutionBlockingReason,
  getDeploymentExecutionStatus,
  getLatestDeploymentExecution,
} from './escrowDeployment';
import {
  fetchDeploymentExecutionFromDb,
  saveDeploymentExecutionToDb,
} from './escrowDeploymentExecution';
import {
  approveDeployment,
  canApproveDeployment,
  createDeploymentApprovalEvidence,
  fetchDeploymentApprovalFromDb,
  getBatchDestinationApprovalHash,
  getDeploymentApprovalBlockingReason,
  getExistingDeploymentApprovalMismatch,
  hasDeploymentApproval,
  saveDeploymentApprovalToDb,
} from './escrowDeploymentApproval';
import {
  DAO_DESTINATION_REGISTRY,
  approveBatchDestinations,
  areBatchDestinationsApproved,
  getDaoDestinationForLeg,
  getDeploymentLegsForDestinationApproval,
  getDestinationApprovalBlockingReason,
  getDestinationApprovalProgress,
} from './escrowDestinations';
import {
  applyFundingConfirmationToBatch,
  createFundingConfirmation,
  getExecutedDeploymentOutflowUsd,
  getLatestFundingConfirmation,
} from './escrowFunding';
import { getDefaultEscrowSigningAuthorities } from './escrowSigningAuthorities';
import {
  CRISIS_SIGNING_PATH_LABEL,
  NORMAL_SIGNING_PATH_LABEL,
  approveSigningRequest,
  attachSigningRequestToBatch,
  createDeploymentSigningRequest,
  getLatestSigningRequest,
  getSigningApprovalProgress,
} from './escrowSigningRequests';
import {
  createBatchWalletBinding,
  createWalletBindingAuditEvent,
  getBatchWalletBindingValidation,
  patchWalletBindingAddress,
  recordBatchWalletBindingMismatch,
} from './escrowWallet';
import type { BatchAuthorityBinding } from '../../lib/escrow/batches';
import {
  BATCH_AUTHORITY_ANCHOR_ABI,
  BatchAuthoritySignerRole,
  OnChainBatchWalletBinding,
  OnChainRoleAuthorities,
  anchorBatchAuthorityBindingOnChain,
  applyOnChainAnchorToBatch,
  getBatchAuthorityBindingValidation,
  getBatchAuthoritySignatureStatus,
  isBatchAuthorityFullySigned,
  readBatchAuthorityAnchorFromChain,
  readBatchWalletBindingFromChain,
  readOnChainRoleAuthorities,
  recordBatchAuthorityBindingMismatch,
  requiresBatchAuthorityBinding,
  signBatchAuthorityBinding,
} from './escrowAuthorityBinding';
import {
  ROLE_AUTHORITY_REGISTRY,
  RoleAuthorityRecord,
  detectRoleAuthorityDrift,
  getContinuityAuthority,
  getEscrowAuthority,
  getTreasuryVaultAuthority,
  isRoleSigningAllowed,
} from '../../lib/escrow/roleAuthorityRegistry';
import {
  OnChainBatchLifecycleState,
  readBatchLifecycleStateFromChain,
} from './escrowChainState';
import {
  getSignerServiceConfig,
  isSignerServiceConfigured,
} from '../../lib/escrow/signerServiceClient';
import { advanceEscrowLifecycleOrThrow } from '../../lib/escrow/lifecycleActions';
import {
  AaaAllocationResponse,
  AaaTickResponse,
  RecoveredAllocationPlan,
  anchorBatchAllocationPlan,
  anchorComputedAllocation,
  applyAllocationToBatch,
  applyComputedPlanToBatch,
  applyRecoveredPlanToBatch,
  canonicalPlanFields,
  computeAndAnchorAllocation,
  computeAndStoreAllocationPlan,
  fetchPlanFromDb,
  getAllocationStorageBatchId,
  readAllocationFromChain,
  recoverAllocationPlan,
  requestAndAttachAllocation,
  resolveAllocationStatus,
} from './escrowAllocation';
import { hasValidatedAaaAllocation } from './escrowAllocationStatus';
import { resolveEscrowBatchId, isUuid } from '../../lib/escrow/ids';
import { BatchLifecycleCard, PHASE_NAMES, type LifecycleRow, type PhaseEvidenceRow, type PhaseAttemptRow } from '../BatchLifecycleCard';
import { buildEscrowBatchDisplayModel, type EscrowBatchDisplayModel, type DevLegPositionRecord } from './escrowDisplayModel';

const TREASURY_BATCH_READER_ABI = [
  'function nextTreasuryBatchId() view returns (uint256)',
  'function getTreasuryBatch(uint256 batchId) view returns (tuple(uint256 batchId,uint8 originType,uint256[] lotIds,uint256 principalAllocated,uint64 openedAt,uint64 expectedReturnAt,uint64 settlementDeadlineAt,uint64 actualReturnedAt,uint8 status))',
  'function originLots(uint256 lotId) view returns (uint256 id,uint8 originType,bytes32 originRefId,uint256 amount,uint64 fundedAt,uint64 liabilityUnlockAt,uint8 status,uint256 batchId)',
];

const ESCROW_BATCH_READER_ABI = [
  'function escrowBatchPositions(uint256 batchId) view returns (uint256 batchId,uint256 deployedPrincipal,uint64 expectedReturnAt,uint64 settlementDeadlineAt,bytes32 executionContextHash,uint64 actualReturnedAt,uint256 settlementAmount,uint8 status)',
  'function getBatchAccounting(uint256 batchId) view returns (tuple(uint256 principalAuthorizedUsd6,uint256 principalFundedUsd6,uint256 principalCommittedUsd6,uint256 principalReturnedUsd6,uint256 feesUsd6,int256 realizedPnlUsd6,int256 unrealizedPnlUsd6,uint256 lastMarkedAt,bool frozen))',
  'function batchWalletFunded(uint256 sourceBatchId) view returns (bool)',
  'function usdc() view returns (address)',
  'event BatchWalletFunded(uint256 indexed sourceBatchId, address indexed walletAddress, string asset, uint256 amount, bytes32 indexed authorityBindingHash, bytes32 walletBindingHash)',
];

const PORTFOLIO_DESTINATION_PREVIEW_ABI = [
  'function getAllAssets() view returns (tuple(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6, uint256 defaultDestinationId, address destination, uint8 destinationType, uint256 addedAt)[])',
  'function getAllDestinations() view returns (tuple(uint256 destinationId, string name, string assetSymbol, address assetAddress, uint8 destinationType, address destinationAddress, bool active)[])',
];

const ERC20_BALANCE_READER_ABI = [
  'function balanceOf(address account) view returns (uint256)',
];

const BATCH_MULTISIG_WALLET_ABI = [
  'function transactionCount() view returns (uint256)',
  'function transactions(uint256 txIndex) view returns (address to, uint256 value, bytes data, bool executed, uint8 confirmationCount)',
  'function submitTransaction(address to, uint256 value, bytes data) returns (uint256)',
  'function confirmTransaction(uint256 txIndex)',
  'event TransactionExecuted(uint256 indexed txIndex, address indexed executor)',
];

const ORIGIN_TYPE_VAULT = 1;
const ORIGIN_TYPE_BANK = 2;

const STATUS_LABELS: Record<EscrowBatchStatus, string> = {
  draft: 'Draft',
  treasury_handoff_pending: 'Treasury Batch Pending',
  treasury_sent: 'Treasury Sent',
  treasury_received: 'Treasury Received',
  handoff_approved: 'Treasury Batch Approved',
  wallet_requested: 'Wallet Requested',
  wallet_created: 'Wallet Created',
  wallet_funded: 'Wallet Funded',
  aaa_plan_attached: 'AAA Plan Attached',
  deployment_pending: 'Deployment Pending',
  deployed: 'Deployed',
  active: 'Active',
  settlement_pending: 'Settlement Pending',
  settled: 'Settled',
  disputed: 'Disputed',
  exception: 'Exception',
  retired: 'Retired',
};

const STATUS_TONE: Record<EscrowBatchStatus, 'success' | 'warning' | 'danger' | 'purple' | 'neutral'> = {
  draft: 'neutral',
  treasury_handoff_pending: 'warning',
  treasury_sent: 'warning',
  treasury_received: 'purple',
  handoff_approved: 'purple',
  wallet_requested: 'warning',
  wallet_created: 'purple',
  wallet_funded: 'success',
  aaa_plan_attached: 'purple',
  deployment_pending: 'warning',
  deployed: 'success',
  active: 'success',
  settlement_pending: 'warning',
  settled: 'success',
  disputed: 'danger',
  exception: 'danger',
  retired: 'neutral',
};

const PROVIDER_LABELS: Record<EscrowBatch['deploymentLegs'][number]['provider'], string> = {
  blockdaemon: 'BlockDaemon API / staking',
  usdc_yield: 'USDC yield venue',
  goldfinch: 'Goldfinch private credit',
  paxg_xaut: 'PAXG / XAUT stabilizer',
  liquidity: 'Liquidity / stabilizer sleeve',
  manual: 'Manual provider',
};

const DESTINATION_TYPE_LABELS = [
  'Batch Wallet Hold',
  'Staking Contract',
  'Investment Handoff',
  'Purchase',
];

const fmtUsd = (value?: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value ?? 0);

const fmtPct = (value: number) => `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
const fmtTerm = (months: number) => months > 0 && months % 12 === 0 ? `${months / 12}Y` : `${months}M`;

function bankingUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `/api/banking${normalizedPath}`;
}

const titleCase = (value: string) =>
  value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const shortHash = (value?: string) => {
  if (!value) return 'Pending';
  if (!value.startsWith('0x')) return value;
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const compactBatchId = (value?: string) => {
  if (!value) return 'Pending';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  }
  if (value.length > 18) return `${value.slice(0, 10)}...${value.slice(-4)}`;
  return value;
};

const formatDateTime = (value?: string | number | null) => {
  if (!value) return 'Pending';
  // Unix seconds (10-digit number or numeric string) → convert to ms
  const asNum = typeof value === 'number' ? value : /^\d{9,10}$/.test(String(value)) ? Number(value) : null;
  const d = asNum != null ? new Date(asNum * 1000) : new Date(value as string);
  if (isNaN(d.getTime())) return 'Pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

function toUnixSeconds(value?: string | number | null) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed > 1_000_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function getLifecycleNaturalKey(sourceBatchId?: string | null, openedAt?: string | number | null) {
  const normalizedSourceBatchId = String(sourceBatchId ?? '').trim();
  if (!normalizedSourceBatchId) return '';
  const openedAtUnix = toUnixSeconds(openedAt);
  return openedAtUnix > 0 ? `${normalizedSourceBatchId}:${openedAtUnix}` : normalizedSourceBatchId;
}

function getLifecycleRowLookupKeys(lc: LifecycleRow) {
  const keys = [
    String(lc.escrow_batch_id ?? '').trim(),
    getLifecycleNaturalKey(lc.source_batch_id, lc.opened_at_unix),
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function getBatchLifecycleLookupKeys(batch: EscrowBatch) {
  const keys = [
    String(batch.batchId ?? '').trim(),
    getLifecycleNaturalKey(
      batch.sourceBatchId ?? batch.treasuryHandoff.handoffId,
      batch.treasuryHandoff.openedAtUnix ?? batch.treasuryHandoff.approvedAt,
    ),
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function getHandoffNaturalKey(handoff: TreasuryHandoffPackage) {
  return getLifecycleNaturalKey(handoff.sourceBatchId ?? handoff.handoffId, handoff.openedAt ?? handoff.approvedAt);
}

function getHandoffLookupKey(handoff: TreasuryHandoffPackage) {
  if (isUuid(handoff.proposedBatchId)) return handoff.proposedBatchId;
  return getHandoffNaturalKey(handoff) || handoff.proposedBatchId || handoff.handoffId;
}

function findLifecycleBatchForBatch(
  lifecycleBatchByKey: Map<string, LifecycleRow>,
  batch: EscrowBatch | undefined,
) {
  if (!batch) return undefined;
  return getBatchLifecycleLookupKeys(batch)
    .map((key) => lifecycleBatchByKey.get(key))
    .find((row): row is LifecycleRow => Boolean(row));
}

function findLifecycleEvidenceForBatch(
  lifecycleEvidenceByBatchId: Map<string, Record<number, PhaseEvidenceRow>>,
  batch: EscrowBatch,
) {
  return getBatchLifecycleLookupKeys(batch)
    .map((key) => lifecycleEvidenceByBatchId.get(key))
    .find((evidence): evidence is Record<number, PhaseEvidenceRow> => Boolean(evidence && Object.keys(evidence).length > 0))
    ?? {};
}

import { canonicalKeccak } from '../../lib/escrow/canonicalHash';

type PortfolioDestinationPreviewAsset = {
  symbol: string;
  defaultDestinationId: number;
};

type ApprovedPortfolioDestination = {
  destinationId: number;
  name: string;
  destinationType: number;
  destinationAddress: string;
  active: boolean;
};

type DestinationApprovalPreviewRow = {
  asset: string;
  amountUsd: number;
  weight: number;
  destinationId: number;
  destinationName: string;
  destinationTypeId: number;
  approvedDestination: string;
  destinationType: string;
  destinationAddress: string;
  status: 'Approved' | 'Missing Destination';
};

type DestinationApprovalPayload = {
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  aaaAllocationHash: string;
  portfolioRegistryVersion: string;
  destinations: Array<{
    assetSymbol: string;
    amount: number;
    weight: number;
    destinationId: number;
    destinationName: string;
    destinationType: number;
    destinationAddress: string;
  }>;
};

type DestinationApprovalRecord = {
  payload: DestinationApprovalPayload | null;
  destinationApprovalHash: string;
  missingAssets: string[];
  blockingReason: string | null;
};

type DeploymentExecutionRecord = NonNullable<EscrowBatch['deploymentExecutions']>[number];

function roundTo(value: number, decimals: number) {
  return Number(value.toFixed(decimals));
}

function isLocalExecutionChain(chainKey: string | undefined) {
  const normalized = String(chainKey ?? '').trim().toLowerCase();
  return ['localhost', 'local', 'hardhat', '1337', '31337'].includes(normalized);
}

function approximatelyEqualAmount(left: number, right: number, precision = 1e-6) {
  return Math.abs(Number(left) - Number(right)) <= precision;
}

const EXECUTED_DEPLOYMENT_LEG_STATUSES = ['executed', 'deployed', 'monitoring', 'settled'] as const;
const DEPLOYMENT_EXECUTION_SOURCE = 'Treasury signer service + Escrow signer service via BatchMultisigWallet';

type ApprovedDeploymentTransferLegContext = {
  leg: EscrowBatch['deploymentLegs'][number];
  approval: NonNullable<EscrowBatch['destinationApprovals']>[number];
  payloadLeg: NonNullable<NonNullable<EscrowBatch['deploymentApproval']['payload']>['deploymentLegs']>[number];
  legAssetSymbol: string;
  transferAssetSymbol: 'USDC';
  amountUsd: number;
  destinationAddress: string;
};

function isExecutedDeploymentLegStatus(status: EscrowBatch['deploymentLegs'][number]['status']) {
  return EXECUTED_DEPLOYMENT_LEG_STATUSES.includes(status as typeof EXECUTED_DEPLOYMENT_LEG_STATUSES[number]);
}

function getApprovedDeploymentTransferLegContexts(
  batch: EscrowBatch,
  options: { includeExecuted?: boolean } = {},
): ApprovedDeploymentTransferLegContext[] {
  if (!batch.deploymentApproval.payload) return [];

  const approvalsByLegId = new Map(
    (batch.destinationApprovals ?? [])
      .filter((approval) => approval.approvalStatus === 'approved' && isValidAddress(approval.destinationAddress))
      .map((approval) => [approval.legId, approval] as const)
  );
  const payloadLegsByLegId = new Map(
    batch.deploymentApproval.payload.deploymentLegs.map((payloadLeg) => [payloadLeg.allocationLegId, payloadLeg] as const)
  );

  return getDeploymentLegsForDestinationApproval(batch)
    .filter((leg) => options.includeExecuted || !isExecutedDeploymentLegStatus(leg.status))
    .map((leg) => {
      const approval = approvalsByLegId.get(leg.legId);
      const payloadLeg = payloadLegsByLegId.get(leg.legId);
      if (!payloadLeg) return null;

      // Fall back to payload data when destinationApprovals haven't been (re-)populated yet.
      const legAssetSymbol = String(leg.assetSymbol ?? leg.asset ?? approval?.assetSymbol ?? payloadLeg.asset ?? batch.asset ?? 'USDC');
      const destinationAddress = String(approval?.destinationAddress ?? payloadLeg.destinationAddress ?? leg.destinationAddress ?? '');
      if (!isValidAddress(destinationAddress)) return null;
      if (isValidAddress(String(leg.destinationAddress ?? '')) && String(leg.destinationAddress).toLowerCase() !== destinationAddress.toLowerCase()) return null;
      if (isValidAddress(String(payloadLeg.destinationAddress ?? '')) && String(payloadLeg.destinationAddress).toLowerCase() !== destinationAddress.toLowerCase()) return null;

      const amountUsd = roundTo(Number(leg.amount ?? leg.amountUsd), 6);
      const approvedAmount = approval ? roundTo(Number(approval.amount), 6) : amountUsd;
      const payloadAmount = roundTo(Number(payloadLeg.amount), 6);
      if (!approximatelyEqualAmount(amountUsd, approvedAmount) || !approximatelyEqualAmount(amountUsd, payloadAmount)) return null;

      return {
        leg,
        approval,
        payloadLeg,
        legAssetSymbol,
        transferAssetSymbol: 'USDC' as const,
        amountUsd,
        destinationAddress,
      };
    })
    .filter((item): item is ApprovedDeploymentTransferLegContext => Boolean(item));
}

function getNextApprovedDeploymentTransferLeg(batch: EscrowBatch) {
  return getApprovedDeploymentTransferLegContexts(batch)[0] ?? null;
}

function mergeDeploymentExecutionRecord(
  batch: EscrowBatch,
  existingExecution: DeploymentExecutionRecord | undefined,
  legResult: DeploymentExecutionRecord['deploymentLegResults'][number],
  executedAt: string,
  deploymentTxHash: string,
) {
  const previousResults = existingExecution?.deploymentLegResults ?? [];
  const nextResults = previousResults.some((item) => item.legId === legResult.legId)
    ? previousResults.map((item) => item.legId === legResult.legId ? legResult : item)
    : [...previousResults, legResult];
  const remainingLegs = getApprovedDeploymentTransferLegContexts(batch, { includeExecuted: true })
    .filter((item) => !nextResults.some((result) => result.legId === item.leg.legId && isExecutedDeploymentLegStatus(result.status)))
    .length;

  return {
    deploymentId: existingExecution?.deploymentId ?? `${batch.batchId}-deployment-execution`,
    batchId: batch.batchId,
    signingRequestId: existingExecution?.signingRequestId ?? getLatestSigningRequest(batch)?.requestId ?? `${batch.batchId}-deploy-batch`,
    status: remainingLegs === 0 ? 'deployed' : 'executing',
    executedBy: DEPLOYMENT_EXECUTION_SOURCE,
    executedAt,
    deploymentTxHash,
    deploymentLegResults: nextResults
      .slice()
      .sort((left, right) => left.legId.localeCompare(right.legId)),
  } satisfies DeploymentExecutionRecord;
}

function applyDeploymentExecutionToBatch(
  batch: EscrowBatch,
  execution: DeploymentExecutionRecord,
): EscrowBatch {
  const existingExecutions = batch.deploymentExecutions ?? [];
  const nextExecutions = existingExecutions.some((item) => item.deploymentId === execution.deploymentId)
    ? existingExecutions.map((item) => item.deploymentId === execution.deploymentId ? execution : item)
    : [execution, ...existingExecutions];
  const auditEventId = `${batch.batchId}-${execution.deploymentTxHash ?? execution.deploymentId}`;

  const nextLegs = batch.deploymentLegs.map((leg) => {
    const result = execution.deploymentLegResults.find((item) => item.legId === leg.legId);
    if (!result) return leg;
    return {
      ...leg,
      status: result.status,
      providerReferenceId: result.providerReferenceId,
      deploymentTxHash: result.deploymentTxHash,
      currentValueUsd: result.amountUsd,
    };
  });
  const allLegsExecuted = nextLegs.length > 0 && nextLegs.every((leg) =>
    ['executed', 'deployed', 'monitoring', 'settled'].includes(leg.status)
  );

  return {
    ...batch,
    status: allLegsExecuted && batch.status === 'deployment_pending' ? 'deployed' : batch.status === 'wallet_funded' || batch.status === 'aaa_plan_attached' ? 'deployment_pending' : batch.status,
    deploymentExecutions: nextExecutions,
    deploymentLegs: nextLegs,
    auditTrail: batch.auditTrail.some((event) => event.eventId === auditEventId)
      ? batch.auditTrail
      : [
          {
            eventId: auditEventId,
            timestamp: execution.executedAt,
            actor: execution.executedBy,
            eventType: 'Deployment leg executed',
            description: `Executed ${execution.deploymentLegResults.map((item) => item.asset).join(', ')} deployment leg(s) through the batch multisig wallet.`,
            txHash: execution.deploymentTxHash,
            reference: execution.deploymentId,
          },
          ...batch.auditTrail,
        ],
  };
}

async function rehydrateDeploymentExecutionFromChain(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  existingExecution?: DeploymentExecutionRecord;
  legIdHint?: string;
  txIndexHint?: number;
  destinationAddressHint?: string;
  amountHint?: number;
  signerProof?: Partial<Pick<
    DeploymentExecutionRecord['deploymentLegResults'][number],
    'treasurySignerAddress' | 'treasurySubmitTxHash' | 'treasuryConfirmTxHash' | 'escrowSignerAddress' | 'escrowConfirmTxHash'
  >>;
}): Promise<DeploymentExecutionRecord | null> {
  const { batch, rpcUrl, escrowAddress, existingExecution, legIdHint, txIndexHint, destinationAddressHint, amountHint, signerProof } = params;
  if (!isValidAddress(escrowAddress)) return null;

  const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address;
  if (!isValidAddress(walletAddress)) return null;
  // Only require payload presence — don't gate on hasDeploymentApproval() which checks
  // destinationApprovalHash consistency. That hash check can fail transiently during reload
  // when destinationApprovals haven't been re-populated yet. Chain txs are ground truth.
  if (batch.deploymentApproval.status !== 'approved' || !batch.deploymentApproval.payload) return null;

  const candidateContexts = getApprovedDeploymentTransferLegContexts(batch, { includeExecuted: true })
    .filter((context) => !legIdHint || context.leg.legId === legIdHint)
    .filter((context) => !destinationAddressHint || context.destinationAddress.toLowerCase() === destinationAddressHint.toLowerCase())
    .filter((context) => amountHint == null || approximatelyEqualAmount(context.amountUsd, Number(amountHint)));
  const contexts = candidateContexts.length > 0
    ? candidateContexts
    : getApprovedDeploymentTransferLegContexts(batch, { includeExecuted: true });
  if (contexts.length === 0) return null;

  const provider = new JsonRpcProvider(rpcUrl);
  const escrow = new Contract(escrowAddress, ESCROW_BATCH_READER_ABI, provider);
  const usdcAddress = String(await escrow.usdc().catch(() => ''));
  if (!isValidAddress(usdcAddress)) return null;

  const multisig = new Contract(walletAddress, BATCH_MULTISIG_WALLET_ABI, provider);
  const txCount = Number(await multisig.transactionCount().catch(() => 0));
  if (!Number.isFinite(txCount) || txCount <= 0) return null;

  const txIndexes = typeof txIndexHint === 'number' && txIndexHint >= 0
    ? [txIndexHint]
    : Array.from({ length: txCount }, (_, index) => txCount - 1 - index);
  const usdc = new Contract(usdcAddress, ERC20_BALANCE_READER_ABI, provider);

  // Accumulate results across all legs rather than returning on the first match.
  // For multi-leg batches each leg has its own multisig TX — we need to find them all.
  let accumulatedExecution: DeploymentExecutionRecord | undefined = existingExecution;
  // Prevent the same multisig TX index from matching two different legs.
  const matchedTxIndexes = new Set<number>(
    (existingExecution?.deploymentLegResults ?? [])
      .map((r) => r.multisigTxIndex)
      .filter((i): i is number => typeof i === 'number'),
  );

  for (const context of contexts) {
    // Skip legs that are already recorded in the accumulated execution.
    const alreadyRecorded = accumulatedExecution?.deploymentLegResults.some(
      (r) => r.legId === context.leg.legId && isExecutedDeploymentLegStatus(r.status),
    );
    if (alreadyRecorded) continue;

    const expectedData = new Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]).encodeFunctionData('transfer', [context.destinationAddress, parseUnits(context.amountUsd.toFixed(6), 6)]).toLowerCase();

    let matchedIndex = -1;
    for (const txIndex of txIndexes) {
      if (matchedTxIndexes.has(txIndex)) continue; // Already matched to another leg
      const raw = await multisig.transactions(txIndex).catch(() => null);
      if (!raw) continue;
      const to = String(raw.to ?? raw[0] ?? '');
      const value = BigInt(raw.value ?? raw[1] ?? 0);
      const data = String(raw.data ?? raw[2] ?? '').toLowerCase();
      const executed = Boolean(raw.executed ?? raw[3] ?? false);
      if (!executed) continue;
      if (!isValidAddress(to) || to.toLowerCase() !== usdcAddress.toLowerCase()) continue;
      if (value !== 0n) continue;
      if (data !== expectedData) continue;
      matchedIndex = txIndex;
      break;
    }
    if (matchedIndex < 0) continue;

    matchedTxIndexes.add(matchedIndex);

    let executedEvents = await multisig.queryFilter(
      multisig.filters.TransactionExecuted(BigInt(matchedIndex)),
      -20000,
    ).catch(() => []);
    if (executedEvents.length === 0) {
      const rawLogs = await provider.getLogs({
        address: walletAddress,
        fromBlock: 0,
        toBlock: 'latest',
        topics: multisig.interface.encodeFilterTopics('TransactionExecuted', [BigInt(matchedIndex)]),
      }).catch(() => []);
      executedEvents = rawLogs
        .map((log) => {
          try {
            return {
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
            };
          } catch {
            return null;
          }
        })
        .filter((event): event is { transactionHash: string; blockNumber: number } => Boolean(event));
    }
    if (executedEvents.length === 0) {
      executedEvents = (await multisig.queryFilter(
        multisig.filters.TransactionExecuted(),
        -20000,
      ).catch(() => [])).filter((event) => Number(event.args?.[0] ?? -1) === matchedIndex);
    }
    const executedEvent = executedEvents[executedEvents.length - 1];
    const deploymentTxHash = String(executedEvent?.transactionHash ?? '');
    if (!deploymentTxHash) continue;

    let executedAt = new Date().toISOString();
    if (executedEvent?.blockNumber != null) {
      const block = await provider.getBlock(executedEvent.blockNumber).catch(() => null);
      if (block?.timestamp) {
        executedAt = new Date(Number(block.timestamp) * 1000).toISOString();
      }
    }

    const [walletBalanceAfterRaw, destinationBalanceAfterRaw] = await Promise.all([
      usdc.balanceOf(walletAddress),
      usdc.balanceOf(context.destinationAddress),
    ]);
    const amountUnits = parseUnits(context.amountUsd.toFixed(6), 6);
    const walletBalanceAfter = BigInt(walletBalanceAfterRaw);
    const destinationBalanceAfter = BigInt(destinationBalanceAfterRaw);
    const walletBalanceBefore = walletBalanceAfter + amountUnits;
    const destinationBalanceBefore = destinationBalanceAfter >= amountUnits
      ? destinationBalanceAfter - amountUnits
      : 0n;

    accumulatedExecution = mergeDeploymentExecutionRecord(
      batch,
      accumulatedExecution,
      {
        legId: context.leg.legId,
        provider: context.leg.provider,
        asset: context.legAssetSymbol,
        amountUsd: context.amountUsd,
        allocationPercent: context.leg.allocationPercent,
        targetYieldBps: context.leg.targetYieldBps,
        status: 'executed',
        providerReferenceId: `multisig:${matchedIndex}`,
        deploymentTxHash,
        deployedAt: executedAt,
        walletAddress,
        destinationAddress: context.destinationAddress,
        sourceBalanceBefore: Number(formatUnits(walletBalanceBefore, 6)),
        sourceBalanceAfter: Number(formatUnits(walletBalanceAfter, 6)),
        destinationBalanceBefore: Number(formatUnits(destinationBalanceBefore, 6)),
        destinationBalanceAfter: Number(formatUnits(destinationBalanceAfter, 6)),
        multisigTxIndex: matchedIndex,
        signingSource: signerProof ? 'signer_services' : undefined,
        treasurySignerAddress: signerProof?.treasurySignerAddress,
        treasurySubmitTxHash: signerProof?.treasurySubmitTxHash,
        treasuryConfirmTxHash: signerProof?.treasuryConfirmTxHash,
        escrowSignerAddress: signerProof?.escrowSignerAddress,
        escrowConfirmTxHash: signerProof?.escrowConfirmTxHash,
      },
      executedAt,
      deploymentTxHash,
    );
    // Continue to the next leg — don't return early.
  }

  return accumulatedExecution ?? null;
}

function destinationAddressRequired(destinationTypeId: number) {
  return destinationTypeId !== 0;
}

function providerForDestinationPreviewRow(
  row: DestinationApprovalPreviewRow,
): EscrowBatch['deploymentLegs'][number]['provider'] {
  if (row.destinationTypeId === 1) return 'blockdaemon';
  if (row.asset === 'GFI') return 'goldfinch';
  if (row.asset === 'PAXG') return 'paxg_xaut';
  if (row.destinationTypeId === 0) return 'liquidity';
  return 'manual';
}

function strategyForDestinationPreviewRow(
  row: DestinationApprovalPreviewRow,
): EscrowBatch['deploymentLegs'][number]['strategyType'] {
  if (row.destinationTypeId === 1) return 'staking';
  if (row.asset === 'GFI' || row.asset === 'SYRUP') return 'private_credit';
  if (row.asset === 'PAXG') return 'stabilizer';
  if (row.destinationTypeId === 0) return 'liquidity';
  return 'yield';
}

function targetYieldForDestinationPreviewRow(row: DestinationApprovalPreviewRow) {
  if (row.asset === 'GFI' || row.asset === 'SYRUP') return 1200;
  if (row.asset === 'PAXG') return 300;
  if (row.destinationTypeId === 1) return 700;
  if (row.destinationTypeId === 0) return 400;
  return 600;
}

function providerForApprovedDeploymentLeg(
  asset: string,
  destinationType: string,
): EscrowBatch['deploymentLegs'][number]['provider'] {
  const normalizedType = destinationType.trim().toLowerCase();
  if (normalizedType.includes('staking')) return 'blockdaemon';
  if (asset === 'GFI') return 'goldfinch';
  if (asset === 'PAXG') return 'paxg_xaut';
  if (normalizedType.includes('liquidity')) return 'liquidity';
  return 'manual';
}

function strategyForApprovedDeploymentLeg(
  asset: string,
  destinationType: string,
): EscrowBatch['deploymentLegs'][number]['strategyType'] {
  const normalizedType = destinationType.trim().toLowerCase();
  if (normalizedType.includes('staking')) return 'staking';
  if (asset === 'GFI' || asset === 'SYRUP') return 'private_credit';
  if (asset === 'PAXG') return 'stabilizer';
  if (normalizedType.includes('liquidity')) return 'liquidity';
  return 'yield';
}

function targetYieldForApprovedDeploymentLeg(asset: string, destinationType: string) {
  if (asset === 'GFI' || asset === 'SYRUP') return 1200;
  if (asset === 'PAXG') return 300;
  if (destinationType.trim().toLowerCase().includes('staking')) return 700;
  if (destinationType.trim().toLowerCase().includes('liquidity')) return 400;
  return 600;
}

function rehydrateDeploymentLegsFromApprovalPayload(
  batch: EscrowBatch,
  payload?: EscrowBatch['deploymentApproval']['payload'],
): EscrowBatch['deploymentLegs'] {
  if (!payload?.deploymentLegs?.length) return batch.deploymentLegs;

  const existingByLegId = new Map(batch.deploymentLegs.map((leg) => [leg.legId, leg] as const));
  const approvalsByLegId = new Map((batch.destinationApprovals ?? []).map((approval) => [approval.legId, approval] as const));
  const sourceBatchId = String(batch.sourceBatchId ?? batch.treasuryHandoff.handoffId ?? '');
  const escrowBatchId = String(payload.escrowBatchId ?? batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId);
  const walletAddress = String(payload.batchWalletAddress ?? batch.wallet.walletAddress ?? batch.wallet.address ?? '');
  const destinationRegistryVersion = batch.deploymentApproval.destinationRegistryVersion
    ?? payload.destinationRegistryVersion
    ?? 'dao-destination-registry-v1';

  return payload.deploymentLegs.map((payloadLeg) => {
    const asset = String(payloadLeg.asset ?? batch.asset ?? 'USDC');
    const destinationType = String(payloadLeg.destinationType ?? '');
    const existing = existingByLegId.get(payloadLeg.allocationLegId);
    const approval = approvalsByLegId.get(payloadLeg.allocationLegId);

    return {
      legId: payloadLeg.allocationLegId,
      provider: existing?.provider ?? providerForApprovedDeploymentLeg(asset, destinationType),
      asset,
      strategyType: existing?.strategyType ?? strategyForApprovedDeploymentLeg(asset, destinationType),
      amountUsd: Number(payloadLeg.amount),
      allocationPercent: Number(payloadLeg.weight) * 100,
      targetYieldBps: existing?.targetYieldBps ?? targetYieldForApprovedDeploymentLeg(asset, destinationType),
      sourceBatchId: existing?.sourceBatchId ?? sourceBatchId,
      escrowBatchId: existing?.escrowBatchId ?? escrowBatchId,
      walletAddress: existing?.walletAddress ?? walletAddress,
      assetSymbol: existing?.assetSymbol ?? approval?.assetSymbol ?? asset,
      amount: existing?.amount ?? approval?.amount ?? Number(payloadLeg.amount),
      weight: existing?.weight ?? approval?.weight ?? Number(payloadLeg.weight),
      destinationId: existing?.destinationId ?? approval?.destinationId ?? payloadLeg.approvedDestinationId,
      destinationName: existing?.destinationName ?? approval?.destinationName ?? payloadLeg.approvedDestinationId,
      destinationType: existing?.destinationType ?? approval?.destinationType ?? destinationType,
      destinationTypeId: existing?.destinationTypeId,
      destinationAddress: existing?.destinationAddress ?? approval?.destinationAddress ?? payloadLeg.destinationAddress,
      aaaAllocationHash: existing?.aaaAllocationHash ?? batch.aaaAllocation.allocationPlanHash,
      destinationRegistryVersion: existing?.destinationRegistryVersion ?? approval?.destinationRegistryVersion ?? destinationRegistryVersion,
      currentValueUsd: existing?.currentValueUsd,
      status: existing?.status ?? 'approved',
      providerReferenceId: existing?.providerReferenceId,
      deploymentTxHash: existing?.deploymentTxHash,
    };
  });
}

function canGenerateDeploymentLegs(batch: EscrowBatch) {
  if (getFundingValidation(batch).state !== 'verified') return false;
  if (!hasValidatedAaaAllocation(batch)) return false;
  if (!batch.aaaAllocation.allocationPlanHash) return false;
  if (batch.deploymentApproval.status === 'approved') return false;
  if (batch.deploymentLegs.some((leg) => ['approved', 'executed', 'deployed', 'monitoring', 'settled', 'exception'].includes(leg.status))) {
    return false;
  }
  return isValidAddress(walletDisplay(batch));
}

function buildDeploymentLegsFromDestinationPreviewRows(
  batch: EscrowBatch,
  rows: DestinationApprovalPreviewRow[],
): EscrowBatch['deploymentLegs'] {
  if (!canGenerateDeploymentLegs(batch)) return batch.deploymentLegs;

  const sourceBatchId = String(batch.sourceBatchId ?? batch.treasuryHandoff.handoffId ?? '');
  const escrowBatchId = String(batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId);
  const walletAddress = walletDisplay(batch);
  if (!sourceBatchId || !escrowBatchId || !isValidAddress(walletAddress)) return batch.deploymentLegs;

  const existingByKey = new Map(
    batch.deploymentLegs.map((leg) => [
      `${leg.assetSymbol || leg.asset}:${String(leg.destinationId ?? '')}`,
      leg,
    ] as const)
  );

  return rows
    .filter((row) =>
      row.status === 'Approved'
      && row.destinationId > 0
      && Boolean(row.destinationName)
      && (!destinationAddressRequired(row.destinationTypeId) || isValidAddress(row.destinationAddress))
    )
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map((row, index) => {
      const existing = existingByKey.get(`${row.asset}:${String(row.destinationId)}`);
      return {
        legId: existing?.legId ?? `${batch.batchId}-dest-leg-${index + 1}`,
        provider: providerForDestinationPreviewRow(row),
        asset: row.asset,
        strategyType: strategyForDestinationPreviewRow(row),
        amountUsd: roundTo(row.amountUsd, 6),
        allocationPercent: roundTo(row.weight * 100, 6),
        targetYieldBps: existing?.targetYieldBps ?? targetYieldForDestinationPreviewRow(row),
        sourceBatchId,
        escrowBatchId,
        walletAddress,
        assetSymbol: row.asset,
        amount: roundTo(row.amountUsd, 6),
        weight: roundTo(row.weight, 12),
        destinationId: String(row.destinationId),
        destinationName: row.destinationName,
        destinationType: row.destinationType,
        destinationTypeId: row.destinationTypeId,
        destinationAddress: row.destinationAddress,
        aaaAllocationHash: batch.aaaAllocation.allocationPlanHash,
        destinationRegistryVersion: DAO_DESTINATION_REGISTRY[0]?.destinationRegistryVersion ?? 'dao-destination-registry-v1',
        currentValueUsd: existing?.currentValueUsd,
        status: existing?.status ?? 'planned',
        providerReferenceId: existing?.providerReferenceId,
        deploymentTxHash: existing?.deploymentTxHash,
      };
    });
}

function deploymentLegSnapshot(legs: EscrowBatch['deploymentLegs']) {
  return JSON.stringify(
    legs
      .slice()
      .sort((a, b) => a.legId.localeCompare(b.legId))
      .map((leg) => ({
        legId: leg.legId,
        provider: leg.provider,
        asset: leg.asset,
        strategyType: leg.strategyType,
        amountUsd: leg.amountUsd,
        allocationPercent: leg.allocationPercent,
        targetYieldBps: leg.targetYieldBps,
        sourceBatchId: leg.sourceBatchId,
        escrowBatchId: leg.escrowBatchId,
        walletAddress: leg.walletAddress,
        assetSymbol: leg.assetSymbol,
        amount: leg.amount,
        weight: leg.weight,
        destinationId: leg.destinationId,
        destinationName: leg.destinationName,
        destinationType: leg.destinationType,
        destinationTypeId: leg.destinationTypeId,
        destinationAddress: leg.destinationAddress,
        aaaAllocationHash: leg.aaaAllocationHash,
        destinationRegistryVersion: leg.destinationRegistryVersion,
        currentValueUsd: leg.currentValueUsd,
        status: leg.status,
        providerReferenceId: leg.providerReferenceId,
        deploymentTxHash: leg.deploymentTxHash,
      }))
  );
}

function destinationApprovalSnapshot(approvals: EscrowBatch['destinationApprovals']) {
  return JSON.stringify(
    (approvals ?? [])
      .slice()
      .sort((a, b) => a.legId.localeCompare(b.legId))
      .map((approval) => ({
        legId: approval.legId,
        sourceBatchId: approval.sourceBatchId,
        escrowBatchId: approval.escrowBatchId,
        walletAddress: approval.walletAddress,
        assetSymbol: approval.assetSymbol,
        amount: approval.amount,
        weight: approval.weight,
        destinationId: approval.destinationId,
        destinationName: approval.destinationName,
        destinationType: approval.destinationType,
        destinationAddress: approval.destinationAddress,
        aaaAllocationHash: approval.aaaAllocationHash,
        policyContextHash: approval.policyContextHash,
        destinationApprovalHash: approval.destinationApprovalHash,
        approvalStatus: approval.approvalStatus,
      }))
  );
}

function canAutoApproveDestinationRecords(batch: EscrowBatch) {
  if (getFundingValidation(batch).state !== 'verified') return false;
  if (!hasValidAuthorityBinding(batch)) return false;
  if (!hasValidatedAaaAllocation(batch)) return false;
  if (getDeploymentLegsForDestinationApproval(batch).length === 0) return false;
  // Allow re-population on page reload: if destinationApprovals is empty, run even when
  // deployment is already approved (hashes are deterministic so they'll match the stored hash).
  if (batch.deploymentApproval.status === 'approved' && (batch.destinationApprovals ?? []).length > 0) return false;
  return true;
}

function normalizePreviewAsset(raw: unknown): PortfolioDestinationPreviewAsset {
  const row = raw as Record<string, unknown>;
  const tuple = raw as unknown[];
  return {
    symbol: String(row.symbol ?? tuple[0] ?? ''),
    defaultDestinationId: Number(row.defaultDestinationId ?? tuple[7] ?? 0),
  };
}

function normalizeApprovedDestination(raw: unknown): ApprovedPortfolioDestination {
  const row = raw as Record<string, unknown>;
  const tuple = raw as unknown[];
  return {
    destinationId: Number(row.destinationId ?? tuple[0] ?? 0),
    name: String(row.name ?? tuple[1] ?? ''),
    destinationType: Number(row.destinationType ?? tuple[4] ?? 0),
    destinationAddress: String(row.destinationAddress ?? tuple[5] ?? ''),
    active: Boolean(row.active ?? tuple[6] ?? false),
  };
}

function buildDestinationApprovalPreviewRows(params: {
  targetWeights: Record<string, number>;
  totalAmountUsd: number;
  assets: PortfolioDestinationPreviewAsset[];
  destinations: ApprovedPortfolioDestination[];
}): DestinationApprovalPreviewRow[] {
  const assetsBySymbol = new Map(params.assets.map((asset) => [asset.symbol, asset]));
  const activeDestinationsById = new Map(
    params.destinations
      .filter((destination) => destination.active)
      .map((destination) => [destination.destinationId, destination])
  );

  return Object.entries(params.targetWeights)
    .filter(([, weight]) => Number(weight) > 0)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .map(([symbol, weight]) => {
      const asset = assetsBySymbol.get(symbol);
      const destination = asset ? activeDestinationsById.get(asset.defaultDestinationId) : undefined;
      return {
        asset: symbol,
        amountUsd: Number(weight) * params.totalAmountUsd,
        weight: Number(weight),
        destinationId: destination?.destinationId ?? 0,
        destinationName: destination?.name ?? '',
        destinationTypeId: destination?.destinationType ?? 0,
        approvedDestination: destination?.name ?? 'Not configured',
        destinationType: destination ? (DESTINATION_TYPE_LABELS[destination.destinationType] ?? String(destination.destinationType)) : 'Not configured',
        destinationAddress: destination?.destinationAddress ?? '',
        status: destination ? 'Approved' : 'Missing Destination',
      };
    });
}

function buildDestinationApprovalRecord(batch: EscrowBatch, rows: DestinationApprovalPreviewRow[]): DestinationApprovalRecord {
  const missingAssets = rows
    .filter((row) => row.status !== 'Approved')
    .map((row) => row.asset)
    .sort();

  if (missingAssets.length > 0) {
    return {
      payload: null,
      destinationApprovalHash: '',
      missingAssets,
      blockingReason: `Missing approved destination for ${missingAssets.join(', ')}.`,
    };
  }

  const sourceBatchId = String(batch.sourceBatchId ?? batch.treasuryHandoff.handoffId ?? '');
  const escrowBatchId = String(batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId);
  const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address ?? '';
  const aaaAllocationHash = batch.aaaAllocation.allocationPlanHash;
  const portfolioRegistryVersion = batch.aaaAllocation.portfolioRegistryVersion;

  if (!rows.length) {
    return {
      payload: null,
      destinationApprovalHash: '',
      missingAssets: [],
      blockingReason: 'No allocation legs are available for destination approval.',
    };
  }
  if (!sourceBatchId || !escrowBatchId || !isValidAddress(walletAddress)) {
    return {
      payload: null,
      destinationApprovalHash: '',
      missingAssets: [],
      blockingReason: 'Batch source id, escrow id, or wallet address is missing.',
    };
  }
  if (!aaaAllocationHash || !portfolioRegistryVersion) {
    return {
      payload: null,
      destinationApprovalHash: '',
      missingAssets: [],
      blockingReason: 'AAA allocation hash or portfolio registry version is missing.',
    };
  }

  const payload: DestinationApprovalPayload = {
    sourceBatchId,
    escrowBatchId,
    walletAddress,
    aaaAllocationHash,
    portfolioRegistryVersion,
    destinations: rows
      .slice()
      .sort((a, b) => a.asset.localeCompare(b.asset))
      .map((row) => ({
        assetSymbol: row.asset,
        amount: Number(row.amountUsd.toFixed(6)),
        weight: Number(row.weight.toFixed(12)),
        destinationId: row.destinationId,
        destinationName: row.destinationName,
        destinationType: row.destinationTypeId,
        destinationAddress: row.destinationAddress,
      })),
  };

  return {
    payload,
    destinationApprovalHash: canonicalKeccak(payload),
    missingAssets: [],
    blockingReason: null,
  };
}

async function readDestinationApprovalPreviewRows(params: {
  rpcUrl: string;
  registryAddress: string;
  targetWeights: Record<string, number>;
  totalAmountUsd: number;
}): Promise<DestinationApprovalPreviewRow[]> {
  const provider = new JsonRpcProvider(params.rpcUrl);
  const registry = new Contract(params.registryAddress, PORTFOLIO_DESTINATION_PREVIEW_ABI, provider);
  const [rawAssets, rawDestinations] = await Promise.all([
    registry.getAllAssets(),
    registry.getAllDestinations(),
  ]);
  return buildDestinationApprovalPreviewRows({
    targetWeights: params.targetWeights,
    totalAmountUsd: params.totalAmountUsd,
    assets: (rawAssets as readonly unknown[]).map(normalizePreviewAsset),
    destinations: (rawDestinations as readonly unknown[]).map(normalizeApprovedDestination),
  });
}

type FundingVerificationResult = {
  batchId: string;
  sourceBatchId: string;
  custodyMode: NonNullable<EscrowBatch['custodyMode']>;
  sourceContract?: string;
  expectedAmountUsd: number;
  observedAmountUsd: number;
  sourceContractBalanceUsd?: number;
  batchPositionCollateralUsd?: number;
  fundingSource?: string;
  fundingTxHash?: string;
  fundingStatus: 'verified' | 'mismatch';
  confirmedAt: string;
  verifiedAt?: string;
};

function usd6ToUsd(value: unknown) {
  const amount = typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
  return Number(amount) / 1_000_000;
}

function fundingStatusLabel(batch: EscrowBatch) {
  const fundingValidation = getFundingValidation(batch);
  if (fundingValidation.state === 'verified' && batch.custodyMode === 'escrow_contract_custody') {
    return 'Escrow Contract Funding Verified';
  }
  return fundingValidation.label;
}

function batchStatusLabel(batch: EscrowBatch) {
  if (hasDeploymentApproval(batch) && batch.status === 'deployment_pending') {
    return 'Deployment Approved';
  }
  if (batch.status === 'wallet_funded' && batch.custodyMode === 'escrow_contract_custody') {
    return 'Funding Verified';
  }
  if (batch.status === 'wallet_funded' && batch.custodyMode === 'batch_wallet_custody') {
    return 'Funding Verified';
  }
  if (batch.status === 'wallet_created' && batch.custodyMode === 'batch_wallet_custody') {
    return 'Funding Pending';
  }
  return STATUS_LABELS[batch.status];
}

function compactBatchStatusLabel(batch: EscrowBatch) {
  const label = batchStatusLabel(batch);
  const labels: Record<string, string> = {
    'AAA Plan Attached': 'AAA Attached',
    'Funding Pending Verification': 'Funding Pending',
    'Funding Verified': 'Funded',
    'Deployment Pending': 'Deploy Pending',
    'Deployment Approved': 'Deploy Approved',
    'Treasury Received': 'Treasury Recv',
  };
  return labels[label] ?? label;
}

function compactFundingStatusLabel(batch: EscrowBatch) {
  const label = fundingStatusLabel(batch);
  const labels: Record<string, string> = {
    'Escrow Contract Funding Verified': 'Verified',
    'Funding Verified': 'Verified',
    'Funding Pending Verification': 'Pending',
    'Funding Pending': 'Pending',
    'Funding Mismatch': 'Mismatch',
  };
  return labels[label] ?? label;
}

function compactSettlementStatusLabel(batch: EscrowBatch) {
  const label = titleCase(batch.settlement.status);
  const labels: Record<string, string> = {
    'Not Due': 'Not Due',
    'Settlement Pending': 'Pending',
    'Settlement Complete': 'Complete',
  };
  return labels[label] ?? label;
}

function compactPrimaryActionLabel(label: string) {
  const labels: Record<string, string> = {
    'Approve Destination': 'Approve Dest.',
    'Approve Deployment': 'Approve Deploy',
    'Create Deployment Signing Request': 'Create Sign Req.',
    'Request AAA Allocation': 'Req. AAA',
    'Anchor AAA Allocation': 'Anchor AAA',
    'Recover Plan Data': 'Recover Plan',
    'Execute Deployment': 'Deploy',
    'Verify Funding': 'Verify Funding',
    'Deploy Batch': 'Deploy Batch',
  };
  return labels[label] ?? label;
}

function getApproximatePhase(batch: EscrowBatch): number {
  if (batch.status === 'settled' || batch.status === 'retired') return 9;
  if (batch.status === 'deployed' || batch.status === 'active' || batch.status === 'disputed') return 8;
  if (batch.status === 'settlement_pending') return 8;
  if (batch.status === 'deployment_pending') return hasDeploymentApproval(batch) ? 7 : 6;
  if (batch.status === 'aaa_plan_attached') return 5;
  if (batch.status === 'wallet_funded') return 4;
  // 'wallet_created' is set client-side when chainConfirmed===true — it does NOT mean Phase 3 ran.
  if (batch.status === 'wallet_created' || batch.status === 'wallet_requested') return 1;
  if (batch.status === 'handoff_approved' || batch.status === 'treasury_received') return 1;
  return 0;
}

function custodyModeLabel(batch: EscrowBatch) {
  return batch.custodyMode === 'batch_wallet_custody' ? 'Batch Wallet Custody' : 'Escrow Contract Custody';
}

async function readOnChainFundingVerification(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  fundingTxHashOverride?: string;
}): Promise<FundingVerificationResult> {
  const { batch, rpcUrl, escrowAddress, fundingTxHashOverride } = params;
  const provider = new JsonRpcProvider(rpcUrl);
  const expectedAmountUsd = batch.expectedFundingAmountUsd || batch.totalAmountUsd;
  const custodyMode = batch.custodyMode ?? 'escrow_contract_custody';
  const confirmedAt = new Date().toISOString();
  const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
  if (!sourceBatchId) {
    throw new Error('sourceBatchId is missing from batch; cannot verify on-chain funding from Escrow batch UUID.');
  }

  if (custodyMode === 'batch_wallet_custody') {
    const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address;
    if (!walletAddress || !isValidAddress(walletAddress)) {
      throw new Error('Batch wallet address is missing.');
    }
    const escrow = new Contract(escrowAddress, ESCROW_BATCH_READER_ABI, provider);
    const usdcAddress = String(await escrow.usdc());
    const usdc = new Contract(usdcAddress, ERC20_BALANCE_READER_ABI, provider);

    const [walletBalance, isFundedOnChain] = await Promise.all([
      usdc.balanceOf(walletAddress),
      escrow.batchWalletFunded(BigInt(sourceBatchId)).catch(() => false),
    ]);
    const observedAmountUsd = usd6ToUsd(walletBalance);
    const executedOutflowUsd = getExecutedDeploymentOutflowUsd(batch);
    const reconciledFundingUsd = Number((observedAmountUsd + executedOutflowUsd).toFixed(6));
    const fundingStatus =
      isFundedOnChain && reconciledFundingUsd === expectedAmountUsd
        ? 'verified'
        : 'mismatch';

    // Resolve tx hash: caller-supplied override > event log readback > undefined.
    let resolvedFundingTxHash: string | undefined = fundingTxHashOverride;
    if (!resolvedFundingTxHash && isFundedOnChain) {
      try {
        const filter = escrow.filters.BatchWalletFunded(BigInt(sourceBatchId));
        const events = await escrow.queryFilter(filter, -20000);
        if (events.length > 0) {
          resolvedFundingTxHash = events[events.length - 1].transactionHash;
        }
      } catch { /* event read is best-effort */ }
    }

    return {
      batchId: batch.batchId,
      sourceBatchId,
      custodyMode,
      sourceContract: walletAddress,
      expectedAmountUsd,
      observedAmountUsd,
      fundingSource: 'Batch wallet USDC balance',
      fundingTxHash: resolvedFundingTxHash,
      fundingStatus,
      confirmedAt,
      verifiedAt: fundingStatus === 'verified' ? confirmedAt : undefined,
    };
  }

  const sourceContract = batch.sourceContract && isValidAddress(batch.sourceContract)
    ? batch.sourceContract
    : escrowAddress;
  const escrow = new Contract(sourceContract, ESCROW_BATCH_READER_ABI, provider);
  const [position, accounting, usdcAddress] = await Promise.all([
    escrow.escrowBatchPositions(BigInt(sourceBatchId)).catch(() => null),
    escrow.getBatchAccounting(BigInt(sourceBatchId)).catch(() => null),
    escrow.usdc(),
  ]);

  const resolvedSourceBatchId = Number(position?.batchId ?? position?.[0] ?? 0);
  if (!resolvedSourceBatchId) {
    throw new Error(`Escrow batch position ${sourceBatchId} is missing.`);
  }

  const deployedPrincipalUsd = usd6ToUsd(position?.deployedPrincipal ?? position?.[1] ?? 0);
  const principalFundedUsd = usd6ToUsd(accounting?.principalFundedUsd6 ?? accounting?.[1] ?? 0);
  const usdc = new Contract(String(usdcAddress), ERC20_BALANCE_READER_ABI, provider);
  const sourceContractBalanceUsd = usd6ToUsd(await usdc.balanceOf(sourceContract));
  const observedAmountUsd = principalFundedUsd || deployedPrincipalUsd;
  const fundingStatus =
    observedAmountUsd === expectedAmountUsd &&
    deployedPrincipalUsd === expectedAmountUsd &&
    sourceContractBalanceUsd >= expectedAmountUsd
      ? 'verified'
      : 'mismatch';

  return {
    batchId: batch.batchId,
    sourceBatchId,
    custodyMode,
    sourceContract,
    expectedAmountUsd,
    observedAmountUsd,
    sourceContractBalanceUsd,
    batchPositionCollateralUsd: deployedPrincipalUsd,
    fundingSource: 'InvestmentEscrow escrowBatchPositions',
    fundingStatus,
    confirmedAt,
    verifiedAt: fundingStatus === 'verified' ? confirmedAt : undefined,
  };
}


function termMonthsFromOrder(order: any) {
  const explicitTermMonths = Number(order.termMonths ?? order.term_months ?? 0);
  if (Number.isFinite(explicitTermMonths) && explicitTermMonths > 0) return explicitTermMonths;
  const termYears = Number(order.termYears ?? order.term_years ?? 0);
  if (Number.isFinite(termYears) && termYears > 0) return termYears * 12;
  const label = String(order.productDuration ?? order.durationClass ?? order.executionHorizon ?? '');
  const daysMatch = label.match(/(\d+)\s*D/i);
  if (daysMatch) return Math.max(1, Math.round(Number(daysMatch[1]) / 30));
  const monthMatch = label.match(/(\d+)\s*M/i);
  if (monthMatch) return Number(monthMatch[1]);
  const yearMatch = label.match(/(\d+)\s*Y/i);
  if (yearMatch) return Number(yearMatch[1]) * 12;
  return 0;
}

function createIncomingDepositFromOrder(order: any): TreasuryHandoffPackage['deposits'][number] {
  return {
    depositId: `${order.sourceType || 'TREASURY'}-${order.batchId}-aggregate`,
    originBank: order.originInstitutionId || 'Manual / Demo Bank',
    adapterType: 'manual',
    amountUsd: Number(order.principalReceivedUsd ?? 0),
    termMonths: termMonthsFromOrder(order),
    status: 'batched',
  };
}

function secondsToIso(value: unknown) {
  const seconds = Number(value ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}

function termMonthsFromTimestamps(startAt: unknown, endAt: unknown) {
  const startMs = Number(startAt ?? 0) * 1000;
  const endMs = Number(endAt ?? 0) * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs <= startMs) return 0;
  // 365.25 / 12 ≈ 30.4375 days/month: avoids the 30-day rounding error that turns
  // 5 years (1826 days) into 61 months instead of 60.
  return Math.max(1, Math.round((endMs - startMs) / (365.25 / 12 * 24 * 60 * 60 * 1000)));
}

function decodeReceiptIdFromOriginRef(value: unknown) {
  const raw = String(value ?? '');
  if (!raw || !raw.startsWith('0x')) return '';
  try {
    return BigInt(raw).toString();
  } catch {
    return '';
  }
}

async function loadOnChainTreasurySentBatches(params: {
  rpcUrl: string;
  chainId: number;
  treasuryAddress: string;
  escrowAddress: string;
}): Promise<TreasuryHandoffPackage[]> {
  const provider = new JsonRpcProvider(params.rpcUrl);
  const treasury = new Contract(params.treasuryAddress, TREASURY_BATCH_READER_ABI, provider);
  const escrow = new Contract(params.escrowAddress, ESCROW_BATCH_READER_ABI, provider);
  const nextBatchId = Number(await treasury.nextTreasuryBatchId().catch(() => 0));
  if (!Number.isFinite(nextBatchId) || nextBatchId <= 1) return [];

  const handoffs: TreasuryHandoffPackage[] = [];
  const maxBatchId = Math.min(nextBatchId - 1, 50);
  for (let batchId = 1; batchId <= maxBatchId; batchId += 1) {
    const [batch, position] = await Promise.all([
      treasury.getTreasuryBatch(BigInt(batchId)).catch(() => null),
      escrow.escrowBatchPositions(BigInt(batchId)).catch(() => null),
    ]);
    const resolvedBatchId = Number(batch?.batchId ?? batch?.[0] ?? 0);
    const resolvedPositionId = Number(position?.batchId ?? position?.[0] ?? 0);
    if (!resolvedBatchId || !resolvedPositionId) continue;

    const originType = Number(batch.originType ?? batch[1] ?? 0);
    const originSource = originType === ORIGIN_TYPE_VAULT ? 'vault' : 'bank';
    const originLabel = originSource === 'vault' ? 'Vault collateral' : 'Treasury batch';

    const lotIds = Array.from(batch.lotIds ?? batch[2] ?? []).map((lotId: any) => Number(lotId));
    const lots = await Promise.all(lotIds.map((lotId) => treasury.originLots(BigInt(lotId)).catch(() => null)));
    const openedAt = Number(batch.openedAt ?? batch[4] ?? 0);
    const expectedReturnAt = Number(batch.expectedReturnAt ?? batch[5] ?? position.expectedReturnAt ?? position[2] ?? 0);
    const settlementDeadlineAt = Number(batch.settlementDeadlineAt ?? batch[6] ?? position.settlementDeadlineAt ?? position[3] ?? 0);
    const totalAmountUsd = Number(batch.principalAllocated ?? batch[3] ?? position.deployedPrincipal ?? position[1] ?? 0) / 1_000_000;
    const fallbackTermMonths = termMonthsFromTimestamps(openedAt, expectedReturnAt);
    const deposits = lots
      .filter(Boolean)
      .map((lot: any, index) => {
        const lotId = Number(lot.id ?? lot[0] ?? lotIds[index] ?? index + 1);
        const receiptId = decodeReceiptIdFromOriginRef(lot.originRefId ?? lot[2]);
        const liabilityUnlockAt = Number(lot.liabilityUnlockAt ?? lot[5] ?? 0);
        return {
          depositId: receiptId ? `${originSource}-receipt-${receiptId}` : `${originSource}-lot-${lotId}`,
          originBank: originLabel,
          adapterType: 'manual' as const,
          bankClientRef: receiptId || undefined,
          amountUsd: Number(lot.amount ?? lot[3] ?? 0) / 1_000_000,
          termMonths: termMonthsFromTimestamps(Number(lot.fundedAt ?? lot[4] ?? openedAt), liabilityUnlockAt) || fallbackTermMonths,
          status: 'batched' as const,
        };
      });
    const executionContextHash = String(position.executionContextHash ?? position[4] ?? '');
    const depositManifestHash = canonicalKeccak({
      version: 1,
      type: 'treasury_deposit_manifest',
      treasuryBatchId: String(batchId),
      originSource,
      principalReceivedUsd: totalAmountUsd,
      lotIds,
      executionContextHash,
    });
    const allocationPlanHash = canonicalKeccak({
      version: 1,
      type: 'treasury_allocation_plan',
      treasuryBatchId: String(batchId),
      originSource,
      principalReceivedUsd: totalAmountUsd,
      expectedReturnAt: secondsToIso(expectedReturnAt),
      settlementDeadlineAt: secondsToIso(settlementDeadlineAt),
    });
    const policyContextHash = canonicalKeccak({
      version: 1,
      type: 'treasury_policy_context',
      treasuryBatchId: String(batchId),
      originSource,
      executionContextHash,
      chainId: 'arc_testnet',
    });

    handoffs.push({
      handoffId: String(batchId),
      // Keep pre-registration IDs deterministic but non-UUID so the frontend does not treat
      // on-chain discovery alone as an authoritative server registration.
      proposedBatchId: `pending-${batchId}-${openedAt || 0}`,
      chainConfirmed: true,
      openedAt,
      custodyMode: 'batch_wallet_custody',
      sourceContract: params.escrowAddress,
      sourceBatchId: String(batchId),
      sourceContractBalanceUsd: undefined,
      batchPositionCollateralUsd: totalAmountUsd,
      fundingSource: 'InvestmentEscrow escrowBatchPositions',
      originBanks: [originLabel],
      deposits: deposits.length > 0
        ? deposits
        : [{
            depositId: `${originSource.toLowerCase()}-batch-${batchId}-aggregate`,
            originBank: originLabel,
            adapterType: 'manual',
            amountUsd: totalAmountUsd,
            termMonths: fallbackTermMonths,
            status: 'batched',
          }],
      asset: 'USDC',
      totalAmountUsd,
      termMonths: fallbackTermMonths,
      expectedFundingAmountUsd: totalAmountUsd,
      depositManifestHash,
      allocationPlanHash,
      policyContextHash,
      approvedByTreasury: true,
      approvedAt: secondsToIso(openedAt),
      status: 'treasury_received',
    });
  }

  return handoffs;
}

// Backend execution-order rows are metadata only. They may include historical or failed
// orders that no longer correspond to a live contract batch, so they must never create
// a visible Escrow batch by themselves.
function resolveInstitutionName(id: string | undefined | null, names: Map<string, string>): string {
  if (!id) return '';
  return names.get(id) ?? id;
}

function buildIncomingTreasuryBatch(order: any, termPositions: any[], institutionNames: Map<string, string> = new Map()): TreasuryHandoffPackage | null {
  const treasuryBatchId = String(order.batchId ?? '');
  if (!treasuryBatchId) return null;

  const sourceEntries = termPositions
    .filter((position) => String(position.treasuryBatchId ?? position.treasury_batch_id ?? '') === treasuryBatchId)
    .map((position, index) => {
      const institutionId = position.originInstitutionId ?? position.origin_institution_id ?? order.originInstitutionId;
      return {
        depositId: String(position.id ?? position.termPositionId ?? `${treasuryBatchId}-source-${index + 1}`),
        originBank: position.institutionDisplayName || resolveInstitutionName(institutionId, institutionNames) || 'Manual / Demo Bank',
        adapterType: 'manual' as const,
        amountUsd: Number(position.amountUsd ?? position.amount_usd ?? position.principalUsd ?? 0),
        termMonths: termMonthsFromOrder(position),
        status: 'batched' as const,
      };
    });
  const deposits = sourceEntries.length > 0 ? sourceEntries : [createIncomingDepositFromOrder(order)];
  const originBanks = Array.from(new Set(deposits.map((deposit) => deposit.originBank).filter(Boolean)));
  const metadata = order.metadata ?? {};
  const walletAddress =
    order.batchWalletAddress ??
    order.walletAddress ??
    order.assignedBatchWalletAddress ??
    metadata.batchWalletAddress ??
    metadata.walletAddress ??
    metadata.assignedBatchWalletAddress ??
    metadata.batchWalletBinding?.canonicalPayload?.walletAddress;
  const batchWalletChain = order.batchWalletChain ?? metadata.batchWalletChain ?? metadata.batchWalletBinding?.canonicalPayload?.chainId;
  const totalAmountUsd = Number(order.totalAmountUsd ?? order.principalReceivedUsd ?? metadata.totalAmountUsd ?? 0);
  const termMonths = termMonthsFromOrder(order);
  const asset = order.asset ?? metadata.asset;
  const sourceBatchId = String(order.sourceBatchId ?? metadata.sourceBatchId ?? treasuryBatchId);
  const openedAt = toUnixSeconds(order.openedAt ?? metadata.openedAt);

  return {
    handoffId: treasuryBatchId,
    proposedBatchId: resolveEscrowBatchId(order.escrowBatchId ?? order.batchId ?? metadata.escrowBatchId, {
      chainId: order.chainId ?? 0,
      treasuryAddress: getRuntimeAddress('Treasury') ?? '',
      sourceBatchId,
      openedAt,
    }),
    chainConfirmed: false,
    openedAt: openedAt || undefined,
    custodyMode: (order.custodyMode === 'batch_wallet_custody' || metadata.custodyMode === 'batch_wallet_custody') ? 'batch_wallet_custody' : 'escrow_contract_custody',
    sourceContract: order.sourceContract ?? metadata.sourceContract ?? getRuntimeAddress('InvestmentEscrow'),
    sourceBatchId,
    sourceContractBalanceUsd:
      order.sourceContractBalanceUsd == null && metadata.sourceContractBalanceUsd == null
        ? undefined
        : Number(order.sourceContractBalanceUsd ?? metadata.sourceContractBalanceUsd),
    batchPositionCollateralUsd:
      order.batchPositionCollateralUsd == null && metadata.batchPositionCollateralUsd == null
        ? undefined
        : Number(order.batchPositionCollateralUsd ?? metadata.batchPositionCollateralUsd),
    fundingSource: order.fundingSource ?? metadata.fundingSource ?? 'InvestmentEscrow contract',
    originBanks,
    deposits,
    asset,
    totalAmountUsd,
    termMonths,
    treasurySourceWallet: order.treasurySourceWallet ?? metadata.treasurySourceWallet,
    treasuryBatchTxHash: order.treasuryBatchTxHash ?? metadata.treasuryBatchTxHash,
    batchWalletAddress: walletAddress,
    batchWalletChain: batchWalletChain === 'arc_mainnet' || batchWalletChain === 'arc_testnet' ? batchWalletChain : undefined,
    batchWalletBindingHash: order.batchWalletBindingHash ?? metadata.batchWalletBindingHash ?? metadata.batchWalletBinding?.bindingHash,
    expectedFundingAmountUsd: Number(order.expectedFundingAmountUsd ?? metadata.expectedFundingAmountUsd ?? totalAmountUsd),
    observedWalletBalanceUsd:
      order.observedWalletBalanceUsd == null && metadata.observedWalletBalanceUsd == null && metadata.walletBalanceUsd == null
        ? undefined
        : Number(order.observedWalletBalanceUsd ?? metadata.observedWalletBalanceUsd ?? metadata.walletBalanceUsd),
    fundingTxHash: order.fundingTxHash ?? metadata.fundingTxHash,
    depositManifestHash: order.depositManifestHash ?? metadata.depositManifestHash ?? '',
    allocationPlanHash: order.allocationPlanHash ?? metadata.allocationPlanHash ?? metadata.onchainAuthorization?.allocationPlanHash ?? '',
    policyContextHash: order.policyContextHash ?? metadata.policyContextHash ?? metadata.onchainAuthorization?.policyContextHash ?? '',
    approvedByTreasury: true,
    approvedAt: order.updatedAt ?? order.createdAt,
    status: walletAddress ? 'treasury_received' : 'treasury_sent',
  };
}

function mergeBackendMetadataIntoOnChainBatch(
  onChainBatch: TreasuryHandoffPackage,
  backendBatch?: TreasuryHandoffPackage | null,
): TreasuryHandoffPackage {
  if (!backendBatch) return onChainBatch;
  // The server-stored UUID is the canonical batch identity: it is written to DB at vault
  // registration and shared with the signer service. All downstream writers (AAA plan save,
  // reconcile loop) and readers (storedAllocationPlans lookup) must use this UUID.
  // The on-chain recomputed UUID is a fallback only when no backend record exists.
  const canonicalBatchId =
    isUuid(backendBatch.proposedBatchId) ? backendBatch.proposedBatchId : onChainBatch.proposedBatchId;

  // Prefer backend termMonths: the backend derives it from real term positions (term_years * 12),
  // whereas the Treasury contract's expectedReturnAt is the execution deadline (often 30 days),
  // not the investment term. Vault lots carry the correct term via liabilityUnlockAt (already
  // computed into each deposit's termMonths), so use the max deposit term as a fallback when
  // both batch-level sources are 1 (the Math.max(1,...) floor indicating a missing timestamp).
  const maxDepositTermMonths = Math.max(
    0,
    ...onChainBatch.deposits.map(d => d.termMonths || 0),
    ...backendBatch.deposits.map(d => d.termMonths || 0),
  );
  const resolvedTermMonths =
    (backendBatch.termMonths > 1 ? backendBatch.termMonths : 0) ||
    (onChainBatch.termMonths > 1 ? onChainBatch.termMonths : 0) ||
    (maxDepositTermMonths > 1 ? maxDepositTermMonths : 0) ||
    backendBatch.termMonths ||
    onChainBatch.termMonths;

  // Patch on-chain deposit termMonths for bank lots which have no liabilityUnlockAt on-chain.
  // Vault lots carry the correct term from liabilityUnlockAt — only override when the computed
  // value is 1 (the Math.max(1,...) floor, indicating a missing timestamp).
  // When the batch has a single resolved institution name, use it for all on-chain deposits.
  // On-chain lots only store originType (vault vs bank), not the institution ID, so
  // per-deposit ID matching is not possible — use the batch-level originBanks as the source.
  const resolvedBatchOriginBank =
    backendBatch.originBanks.length === 1 ? backendBatch.originBanks[0] : null;

  const mergedDeposits = onChainBatch.deposits.length > 0
    ? onChainBatch.deposits.map(d => ({
        ...d,
        termMonths: resolvedTermMonths || (d.termMonths > 1 ? d.termMonths : 0),
        originBank: resolvedBatchOriginBank || d.originBank,
      }))
    : backendBatch.deposits;

  return {
    ...backendBatch,
    ...onChainBatch,
    proposedBatchId: canonicalBatchId,
    openedAt: backendBatch.openedAt ?? onChainBatch.openedAt,
    termMonths: resolvedTermMonths,
    deposits: mergedDeposits,
    batchWalletAddress: backendBatch.batchWalletAddress ?? onChainBatch.batchWalletAddress,
    batchWalletChain: backendBatch.batchWalletChain ?? onChainBatch.batchWalletChain,
    batchWalletBindingHash: backendBatch.batchWalletBindingHash ?? onChainBatch.batchWalletBindingHash,
    observedWalletBalanceUsd: backendBatch.observedWalletBalanceUsd ?? onChainBatch.observedWalletBalanceUsd,
    fundingTxHash: backendBatch.fundingTxHash ?? onChainBatch.fundingTxHash,
    treasuryBatchTxHash: backendBatch.treasuryBatchTxHash ?? onChainBatch.treasuryBatchTxHash,
    approvedAt: backendBatch.approvedAt ?? onChainBatch.approvedAt,
  };
}

function statusTone(batch: EscrowBatch) {
  return STATUS_TONE[batch.status];
}

function deploymentStatus(batch: EscrowBatch) {
  return `${deploymentApprovalLabel(batch)} / ${deploymentExecutionLabel(batch)}`;
}

function deploymentApprovalLabel(batch: EscrowBatch) {
  if (hasDeploymentApproval(batch)) return 'Deployment Approved';
  return titleCase(batch.deploymentApproval.status);
}

function deploymentExecutionLabel(batch: EscrowBatch) {
  const deploymentStatus = getDeploymentExecutionStatus(batch);
  if (deploymentStatus === 'ready') return 'Ready';
  if (deploymentStatus === 'monitoring') return 'Monitoring';
  if (deploymentStatus === 'failed') return 'Failed';
  if (deploymentStatus === 'executing') return 'Executing';
  if (deploymentStatus === 'deployed') return 'Deployed';
  if (batch.status === 'exception') return 'Blocked';
  if (batch.deploymentLegs.some((leg) => leg.status === 'exception')) return 'Exception';
  if (batch.deploymentLegs.some((leg) => leg.status === 'monitoring')) return 'Monitoring';
  if (batch.deploymentLegs.some((leg) => leg.status === 'executed')) return 'Executing';
  if (batch.deploymentLegs.some((leg) => leg.status === 'deployed' || leg.status === 'settled')) return 'Deployed';
  return 'Not Deployed';
}

function walletRetirementLabel(batch: EscrowBatch) {
  return titleCase(batch.settlement.walletRetirementStatus);
}

function walletTypeLabel(batch: EscrowBatch) {
  if (batch.wallet.walletType === 'batch_multisig' || batch.wallet.custodyMode === 'role_based_multisig') {
    return '2-of-3 Multisig';
  }

  return titleCase(batch.wallet.custodyMode);
}

function getWalletSignerAuthorities(batch: EscrowBatch) {
  return batch.wallet.signerAuthorities?.length ? batch.wallet.signerAuthorities : getDefaultEscrowSigningAuthorities();
}

function canCreateDeploymentSigningRequest(batch: EscrowBatch) {
  const manifestValidation = getManifestValidation(batch);
  const fundingValidation = getFundingValidation(batch);
  const existingRequest = getLatestSigningRequest(batch);
  const hasOpenRequest = existingRequest && ['proposed', 'awaiting_second_approval', 'approved'].includes(existingRequest.status);

  return (
    !hasOpenRequest &&
    ['wallet_funded', 'aaa_plan_attached', 'deployment_pending'].includes(batch.status) &&
    Boolean(batch.wallet.address) &&
    batch.wallet.fundingStatus !== 'not_created' &&
    manifestValidation.state === 'verified' &&
    fundingValidation.state === 'verified' &&
    hasValidAuthorityBinding(batch) &&
    isAuthorityBindingAnchored(batch) &&
    areBatchDestinationsApproved(batch) &&
    hasValidatedAaaAllocation(batch)
  );
}

// ─── Evidence helpers ─────────────────────────────────────────────────────────

function getAuthorityBindingEvidence(batch: EscrowBatch): EvidenceRow[] {
  const binding = batch.batchAuthorityBinding;
  if (!binding) return [];
  const p = binding.canonicalPayload;
  return [
    { label: 'Binding hash', value: binding.batchAuthorityBindingHash },
    { label: 'EIP-712 chain ID', value: String(p.chainId) },
    { label: 'Network', value: binding.networkLabel },
    { label: 'Source type', value: p.sourceType },
    { label: 'Source contract', value: p.sourceContractAddress },
    { label: 'Active Treasury', value: p.activeTreasuryAddress },
    { label: 'Active Vault', value: p.activeVaultAddress },
    { label: 'Active Escrow', value: p.activeEscrowAddress },
    { label: 'DAO registry', value: p.daoSystemRegistryVersion },
    { label: 'System map hash', value: p.systemMapHash },
    { label: 'Source batch ID', value: p.sourceBatchId },
    { label: 'Escrow batch ID', value: p.escrowBatchId },
    { label: 'Custody mode', value: p.custodyMode },
    { label: 'Custody location', value: p.custodyLocation },
    { label: 'Asset', value: p.asset },
    { label: 'Total amount', value: fmtUsd(p.totalAmountUsd) },
    { label: 'Term', value: fmtTerm(p.termMonths) },
    { label: 'Manifest hash', value: p.depositManifestHash },
    ...(p.allocationPlanHash ? [{ label: 'Allocation hash', value: p.allocationPlanHash }] : []),
    ...(p.policyContextHash ? [{ label: 'Policy hash', value: p.policyContextHash }] : []),
    { label: 'Nonce', value: shortHash(p.nonce) },
    { label: 'Treasury sig status', value: binding.treasurySignatureStatus },
    { label: 'Treasury expected signer', value: binding.treasurySignerAddress ?? 'Not configured' },
    { label: 'Treasury recovered signer', value: binding.treasuryRecoveredSignerAddress ?? 'Not signed' },
    { label: 'Treasury signed at', value: binding.treasurySignedAt ? formatDateTime(binding.treasurySignedAt) : 'Pending' },
    { label: 'Escrow sig status', value: binding.escrowSignatureStatus },
    { label: 'Escrow expected signer', value: binding.escrowSignerAddress ?? 'Not configured' },
    { label: 'Escrow recovered signer', value: binding.escrowRecoveredSignerAddress ?? 'Not signed' },
    { label: 'Escrow signed at', value: binding.escrowSignedAt ? formatDateTime(binding.escrowSignedAt) : 'Pending' },
    { label: 'Sig verification status', value: binding.signatureVerificationStatus ?? 'unverified' },
    ...(binding.signatureMismatchReason ? [{ label: 'Mismatch reason', value: binding.signatureMismatchReason }] : []),
    { label: 'Anchor status', value: binding.anchorStatus },
    ...(binding.anchorTxHash ? [{ label: 'Anchor tx hash', value: shortHash(binding.anchorTxHash) }] : []),
    ...(binding.anchorBlockNumber != null ? [{ label: 'Anchor block', value: String(binding.anchorBlockNumber) }] : []),
    ...(binding.anchoredAt ? [{ label: 'Anchored at', value: formatDateTime(binding.anchoredAt) }] : []),
  ];
}

function getStepEvidence(batch: EscrowBatch, stepId: LifecycleStep['id']): EvidenceRow[] {
  const binding = batch.batchAuthorityBinding;
  const payload = binding?.canonicalPayload;
  const latestConfirmation = getLatestFundingConfirmation(batch);
  const latestExecution = getLatestDeploymentExecution(batch);

  switch (stepId) {
    case 'treasury_handoff':
      return [
        { label: 'Source type', value: payload?.sourceType ?? 'treasury' },
        { label: 'Source contract', value: shortHash(batch.sourceContract) },
        { label: 'Source batch ID', value: batch.sourceBatchId ?? batch.treasuryHandoff.handoffId },
        { label: 'Asset', value: batch.asset ?? 'USDC' },
        { label: 'Amount', value: fmtUsd(batch.totalAmountUsd) },
        { label: 'Term', value: fmtTerm(batch.termMonths) },
        { label: 'Authority binding hash', value: shortHash(binding?.batchAuthorityBindingHash) },
      ];
    case 'wallet_created':
      return [
        { label: 'Escrow batch ID', value: batch.batchId },
        { label: 'Materialized at', value: formatDateTime(batch.wallet.createdAt) },
        { label: 'Wallet address', value: shortHash(batch.wallet.walletAddress ?? batch.wallet.address) },
        { label: 'Binding hash', value: shortHash(batch.batchWalletBinding?.bindingHash) },
        { label: 'Reconciliation source', value: batch.fundingSource ?? 'Pending' },
      ];
    case 'wallet_funded':
      return [
        { label: 'Custody mode', value: batch.custodyMode ?? 'Pending' },
        { label: 'Custody location', value: shortHash(payload?.custodyLocation ?? batch.sourceContract) },
        { label: 'Expected amount', value: fmtUsd(batch.expectedFundingAmountUsd) },
        { label: 'Observed amount', value: latestConfirmation ? fmtUsd(latestConfirmation.observedAmountUsd) : 'Pending' },
        { label: 'Source contract', value: shortHash(batch.sourceContract) },
        { label: 'Source batch ID', value: batch.sourceBatchId ?? 'Pending' },
        { label: 'Tx hash', value: shortHash(latestConfirmation?.fundingTxHash ?? batch.wallet.fundingTxHash) },
        { label: 'Funding validation', value: latestConfirmation?.fundingStatus ?? getFundingValidation(batch).state },
      ];
    case 'aaa_attached':
      return [
        { label: 'Plan ID', value: batch.aaaAllocation.planId || 'Pending' },
        { label: 'Status', value: batch.aaaAllocation.status },
        { label: 'Allocation hash', value: shortHash(batch.aaaAllocation.allocationPlanHash) },
        { label: 'Policy context hash', value: shortHash(batch.aaaAllocation.policyContextHash) },
        { label: 'Target yield', value: `${batch.aaaAllocation.targetYieldBps} bps` },
        { label: 'Deployment legs', value: String(batch.deploymentLegs.length) },
      ];
    case 'destinations_approved': {
      const destBlocking = getDestinationApprovalBlockingReason(batch);
      return [
        { label: 'Destinations approved', value: areBatchDestinationsApproved(batch) ? 'Yes' : 'Pending' },
        ...(destBlocking ? [{ label: 'Destination block', value: destBlocking }] : []),
        { label: 'Destination approval hash', value: shortHash(getBatchDestinationApprovalHash(batch)) },
        { label: 'Destination registry version', value: batch.destinationApprovals?.[0]?.destinationRegistryVersion ?? 'Pending' },
        { label: 'Approved legs', value: getDestinationApprovalProgress(batch).label },
      ];
    }
    case 'deployment_approved': {
      const approvalBlocking = getDeploymentApprovalBlockingReason(batch);
      return [
        { label: 'Deployment approved', value: hasDeploymentApproval(batch) ? 'Yes' : 'Pending' },
        ...(approvalBlocking ? [{ label: 'Approval block', value: approvalBlocking }] : []),
        { label: 'Deployment approval hash', value: shortHash(batch.deploymentApproval.deploymentApprovalHash) },
        { label: 'Destination approval hash', value: shortHash(batch.deploymentApproval.destinationApprovalHash ?? getBatchDestinationApprovalHash(batch)) },
        { label: 'Allocation hash', value: shortHash(batch.aaaAllocation.allocationPlanHash) },
        { label: 'Policy hash', value: shortHash(batch.aaaAllocation.policyContextHash) },
      ];
    }
    case 'deployed': {
      const legResults = latestExecution?.deploymentLegResults ?? [];
      return [
        { label: 'Execution ID', value: latestExecution?.deploymentId ?? 'Pending' },
        { label: 'Execution status', value: latestExecution?.status ?? 'not_started' },
        { label: 'Executed by', value: latestExecution?.executedBy ?? 'Pending' },
        { label: 'Executed at', value: formatDateTime(latestExecution?.executedAt) },
        { label: 'Tx hash', value: shortHash(latestExecution?.deploymentTxHash) },
        { label: 'Legs', value: String(legResults.length) },
        ...(legResults.length > 0 ? [{ label: 'First leg status', value: legResults[0].status }] : []),
        ...(legResults.length > 0 ? [{ label: 'First leg tx', value: shortHash(legResults[0].deploymentTxHash) }] : []),
      ];
    }
    case 'settlement':
      return [
        { label: 'Principal', value: fmtUsd(batch.totalAmountUsd) },
        { label: 'Expected return', value: batch.settlement.expectedReturnUsd == null ? 'Pending' : fmtUsd(batch.settlement.expectedReturnUsd) },
        { label: 'Returned amount', value: batch.settlement.returnedAmountUsd == null ? 'Pending' : fmtUsd(batch.settlement.returnedAmountUsd) },
        { label: 'Settlement destination', value: shortHash(batch.wallet.walletAddress ?? batch.wallet.address) },
        { label: 'Settlement tx', value: shortHash(batch.settlement.settlementTxHash) },
        { label: 'Status', value: batch.settlement.status },
        { label: 'Wallet retirement', value: batch.settlement.walletRetirementStatus },
      ];
    default:
      return [];
  }
}

function getReadinessEvidence(batch: EscrowBatch, rowLabel: string): EvidenceRow[] {
  const manifest = getManifestValidation(batch);
  const funding = getFundingValidation(batch);
  const binding = batch.batchAuthorityBinding;
  const latestConfirmation = getLatestFundingConfirmation(batch);

  switch (rowLabel) {
    case 'Treasury batch sent':
      return [
        { label: 'Approved by Treasury', value: batch.treasuryHandoff.approvedByTreasury ? 'Yes' : 'No' },
        { label: 'Approved at', value: formatDateTime(batch.treasuryHandoff.approvedAt) },
        { label: 'Handoff ID', value: batch.treasuryHandoff.handoffId },
        { label: 'Manifest hash', value: shortHash(batch.treasuryHandoff.depositManifestHash) },
      ];
    case 'Deposit manifest verified':
      return [
        { label: 'Expected total', value: fmtUsd(manifest.expectedTotalUsd) },
        { label: 'Computed total', value: fmtUsd(manifest.computedTotalUsd) },
        { label: 'State', value: manifest.state },
        { label: 'Manifest hash', value: shortHash(batch.treasuryHandoff.depositManifestHash) },
      ];
    case 'Wallet created':
      return [
        { label: 'Wallet address', value: shortHash(batch.wallet.walletAddress ?? batch.wallet.address) },
        { label: 'Funding status', value: batch.wallet.fundingStatus },
        { label: 'Wallet type', value: batch.wallet.walletType ?? 'Pending' },
        { label: 'Created at', value: formatDateTime(batch.wallet.createdAt) },
        { label: 'Created by', value: batch.wallet.createdBy ?? 'Pending' },
      ];
    case 'Treasury binding locked':
      return [
        { label: 'Binding status', value: batch.batchWalletBinding?.bindingStatus ?? 'not_created' },
        { label: 'Binding hash', value: shortHash(batch.batchWalletBinding?.bindingHash) },
        { label: 'Confirmed at', value: formatDateTime(batch.batchWalletBinding?.confirmedAt) },
      ];
    case 'Authority binding signed': {
      const v = getBatchAuthorityBindingValidation(batch);
      const sigStatus = binding ? getBatchAuthoritySignatureStatus(binding) : null;
      return [
        { label: 'Binding state', value: v.state },
        { label: 'Binding hash', value: shortHash(binding?.batchAuthorityBindingHash) },
        { label: 'Treasury sig', value: binding?.treasurySignatureStatus ?? 'pending' },
        { label: 'Treasury expected signer', value: binding?.treasurySignerAddress ?? 'Not configured' },
        { label: 'Treasury recovered signer', value: binding?.treasuryRecoveredSignerAddress ?? 'Not signed' },
        { label: 'Escrow sig', value: binding?.escrowSignatureStatus ?? 'pending' },
        { label: 'Escrow expected signer', value: binding?.escrowSignerAddress ?? 'Not configured' },
        { label: 'Escrow recovered signer', value: binding?.escrowRecoveredSignerAddress ?? 'Not signed' },
        { label: 'Sig verification', value: binding?.signatureVerificationStatus ?? 'unverified' },
        { label: 'Anchor status', value: binding?.anchorStatus ?? 'pending_onchain_anchor' },
        ...(v.blockingReason ? [{ label: 'Binding block reason', value: v.blockingReason }] : []),
        ...(sigStatus?.blockingReason ? [{ label: 'Sig mismatch reason', value: sigStatus.blockingReason }] : []),
      ];
    }
    case 'Authority binding anchored': {
      return [
        { label: 'Anchor status', value: binding?.anchorStatus ?? 'pending_onchain_anchor' },
        ...(binding?.anchorTxHash ? [{ label: 'Anchor tx hash', value: shortHash(binding.anchorTxHash) }] : []),
        ...(binding?.anchorBlockNumber != null ? [{ label: 'Anchor block', value: String(binding.anchorBlockNumber) }] : []),
        ...(binding?.anchoredAt ? [{ label: 'Anchored at', value: formatDateTime(binding.anchoredAt) }] : []),
        { label: 'Binding hash', value: shortHash(binding?.batchAuthorityBindingHash) },
        ...(binding?.anchorStatus === 'binding_mismatch' ? [{ label: 'Mismatch', value: 'On-chain hash does not match local hash' }] : []),
      ];
    }
    case 'Wallet funded':
    case 'Escrow contract funded':
      return [
        { label: 'Expected', value: fmtUsd(funding.expectedAmountUsd) },
        { label: 'Observed', value: funding.observedAmountUsd == null ? 'Pending' : fmtUsd(funding.observedAmountUsd) },
        { label: 'Tx hash', value: shortHash(latestConfirmation?.fundingTxHash ?? batch.wallet.fundingTxHash) },
        { label: 'Confirmed by', value: latestConfirmation?.confirmedBy ?? 'Pending' },
        { label: 'Custody mode', value: batch.custodyMode ?? 'Pending' },
      ];
    case 'Funding verified':
      return [
        { label: 'State', value: funding.state },
        { label: 'Expected', value: fmtUsd(funding.expectedAmountUsd) },
        { label: 'Observed', value: funding.observedAmountUsd == null ? 'Pending' : fmtUsd(funding.observedAmountUsd) },
        { label: 'Verified at', value: formatDateTime(funding.verifiedAt) },
        ...(funding.state !== 'verified' ? [{ label: 'Missing evidence', value: 'On-chain funding confirmation required' }] : []),
      ];
    case 'AAA plan attached':
      return [
        { label: 'Plan ID', value: batch.aaaAllocation.planId || 'Pending' },
        { label: 'Status', value: batch.aaaAllocation.status },
        { label: 'Allocation hash', value: shortHash(batch.aaaAllocation.allocationPlanHash) },
        { label: 'Policy hash', value: shortHash(batch.aaaAllocation.policyContextHash) },
        ...(batch.aaaAllocation.status === 'missing' ? [{ label: 'Missing evidence', value: 'Allocation plan hash required' }] : []),
      ];
    case 'Destination approved': {
      const destBlocking = getDestinationApprovalBlockingReason(batch);
      return [
        { label: 'Status', value: areBatchDestinationsApproved(batch) ? 'Approved' : 'Pending' },
        { label: 'DAO approvals', value: String(batch.destinationApprovals?.filter((a) => a.approvalStatus === 'approved').length ?? 0) },
        ...(destBlocking ? [{ label: 'Blocking reason', value: destBlocking }] : []),
      ];
    }
    case 'Deployment approved': {
      const approvalBlocking = getDeploymentApprovalBlockingReason(batch);
      return [
        { label: 'Deployment approval', value: hasDeploymentApproval(batch) ? 'approved' : batch.deploymentApproval.status },
        { label: 'Deployment approval hash', value: shortHash(batch.deploymentApproval.deploymentApprovalHash) },
        { label: 'Destination approval hash', value: shortHash(batch.deploymentApproval.destinationApprovalHash ?? getBatchDestinationApprovalHash(batch)) },
        { label: 'Allocation plan hash', value: shortHash(batch.aaaAllocation.allocationPlanHash) },
        { label: 'Policy context hash', value: shortHash(batch.aaaAllocation.policyContextHash) },
        { label: 'Approved by', value: batch.deploymentApproval.approvedBy ?? 'Pending' },
        ...(approvalBlocking ? [{ label: 'Blocking reason', value: approvalBlocking }] : []),
      ];
    }
    case 'Deployment execution ready': {
      const execStatus = getDeploymentExecutionStatus(batch);
      return [
        { label: 'Execution status', value: execStatus },
        { label: 'Legs', value: String(batch.deploymentLegs.length) },
        ...(batch.deploymentLegs.length === 0 ? [{ label: 'Missing evidence', value: 'Deployment legs not planned' }] : []),
      ];
    }
    default:
      return [];
  }
}

function StatusBadge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'purple' | 'neutral' }) {
  const resolvedTone = tone === 'neutral' ? undefined : tone;
  return (
    <span className="data-chip" data-tone={resolvedTone}>
      {tone === 'danger' ? <AlertTriangle size={13} /> : tone === 'success' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
      {label}
    </span>
  );
}

function ReadinessBadge({ label, state }: { label: string; state: ReadinessRowState | 'ready' | 'not_ready' }) {
  const tone =
    state === 'passed' || state === 'ready'
      ? 'success'
      : state === 'blocked' || state === 'exception' || state === 'not_ready'
        ? 'danger'
        : 'warning';

  return (
    <span className="data-chip" data-tone={tone}>
      {tone === 'success' ? <CheckCircle2 size={13} /> : tone === 'danger' ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
      {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm text-slate-100">{value}</div>
    </div>
  );
}

function FormField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClassName = 'w-full rounded-lg border border-slate-700/50 bg-slate-900/45 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[rgba(148,98,232,0.58)]';

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-700/50 bg-slate-950/25 p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[var(--gold-300)]">{icon}</span>
        <h3 className="section-title !mb-0">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function LifecycleTimeline({ batch }: { batch: EscrowBatch }) {
  const lifecycleSteps = getLifecycleSteps(batch);

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[880px] items-center gap-2">
        {lifecycleSteps.map((step, index) => {
          const evidence = getStepEvidence(batch, step.id);
          return (
            <React.Fragment key={step.id}>
              <div
                className={`flex min-h-[74px] min-w-[118px] flex-1 flex-col justify-between rounded-lg border p-3 ${
                  step.state === 'complete'
                    ? 'border-[rgba(212,168,48,0.34)] bg-[rgba(50,36,8,0.36)]'
                    : step.state === 'current'
                      ? 'border-[rgba(148,98,232,0.42)] bg-[rgba(80,40,160,0.22)]'
                      : step.state === 'blocked'
                        ? 'border-[rgba(236,86,86,0.38)] bg-[rgba(60,20,20,0.42)]'
                        : 'border-slate-700/40 bg-slate-900/35'
                }`}
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</div>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-slate-100">{step.label}</span>
                  {evidence.length > 0 && (
                    <EvidencePopover
                      title={`${step.label} — Evidence`}
                      rows={evidence}
                    >
                      <Info
                        size={12}
                        className={`shrink-0 ${
                          step.state === 'blocked' ? 'text-rose-400/70 hover:text-rose-300' :
                          step.state === 'complete' ? 'text-amber-400/60 hover:text-amber-300' :
                          'text-slate-500 hover:text-slate-300'
                        }`}
                      />
                    </EvidencePopover>
                  )}
                </div>
              </div>
              {index < lifecycleSteps.length - 1 ? (
                <ArrowRight className="shrink-0 text-slate-600" size={16} />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function BatchReadinessPanel({ batch }: { batch: EscrowBatch }) {
  const readinessRows = getBatchReadiness(batch);
  const deploymentReady = isBatchDeploymentReady(batch);

  return (
    <div className="mb-5 rounded-lg border border-slate-700/50 bg-slate-950/25 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="section-title !mb-0">Batch Readiness</h3>
        </div>
        <ReadinessBadge label={deploymentReady ? 'Deployment Ready' : 'Deployment Blocked'} state={deploymentReady ? 'ready' : 'not_ready'} />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {readinessRows.map((row) => {
          const evidence = getReadinessEvidence(batch, row.label);
          return (
            <div key={row.label} className="flex min-h-[42px] items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-900/35 px-3 py-2">
              <span className="text-xs text-slate-300">{row.label}</span>
              <EvidencePopover
                title={`${row.label}`}
                rows={evidence}
                align="right"
              >
                <ReadinessBadge label={titleCase(row.state)} state={row.state} />
              </EvidencePopover>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TreasuryFundingSection({
  batch,
  currentPhase,
  onVerifyFunding,
  onManualConfirmFunding,
  isVerifying,
  verificationError,
}: {
  batch: EscrowBatch;
  currentPhase: number;
  onVerifyFunding: (batch: EscrowBatch) => void;
  onManualConfirmFunding: (batch: EscrowBatch, observedAmountUsd: number, fundingTxHash: string) => void;
  isVerifying: boolean;
  verificationError: string | null;
}) {
  const fundingValidation = getFundingValidation(batch);
  const latestConfirmation = getLatestFundingConfirmation(batch);
  const [observedAmountUsd, setObservedAmountUsd] = useState(String(batch.observedWalletBalanceUsd ?? batch.expectedFundingAmountUsd ?? batch.totalAmountUsd));
  const [fundingTxHash, setFundingTxHash] = useState(latestConfirmation?.fundingTxHash ?? '');
  const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address;
  const isEscrowContractCustody = batch.custodyMode === 'escrow_contract_custody';

  // Funding verification requires Phase 2+ (authority binding anchored) for escrow_contract_custody,
  // or Phase 3+ (wallet created on-chain) for batch_wallet_custody.
  // Before those phases, binding state is precomputed candidate metadata — not confirming it as
  // a blocking error would produce false phase-0 diagnostics.
  const fundingPhaseReady = isEscrowContractCustody ? currentPhase >= 2 : currentPhase >= 3;

  const bindingLocked = batch.batchWalletBinding?.bindingStatus === 'binding_locked';
  const bindingValidation = getBatchWalletBindingValidation(batch);
  const bindingValid = bindingValidation.state === 'valid';
  const authorityBindingValid = hasValidAuthorityBinding(batch);
  const authorityBindingAnchored = isAuthorityBindingAnchored(batch);

  // Blocking reason is only meaningful once the relevant phase prerequisites exist.
  // Before that, show a phase-appropriate message instead of false mismatch errors.
  const blockingReason = !fundingPhaseReady
    ? null
    : isEscrowContractCustody
    ? (!authorityBindingAnchored
        ? 'Batch Authority Binding has not been anchored on-chain.'
        : !authorityBindingValid
          ? (getBatchAuthorityBindingValidation(batch).blockingReason ?? 'Batch authority binding is missing or invalid.')
          : fundingValidation.state === 'mismatch'
            ? getBatchBlockingReason(batch)
            : null)
    : (!bindingLocked
        ? 'Batch wallet binding has not been locked by Treasury.'
        : !bindingValid
          ? bindingValidation.blockingReason
          : !authorityBindingValid
            ? (getBatchAuthorityBindingValidation(batch).blockingReason ?? 'Batch authority binding is missing or invalid.')
            : fundingValidation.state === 'mismatch'
              ? getBatchBlockingReason(batch)
              : null);

  useEffect(() => {
    setObservedAmountUsd(String(batch.observedWalletBalanceUsd ?? batch.expectedFundingAmountUsd ?? batch.totalAmountUsd));
    setFundingTxHash(getLatestFundingConfirmation(batch)?.fundingTxHash ?? '');
  }, [batch]);

  return (
    <SectionCard title="Treasury Funding" icon={<Banknote size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge
          label={fundingStatusLabel(batch)}
          state={fundingValidation.state === 'verified' ? 'passed' : fundingValidation.state === 'mismatch' ? 'blocked' : 'pending'}
        />
        <span className="data-chip">Asset {latestConfirmation?.asset ?? 'USDC'}</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Expected funding amount" value={fmtUsd(fundingValidation.expectedAmountUsd)} />
        <Field label="Observed amount" value={fundingValidation.observedAmountUsd == null ? 'Pending' : fmtUsd(fundingValidation.observedAmountUsd)} />
        <Field label="Source contract" value={<span className="font-mono">{shortHash(batch.sourceContract)}</span>} />
        <Field label="Source batch ID" value={batch.sourceBatchId ?? batch.treasuryHandoff.handoffId} />
        <Field label="Funding source" value={latestConfirmation?.fundingSource ?? batch.fundingSource ?? 'Pending'} />
        <Field label="Escrow contract USDC balance" value={batch.sourceContractBalanceUsd == null ? 'Pending' : fmtUsd(batch.sourceContractBalanceUsd)} />
        <Field label="Batch position collateral" value={batch.batchPositionCollateralUsd == null ? 'Pending' : fmtUsd(batch.batchPositionCollateralUsd)} />
        <Field label="Asset" value={latestConfirmation?.asset ?? 'USDC'} />
        <Field label="Treasury source wallet" value={<span className="font-mono">{shortHash(batch.treasuryHandoff.treasurySourceWallet)}</span>} />
        {!isEscrowContractCustody && (
          <Field label="Batch wallet address" value={<span className="font-mono">{shortHash(walletAddress)}</span>} />
        )}
        <Field label="Funding tx hash" value={<span className="font-mono">{shortHash(latestConfirmation?.fundingTxHash ?? batch.wallet.fundingTxHash)}</span>} />
        <Field label="Funding status" value={latestConfirmation ? titleCase(latestConfirmation.fundingStatus) : fundingStatusLabel(batch)} />
        <Field label="Confirmed by" value={latestConfirmation?.confirmedBy ?? 'Pending'} />
        <Field label="Confirmed at" value={formatDateTime(latestConfirmation?.confirmedAt)} />
        <Field label="Verified at" value={formatDateTime(latestConfirmation?.verifiedAt ?? batch.fundingVerifiedAt)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!fundingPhaseReady ? (
          <p className="text-xs text-slate-500">
            {isEscrowContractCustody
              ? 'Funding verification available after authority binding is anchored (Phase 2).'
              : 'Funding verification available after wallet is created on-chain (Phase 3).'}
          </p>
        ) : (
          <button
            type="button"
            className="action-button action-button--primary inline-flex items-center gap-2"
            disabled={isEscrowContractCustody ? (!authorityBindingAnchored || !authorityBindingValid || isVerifying) : (!walletAddress || !bindingLocked || !bindingValid || !authorityBindingValid || isVerifying)}
            aria-disabled={isEscrowContractCustody ? (!authorityBindingAnchored || !authorityBindingValid || isVerifying) : (!walletAddress || !bindingLocked || !bindingValid || !authorityBindingValid || isVerifying)}
            onClick={() => onVerifyFunding(batch)}
          >
            <CheckCircle2 size={16} />
            {isVerifying ? 'Verifying...' : 'Verify Funding'}
          </button>
        )}
      </div>


      {verificationError ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
          <span className="font-semibold">Verification Error:</span> {verificationError}
        </div>
      ) : null}

      {blockingReason ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
          <span className="font-semibold">Blocking Reason:</span> {blockingReason}
        </div>
      ) : null}
    </SectionCard>
  );
}

function BatchWalletBindingSection({
  batch,
}: {
  batch: EscrowBatch;
}) {
  const binding = batch.batchWalletBinding;
  const isLocked = binding?.bindingStatus === 'binding_locked';
  const walletConfirmed = Boolean(batch.wallet.walletAddress);
  const bindingValidation = getBatchWalletBindingValidation(batch);
  const bindingValid = bindingValidation.state === 'valid';
  const canonicalPayloadText = binding?.canonicalPayload
    ? JSON.stringify(binding.canonicalPayload, null, 2)
    : 'Create the batch wallet to generate the canonical binding payload.';

  return (
    <SectionCard title="Batch Wallet Binding" icon={<KeyRound size={18} />}>
      {binding ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ReadinessBadge label={isLocked ? 'Binding Locked' : 'Binding Pending'} state={isLocked ? 'passed' : 'pending'} />
            {/* Only surface the binding hash validation badge once the wallet is confirmed on-chain.
                Before Phase 3 the wallet address is predicted — any divergence is expected. */}
            {walletConfirmed && (
              <ReadinessBadge label={bindingValidation.label} state={bindingValid ? 'passed' : 'blocked'} />
            )}
            <span className="data-chip">Auto-locked</span>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Escrow batch ID" value={binding.batchId} />
            <Field label="Wallet address" value={<span className="font-mono">{shortHash(binding.walletAddress)}</span>} />
            <Field label="Total amount" value={fmtUsd(binding.totalAmountUsd)} />
            <Field label="Asset" value={binding.asset} />
            <Field label="Term" value={`${binding.termMonths} months`} />
            <Field label="Chain ID" value={binding.chainId} />
            <Field label="Manifest hash" value={<span className="font-mono">{shortHash(binding.depositManifestHash)}</span>} />
            <Field label="Allocation hash" value={<span className="font-mono">{shortHash(binding.allocationPlanHash)}</span>} />
            <Field label="Policy hash" value={<span className="font-mono">{shortHash(binding.policyContextHash)}</span>} />
            <Field label="Binding hash" value={<span className="font-mono">{shortHash(binding.bindingHash)}</span>} />
            <Field label="Binding status" value={titleCase(binding.bindingStatus)} />
            <Field label="Confirmed at" value={formatDateTime(binding.confirmedAt)} />
          </div>
          <div className="mb-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Canonical binding payload</div>
            <pre className="max-h-44 overflow-auto rounded-lg border border-slate-700/50 bg-slate-950/50 p-3 font-mono text-xs leading-5 text-slate-300">
              {canonicalPayloadText}
            </pre>
          </div>
          {walletConfirmed && !bindingValid && bindingValidation.blockingReason ? (
            <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
              <span className="font-semibold">Blocking Reason:</span> {bindingValidation.blockingReason}
            </div>
          ) : null}
        </>
      ) : (
        <div className="panel-note">Wallet binding is generated and locked automatically when the batch is registered.</div>
      )}
    </SectionCard>
  );
}

function SigIndicator({ role, status }: { role: 'T' | 'E'; status: 'pending' | 'signed' | 'rejected' | 'invalid' }) {
  const color = status === 'signed'
    ? 'text-emerald-400'
    : status === 'invalid' || status === 'rejected'
      ? 'text-rose-400'
      : 'text-amber-400/80';
  const mark = status === 'signed' ? '✓' : status === 'invalid' || status === 'rejected' ? '✗' : '·';
  return (
    <span className={`font-mono text-[10px] font-semibold tabular-nums ${color}`} title={`${role === 'T' ? 'Treasury/Vault' : 'Escrow'}: ${status}`}>
      {role}{mark}
    </span>
  );
}

function sigStatusTone(status: 'pending' | 'signed' | 'rejected' | 'invalid'): 'success' | 'warning' | 'danger' {
  if (status === 'signed') return 'success';
  if (status === 'rejected' || status === 'invalid') return 'danger';
  return 'warning';
}

function getSigBadgeEvidence(batch: EscrowBatch, role: 'treasury' | 'escrow'): EvidenceRow[] {
  const binding = batch.batchAuthorityBinding;
  if (!binding) return [];
  const sigStatus = role === 'treasury' ? binding.treasurySignatureStatus : binding.escrowSignatureStatus;
  const storedExpected = role === 'treasury' ? binding.treasurySignerAddress : binding.escrowSignerAddress;
  const recoveredSigner = role === 'treasury' ? binding.treasuryRecoveredSignerAddress : binding.escrowRecoveredSignerAddress;
  const signedAt = role === 'treasury' ? binding.treasurySignedAt : binding.escrowSignedAt;
  const registryRecord = role === 'treasury' ? getTreasuryVaultAuthority() : getEscrowAuthority();
  const roleStatus = isRoleSigningAllowed(registryRecord);
  const drift = detectRoleAuthorityDrift(role, storedExpected);
  const connectedAddr = typeof window !== 'undefined' ? ((window as any).ethereum?.selectedAddress ?? '') : '';
  const walletMatchesRole = Boolean(connectedAddr && connectedAddr.toLowerCase() === registryRecord.expectedSignerAddress.toLowerCase());
  const signerMatchesRegistry = Boolean(recoveredSigner && recoveredSigner.toLowerCase() === registryRecord.expectedSignerAddress.toLowerCase());

  return [
    { label: 'Role', value: registryRecord.roleLabel },
    { label: 'Sig status', value: sigStatus },
    { label: 'Role registry status', value: registryRecord.status + (roleStatus.allowed ? '' : ` — ${roleStatus.reason}`) },
    { label: 'Registry version', value: registryRecord.registryVersion },
    { label: 'Registry expected signer', value: registryRecord.expectedSignerAddress },
    ...(drift.hasDrift
      ? [{ label: 'Role drift — stored signer', value: storedExpected ?? 'Not configured' }]
      : storedExpected
        ? [{ label: 'Stored expected signer', value: storedExpected }]
        : []),
    ...(connectedAddr ? [{ label: 'Connected wallet', value: connectedAddr + (walletMatchesRole ? ' ✓ matches role' : ' ≠ role expected') }] : []),
    { label: 'Recovered signer', value: recoveredSigner ?? 'Not signed yet' },
    ...(recoveredSigner ? [{ label: 'Signer matches registry', value: signerMatchesRegistry ? 'Match' : 'Mismatch' }] : []),
    { label: 'Signed at', value: formatDateTime(signedAt) },
    { label: 'Verification method', value: 'EIP-712 ECDSA (ethers.verifyTypedData)' },
    ...(sigStatus === 'invalid' && binding.signatureMismatchReason
      ? [{ label: 'Mismatch reason', value: binding.signatureMismatchReason }]
      : []),
  ];
}

function roleStatusTone(status: RoleAuthorityRecord['status']): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'rotation_pending') return 'warning';
  return 'danger';
}

function RoleAuthorityRegistrySection() {
  const allActive = ROLE_AUTHORITY_REGISTRY.every(r => r.status === 'active');
  return (
    <SectionCard title="Role Authority Registry" icon={<ShieldCheck size={18} />}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="data-chip" data-tone="purple">{ROLE_AUTHORITY_REGISTRY[0].registryVersion}</span>
        <span className="data-chip">{ROLE_AUTHORITY_REGISTRY.length} roles</span>
        <span className="data-chip" data-tone={allActive ? 'success' : 'warning'}>
          drift: {allActive ? 'none' : 'detected'}
        </span>
        {ROLE_AUTHORITY_REGISTRY.map(role => (
          <span key={role.roleId} className="data-chip" data-tone={role.status === 'active' ? 'success' : role.status === 'rotation_pending' ? 'warning' : 'danger'}>
            {role.roleLabel}: {role.status}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}

function BatchAuthorityBindingSection({
  batch,
  onSignAsRole,
  onAnchorBinding,
  isAnchoring,
  anchorError,
  signingRole,
  signingError,
  onChainRoleAuthorities,
  onRoleAuthoritiesInitialized,
  signerServicesConfigured,
}: {
  batch: EscrowBatch;
  onSignAsRole?: (batch: EscrowBatch, role: BatchAuthoritySignerRole) => void;
  onAnchorBinding?: (batch: EscrowBatch) => void;
  isAnchoring?: boolean;
  anchorError?: string | null;
  signingRole?: string;
  signingError?: string | null;
  onChainRoleAuthorities?: OnChainRoleAuthorities | null;
  onRoleAuthoritiesInitialized?: () => void;
  signerServicesConfigured?: { treasury: boolean; escrow: boolean };
}) {
  const isRequired = requiresBatchAuthorityBinding(batch);
  const binding = batch.batchAuthorityBinding;
  const validation = getBatchAuthorityBindingValidation(batch);
  const isValid = validation.state === 'valid';
  const sigStatus = binding ? getBatchAuthoritySignatureStatus(binding) : null;
  const fullySigned = binding ? isBatchAuthorityFullySigned(binding) : false;
  const effectiveAnchorStatus = binding?.anchorStatus ?? 'pending_onchain_anchor';

  // Detect connected browser wallet (for enabling sign buttons in non-dev mode)
  const [connectedAddress, setConnectedAddress] = useState('');
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    setConnectedAddress((eth.selectedAddress ?? '').toLowerCase());
    const handle = (accounts: string[]) => setConnectedAddress((accounts[0] ?? '').toLowerCase());
    eth.on?.('accountsChanged', handle);
    return () => eth.removeListener?.('accountsChanged', handle);
  }, []);

  if (!isRequired) {
    return (
      <SectionCard title="Batch Authority Binding" icon={<Lock size={18} />}>
        <div className="panel-note">EIP-712 Batch Authority Binding is generated automatically when a Treasury batch is registered.</div>
      </SectionCard>
    );
  }

  if (!binding) {
    return (
      <SectionCard title="Batch Authority Binding" icon={<Lock size={18} />}>
        <div className="panel-note">EIP-712 Batch Authority Binding is generated automatically when a real Treasury/Vault batch is registered.</div>
      </SectionCard>
    );
  }

  const domain = binding.eip712Domain;
  const types = binding.eip712Types;
  const payload = binding.canonicalPayload;
  const typedPayloadText = JSON.stringify({ domain, types, message: payload }, null, 2);

  const isMismatch = validation.state === 'mismatch';
  const tvAuthority = getTreasuryVaultAuthority();
  const escrowAuthority = getEscrowAuthority();

  // Prefer on-chain role data; fall back to local registry for dev display.
  const onChainTv = onChainRoleAuthorities?.treasury;
  const onChainEscrow = onChainRoleAuthorities?.escrow;
  const signerSource = onChainTv?.exists && onChainEscrow?.exists ? 'on-chain' : 'local-dev';

  const [isInitializingRoles, setIsInitializingRoles] = useState(false);
  const [initRolesError, setInitRolesError] = useState<string | null>(null);
  const [initRolesSuccess, setInitRolesSuccess] = useState(false);

  const initializeRoleAuthorities = async () => {
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress)) {
      setInitRolesError('InvestmentEscrow address is not configured.');
      return;
    }
    const eth = (window as any).ethereum;
    if (!eth) {
      setInitRolesError('No browser wallet connected.');
      return;
    }
    setIsInitializingRoles(true);
    setInitRolesError(null);
    setInitRolesSuccess(false);
    try {
      const provider = new BrowserProvider(eth);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const contract = new Contract(escrowAddress, BATCH_AUTHORITY_ANCHOR_ABI, signer);
      const rolesToInit = [
        { id: 0, record: getTreasuryVaultAuthority(), existing: onChainRoleAuthorities?.treasury },
        { id: 1, record: getEscrowAuthority(), existing: onChainRoleAuthorities?.escrow },
        { id: 2, record: getContinuityAuthority(), existing: onChainRoleAuthorities?.continuitySce },
      ];
      for (const { id, record, existing } of rolesToInit) {
        if (existing?.exists) continue;
        const tx = await contract.setRoleAuthority(id, record.expectedSignerAddress, 0);
        await tx.wait();
      }
      setInitRolesSuccess(true);
      onRoleAuthoritiesInitialized?.();
    } catch (err: any) {
      setInitRolesError(err?.reason ?? err?.message ?? 'Failed to initialize role authorities.');
    } finally {
      setIsInitializingRoles(false);
    }
  };

  const tvExpectedSigner = (onChainTv?.exists ? onChainTv.signer : tvAuthority.expectedSignerAddress).toLowerCase();
  const escrowExpectedSigner = (onChainEscrow?.exists ? onChainEscrow.signer : escrowAuthority.expectedSignerAddress).toLowerCase();

  // Role status: prefer on-chain status, fall back to local registry.
  const tvRoleStatus = onChainTv?.exists
    ? { allowed: onChainTv.status === 'active', reason: onChainTv.status === 'frozen' ? 'Role is frozen' : onChainTv.status === 'retired' ? 'Role is retired' : undefined }
    : isRoleSigningAllowed(tvAuthority);
  const escrowRoleStatus = onChainEscrow?.exists
    ? { allowed: onChainEscrow.status === 'active', reason: onChainEscrow.status === 'frozen' ? 'Role is frozen' : onChainEscrow.status === 'retired' ? 'Role is retired' : undefined }
    : isRoleSigningAllowed(escrowAuthority);

  const walletMatchesTreasury = Boolean(connectedAddress && connectedAddress === tvExpectedSigner);
  const walletMatchesEscrow = Boolean(connectedAddress && connectedAddress === escrowExpectedSigner);

  // Anchor requires on-chain role authorities to be set, or the escrow signer service to be configured.
  const onChainRolesAvailable = Boolean(onChainTv?.exists && onChainEscrow?.exists);
  const canAnchorOnChain = onChainRolesAvailable || Boolean(signerServicesConfigured?.escrow);

  // When signer services are configured, signing is always available (no wallet match required).
  const tvServiceMode = Boolean(signerServicesConfigured?.treasury);
  const escrowServiceMode = Boolean(signerServicesConfigured?.escrow);

  const canSignAsTreasury = !isMismatch &&
    binding.treasurySignatureStatus !== 'signed' &&
    tvRoleStatus.allowed &&
    (tvServiceMode || walletMatchesTreasury);
  const canSignAsEscrow = !isMismatch &&
    binding.escrowSignatureStatus !== 'signed' &&
    escrowRoleStatus.allowed &&
    (escrowServiceMode || walletMatchesEscrow);

  const treasuryDisabledReason = binding.treasurySignatureStatus === 'signed' ? 'Already signed' :
    isMismatch ? 'Binding mismatch' :
    !tvRoleStatus.allowed ? tvRoleStatus.reason :
    !tvServiceMode && !walletMatchesTreasury ? 'Connected wallet does not match expected role signer' :
    null;
  const escrowDisabledReason = binding.escrowSignatureStatus === 'signed' ? 'Already signed' :
    isMismatch ? 'Binding mismatch' :
    !escrowRoleStatus.allowed ? escrowRoleStatus.reason :
    !escrowServiceMode && !walletMatchesEscrow ? 'Connected wallet does not match expected role signer' :
    null;

  const isSigningTreasury = signingRole === 'treasury';
  const isSigningEscrow = signingRole === 'escrow';

  return (
    <SectionCard title="Batch Authority Binding" icon={<Lock size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge
          label={
            fullySigned && isValid ? 'Authority Binding Signed' :
            isValid ? validation.label :
            validation.label
          }
          state={
            sigStatus?.overallStatus === 'invalid' ? 'exception' :
            fullySigned && isValid ? 'passed' :
            isMismatch ? 'blocked' :
            'pending'
          }
        />
        <EvidencePopover title="Treasury/Vault Signature" rows={getSigBadgeEvidence(batch, 'treasury')}>
          <span className="cursor-pointer">
            <StatusBadge label={`Treasury sig: ${binding.treasurySignatureStatus}`} tone={sigStatusTone(binding.treasurySignatureStatus)} />
          </span>
        </EvidencePopover>
        <EvidencePopover title="Escrow Signature" rows={getSigBadgeEvidence(batch, 'escrow')}>
          <span className="cursor-pointer">
            <StatusBadge label={`Escrow sig: ${binding.escrowSignatureStatus}`} tone={sigStatusTone(binding.escrowSignatureStatus)} />
          </span>
        </EvidencePopover>
        <span className="data-chip" data-tone={effectiveAnchorStatus === 'anchored' ? 'success' : effectiveAnchorStatus === 'binding_mismatch' ? 'danger' : 'purple'}>
          {effectiveAnchorStatus === 'anchored' ? 'On-chain Anchored' : effectiveAnchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending On-chain Anchor'}
        </span>
        <span className="data-chip">EIP-712</span>
        <span className="data-chip" title={`EVM chain ID: ${binding.canonicalPayload.chainId}`}>
          Chain {binding.canonicalPayload.chainId} · {binding.networkLabel}
        </span>
        <span
          className="data-chip"
          data-tone={signerSource === 'on-chain' ? 'success' : 'warning'}
          title={signerSource === 'on-chain' ? 'Expected signers loaded from on-chain role registry' : 'On-chain role registry not set — using local-dev signer config'}
        >
          Role signers: {signerSource === 'on-chain' ? 'On-chain' : 'Local-dev fallback'}
        </span>
        <span className="data-chip" data-tone="purple">Role Authority Registry {ROLE_AUTHORITY_REGISTRY[0].registryVersion}</span>
        {signerServicesConfigured?.treasury || signerServicesConfigured?.escrow ? (
          <span className="data-chip" data-tone="success" title="Autonomous signer services are configured — signing and anchoring are performed server-side">
            Autonomous signing
          </span>
        ) : null}
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">EIP-712 Domain</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Name" value={domain.name} />
          <Field label="Version" value={domain.version} />
          <Field label="Chain ID" value={String(domain.chainId)} />
          <Field label="Verifying contract" value={<span className="font-mono">{shortHash(domain.verifyingContract)}</span>} />
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Canonical payload fields</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Escrow batch ID" value={payload.escrowBatchId} />
          <Field label="Source type" value={payload.sourceType === 'vault' ? 'Vault' : 'Treasury'} />
          <Field label="Source contract" value={<span className="font-mono">{shortHash(payload.sourceContractAddress)}</span>} />
          <Field label="Active Treasury" value={<span className="font-mono">{shortHash(payload.activeTreasuryAddress)}</span>} />
          <Field label="Active Vault" value={<span className="font-mono">{shortHash(payload.activeVaultAddress)}</span>} />
          <Field label="Active Escrow" value={<span className="font-mono">{shortHash(payload.activeEscrowAddress)}</span>} />
          <Field label="DAO registry version" value={payload.daoSystemRegistryVersion} />
          <Field label="System map hash" value={<span className="font-mono">{shortHash(payload.systemMapHash)}</span>} />
          <Field label="Source batch ID" value={payload.sourceBatchId} />
          <Field label="Custody mode" value={payload.custodyMode} />
          <Field label="Asset" value={payload.asset} />
          <Field label="Total amount" value={fmtUsd(payload.totalAmountUsd)} />
          <Field label="Term" value={`${payload.termMonths} months`} />
          <Field label="Chain ID (EVM, uint256)" value={String(payload.chainId)} />
          <Field label="Network label" value={binding.networkLabel} />
          <Field label="Manifest hash" value={<span className="font-mono">{shortHash(payload.depositManifestHash)}</span>} />
          {payload.allocationPlanHash ? (
            <Field label="Allocation plan hash" value={<span className="font-mono">{shortHash(payload.allocationPlanHash)}</span>} />
          ) : null}
          {payload.policyContextHash ? (
            <Field label="Policy context hash" value={<span className="font-mono">{shortHash(payload.policyContextHash)}</span>} />
          ) : null}
          <Field label="Nonce (uint256)" value={<span className="font-mono">{shortHash(payload.nonce)}</span>} />
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Binding hash (EIP-712 typed data hash)</div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-950/50 px-3 py-2 font-mono text-xs text-[var(--gold-300)] break-all">
          {binding.batchAuthorityBindingHash}
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Authority signatures</div>

        {connectedAddress ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/35 px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Connected wallet</span>
            <span className="font-mono text-xs text-slate-300">{connectedAddress}</span>
            {walletMatchesTreasury ? <span className="data-chip" data-tone="success">Treasury/Vault role</span> : null}
            {walletMatchesEscrow ? <span className="data-chip" data-tone="success">Escrow role</span> : null}
            {!walletMatchesTreasury && !walletMatchesEscrow ? <span className="data-chip" data-tone="warning">No role match</span> : null}
          </div>
        ) : (
          <div className="mb-3 rounded-lg border border-slate-700/50 bg-slate-900/35 px-3 py-2 text-xs text-amber-200">
            No wallet connected — connect a browser wallet matching an expected role signer address to sign.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(['treasury', 'escrow'] as const).map((role) => {
            const sigSt = role === 'treasury' ? binding.treasurySignatureStatus : binding.escrowSignatureStatus;
            const storedExpected = role === 'treasury' ? binding.treasurySignerAddress : binding.escrowSignerAddress;
            const recoveredAddr = role === 'treasury' ? binding.treasuryRecoveredSignerAddress : binding.escrowRecoveredSignerAddress;
            const signedAt = role === 'treasury' ? binding.treasurySignedAt : binding.escrowSignedAt;
            const registryRecord = role === 'treasury' ? tvAuthority : escrowAuthority;
            const roleCheck = role === 'treasury' ? tvRoleStatus : escrowRoleStatus;
            const walletMatches = role === 'treasury' ? walletMatchesTreasury : walletMatchesEscrow;
            const disabledReason = role === 'treasury' ? treasuryDisabledReason : escrowDisabledReason;
            const drift = detectRoleAuthorityDrift(role, storedExpected);
            const effectiveExpected = role === 'treasury' ? tvExpectedSigner : escrowExpectedSigner;
            const signerMatchesRegistry = Boolean(recoveredAddr && recoveredAddr.toLowerCase() === effectiveExpected);
            return (
              <div key={role} className={`rounded-lg border p-3 ${
                !roleCheck.allowed ? 'border-[rgba(236,86,86,0.38)] bg-[rgba(60,20,20,0.42)]' :
                sigSt === 'invalid' ? 'border-[rgba(236,86,86,0.38)] bg-[rgba(60,20,20,0.42)]' :
                sigSt === 'signed' ? 'border-[rgba(34,197,94,0.28)] bg-[rgba(10,50,20,0.28)]' :
                'border-slate-700/50 bg-slate-900/35'
              }`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-100">{registryRecord.roleLabel}</span>
                  <div className="flex items-center gap-1.5">
                    {!roleCheck.allowed ? (
                      <StatusBadge label={titleCase(registryRecord.status.replace(/_/g, ' '))} tone="danger" />
                    ) : (
                      <StatusBadge label={titleCase(sigSt)} tone={sigStatusTone(sigSt)} />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-[0.14em] text-slate-500">
                      Expected signer ({signerSource === 'on-chain' ? 'on-chain' : 'local-dev'})
                    </span>
                    <span className="break-all font-mono text-slate-300">
                      {role === 'treasury' ? tvExpectedSigner : escrowExpectedSigner}
                    </span>
                    {signerSource === 'on-chain' && (
                      <span className="text-[10px] text-slate-500">
                        Updated {role === 'treasury'
                          ? (onChainTv?.updatedAt ? new Date(onChainTv.updatedAt).toLocaleDateString() : '—')
                          : (onChainEscrow?.updatedAt ? new Date(onChainEscrow.updatedAt).toLocaleDateString() : '—')}
                        {' '}by {role === 'treasury'
                          ? (onChainTv?.updatedBy ? onChainTv.updatedBy.slice(0, 10) + '…' : '—')
                          : (onChainEscrow?.updatedBy ? onChainEscrow.updatedBy.slice(0, 10) + '…' : '—')}
                      </span>
                    )}
                  </div>
                  {drift.hasDrift ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-amber-500">Role drift — stored signer differs</span>
                      <span className="break-all font-mono text-amber-300">{storedExpected}</span>
                    </div>
                  ) : null}
                  {connectedAddress ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-slate-500">Connected wallet</span>
                      <span className={`break-all font-mono ${walletMatches ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {connectedAddress} {walletMatches ? '✓' : '≠ expected'}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-[0.14em] text-slate-500">Recovered signer</span>
                    <span className={`break-all font-mono ${recoveredAddr ? (signerMatchesRegistry ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-500'}`}>
                      {recoveredAddr ?? 'Not signed yet'}
                      {recoveredAddr ? (signerMatchesRegistry ? ' ✓' : ' ✗ mismatch') : ''}
                    </span>
                  </div>
                  {signedAt ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-[0.14em] text-slate-500">Signed at</span>
                      <span className="text-slate-300">{formatDateTime(signedAt)}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-[0.14em] text-slate-500">Registry version</span>
                    <span className="text-slate-400">{registryRecord.registryVersion}</span>
                  </div>
                  {disabledReason && sigSt !== 'signed' ? (
                    <div className="mt-1 rounded bg-amber-900/30 px-2 py-1 text-[10px] text-amber-200">
                      {disabledReason}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Overall:</span>
          <StatusBadge
            label={sigStatus?.overallStatus === 'signed' ? 'Both Signed' : sigStatus?.overallStatus === 'partial' ? 'Partial' : sigStatus?.overallStatus === 'invalid' ? 'Invalid' : 'Pending Signatures'}
            tone={sigStatus?.overallStatus === 'signed' ? 'success' : sigStatus?.overallStatus === 'invalid' ? 'danger' : 'warning'}
          />
          <span className="text-[11px] text-slate-500">On-chain:</span>
          <StatusBadge
            label={effectiveAnchorStatus === 'anchored' ? 'Anchored' : effectiveAnchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending Anchor'}
            tone={effectiveAnchorStatus === 'anchored' ? 'success' : effectiveAnchorStatus === 'binding_mismatch' ? 'danger' : 'warning'}
          />
          {binding.signatureVerificationStatus ? (
            <>
              <span className="text-[11px] text-slate-500">Verified:</span>
              <StatusBadge
                label={titleCase(binding.signatureVerificationStatus)}
                tone={binding.signatureVerificationStatus === 'verified' ? 'success' : binding.signatureVerificationStatus === 'invalid' ? 'danger' : 'warning'}
              />
            </>
          ) : null}
        </div>

        {onSignAsRole && process.env.NEXT_PUBLIC_DEV_SIGNING_TOOLS === 'true' ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded border border-rose-500/50 bg-rose-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-300">
              DEV ONLY
            </span>
            <button
              type="button"
              className="action-button action-button--secondary inline-flex items-center gap-2"
              disabled={!canSignAsTreasury || isSigningTreasury || isSigningEscrow}
              aria-disabled={!canSignAsTreasury || isSigningTreasury || isSigningEscrow}
              onClick={() => onSignAsRole(batch, 'treasury')}
            >
              <KeyRound size={15} />
              {isSigningTreasury ? 'Signing…' : 'Sign as Treasury/Vault'}
            </button>
            <button
              type="button"
              className="action-button action-button--secondary inline-flex items-center gap-2"
              disabled={!canSignAsEscrow || isSigningTreasury || isSigningEscrow}
              aria-disabled={!canSignAsEscrow || isSigningTreasury || isSigningEscrow}
              onClick={() => onSignAsRole(batch, 'escrow')}
            >
              <KeyRound size={15} />
              {isSigningEscrow ? 'Signing…' : 'Sign as Escrow'}
            </button>
          </div>
        ) : null}

        {signerSource === 'local-dev' ? (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
            <div className="mb-2 text-[11px] font-semibold text-amber-200">
              On-chain role registry not initialized
            </div>
            <p className="mb-3 text-[11px] text-amber-300/80">
              The redeployed InvestmentEscrow has no role authorities set. Connect the contract owner wallet and click below to call{' '}
              <span className="font-mono">setRoleAuthority</span> for all three roles (Treasury/Vault, Escrow, Continuity) using the local registry signer addresses.
            </p>
            <div className="mb-2 grid grid-cols-1 gap-1 text-[10px] font-mono text-amber-400/70">
              {[
                { id: 0, label: 'ROLE_TREASURY_VAULT (0)', record: getTreasuryVaultAuthority(), existing: onChainRoleAuthorities?.treasury },
                { id: 1, label: 'ROLE_ESCROW (1)', record: getEscrowAuthority(), existing: onChainRoleAuthorities?.escrow },
                { id: 2, label: 'ROLE_CONTINUITY_SCE (2)', record: getContinuityAuthority(), existing: onChainRoleAuthorities?.continuitySce },
              ].map(({ id, label, record, existing }) => (
                <div key={id} className="flex items-center gap-2">
                  <span className={existing?.exists ? 'text-emerald-400' : 'text-amber-400'}>
                    {existing?.exists ? '✓' : '○'} {label}
                  </span>
                  <span className="text-slate-400">→ {record.expectedSignerAddress}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="action-button action-button--secondary inline-flex items-center gap-2 text-[11px]"
                disabled={isInitializingRoles || initRolesSuccess}
                aria-disabled={isInitializingRoles || initRolesSuccess}
                onClick={initializeRoleAuthorities}
              >
                <KeyRound size={13} />
                {isInitializingRoles ? 'Initializing…' : initRolesSuccess ? 'Roles initialized' : 'Initialize Role Authorities'}
              </button>
              {initRolesSuccess ? (
                <span className="text-[11px] text-emerald-300">Done — refresh to confirm On-chain badge.</span>
              ) : null}
            </div>
            {initRolesError ? (
              <div className="mt-2 rounded bg-rose-900/30 px-2 py-1.5 text-[10px] text-rose-200">
                {initRolesError}
              </div>
            ) : null}
          </div>
        ) : null}

        {onAnchorBinding && binding.anchorStatus === 'pending_onchain_anchor' && isValid && fullySigned ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canAnchorOnChain ? (
              <button
                type="button"
                className="action-button action-button--primary inline-flex items-center gap-2"
                disabled={isAnchoring}
                aria-disabled={isAnchoring}
                onClick={() => onAnchorBinding(batch)}
              >
                <Anchor size={15} />
                {isAnchoring ? 'Anchoring…' : 'Anchor Batch Authority Binding'}
              </button>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-200">
                Anchor blocked — on-chain role authority registry not set. Initialize role authorities above before anchoring.
              </div>
            )}
            <span className="text-[11px] text-slate-400">
              Locks the batchAuthorityBindingHash on-chain for sourceBatchId {binding.canonicalPayload.sourceBatchId}.
            </span>
          </div>
        ) : null}

        {anchorError ? (
          <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
            <span className="font-semibold">Anchor Error:</span> {anchorError}
          </div>
        ) : null}

        {binding.anchorStatus === 'anchored' ? (
          <div className="mt-3 rounded-lg border border-[rgba(34,197,94,0.28)] bg-[rgba(10,50,20,0.28)] p-3 text-sm text-emerald-100">
            <div className="mb-1 font-semibold">On-chain Anchored</div>
            {binding.anchorTxHash ? (
              <div className="font-mono text-xs text-emerald-300">Tx: {binding.anchorTxHash}</div>
            ) : null}
            {binding.anchorBlockNumber != null ? (
              <div className="text-xs text-emerald-400">Block: {binding.anchorBlockNumber}</div>
            ) : null}
            {binding.anchoredAt ? (
              <div className="text-xs text-emerald-400">Anchored: {formatDateTime(binding.anchoredAt)}</div>
            ) : null}
          </div>
        ) : null}

        {effectiveAnchorStatus === 'binding_mismatch' ? (
          <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
            <span className="font-semibold">Binding Mismatch:</span> On-chain anchor for this sourceBatchId has a different hash. This batch is blocked.
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">EIP-712 typed payload (domain + types + message)</div>
        <pre className="max-h-80 overflow-auto rounded-lg border border-slate-700/50 bg-slate-950/50 p-3 font-mono text-xs leading-5 text-slate-300">
          {typedPayloadText}
        </pre>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Created by" value={binding.createdBy} />
        <Field label="Created at" value={formatDateTime(binding.createdAt)} />
      </div>

      {isMismatch && validation.blockingReason ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
          <span className="font-semibold">Binding Mismatch:</span> {validation.blockingReason}
        </div>
      ) : null}

      {sigStatus?.overallStatus === 'invalid' && binding.signatureMismatchReason ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
          <span className="font-semibold">Signature Mismatch:</span> {binding.signatureMismatchReason}
        </div>
      ) : null}

      {signingError ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-sm text-rose-100">
          <span className="font-semibold">Signing Error:</span> {signingError}
        </div>
      ) : null}
    </SectionCard>
  );
}

function allocationStatusTone(status: EscrowBatch['aaaAllocation']['status']): 'passed' | 'pending' | 'blocked' | 'exception' {
  switch (status) {
    case 'validated':
    case 'locked':
    case 'deployed':
      return 'passed';
    case 'requesting':
    case 'pending_anchor':
    case 'computed':
    case 'chain_only':
    case 'attached':
      return 'pending';
    case 'hash_mismatch':
    case 'failed':
      return 'blocked';
    default:
      return 'pending';
  }
}

function allocationStatusLabel(status: EscrowBatch['aaaAllocation']['status']): string {
  switch (status) {
    case 'missing':        return 'Pending';
    case 'requesting':     return 'Requesting…';
    case 'computed':       return 'Computed — Pending Anchor';
    case 'pending_anchor': return 'Anchoring…';
    case 'validated':      return 'Validated';
    case 'chain_only':     return 'Chain Only — Payload Missing';
    case 'hash_mismatch':  return 'Hash Mismatch';
    case 'failed':         return 'Failed';
    case 'attached':       return 'Pending Chain Validation';
    case 'locked':         return 'Locked';
    case 'deployed':       return 'Deployed';
    default:               return titleCase(status);
  }
}

function DestinationApprovalPreviewSection({
  batch,
  targetWeights,
}: {
  batch: EscrowBatch;
  targetWeights?: Record<string, number>;
}) {
  const { selectedChain } = useProtocolChain();
  const [rows, setRows] = useState<DestinationApprovalPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isValidated = hasValidatedAaaAllocation(batch);
  const registryAddress = getRuntimeAddress('PortfolioRegistry');
  const weightKey = targetWeights ? JSON.stringify(targetWeights) : '';
  const allApproved = rows.length > 0 && rows.every((row) => row.status === 'Approved');
  const destinationApprovalRecord = useMemo(
    () => (isValidated ? buildDestinationApprovalRecord(batch, rows) : null),
    [batch, isValidated, rows]
  );

  useEffect(() => {
    let cancelled = false;

    if (!isValidated || !targetWeights || Object.keys(targetWeights).length === 0) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!selectedChain?.rpcUrl || !isValidAddress(registryAddress)) {
      setRows([]);
      setError('PortfolioRegistry address is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    readDestinationApprovalPreviewRows({
      rpcUrl: selectedChain.rpcUrl,
      registryAddress,
      targetWeights,
      totalAmountUsd: batch.totalAmountUsd,
    }).then((nextRows) => {
      if (cancelled) return;
      setRows(nextRows);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setRows([]);
      setError((err as Error)?.message ?? 'Failed to read DAO-approved destinations.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [batch.batchId, batch.totalAmountUsd, isValidated, registryAddress, selectedChain?.rpcUrl, weightKey]);

  if (!isValidated && !targetWeights) return null;

  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Destination Approval Preview</div>
        {loading ? <span className="data-chip">Loading destinations…</span> : null}
      </div>

      {!isValidated ? (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          AAA allocation must be validated before destination preview is available.
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-slate-400">
          No validated AAA allocation legs are available for destination preview.
        </div>
      ) : (
        <>
          {allApproved ? (
            <div className="mb-3 rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-xs text-emerald-200">
              <div className="font-semibold">All AAA allocation legs have DAO-approved destinations.</div>
              {destinationApprovalRecord?.destinationApprovalHash ? (
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <div>
                    <span className="text-emerald-300">Destination Approval: </span>
                    <span className="font-semibold">Ready</span>
                  </div>
                  <div className="break-all font-mono">
                    <span className="text-emerald-300">Destination Approval Hash: </span>
                    {destinationApprovalRecord.destinationApprovalHash}
                  </div>
                </div>
              ) : destinationApprovalRecord?.blockingReason ? (
                <div className="mt-2 text-amber-200">{destinationApprovalRecord.blockingReason}</div>
              ) : null}
            </div>
          ) : destinationApprovalRecord?.missingAssets.length ? (
            <div className="mb-3 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs font-semibold text-amber-200">
              Destination Approval: Missing Destination for {destinationApprovalRecord.missingAssets.join(', ')}.
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-slate-700/40">
            <table className="w-full min-w-[980px] text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2">Approved Destination</th>
                  <th className="px-3 py-2">Destination Type</th>
                  <th className="px-3 py-2">Destination Address</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.asset} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                    <td className="px-3 py-2 font-mono font-semibold text-slate-100">{row.asset}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(row.amountUsd)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--gold-300)]">
                      {(row.weight * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-200">{row.approvedDestination}</td>
                    <td className="px-3 py-2 text-slate-300">{row.destinationType}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">
                      {isValidAddress(row.destinationAddress) ? shortHash(row.destinationAddress) : 'Not configured'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        label={row.status}
                        tone={row.status === 'Approved' ? 'success' : 'warning'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AaaAllocationSection({
  batch,
  evidence = {},
  currentPhase = 0,
}: {
  batch: EscrowBatch;
  evidence?: Record<number, import('../BatchLifecycleCard').PhaseEvidenceRow>;
  currentPhase?: number;
}) {
  // Phase 5 evidence takes precedence over session-side batch fields when present.
  // This prevents "Request AAA Allocation" from showing after Phase 5 has completed.
  const p5Evidence = evidence[5];
  const p5ev = p5Evidence?.evidence_json as Record<string, unknown> | undefined;
  const phase5Complete = currentPhase >= 5;
  const phase5EvidencePresent = Boolean(p5Evidence);

  // When Phase 5 is complete but evidence is missing: show integrity fault immediately.
  if (phase5Complete && !phase5EvidencePresent) {
    return (
      <SectionCard title="AAA Allocation" icon={<ShieldCheck size={18} />}>
        <EvidenceIntegrityFault phase={5} label="Phase 5 (AAA Allocation)" currentPhase={currentPhase} />
      </SectionCard>
    );
  }

  // When Phase 5 evidence exists, override alloc fields from evidence to prevent stale batch object.
  const alloc = phase5Complete && p5ev ? {
    ...batch.aaaAllocation,
    status: 'validated' as const,
    allocationPlan: (p5ev.allocationPlanJson ?? batch.aaaAllocation.allocationPlan) as Record<string, unknown> | null,
    allocationPlanHash: (p5ev.allocationPlanHash as string | undefined) ?? batch.aaaAllocation.allocationPlanHash,
    policyContextHash: (p5ev.policyContextHash as string | undefined) ?? batch.aaaAllocation.policyContextHash,
    portfolioRegistryVersion: (p5ev.portfolioRegistryVersion as string | undefined) ?? batch.aaaAllocation.portfolioRegistryVersion,
    attachedAt: p5ev.attachedAt != null
      ? (typeof p5ev.attachedAt === 'number'
        ? new Date((p5ev.attachedAt as number) * 1000).toISOString()
        : String(p5ev.attachedAt))
      : batch.aaaAllocation.attachedAt,
    attachTxHash: (p5ev.attachTxHash as string | undefined) ?? batch.aaaAllocation.attachTxHash,
  } : batch.aaaAllocation;

  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const planData = alloc.allocationPlan as (Record<string, unknown> | null | undefined);
  const isPayloadMissing = alloc.status === 'chain_only' && !planData;
  const hasChainAllocationAnchor = phase5Complete || ['validated', 'attached', 'locked', 'deployed', 'chain_only', 'hash_mismatch'].includes(alloc.status);
  const isMismatch = alloc.status === 'hash_mismatch';

  const targetWeights = planData?.target_weights as Record<string, number> | undefined;
  const roleByAsset   = planData?.role_by_asset  as Record<string, string> | undefined;
  const scoreTrace    = planData?.score_trace_by_asset as Record<string, Record<string, unknown>> | undefined;
  const metaData      = planData?.meta as Record<string, unknown> | undefined;
  const legCount      = targetWeights ? Object.keys(targetWeights).length : null;

  const planJson = planData ? JSON.stringify(planData, null, 2) : null;
  let recomputedPlanHash = '';
  let canonicalPlanJson: string | null = null;
  try {
    if (planData) {
      const cpd = canonicalPlanFields(planData as any);
      recomputedPlanHash = canonicalKeccak(cpd);
      canonicalPlanJson = JSON.stringify(cpd, null, 2);
    }
  } catch { /* ignore */ }
  const planHashMatches = Boolean(
    recomputedPlanHash && alloc.allocationPlanHash &&
    recomputedPlanHash.toLowerCase() === alloc.allocationPlanHash.toLowerCase()
  );

  const copyJson = () => {
    if (!planJson) return;
    navigator.clipboard.writeText(planJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Pre-phase-5: awaiting Phase 5 execution. Post-phase-5: anchored read-only.
  const showAnchoredState = hasChainAllocationAnchor;

  const rawJsonToggle = (planData || alloc.allocationPlanHash) ? (
    <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-900/40">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-200"
          onClick={() => setJsonExpanded((v) => !v)}
        >
          <FileCheck size={13} />
          {jsonExpanded ? 'Hide' : 'Show'} raw plan JSON (tick_v1 evidence)
          <span className="ml-1 text-slate-600">{jsonExpanded ? '▲' : '▼'}</span>
        </button>
        {planJson && (
          <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300" onClick={copyJson}>
            {copied ? '✓ Copied' : 'Copy JSON'}
          </button>
        )}
      </div>
      {jsonExpanded && (
        <div className="border-t border-slate-700/40 px-4 pb-4 pt-3">
          {planJson ? (
            <div className="space-y-4">
              <div className="rounded border border-slate-700/40 bg-[rgba(0,0,0,0.25)] p-3 text-[11px]">
                <div className="mb-2 font-semibold uppercase tracking-[0.12em] text-slate-400">Hash Evidence</div>
                <div className="space-y-1 break-all font-mono text-slate-300">
                  <div><span className="text-slate-500">allocationPlanHash: </span>{alloc.allocationPlanHash || '—'}</div>
                  <div><span className="text-slate-500">recomputedHash:     </span>{recomputedPlanHash || '—'}</div>
                  <div>
                    <span className="text-slate-500">verification:       </span>
                    <span className={planHashMatches ? 'text-emerald-300' : 'text-rose-300'}>
                      {planHashMatches
                        ? hasChainAllocationAnchor ? 'MATCHES ON-CHAIN ANCHOR' : 'MATCHES COMPUTED HASH'
                        : 'HASH MISMATCH'}
                    </span>
                  </div>
                </div>
              </div>
              {canonicalPlanJson && (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Canonical JSON hashed into allocationPlanHash
                  </div>
                  <pre className="max-h-[360px] overflow-auto rounded bg-[rgba(0,0,0,0.35)] p-4 text-[11px] leading-5 text-slate-300">
                    {canonicalPlanJson}
                  </pre>
                </div>
              )}
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Full tick_v1 JSON stored in DB</div>
                <pre className="max-h-[520px] overflow-auto rounded bg-[rgba(0,0,0,0.35)] p-4 text-[11px] leading-5 text-slate-300">
                  {planJson}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded bg-[rgba(0,0,0,0.25)] p-4 text-xs">
              <p className="font-semibold text-slate-200">
                {alloc.status === 'chain_only' ? 'Chain anchor found — no DB payload.' : 'Plan payload not in DB for this session.'}
              </p>
              <div className="space-y-1 font-mono text-[11px] text-slate-400">
                <div><span className="text-slate-500">allocationPlanHash: </span>{alloc.allocationPlanHash || '—'}</div>
                <div><span className="text-slate-500">policyContextHash:  </span>{alloc.policyContextHash  || '—'}</div>
                <div><span className="text-slate-500">registryVersion:    </span>{alloc.portfolioRegistryVersion || '—'}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <SectionCard title="AAA Allocation" icon={<ShieldCheck size={18} />}>
      {/* ── Status chip bar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge label={allocationStatusLabel(alloc.status)} state={allocationStatusTone(alloc.status)} />
        {phase5EvidencePresent && <span className="data-chip text-[9px] text-emerald-300">phase5_evidence</span>}
        {isMismatch && <span className="data-chip text-rose-300">hash mismatch</span>}
        {metaData && (
          <span className="data-chip">{String(metaData.allocator ?? 'allocator')} v{String(metaData.allocator_version_effective ?? '1')}</span>
        )}
        {planData?.schema_version && <span className="data-chip font-mono">{String(planData.schema_version)}</span>}
        {legCount != null && <span className="data-chip">{legCount} legs</span>}
        {planData && alloc.allocationPlanHash && (
          <span className={`data-chip ${planHashMatches ? 'text-emerald-300' : 'text-rose-300'}`}>
            {planHashMatches ? (hasChainAllocationAnchor ? 'hash ✓ on-chain' : 'hash ✓') : 'hash ✗'}
          </span>
        )}
      </div>

      {/* ── Awaiting Phase 5 ── */}
      {!showAnchoredState && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-slate-400">
          AAA allocation will be computed and anchored on-chain when Phase 5 executes.
        </div>
      )}

      {/* ── State C: Anchored — read-only summary + per-leg table ── */}
      {showAnchoredState && (
        <div className="space-y-4">
          {/* Summary row */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(alloc.attachedAt || (planData?.timestamp as string | undefined)) && (
              <Field label="Anchored at"
                value={formatDateTime((alloc.attachedAt ?? planData?.timestamp) as string)} />
            )}
            {metaData && (
              <Field label="Algorithm"
                value={`${String(metaData.allocator ?? 'allocator')} v${String(metaData.allocator_version_effective ?? '1')}`} />
            )}
            <Field label="Plan hash"
              value={
                <span className="flex items-center gap-1.5">
                  <span className="break-all font-mono text-[11px] text-[var(--gold-300)]">
                    {alloc.allocationPlanHash ? `${alloc.allocationPlanHash.slice(0, 10)}…` : '—'}
                  </span>
                  {planHashMatches && <span className="data-chip text-[9px] text-emerald-300">verified</span>}
                  {alloc.allocationPlanHash && !planHashMatches && recomputedPlanHash && (
                    <span className="data-chip text-[9px] text-rose-300">mismatch</span>
                  )}
                </span>
              }
            />
            {legCount != null && <Field label="Legs" value={String(legCount)} />}
            {alloc.targetYieldBps != null && <Field label="Target yield" value={`${alloc.targetYieldBps} bps`} />}
            {alloc.attachTxHash && (
              <Field label="Attach tx"
                value={<span className="font-mono text-[11px]">{shortHash(alloc.attachTxHash)}</span>} />
            )}
          </div>

          {/* Per-leg allocation table */}
          {targetWeights && roleByAsset && (
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Allocation Legs</div>
              <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2 text-right">%</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">Target Yield</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(targetWeights)
                      .sort(([, a], [, b]) => b - a)
                      .map(([symbol, weight]) => {
                        const trace = scoreTrace?.[symbol];
                        const yieldEr = trace?.expected_return_used_role_adj;
                        return (
                          <tr key={symbol} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                            <td className="px-3 py-2 text-slate-400">{roleByAsset[symbol] ?? '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-100">{symbol}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--gold-300)]">
                              {(weight * 100).toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{fmtUsd(weight * batch.totalAmountUsd)}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-300">
                              {yieldEr != null ? `${(Number(yieldEr) * 100).toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isMismatch && (
            <div className="rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
              <p className="mb-1 font-semibold">Hash mismatch — PortfolioRegistry has changed since this allocation was anchored.</p>
              <p className="mb-2 text-rose-200">
                The deterministic allocator produced a different hash with the current registry state.
                A new Phase 5 execution is required to re-anchor.
              </p>
              <p className="font-mono text-[11px]">
                <span className="text-rose-400">On-chain: </span>{alloc.allocationPlanHash}
              </p>
            </div>
          )}

          {isPayloadMissing && (
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">
              Chain anchor found — full tick JSON not in DB. Re-run Phase 5 to re-anchor with current registry state.
            </div>
          )}

          {rawJsonToggle}
        </div>
      )}
    </SectionCard>
  );
}

type CheckItem = { label: string; ok: boolean; detail?: string };

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {item.ok
        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
        : <XCircle     size={14} className="mt-0.5 shrink-0 text-rose-400" />}
      <span className={`text-xs ${item.ok ? 'text-slate-300' : 'text-rose-300'}`}>
        {item.label}
        {item.detail ? <span className="ml-1 font-mono text-slate-500">{item.detail}</span> : null}
      </span>
    </div>
  );
}

function buildDestinationChecklist(batch: EscrowBatch): {
  batchChecks: CheckItem[];
  legChecks: { legId: string; items: CheckItem[] }[];
} {
  const aaa = batch.aaaAllocation;
  const fundingState = getFundingValidation(batch).state;
  const deploymentLegs = getDeploymentLegsForDestinationApproval(batch);

  const batchChecks: CheckItem[] = [
    { label: 'Funding verified',            ok: fundingState === 'verified',        detail: fundingState !== 'verified' ? fundingState : undefined },
    { label: 'Authority binding valid',     ok: hasValidAuthorityBinding(batch),    detail: hasValidAuthorityBinding(batch) ? undefined : getBatchAuthorityBindingValidation(batch).blockingReason ?? undefined },
    { label: 'AAA allocation validated',    ok: hasValidatedAaaAllocation(batch),   detail: aaa.status !== 'validated' ? aaa.status : undefined },
    { label: 'Allocation plan hash',        ok: Boolean(aaa.allocationPlanHash),    detail: aaa.allocationPlanHash ? shortHash(aaa.allocationPlanHash) : 'missing' },
    { label: 'Policy context hash',         ok: Boolean(aaa.policyContextHash),     detail: aaa.policyContextHash ? shortHash(aaa.policyContextHash) : 'missing' },
    { label: 'Allocation attached at',      ok: Boolean(aaa.attachedAt) || hasValidatedAaaAllocation(batch), detail: aaa.attachedAt ? undefined : hasValidatedAaaAllocation(batch) ? 'validated (timestamp unavailable)' : 'missing' },
    { label: 'Deployment legs configured',  ok: deploymentLegs.length > 0,          detail: `${deploymentLegs.length} leg(s)` },
  ];

  const legChecks = deploymentLegs.map((leg) => {
    const destination  = getDaoDestinationForLeg(batch, leg);
    const approval     = (batch.destinationApprovals ?? []).find((a) => a.legId === leg.legId);
    const batchChain   = batch.wallet.chain;
    const legAsset     = leg.assetSymbol || leg.asset || batch.asset || 'USDC';
    const attachedAt   = aaa.attachedAt;
    // When attachedAt is unavailable, treat as satisfied if hashes match (validated allocation).
    const approvedAfterAttach = !attachedAt
      ? hasValidatedAaaAllocation(batch)
      : Boolean(
          approval?.approvedAt &&
          new Date(approval.approvedAt).getTime() >= new Date(attachedAt).getTime()
        );
    const planHashMatch  = Boolean(approval && aaa.allocationPlanHash && approval.allocationPlanHash?.toLowerCase() === aaa.allocationPlanHash.toLowerCase());
    const policyHashMatch= Boolean(approval && aaa.policyContextHash  && approval.policyContextHash?.toLowerCase()  === aaa.policyContextHash.toLowerCase());

    const items: CheckItem[] = [
      { label: 'Destination in DAO registry',        ok: Boolean(destination),                                        detail: destination ? destination.destinationId : `no match for ${legAsset}/${leg.destinationType ?? leg.strategyType} on ${batchChain}` },
      { label: 'Destination DAO-approved',            ok: destination?.approvalStatus === 'dao_approved',              detail: destination?.approvalStatus },
      { label: 'Destination address configured',      ok: Boolean(destination?.destinationAddress),                   detail: destination?.destinationAddress ? shortHash(destination.destinationAddress) : 'empty — set env var' },
      { label: 'Registry version present',            ok: Boolean(destination?.destinationRegistryVersion),           detail: destination?.destinationRegistryVersion ?? 'missing' },
      { label: 'Deploy action allowed',               ok: Boolean(destination?.allowedActions?.includes('deploy_batch')), detail: destination ? undefined : 'n/a' },
      { label: `Chain match (batch: ${batchChain})`,  ok: !destination || destination.chain === batchChain,            detail: destination ? destination.chain : 'n/a' },
      { label: `Asset match (leg: ${legAsset})`,      ok: !destination || destination.asset === legAsset,              detail: destination ? destination.asset : 'n/a' },
      { label: `Amount ≤ max exposure ($${(destination?.maxExposureUsd ?? 0).toLocaleString()})`, ok: !destination || leg.amountUsd <= (destination.maxExposureUsd ?? Infinity), detail: `$${leg.amountUsd.toLocaleString()}` },
      { label: 'Approval record exists',              ok: Boolean(approval) },
      { label: 'Approval status = approved',          ok: approval?.approvalStatus === 'approved',                    detail: approval?.approvalStatus ?? 'none' },
      { label: 'Approval hash present',               ok: Boolean(approval?.destinationApprovalHash),                 detail: approval?.destinationApprovalHash ? shortHash(approval.destinationApprovalHash) : 'missing' },
      { label: 'Approval plan hash matches batch',    ok: planHashMatch,                                              detail: !approval ? 'no approval' : planHashMatch ? 'match' : `mismatch — approval: ${shortHash(approval.allocationPlanHash)}` },
      { label: 'Approval policy hash matches batch',  ok: policyHashMatch,                                            detail: !approval ? 'no approval' : policyHashMatch ? 'match' : `mismatch — approval: ${shortHash(approval.policyContextHash)}` },
      { label: 'Approval after allocation attached',  ok: approvedAfterAttach,                                        detail: !approval ? 'no approval' : !attachedAt ? (hasValidatedAaaAllocation(batch) ? 'validated (timestamp unavailable)' : 'attachedAt missing') : approvedAfterAttach ? 'yes' : `approved ${approval.approvedAt} < attached ${attachedAt}` },
    ];
    return { legId: leg.legId, items };
  });

  return { batchChecks, legChecks };
}

function DestinationApprovalSection({
  batch,
  evidence = {},
  currentPhase = 0,
}: {
  batch: EscrowBatch;
  evidence?: Record<number, import('../BatchLifecycleCard').PhaseEvidenceRow>;
  currentPhase?: number;
}) {
  const p6Evidence = evidence[6];
  const phase6Complete = currentPhase >= 6;
  const phase6EvidencePresent = Boolean(p6Evidence);

  const [showChecklist, setShowChecklist] = useState(false);
  const progress = getDestinationApprovalProgress(batch);
  // When Phase 6 is complete, treat destinations as approved regardless of session state.
  const approved = phase6Complete ? true : areBatchDestinationsApproved(batch);
  const blockingReason = approved ? null : getDestinationApprovalBlockingReason(batch);
  const legs = getDeploymentLegsForDestinationApproval(batch);
  const fundingVerified = getFundingValidation(batch).state === 'verified';
  const authorityBindingValid = hasValidAuthorityBinding(batch);
  // Phase 5 complete means allocation is anchored — don't re-check batch session state.
  const allocationAttached = currentPhase >= 5 ? true : hasValidatedAaaAllocation(batch);
  const { batchChecks, legChecks } = buildDestinationChecklist(batch);
  const failCount = [...batchChecks, ...legChecks.flatMap((l) => l.items)].filter((c) => !c.ok).length;
  const prerequisitesMet = authorityBindingValid && allocationAttached && fundingVerified;

  if (phase6Complete && !phase6EvidencePresent) {
    return (
      <SectionCard title="DAO Approval" icon={<ShieldCheck size={18} />}>
        <EvidenceIntegrityFault phase={6} label="Phase 6 (Destination Approvals)" currentPhase={currentPhase} />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="DAO Approval" icon={<ShieldCheck size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge label={approved ? 'DAO Approved' : 'DAO Pending'} state={approved ? 'passed' : 'pending'} />
        {phase6EvidencePresent && <span className="data-chip text-[9px] text-emerald-300">phase6_evidence</span>}
        <span className="data-chip">Approval progress {progress.label}</span>
        {!approved && prerequisitesMet && failCount > 0 && (
          <span className="data-chip" data-tone="danger">{failCount} check{failCount !== 1 ? 's' : ''} failing</span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="DAO registry" value={<span className="data-chip text-[9px]">{DAO_DESTINATION_REGISTRY[0]?.destinationRegistryVersion ?? 'Missing'} · {DAO_DESTINATION_REGISTRY.length} entries</span>} />
        <Field label="Required approvals" value={String(progress.requiredCount)} />
        <Field label="Approved venues" value={String(progress.approvedCount)} />
        <Field label="Destination approval" value={approved ? 'approved' : 'pending'} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className={`data-chip ${approved ? 'text-emerald-300' : 'text-slate-300'}`}>
          Destination approval {approved ? 'approved' : 'pending'}
        </span>
        <button
          type="button"
          className="action-button action-button--ghost inline-flex items-center gap-2"
          onClick={() => setShowChecklist((v) => !v)}
        >
          <ListChecks size={14} />
          {showChecklist ? 'Hide' : 'Show'} Checklist
          {!approved && prerequisitesMet && failCount > 0 && <span className="ml-1 rounded bg-rose-900/60 px-1 text-[10px] text-rose-300">{failCount}</span>}
        </button>
      </div>

      {!phase6Complete && (!authorityBindingValid ? (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          {getBatchAuthorityBindingValidation(batch).blockingReason ?? 'Batch authority binding is missing or invalid.'}
        </div>
      ) : !allocationAttached ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          AAA allocation must be anchored on-chain before destination approval.
        </div>
      ) : !fundingVerified ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          Funding must be verified before DAO approval.
        </div>
      ) : blockingReason ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          <span className="font-semibold">Blocking Reason:</span> {blockingReason}
        </div>
      ) : null)}

      {showChecklist && (
        <div className="mb-4 rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Batch Prerequisites</div>
          <div className="space-y-0.5">
            {batchChecks.map((item, i) => <CheckRow key={i} item={item} />)}
          </div>

          {legChecks.map(({ legId, items }) => (
            <div key={legId} className="mt-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Leg {legId} — {items.filter((c) => !c.ok).length === 0 ? <span className="text-emerald-500">all pass</span> : <span className="text-rose-400">{items.filter((c) => !c.ok).length} failing</span>}
              </div>
              <div className="space-y-0.5">
                {items.map((item, i) => <CheckRow key={i} item={item} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <th className="pb-2 pr-4">Leg</th>
              <th className="pb-2 pr-4">DAO Venue</th>
              <th className="pb-2 pr-4">Address</th>
              <th className="pb-2 pr-4">Chain / Asset</th>
              <th className="pb-2 pr-4 text-right">Amount</th>
              <th className="pb-2 pr-4">Registry</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2">Approval Hash</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => {
              const destination = getDaoDestinationForLeg(batch, leg);
              const approval = (batch.destinationApprovals ?? []).find((item) => item.legId === leg.legId);
              return (
                <tr key={leg.legId} className="border-b border-slate-800/60">
                  <td className="py-3 pr-4 font-mono text-slate-100">{leg.legId}</td>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-slate-100">{destination?.label ?? 'No DAO venue'}</div>
                    <div className="mt-1 text-xs text-slate-500">{destination?.providerType ? titleCase(destination.providerType) : 'Unregistered'}</div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-400">{shortHash(destination?.destinationAddress)}</td>
                  <td className="py-3 pr-4 text-slate-300">{destination ? `${titleCase(destination.chain)} / ${destination.asset}` : `${titleCase(batch.wallet.chain)} / ${leg.asset}`}</td>
                  <td className="py-3 pr-4 text-right font-mono">{fmtUsd(leg.amountUsd)}</td>
                  <td className="py-3 pr-4">{destination?.destinationRegistryVersion ?? 'Missing'}</td>
                  <td className="py-3 pr-4">
                    <StatusBadge
                      label={approval ? titleCase(approval.approvalStatus) : destination?.approvalStatus === 'dao_approved' ? 'DAO Whitelisted' : 'Blocked'}
                      tone={approval?.approvalStatus === 'approved' ? 'success' : destination?.approvalStatus === 'dao_approved' ? 'warning' : 'danger'}
                    />
                  </td>
                  <td className="py-3 font-mono text-xs text-slate-400">{shortHash(approval?.destinationApprovalHash)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function DeploymentApprovalSection({
  batch,
  evidence = {},
  currentPhase = 0,
}: {
  batch: EscrowBatch;
  evidence?: Record<number, import('../BatchLifecycleCard').PhaseEvidenceRow>;
  currentPhase?: number;
}) {
  const p7Evidence = evidence[7];
  const p7ev = p7Evidence?.evidence_json as Record<string, unknown> | undefined;
  const phase7Complete = currentPhase >= 7;
  const phase7EvidencePresent = Boolean(p7Evidence);

  // Phase 7 complete but evidence missing: integrity fault
  if (phase7Complete && !phase7EvidencePresent) {
    return (
      <SectionCard title="Deployment Approval" icon={<ShieldCheck size={18} />}>
        <EvidenceIntegrityFault phase={7} label="Phase 7 (Deployment Approval)" currentPhase={currentPhase} />
      </SectionCard>
    );
  }

  const approved = phase7Complete ? true : hasDeploymentApproval(batch);
  // Suppress browser-side mismatch check when Phase 7 evidence is present.
  // The server-side canonicalKeccak schema for destinationApprovalHash differs from the
  // browser-side getBatchDestinationApprovalHash schema, so comparison always returns a
  // false positive. Integrity is verified server-side in the Phase 7 executor and Phase 8
  // checklist/executor cross-phase guards.
  const mismatchReason = phase7EvidencePresent ? null : getExistingDeploymentApprovalMismatch(batch);
  // When Phase 7 evidence exists, read canonical hashes from it instead of batch object
  const approval = phase7EvidencePresent && p7ev ? {
    ...batch.deploymentApproval,
    deploymentApprovalHash: (p7ev.deploymentApprovalHash as string | undefined) ?? batch.deploymentApproval.deploymentApprovalHash,
    destinationApprovalHash: (p7ev.destinationApprovalHash as string | undefined) ?? batch.deploymentApproval.destinationApprovalHash,
    allocationPlanHash: (p7ev.allocationPlanHash as string | undefined) ?? batch.deploymentApproval.allocationPlanHash,
    policyContextHash: (p7ev.policyContextHash as string | undefined) ?? batch.deploymentApproval.policyContextHash,
    destinationRegistryVersion: (p7ev.destinationRegistryVersion as string | undefined) ?? batch.deploymentApproval.destinationRegistryVersion,
    approvedBy: (p7ev.approvedBy as string | undefined) ?? batch.deploymentApproval.approvedBy,
    approvedAt: p7ev.approvedAt != null ? new Date(Number(p7ev.approvedAt) * 1000).toISOString() : batch.deploymentApproval.approvedAt,
  } : batch.deploymentApproval;
  const payload = approval.payload ?? batch.deploymentApproval.payload;

  return (
    <SectionCard title="Deployment Approval" icon={<ShieldCheck size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge
          label={approved ? 'Deployment Approved' : 'Deployment Approval Pending'}
          tone={approved ? 'success' : 'purple'}
        />
        {phase7EvidencePresent && <span className="data-chip text-[9px] text-emerald-300">phase7_evidence</span>}
        <span className="data-chip">Destinations Approved = routes are allowed</span>
        <span className="data-chip">Deployment Approved = batch authorized</span>
        <span className="data-chip">Deployed = funds moved</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Deployment status" value={approved ? 'Deployment Approved' : 'Pending'} />
        <Field label="Deployment approval hash" value={<span className="font-mono">{shortHash(approval.deploymentApprovalHash)}</span>} />
        <Field label="Destination approval hash" value={<span className="font-mono">{shortHash(approval.destinationApprovalHash)}</span>} />
        <Field label="Allocation plan hash" value={<span className="font-mono">{shortHash(approval.allocationPlanHash ?? batch.aaaAllocation.allocationPlanHash)}</span>} />
        <Field label="Policy context hash" value={<span className="font-mono">{shortHash(approval.policyContextHash ?? batch.aaaAllocation.policyContextHash)}</span>} />
        <Field label="Destination registry version" value={approval.destinationRegistryVersion ?? batch.destinationApprovals?.[0]?.destinationRegistryVersion ?? 'Pending'} />
        <Field label="Approved by" value={approval.approvedBy ?? 'Pending'} />
        <Field label="Approved at" value={formatDateTime(approval.approvedAt)} />
      </div>

      {mismatchReason && (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <span className="font-semibold">Approval Mismatch:</span> {mismatchReason}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <th className="pb-2 pr-4">Asset</th>
              <th className="pb-2 pr-4 text-right">Amount</th>
              <th className="pb-2 pr-4 text-right">Weight</th>
              <th className="pb-2 pr-4">Destination ID</th>
              <th className="pb-2 pr-4">Destination Type</th>
              <th className="pb-2 pr-4">Destination Address</th>
              <th className="pb-2">Leg ID</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.deploymentLegs ?? []).length === 0 ? (
              <tr className="border-b border-slate-800/60">
                <td className="py-4 text-sm text-slate-400" colSpan={7}>
                  Deployment leg preview appears after deployment approval.
                </td>
              </tr>
            ) : null}
            {(payload?.deploymentLegs ?? []).map((leg) => (
              <tr key={leg.allocationLegId} className="border-b border-slate-800/60">
                <td className="py-3 pr-4 font-semibold text-slate-100">{leg.asset}</td>
                <td className="py-3 pr-4 text-right font-mono">{fmtUsd(leg.amount)}</td>
                <td className="py-3 pr-4 text-right font-mono">{fmtPct(leg.weight * 100)}</td>
                <td className="py-3 pr-4 font-mono text-xs text-slate-400">{leg.approvedDestinationId}</td>
                <td className="py-3 pr-4">{titleCase(leg.destinationType)}</td>
                <td className="py-3 pr-4 font-mono text-xs text-slate-400">{shortHash(leg.destinationAddress)}</td>
                <td className="py-3 font-mono text-xs text-slate-400">{leg.allocationLegId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function SigningControlSection({
  batch,
  onCreateDeploymentSigningRequest,
  onApproveSigningRequest,
  onExecuteDeployment,
}: {
  batch: EscrowBatch;
  onCreateDeploymentSigningRequest: (batch: EscrowBatch) => void;
  onApproveSigningRequest: (batch: EscrowBatch, authorityRole: 'treasury' | 'escrow' | 'continuity') => void;
  onExecuteDeployment: (batch: EscrowBatch) => void;
}) {
  const authorities = getWalletSignerAuthorities(batch);
  const latestRequest = getLatestSigningRequest(batch);
  const progress = getSigningApprovalProgress(latestRequest);
  const canCreateRequest = canCreateDeploymentSigningRequest(batch);
  const requestIsApprovable = latestRequest && ['proposed', 'awaiting_second_approval'].includes(latestRequest.status);
  const deploymentAuthorized = latestRequest?.actionType === 'deploy_batch' && latestRequest.status === 'approved';
  const deploymentReady = canExecuteDeployment(batch);
  const signingControlStatus = !latestRequest
    ? 'No deployment signing request'
    : deploymentAuthorized
      ? 'Deployment Authorized'
      : progress.approvedCount === 1
        ? 'Awaiting Second Approval'
        : progress.approvedCount === 0
          ? '0 of 2 Approvals'
          : titleCase(latestRequest.status);
  const approvedRoles = new Set(
    latestRequest?.approvals
      .filter((approval) => approval.approvalStatus === 'approved')
      .map((approval) => approval.authorityRole) ?? []
  );
  const authorityLabels = {
    treasury: 'Approve as Treasury',
    escrow: 'Approve as Escrow',
    continuity: 'Approve as Continuity / SCE',
  };

  return (
    <SectionCard title="Signing Control" icon={<KeyRound size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="data-chip" data-tone="purple">Recommended path: {NORMAL_SIGNING_PATH_LABEL}</span>
        <span className="data-chip">{CRISIS_SIGNING_PATH_LABEL}</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Batch wallet type" value={walletTypeLabel(batch)} />
        <Field label="Threshold" value={`${batch.wallet.threshold ?? 2} of ${authorities.length || 3}`} />
        <Field label="Request status" value={signingControlStatus} />
        <Field label="Approval progress" value={progress.label} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {authorities.map((authority) => (
          <div key={authority.authorityId} className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {authority.role === 'continuity' ? 'Continuity / SCE Authority' : authority.displayName}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">Custody domain</div>
                <div className="text-xs text-slate-300">{authority.custodyDomain}</div>
              </div>
              <StatusBadge label={titleCase(authority.status)} tone={authority.status === 'active' ? 'success' : 'warning'} />
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-slate-500">Public signer address</div>
            <div className="break-all font-mono text-xs text-slate-300">{authority.publicSignerAddress}</div>
            <div className="mt-2 text-xs text-slate-500">{titleCase(authority.custodyMode)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-slate-400">
        Escrow DB stores role metadata only. Actual signing power lives outside the Escrow DB. No private keys,
        signatures, seed phrases, or mnemonics are stored or displayed here.
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!latestRequest ? (
          <button
            type="button"
            className="action-button action-button--primary inline-flex items-center gap-2"
            disabled={!canCreateRequest}
            aria-disabled={!canCreateRequest}
            onClick={() => onCreateDeploymentSigningRequest(batch)}
          >
            <KeyRound size={16} />
            Create Deployment Signing Request
          </button>
        ) : null}

        {deploymentAuthorized ? (
          <button
            type="button"
            className="action-button action-button--primary inline-flex items-center gap-2"
            disabled={!deploymentReady}
            aria-disabled={!deploymentReady}
            onClick={() => onExecuteDeployment(batch)}
          >
            <ArrowRight size={16} />
            Execute Deployment
          </button>
        ) : null}

        {requestIsApprovable ? (
          (['treasury', 'escrow', 'continuity'] as const).map((role) => (
            <button
              key={role}
              type="button"
              className="action-button action-button--secondary inline-flex items-center gap-2"
              disabled={approvedRoles.has(role)}
              aria-disabled={approvedRoles.has(role)}
              onClick={() => onApproveSigningRequest(batch, role)}
            >
              <CheckCircle2 size={16} />
              {authorityLabels[role]}
            </button>
          ))
        ) : null}
      </div>
    </SectionCard>
  );
}

function DeploymentExecutionSection({
  batch,
  evidence = {},
  currentPhase = 0,
}: {
  batch: EscrowBatch;
  evidence?: Record<number, import('../BatchLifecycleCard').PhaseEvidenceRow>;
  currentPhase?: number;
}) {
  const p8Evidence = evidence[8];
  const p8ev = p8Evidence?.evidence_json as Record<string, unknown> | undefined;
  const phase8Complete = currentPhase >= 8;
  const phase8EvidencePresent = Boolean(p8Evidence);

  // Phase 8 complete but evidence missing: integrity fault
  if (phase8Complete && !phase8EvidencePresent) {
    return (
      <SectionCard title="Deployment Execution" icon={<Layers size={18} />}>
        <EvidenceIntegrityFault phase={8} label="Phase 8 (Deployment Execution)" currentPhase={currentPhase} />
      </SectionCard>
    );
  }

  const latestExecution = getLatestDeploymentExecution(batch);
  // When Phase 8 evidence exists, derive status from it rather than batch object
  const p8Legs = phase8EvidencePresent && p8ev ? (Array.isArray(p8ev.legs) ? p8ev.legs as Array<{ legId: string; status: string; txHash?: string; executedAt?: number }> : []) : null;
  const allP8LegsExecuted = p8Legs ? p8Legs.every(l => l.status === 'executed') : false;
  const deploymentStatus = phase8EvidencePresent
    ? (allP8LegsExecuted ? 'deployed' : 'partial')
    : getDeploymentExecutionStatus(batch);
  const legResults = latestExecution?.deploymentLegResults ?? [];
  const latestLegResult = [...legResults].sort((left, right) => right.deployedAt.localeCompare(left.deployedAt))[0];
  const p7ev8 = evidence[7]?.evidence_json as Record<string, unknown> | undefined;
  const p6ev8 = evidence[6]?.evidence_json as Record<string, unknown> | undefined;
  const p8ApprovalHashDisplay = (p8ev?.deploymentApprovalHash as string | undefined)
    ?? (p7ev8?.deploymentApprovalHash as string | undefined)
    ?? batch.deploymentApproval.deploymentApprovalHash;
  const p8DestApprovalHash = (p8ev?.destinationApprovalHash as string | undefined)
    ?? (p6ev8?.destinationApprovalHash as string | undefined)
    ?? batch.deploymentApproval.destinationApprovalHash;
  const p8TxHash = p8Legs && p8Legs.length > 0
    ? (p8Legs[0].txHash ?? latestExecution?.deploymentTxHash)
    : latestExecution?.deploymentTxHash;
  const p8ExecutedBy = (p8ev?.executedBy as string | undefined) ?? latestExecution?.executedBy;
  const p8ExecutedAt = p8ev?.executedAt != null
    ? new Date(Number(p8ev.executedAt) * 1000).toISOString()
    : latestExecution?.executedAt;

  return (
    <SectionCard title="Deployment Execution" icon={<Layers size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge
          label={titleCase(deploymentStatus)}
          tone={deploymentStatus === 'monitoring' || deploymentStatus === 'deployed' ? 'success' : deploymentStatus === 'failed' ? 'danger' : 'warning'}
        />
        {phase8EvidencePresent && <span className="data-chip text-[9px] text-emerald-300">phase8_evidence</span>}
        <span className="data-chip">{(phase8EvidencePresent || hasDeploymentApproval(batch)) ? 'Deployment Approved' : 'Approval Pending'}</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Deployment status" value={titleCase(deploymentStatus)} />
        <Field label="Deployment approval hash" value={<span className="font-mono">{shortHash(p8ApprovalHashDisplay)}</span>} />
        <Field label="Destination approval hash" value={<span className="font-mono">{shortHash(p8DestApprovalHash)}</span>} />
        <Field label="Deployment tx hash" value={<span className="font-mono">{shortHash(p8TxHash)}</span>} />
        <Field label="Executed by" value={p8ExecutedBy ?? 'Pending'} />
        <Field label="Executed at" value={formatDateTime(p8ExecutedAt)} />
        <Field label="Leg result status" value={latestLegResult ? titleCase(latestLegResult.status) : 'Pending'} />
        <Field label="Execution source" value={latestLegResult?.signingSource === 'signer_services' ? 'Treasury + Escrow signer services' : 'Pending'} />
        <Field label="Treasury signer" value={latestLegResult?.treasurySignerAddress ? <span className="font-mono">{shortHash(latestLegResult.treasurySignerAddress)}</span> : 'Pending'} />
        <Field label="Escrow signer" value={latestLegResult?.escrowSignerAddress ? <span className="font-mono">{shortHash(latestLegResult.escrowSignerAddress)}</span> : 'Pending'} />
        <Field label="Signer proofs" value={
          latestLegResult?.signingSource === 'signer_services'
            ? <span className="font-mono text-[11px]">{shortHash(latestLegResult.treasuryConfirmTxHash || latestLegResult.treasurySubmitTxHash)} / {shortHash(latestLegResult.escrowConfirmTxHash)}</span>
            : 'Pending'
        } />
      </div>


      {legResults.length === 0 ? (
        <div className="panel-note">Deployment leg results will appear after provider deployment execution.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <th className="pb-2 pr-4">Leg</th>
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Asset</th>
                <th className="pb-2 pr-4 text-right">Amount</th>
                <th className="pb-2 pr-4 text-right">Allocation</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Provider Ref</th>
                <th className="pb-2 pr-4">Wallet Balance</th>
                <th className="pb-2 pr-4">Destination Balance</th>
                <th className="pb-2">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {legResults.map((result) => (
                <tr key={result.legId} className="border-b border-slate-800/60">
                  <td className="py-3 pr-4 font-mono text-slate-100">{result.legId}</td>
                  <td className="py-3 pr-4 text-slate-300">{PROVIDER_LABELS[result.provider]}</td>
                  <td className="py-3 pr-4">{result.asset}</td>
                  <td className="py-3 pr-4 text-right font-mono">{fmtUsd(result.amountUsd)}</td>
                  <td className="py-3 pr-4 text-right font-mono">{fmtPct(result.allocationPercent)}</td>
                  <td className="py-3 pr-4">{titleCase(result.status)}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-400">{result.providerReferenceId}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                    {result.sourceBalanceBefore == null || result.sourceBalanceAfter == null
                      ? 'Pending'
                      : `${fmtUsd(result.sourceBalanceBefore)} -> ${fmtUsd(result.sourceBalanceAfter)}`}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                    {result.destinationBalanceBefore == null || result.destinationBalanceAfter == null
                      ? 'Pending'
                      : `${fmtUsd(result.destinationBalanceBefore)} -> ${fmtUsd(result.destinationBalanceAfter)}`}
                  </td>
                  <td className="py-3 font-mono text-xs text-slate-400">{shortHash(result.deploymentTxHash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function PhaseLocked({ message, requiredPhase }: { message: string; requiredPhase: number }) {
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/30 p-6 text-center">
      <Lock size={20} className="mx-auto mb-3 text-slate-600" />
      <p className="text-sm text-slate-400">{message}</p>
      <p className="mt-1 text-xs text-slate-600">Available after Phase {requiredPhase}</p>
    </div>
  );
}

function EvidenceIntegrityFault({
  phase,
  label,
  currentPhase,
  missingPhases,
}: {
  phase?: number;
  label: string;
  currentPhase: number;
  missingPhases?: number[];
}) {
  const phases = missingPhases ?? (phase != null ? [phase] : []);
  return (
    <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-300">
        <span>⚠</span>
        <span>Evidence chain incomplete</span>
      </div>
      <div className="space-y-1 text-xs text-rose-200">
        {phases.map(p => (
          <div key={p}>• Missing Phase {p} {p === 5 ? 'AAA allocation' : p === 6 ? 'destination approval' : p === 7 ? 'deployment approval' : p === 8 ? 'deployment execution' : ''} evidence</div>
        ))}
      </div>
      <p className="mt-2 text-xs text-rose-300/70">
        current_phase = {currentPhase}. {label} is complete on-chain but the lifecycle evidence record is absent.
        This batch requires admin investigation before proceeding.
      </p>
    </div>
  );
}

type BatchDetailTab =
  | 'overview'
  | 'deposits'
  | 'wallet'
  | 'aaa'
  | 'deployment'
  | 'settlement'
  | 'performance'
  | 'audit';

const BATCH_DETAIL_TABS: { id: BatchDetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'wallet', label: 'Wallet + Binding' },
  { id: 'aaa', label: 'AAA Allocation' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'performance', label: 'Performance' },
  { id: 'audit', label: 'Audit Trail' },
];

function walletDisplay(batch: EscrowBatch) {
  return batch.wallet.walletAddress ?? batch.wallet.address;
}

function BatchDetail({
  batch,
  evidence = {},
  allAttempts = [],
  lcRow,
  chainKey,
  sourceBatchId,
  onVerifyFunding,
  onManualConfirmFunding,
  isVerifyingFunding,
  fundingVerificationError,
  onCreateDeploymentSigningRequest,
  onApproveSigningRequest,
  onExecuteDeployment,
  onSignAuthorityBinding,
  onAnchorBinding,
  isAnchoring,
  anchorError,
  onCreateBatchWallet,
  isCreatingWallet,
  walletCreationError,
  signingAuthorityRole,
  signingAuthorityError,
  onChainRoleAuthorities,
  onRoleAuthoritiesInitialized,
  signerServicesConfigured,
}: {
  batch: EscrowBatch;
  evidence?: Record<number, PhaseEvidenceRow>;
  allAttempts?: PhaseAttemptRow[];
  lcRow?: LifecycleRow;
  chainKey?: string;
  sourceBatchId?: string;
  onVerifyFunding: (batch: EscrowBatch) => void;
  onManualConfirmFunding: (batch: EscrowBatch, observedAmountUsd: number, fundingTxHash: string) => void;
  isVerifyingFunding: boolean;
  fundingVerificationError: string | null;
  onCreateDeploymentSigningRequest: (batch: EscrowBatch) => void;
  onApproveSigningRequest: (batch: EscrowBatch, authorityRole: 'treasury' | 'escrow' | 'continuity') => void;
  onExecuteDeployment: (batch: EscrowBatch) => void;
  onSignAuthorityBinding: (batch: EscrowBatch, role: BatchAuthoritySignerRole) => void;
  onAnchorBinding: (batch: EscrowBatch) => void;
  isAnchoring: boolean;
  anchorError: string | null;
  onCreateBatchWallet: (batch: EscrowBatch) => void;
  isCreatingWallet: boolean;
  walletCreationError: string | null;
  signingAuthorityRole?: string;
  signingAuthorityError?: string | null;
  onChainRoleAuthorities: OnChainRoleAuthorities | null;
  onRoleAuthoritiesInitialized?: () => void;
  signerServicesConfigured?: { treasury: boolean; escrow: boolean };
}) {
  const [activeTab, setActiveTab] = useState<BatchDetailTab>('overview');

  // Reconciliation status — fetched once Phase 9 evidence is present
  type ReconRow = {
    reconciliation_id: string;
    term_position_id: string;
    origin_institution_id: string;
    institution_display_name: string | null;
    principal_usd6: string;
    user_payout_usd6: string;
    realized_pnl_usd6: string;
    realized_pnl_bps: number;
    deposit_share_bps: number;
    settlement_scenario: string | null;
    fineract_writeback_status: 'pending' | 'posted' | 'failed' | 'skipped';
    error_code: string | null;
    posted_at: string | null;
    created_at: string;
  };
  type ReconSummary = {
    total: number; posted: number; failed: number; pending: number; skipped: number;
    lastPostedAt: string | null;
  };
  const [reconRows, setReconRows] = React.useState<ReconRow[]>([]);
  const [reconSummary, setReconSummary] = React.useState<ReconSummary | null>(null);
  React.useEffect(() => {
    if (!evidence[9]) { setReconRows([]); setReconSummary(null); return; }
    let cancelled = false;
    fetch(`/api/banking/escrow/reconciliation-status?escrowBatchId=${encodeURIComponent(batch.batchId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { rows?: ReconRow[]; summary?: ReconSummary | null } | null) => {
        if (cancelled || !data) return;
        setReconRows(data.rows ?? []);
        setReconSummary(data.summary ?? null);
      })
      .catch(() => { /* reconciliation table may not exist yet in dev */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.batchId, Boolean(evidence[9])]);

  // On-chain audit trail — fetched when the Audit Trail tab is active
  type BatchAuditEvent = {
    id: string; phase: number | null; eventKind: string; movementType: string;
    sourceAuthority: string; txHash: string | null; blockNumber: number | null;
    fromAddress: string | null; toAddress: string | null; assetSymbol: string | null;
    amountDisplay: string | null; evidenceHash: string | null;
    occurredAt: string | null; status: string; notes: string | null;
  };
  type AuditReconciliationCheck = {
    checkName: string; status: 'pass' | 'fail' | 'missing' | 'warning';
    expected: string | null; observed: string | null; tolerance: string | null;
    sourceA: string; sourceB: string; resolutionHint: string | null;
  };
  type BatchAuditSummary = {
    overallAuditStatus: 'verified' | 'missing_proof' | 'mismatch' | 'incomplete';
    confirmedOnchainTxCount: number; missingProofCount: number; mismatchCount: number;
    internalRecordCount: number; simulatedDevCount: number;
  };
  type BatchAuditTrail = {
    escrowBatchId: string; sourceBatchId: string; generatedAt: string;
    summary: BatchAuditSummary;
    events: BatchAuditEvent[];
    reconciliationChecks: AuditReconciliationCheck[];
  };
  const [auditTrail, setAuditTrail] = React.useState<BatchAuditTrail | null>(null);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [auditError, setAuditError] = React.useState<string | null>(null);
  const [internalCollapsed, setInternalCollapsed] = React.useState(true);

  React.useEffect(() => {
    if (activeTab !== 'audit') return;
    let cancelled = false;
    const escrowBatchId = lcRow?.escrow_batch_id ?? batch.batchId;
    if (!escrowBatchId) return;
    setAuditLoading(true);
    setAuditError(null);
    fetch(`/api/banking/escrow/audit-onchain/${encodeURIComponent(escrowBatchId)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error ?? 'Server error')))
      .then((data: BatchAuditTrail) => { if (!cancelled) { setAuditTrail(data); setAuditLoading(false); } })
      .catch((err: string) => { if (!cancelled) { setAuditError(String(err)); setAuditLoading(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, lcRow?.escrow_batch_id, batch.batchId]);

  // Dev scenario picker — active when Phase >= 8 and Phase 9 not yet begun
  const SCENARIO_OPTIONS = [
    { id: 'target_yield',    label: 'Target Yield'      },
    { id: 'high_yield',      label: 'High Yield'        },
    { id: 'principal_return',label: 'Principal Return'  },
    { id: 'loss_covered',    label: 'Loss Covered'      },
    { id: 'loss_uncovered',  label: 'Loss Uncovered'    },
  ] as const;
  type ScenarioId = typeof SCENARIO_OPTIONS[number]['id'];
  const [selectedScenario, setSelectedScenario] = React.useState<ScenarioId>('target_yield');
  const [simulating, setSimulating]             = React.useState(false);
  const [simResult, setSimResult]               = React.useState<{ ok: boolean; message: string } | null>(null);

  const handleSimulateLegReturns = React.useCallback(async () => {
    const escrowBatchId = lcRow?.escrow_batch_id ?? batch.batchId;
    if (!escrowBatchId) return;
    setSimulating(true);
    setSimResult(null);
    try {
      const resp = await fetch('/api/banking/escrow/admin/simulate-leg-returns', {
        method: 'POST',
        // No credential is attached here. NEXT_PUBLIC_ADMIN_API_TOKEN used to be
        // sent from this call site, which inlined the administrator credential
        // into the client bundle for anyone to read. Authority now comes from the
        // wallet session cookie, which the browser sends automatically and cannot
        // read.
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ escrowBatchId, scenarioId: selectedScenario, mode: 'mark_and_return' }),
      });
      const data = await resp.json() as { success?: boolean; error?: string; legs?: unknown[] };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setSimResult({ ok: true, message: `${data.legs?.length ?? 0} legs simulated · scenario: ${selectedScenario}` });
    } catch (err: any) {
      setSimResult({ ok: false, message: String(err?.message ?? err) });
    } finally {
      setSimulating(false);
    }
  }, [lcRow?.escrow_batch_id, batch.batchId, selectedScenario]);

  // Dev leg positions — fetched when Phase >= 8 and Phase 9 not yet complete (dev-only)
  const [devLegPositions, setDevLegPositions] = React.useState<DevLegPositionRecord[]>([]);
  React.useEffect(() => {
    const phase = lcRow?.current_phase ?? 0;
    const escrowBatchId = lcRow?.escrow_batch_id ?? '';
    if (phase < 8 || evidence[9] || !escrowBatchId) {
      setDevLegPositions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/banking/escrow/admin/dev/leg-positions/${encodeURIComponent(escrowBatchId)}`, {
          credentials: 'same-origin',
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json() as { legs?: DevLegPositionRecord[] };
        if (!cancelled) setDevLegPositions(data.legs ?? []);
      } catch { /* dev endpoint not available — silently skip */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lcRow?.escrow_batch_id, lcRow?.current_phase, Boolean(evidence[9])]);

  const model = React.useMemo(
    () => buildEscrowBatchDisplayModel(batch, lcRow, evidence, devLegPositions.length > 0 ? devLegPositions : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batch.batchId, batch.status, lcRow?.current_phase, lcRow?.status, lcRow?.wallet_address, Object.keys(evidence).join(','), devLegPositions],
  );
  const manifestValidation = getManifestValidation(batch);
  const fundingValidation = getFundingValidation(batch);
  const computedDepositTotal = getComputedDepositTotal(batch);
  const walletCreated = Boolean(walletDisplay(batch)) && batch.wallet.fundingStatus !== 'not_created';

  const lcPhase = lcRow?.current_phase ?? 0;
  const lcFundingLabel = lcPhase >= 4
    ? 'Wallet Funded'
    : lcPhase >= 3
    ? 'Wallet Created — Pending Funding'
    : fundingStatusLabel(batch);

  return (
    <section className="sagitta-cell">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="data-chip">{fmtTerm(model.termMonths)} Term</span>
          <span className="data-chip">{batch.deposits.length} Deposits</span>
          {lcRow && <span className="data-chip">Phase {lcRow.current_phase} / 9</span>}
        </div>
        <h2 className="text-2xl font-bold break-all">{batch.batchId}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Source Batch #{batch.sourceBatchId ?? lcRow?.source_batch_id ?? '—'}
          {lcRow && <> · {lcRow.chain_key} ({lcRow.chain_id})</>}
          {lcRow?.opened_at_unix ? <> · opened {new Date(lcRow.opened_at_unix * 1000).toLocaleString()}</> : null}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Wallet" value={
          model.walletStatus === 'created_bound' && model.walletAddress
            ? <span className="font-mono">{shortHash(model.walletAddress)}</span>
            : model.walletStatus === 'predicted' && model.predictedAddress
            ? <span className="flex items-center gap-1"><span className="font-mono text-amber-400/80">{shortHash(model.predictedAddress)}</span><span className="data-chip text-[9px]">Predicted</span></span>
            : <span className="text-slate-500">—</span>
        } />
        <Field label="Funding" value={lcFundingLabel} />
        <Field label="Deployment" value={deploymentExecutionLabel(batch)} />
        {model.currentPhase >= 2 && batch.batchAuthorityBinding ? (
          <Field
            label="Authority Binding"
            value={
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-xs text-[var(--gold-300)]">{shortHash(batch.batchAuthorityBinding.batchAuthorityBindingHash)}</span>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge
                    label={`T:${batch.batchAuthorityBinding.treasurySignatureStatus.toUpperCase()}`}
                    tone={sigStatusTone(batch.batchAuthorityBinding.treasurySignatureStatus)}
                  />
                  <StatusBadge
                    label={`E:${batch.batchAuthorityBinding.escrowSignatureStatus.toUpperCase()}`}
                    tone={sigStatusTone(batch.batchAuthorityBinding.escrowSignatureStatus)}
                  />
                  {(() => {
                    const anchorStatus = batch.batchAuthorityBinding.anchorStatus;
                    return (
                      <span className="data-chip" data-tone={anchorStatus === 'anchored' ? 'success' : anchorStatus === 'binding_mismatch' ? 'danger' : 'purple'}>
                        {anchorStatus === 'anchored' ? 'Anchored' : anchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending Anchor'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            }
          />
        ) : model.currentPhase < 2 ? (
          <Field label="Authority Binding" value={<span className="text-slate-500 text-xs">Not created — available after Phase 1</span>} />
        ) : null}
      </div>

      {/* Phase rail — full width */}
      {chainKey && sourceBatchId ? (
        <div className="mb-5 rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-3">
          <BatchLifecycleCard
            key={lcRow?.escrow_batch_id ?? `${chainKey}:${sourceBatchId}`}
            variant="rail"
            escrowBatchId={lcRow?.escrow_batch_id}
            chainKey={chainKey}
            sourceBatchId={sourceBatchId}
          />
        </div>
      ) : null}

      {/* Dev scenario picker — Phase 8 complete, Phase 9 not yet started */}
      {(lcRow?.current_phase ?? 0) >= 8 && !evidence[9] && (
        <div className="mb-5 rounded-lg border border-violet-700/30 bg-violet-950/20 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-400">Dev Settlement Scenario</span>
            <span className="data-chip text-[9px] text-violet-400">dev-only</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedScenario}
              onChange={e => { setSelectedScenario(e.target.value as ScenarioId); setSimResult(null); }}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              {SCENARIO_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={handleSimulateLegReturns}
              disabled={simulating}
              className={`action-button ${simulating ? 'opacity-50 cursor-not-allowed' : 'action-button--primary'}`}
            >
              {simulating
                ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent mr-1" />Simulating…</>
                : 'Simulate Leg Returns'}
            </button>
            {simResult && (
              <span className={`text-xs ${simResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {simResult.ok ? '✓' : '✗'} {simResult.message}
              </span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            Scenario: <span className="text-slate-300 font-medium">{SCENARIO_OPTIONS.find(o => o.id === selectedScenario)?.label}</span>
            {' '}· Simulates leg P&amp;L without advancing the phase. Advance to Phase 9 separately after reviewing results.
          </p>
        </div>
      )}

      {/* Tabs — full width */}
      <div>
          <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Selected batch container sections">
            {BATCH_DETAIL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`data-chip data-chip--btn ${activeTab === tab.id ? 'border-[rgba(148,98,232,0.58)] bg-[rgba(80,40,160,0.22)] text-slate-100' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

      {activeTab === 'overview' ? (
        <SectionCard title="Batch Details" icon={<Database size={18} />}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <Field label="Total amount" value={
              <span className="flex items-center gap-1.5">
                {fmtUsd(model.principalUsd)}
                <span className={`data-chip text-[9px] ${model.principalSource === 'phase1_evidence' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {model.principalSource === 'phase1_evidence' ? 'phase1_evidence' : 'order_estimate'}
                </span>
              </span>
            } />
            <Field label="Asset" value={model.asset} />
            <Field label="Term" value={fmtTerm(model.termMonths)} />
            <Field label="Deposits" value={String(batch.deposits.length)} />
            <Field label="Wallet" value={
              model.walletStatus === 'created_bound' && model.walletAddress
                ? <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px]">{shortHash(model.walletAddress)}</span>
                    <span className="data-chip text-[9px] text-emerald-400">phase3_evidence</span>
                  </span>
                : model.walletStatus === 'predicted' && model.predictedAddress
                ? <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-amber-400/80">{shortHash(model.predictedAddress)}</span>
                    <span className="data-chip text-[9px] text-amber-400">predicted</span>
                  </span>
                : <span className="text-slate-500">—</span>
            } />
            <Field label="Treasury state" value={batch.treasuryHandoff.approvedByTreasury ? 'Sent by Treasury' : 'Pending Treasury send'} />
            <Field label="Treasury sent at" value={formatDateTime(model.treasurySentAt ?? undefined)} />
            {model.openedAt && (
              <Field label="Registered at" value={
                <span className="flex items-center gap-1.5">
                  {formatDateTime(model.openedAt)}
                  <span className="data-chip text-[9px] text-emerald-400">lifecycle</span>
                </span>
              } />
            )}
            <Field label="Source batch ID" value={
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[11px]">{model.sourceBatchId || '—'}</span>
                {model.sourceBatchId && lcRow?.source_batch_id === model.sourceBatchId && (
                  <span className="data-chip text-[9px] text-emerald-400">lifecycle</span>
                )}
              </span>
            } />
            <Field label="Source wallet" value={<span className="font-mono">{shortHash(batch.treasuryHandoff.treasurySourceWallet) || '—'}</span>} />
            <Field label="Manifest hash" value={<span className="font-mono">{shortHash(batch.treasuryHandoff.depositManifestHash)}</span>} />
            {model.treasuryAddress && (
              <Field label="Treasury contract" value={<span className="font-mono">{shortHash(model.treasuryAddress)}</span>} />
            )}
            {model.chainId && (
              <Field label="Chain" value={`${model.chainKey} (${model.chainId})`} />
            )}
          </div>
        </SectionCard>
      ) : null}

      {activeTab === 'deposits' ? (
        <SectionCard title="Deposits" icon={<ListChecks size={18} />}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ReadinessBadge
              label={manifestValidation.label}
              state={manifestValidation.state === 'verified' ? 'passed' : 'blocked'}
            />
            <span className="data-chip">Computed {fmtUsd(computedDepositTotal)}</span>
            <span className="data-chip">Expected {fmtUsd(batch.totalAmountUsd)}</span>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Deposit count" value={String(batch.deposits.length)} />
            <Field label="Total amount" value={fmtUsd(batch.totalAmountUsd)} />
            <Field label="Term" value={fmtTerm(model.termMonths)} />
            <Field label="Asset" value={batch.asset ?? 'USDC'} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <th className="pb-2 pr-4">Deposit ID</th>
                  <th className="pb-2 pr-4">Origin Bank</th>
                  <th className="pb-2 pr-4">Adapter</th>
                  <th className="pb-2 pr-4">Bank Ref</th>
                  <th className="pb-2 pr-4">Account Ref</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 pr-4 text-right">Term</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {batch.deposits.map((deposit) => {
                  const wireMatched = Boolean(deposit.bankClientRef);
                  return (
                    <tr key={deposit.depositId} className="border-b border-slate-800/60 hover:bg-slate-800/20">
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-300" title={deposit.depositId}>
                        {deposit.depositId.length > 14
                          ? `${deposit.depositId.slice(0, 8)}…`
                          : deposit.depositId}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-300">{deposit.originBank || '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-400">{titleCase(deposit.adapterType)}</td>
                      <td className="py-2.5 pr-4" title={deposit.bankClientRef ?? ''}>
                        {deposit.bankClientRef ? (
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-slate-300" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              {deposit.bankClientRef}
                            </span>
                            <span className="shrink-0 text-emerald-400" title="Wire reference matched">✓</span>
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-400" title={deposit.depositAccountRef ?? ''}>
                        {deposit.depositAccountRef
                          ? deposit.depositAccountRef.length > 16
                            ? `${deposit.depositAccountRef.slice(0, 12)}…`
                            : deposit.depositAccountRef
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono">{fmtUsd(deposit.amountUsd)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{fmtTerm(deposit.termMonths)}</td>
                      <td className="py-2.5 text-right">
                        <span className={`data-chip text-[9px] ${deposit.status === 'settled' || deposit.status === 'funded' || deposit.status === 'active' ? 'text-emerald-400' : deposit.status === 'exception' ? 'text-rose-400' : ''}`}>
                          {titleCase(deposit.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {activeTab === 'wallet' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard title={batch.custodyMode === 'batch_wallet_custody' ? 'Batch Wallet (2-of-3 Multisig)' : 'Custody'} icon={<Wallet size={18} />}>
            {batch.custodyMode === 'escrow_contract_custody' ? (
              // escrow_contract_custody: funds remain in InvestmentEscrow — no external wallet needed.
              <div className="space-y-3">
                <div className="panel-note">
                  This batch uses <strong>Escrow Contract Custody</strong>. Funds are held directly in the InvestmentEscrow contract and tracked via escrowBatchPositions. No external wallet is created or required.
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Custody mode" value="Escrow Contract Custody" />
                  <Field label="Custody contract" value={<span className="font-mono">{shortHash(batch.sourceContract)}</span>} />
                  <Field label="Source batch ID" value={batch.sourceBatchId ?? '—'} />
                  <Field label="Funding status" value={fundingStatusLabel(batch)} />
                </div>
              </div>
            ) : walletCreated ? (
              // batch_wallet_custody with confirmed wallet binding.
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <ReadinessBadge
                    label={fundingStatusLabel(batch)}
                    state={fundingValidation.state === 'verified' ? 'passed' : fundingValidation.state === 'mismatch' ? 'blocked' : 'pending'}
                  />
                  <span className="data-chip">Expected {fmtUsd(fundingValidation.expectedAmountUsd)}</span>
                  <span className="data-chip">Observed {fmtUsd(fundingValidation.observedAmountUsd)}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Wallet address" value={
                    model.walletAddress
                      ? <span className="flex items-center gap-1.5"><span className="font-mono">{model.walletAddress}</span><span className="data-chip text-[9px]" data-tone="success">phase3_evidence</span></span>
                      : model.predictedAddress
                      ? <span className="flex items-center gap-1.5"><span className="font-mono text-amber-400/80">{model.predictedAddress}</span><span className="data-chip text-[9px]">Predicted</span></span>
                      : <span className="text-slate-500">Pending (Phase 3 incomplete)</span>
                  } />
                  <Field label="Wallet type" value="2-of-3 Multisig" />
                  <Field label="Threshold" value={`${batch.wallet.threshold ?? 2} of 3`} />
                  <Field label="Signers" value="Treasury / Escrow / Continuity SCE" />
                  <Field label="Owner Treasury" value={<span className="font-mono">{shortHash(batch.wallet.owners?.treasury)}</span>} />
                  <Field label="Owner Escrow" value={<span className="font-mono">{shortHash(batch.wallet.owners?.escrow)}</span>} />
                  <Field label="Owner Continuity" value={<span className="font-mono">{shortHash(batch.wallet.owners?.continuity)}</span>} />
                  <Field label="Chain" value={
                    model.chainKey
                      ? <span className="flex items-center gap-1.5">
                          {model.chainKey} ({model.chainId})
                          {batch.wallet.chain && batch.wallet.chain !== model.chainKey && (
                            <span className="data-chip text-[9px] text-amber-400" title={`Registry profile: ${batch.wallet.chain}`}>
                              registry: {batch.wallet.chain}
                            </span>
                          )}
                        </span>
                      : titleCase(batch.wallet.chain)
                  } />
                  <Field label="Created at" value={formatDateTime(batch.wallet.createdAt)} />
                  <Field label="Funding status" value={fundingStatusLabel(batch)} />
                  <Field
                    label="Deployment tx (evidence)"
                    value={<span className="font-mono">{shortHash(batch.wallet.creationTxHash)}</span>}
                  />
                  <Field
                    label="Binding tx"
                    value={<span className="font-mono">{shortHash(batch.wallet.bindingTxHash)}</span>}
                  />
                  <div className="col-span-2">
                    <Field
                      label="Bound authority binding hash"
                      value={<span className="font-mono text-[var(--gold-300)]">{shortHash(batch.wallet.boundAuthorityBindingHash)}</span>}
                    />
                  </div>
                </div>
              </>
            ) : isCreatingWallet ? (
              // batch_wallet_custody — wallet deployment in flight.
              <div className="panel-note flex items-center gap-2">
                <Clock3 size={14} className="animate-spin" />
                Deploying 2-of-3 multisig wallet on-chain…
              </div>
            ) : batch.batchAuthorityBinding?.anchorStatus === 'anchored' ? (
              // batch_wallet_custody — anchor done, wallet not yet deployed.
              <div className="space-y-3">
                <div className="panel-note">
                  Batch Authority Binding is anchored. A 2-of-3 multisig wallet will be created automatically via the Wallet Factory Service.
                  {!WALLET_FACTORY_URL ? ' (NEXT_PUBLIC_WALLET_FACTORY_URL is not configured — set it in frontend/.env.local and restart.)' : ''}
                </div>
                {walletCreationError ? (
                  <div className="rounded border border-rose-700/40 bg-rose-900/20 p-3 text-xs text-rose-200">
                    <strong>Wallet creation error:</strong> {walletCreationError}
                  </div>
                ) : null}
                {WALLET_FACTORY_URL ? (
                  <button
                    type="button"
                    className="action-button action-button--primary"
                    onClick={() => onCreateBatchWallet(batch)}
                  >
                    Create 2-of-3 Multisig Wallet
                  </button>
                ) : null}
              </div>
            ) : (
              // batch_wallet_custody — waiting for anchor.
              <div className="panel-note">
                Wallet creation is blocked until the Batch Authority Binding is anchored on-chain.
                Sign and anchor the binding in the Authority Binding section below.
              </div>
            )}
          </SectionCard>

          {model.currentPhase >= 2 ? (
            <BatchWalletBindingSection batch={batch} />
          ) : (
            <SectionCard title="Batch Wallet Binding" icon={<KeyRound size={18} />}>
              <div className="panel-note">
                Wallet binding is not available yet. Authority binding must be anchored (Phase 2) before wallet binding is created.
              </div>
            </SectionCard>
          )}

          <div className="xl:col-span-2">
            <RoleAuthorityRegistrySection />
          </div>

          <div className="xl:col-span-2">
            {model.currentPhase >= 2 ? (
              <BatchAuthorityBindingSection
                batch={batch}
                onSignAsRole={onSignAuthorityBinding}
                onAnchorBinding={onAnchorBinding}
                isAnchoring={isAnchoring}
                anchorError={anchorError}
                signingRole={signingAuthorityRole}
                signingError={signingAuthorityError}
                onChainRoleAuthorities={onChainRoleAuthorities}
                onRoleAuthoritiesInitialized={onRoleAuthoritiesInitialized}
                signerServicesConfigured={signerServicesConfigured}
              />
            ) : (
              <SectionCard title="Batch Authority Binding" icon={<Lock size={18} />}>
                <div className="panel-note">
                  Authority binding is not created yet. Advance to Phase 1 (register treasury handoff) before authority binding can be built.
                </div>
              </SectionCard>
            )}
          </div>

          <div className="xl:col-span-2">
            <TreasuryFundingSection
              batch={batch}
              currentPhase={model.currentPhase}
              onVerifyFunding={onVerifyFunding}
              onManualConfirmFunding={onManualConfirmFunding}
              isVerifying={isVerifyingFunding}
              verificationError={fundingVerificationError}
            />
          </div>
        </div>
      ) : null}

      {activeTab === 'aaa' ? (
        model.currentPhase < 4
          ? <PhaseLocked message="AAA allocation unavailable until wallet funding is verified (Phase 4)." requiredPhase={4} />
          : <AaaAllocationSection
              batch={batch}
              evidence={evidence}
              currentPhase={model.currentPhase}
            />
      ) : null}

      {activeTab === 'deployment' ? (
        model.currentPhase < 5
          ? <PhaseLocked message="Deployment unavailable until funding is verified and AAA allocation is complete." requiredPhase={5} />
          : <div className="space-y-4">
          <DestinationApprovalSection batch={batch} evidence={evidence} currentPhase={model.currentPhase} />
          <DeploymentApprovalSection
            batch={batch}
            evidence={evidence}
            currentPhase={model.currentPhase}
          />
          <DeploymentExecutionSection
            batch={batch}
            evidence={evidence}
            currentPhase={model.currentPhase}
          />
          <SectionCard title="Deployment Legs" icon={<Layers size={18} />}>
            {/* ── Execution summary banner ── */}
            {(() => {
              const exec = getLatestDeploymentExecution(batch);
              const p7evSum = evidence[7]?.evidence_json as Record<string, unknown> | undefined;
              const p8evSum = evidence[8]?.evidence_json as Record<string, unknown> | undefined;
              const approvedByDisplay = (p7evSum?.approvedBy as string | undefined) ?? batch.deploymentApproval.approvedBy;
              const p8LegsSum = p8evSum && Array.isArray(p8evSum.legs)
                ? p8evSum.legs as Array<{ legId: string; status: string; txHash?: string; executedAt?: number }>
                : null;
              const executedByDisplay = (p8evSum?.executedBy as string | undefined) ?? exec?.executedBy;
              const executedAtDisplay = p8evSum?.executedAt != null
                ? new Date(Number(p8evSum.executedAt) * 1000).toISOString()
                : exec?.executedAt;
              const execTxHash = (p8LegsSum && p8LegsSum.length > 0 ? p8LegsSum[0].txHash : null) ?? exec?.deploymentTxHash;
              const totalDeployed = model.deploymentLegs.reduce((s, l) => s + l.amountUsd, 0);
              const totalReturned = model.deploymentLegs.every(l => l.settledAmountUsd != null)
                ? model.deploymentLegs.reduce((s, l) => s + (l.settledAmountUsd ?? 0), 0)
                : null;
              return (
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Deployment approval" value={deploymentApprovalLabel(batch)} />
                  <Field label="Deployment execution" value={deploymentExecutionLabel(batch)} />
                  <Field label="Approved by" value={approvedByDisplay ?? 'Pending'} />
                  {executedByDisplay && <Field label="Executed by" value={executedByDisplay} />}
                  {executedAtDisplay && <Field label="Executed at" value={formatDateTime(executedAtDisplay)} />}
                  {execTxHash && (
                    <Field label="Execution tx" value={<span className="font-mono text-[11px]">{shortHash(execTxHash)}</span>} />
                  )}
                  <Field label="Total deployed" value={fmtUsd(totalDeployed)} />
                  {totalReturned != null && (
                    <Field label="Total returned" value={fmtUsd(totalReturned)} />
                  )}
                  {model.pnlUsd != null && (
                    <Field label="Overall P&L" value={
                      <span className={model.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {model.pnlUsd >= 0 ? '+' : ''}{fmtUsd(model.pnlUsd)}
                        {model.pnlPct != null && ` (${model.pnlPct >= 0 ? '+' : ''}${model.pnlPct.toFixed(2)}%)`}
                      </span>
                    } />
                  )}
                </div>
              );
            })()}
            {model.deploymentLegs.length === 0 ? (
              <div className="panel-note">No deployment legs are attached. Verify funding before deployment planning.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {model.deploymentLegs.map((leg) => {
                  const isExecuted = ['executed', 'deployed', 'monitoring', 'settled'].includes(leg.status);
                  const isSettledLeg = leg.status === 'settled' || leg.settledAmountUsd != null;
                  return (
                    <div key={leg.legId} className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            {PROVIDER_LABELS[leg.provider as keyof typeof PROVIDER_LABELS] ?? leg.provider}
                          </div>
                          <div className="mt-1 font-semibold text-slate-100">{leg.asset}</div>
                        </div>
                        <StatusBadge
                          label={titleCase(leg.status)}
                          tone={leg.status === 'exception' ? 'danger' : isExecuted ? 'success' : 'warning'}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {leg.phase7Warning && (
                          <div className="col-span-2 rounded border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-400">
                            {leg.phase7Warning}
                          </div>
                        )}
                        <Field label="Allocation" value={
                          leg.allocationPercent > 0 || leg.plannedSource === 'phase7_evidence'
                            ? <span className="flex items-center gap-1">
                                {fmtPct(leg.allocationPercent)}
                                {leg.plannedSource === 'phase7_evidence' && <span className="data-chip text-[9px] text-emerald-300">phase7_evidence</span>}
                              </span>
                            : <span className="text-amber-400 text-[10px]">Unavailable</span>
                        } />
                        <Field label="Amount" value={
                          <span className="flex items-center gap-1">
                            {fmtUsd(leg.amountUsd)}
                            {leg.plannedAmountUsd6 && <span className="data-chip text-[9px] text-emerald-300">phase7_evidence</span>}
                          </span>
                        } />
                        <Field label="Target yield" value={
                          leg.targetYieldBps > 0 || leg.plannedSource === 'phase7_evidence'
                            ? <span className="flex items-center gap-1">
                                {leg.targetYieldBps} bps
                                {leg.plannedSource === 'phase7_evidence' && <span className="data-chip text-[9px] text-emerald-300">phase7_evidence</span>}
                              </span>
                            : <span className="text-amber-400 text-[10px]">Unavailable</span>
                        } />
                        <Field label="Adapter" value={titleCase(leg.strategyType)} />
                        <Field label="Destination" value={leg.destinationName ?? 'Pending'} />
                        <Field label="Destination type" value={leg.destinationType ?? '—'} />
                        {leg.deploymentTxHash && (
                          <div className="col-span-2">
                            <Field label="Deploy tx" value={
                              <span className="flex items-center gap-1.5">
                                <span className="font-mono text-[11px]">{shortHash(leg.deploymentTxHash)}</span>
                                <span className="data-chip text-[9px] text-emerald-300">phase8_evidence</span>
                              </span>
                            } />
                          </div>
                        )}
                        {leg.deployedAt && (
                          <div className="col-span-2">
                            <Field label="Deployed at" value={
                              <span className="flex items-center gap-1.5">
                                {formatDateTime(leg.deployedAt)}
                                <span className="data-chip text-[9px] text-emerald-300">phase8_evidence</span>
                              </span>
                            } />
                          </div>
                        )}
                        {isSettledLeg && (
                          <>
                            <Field label="Returned" value={
                              leg.settledAmountUsd != null
                                ? <span className="flex items-center gap-1.5">
                                    {fmtUsd(leg.settledAmountUsd)}
                                    <span className="data-chip text-[9px] text-emerald-300">phase9_evidence</span>
                                  </span>
                                : '—'
                            } />
                            <Field label="Leg P&L" value={
                              leg.legPnlUsd != null
                                ? <span className={leg.legPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {leg.legPnlUsd >= 0 ? '+' : ''}{fmtUsd(leg.legPnlUsd)}
                                    {leg.legPnlPct != null && ` (${leg.legPnlPct >= 0 ? '+' : ''}${leg.legPnlPct.toFixed(2)}%)`}
                                  </span>
                                : '—'
                            } />
                          </>
                        )}
                        {!isExecuted && leg.currentValueUsd != null && (
                          <Field label="Current" value={fmtUsd(leg.currentValueUsd)} />
                        )}
                        {leg.isDevSimulated && (
                          <>
                            <div className="col-span-2 flex items-center gap-2 rounded border border-violet-500/30 bg-violet-950/30 px-2 py-1 text-[10px]">
                              <span className="data-chip text-[9px] text-violet-300">dev_simulation</span>
                              <span className="text-violet-300">
                                {leg.devLegStatus === 'returned' ? 'Returned (settlement pending)' :
                                 leg.devLegStatus === 'marked' ? 'Marked (unrealized P&L)' :
                                 'Deployed (position open)'}
                              </span>
                              {devLegPositions.find(p => p.leg_id === leg.legId)?.simulation_scenario && (
                                <span className="data-chip text-[9px] text-violet-300 capitalize">
                                  {(devLegPositions.find(p => p.leg_id === leg.legId)?.simulation_scenario ?? '').replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                            {leg.devLegStatus !== 'deployed' && leg.currentValueUsd6Dev != null && (
                              <Field label="Current (dev)" value={
                                <span className="flex items-center gap-1 text-violet-300">
                                  {fmtUsd(Number(leg.currentValueUsd6Dev) / 1_000_000)}
                                  {leg.unrealizedPnlBpsDev != null && (
                                    <span className={leg.unrealizedPnlBpsDev >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                      ({leg.unrealizedPnlBpsDev >= 0 ? '+' : ''}{leg.unrealizedPnlBpsDev} bps)
                                    </span>
                                  )}
                                </span>
                              } />
                            )}
                          </>
                        )}
                        <div className="col-span-2">
                          <Field label="Destination address" value={
                            leg.destinationAddress
                              ? <span className="font-mono text-[11px]">{shortHash(leg.destinationAddress)}</span>
                              : 'Pending'
                          } />
                        </div>
                        {leg.providerReferenceId && (
                          <div className="col-span-2">
                            <Field label="Provider reference" value={leg.providerReferenceId} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === 'settlement' ? (
        model.currentPhase < 8
          ? <PhaseLocked message="Settlement unavailable until deployment legs execute (Phase 8)." requiredPhase={8} />
          : <SectionCard title="Settlement" icon={<FileCheck size={18} />}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`data-chip text-[9px] ${model.settlementSource === 'phase9_evidence' ? 'text-emerald-400' : model.settlementSource === 'batch_object' ? 'text-amber-400' : 'text-slate-500'}`}>
              {model.settlementSource === 'phase9_evidence' ? 'phase9_evidence' : model.settlementSource === 'batch_object' ? 'batch_object (unconfirmed)' : 'pending'}
            </span>
            {model.settlementEvidenceHash && (
              <span className="data-chip text-[9px]" title={model.settlementEvidenceHash}>Phase 9 evidence hash: {shortHash(model.settlementEvidenceHash)}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Maturity date" value={formatDateTime(model.maturityDate ?? undefined)} />
            <Field label="Settlement status" value={model.isSettled ? 'Settled' : titleCase(batch.settlement.status)} />
            <Field label="Expected return" value={model.expectedReturnUsd == null ? 'Pending' : fmtUsd(model.expectedReturnUsd)} />
            <Field label="Returned amount" value={model.returnedAmountUsd == null ? 'Pending' : fmtUsd(model.returnedAmountUsd)} />
            <Field label="Bank repayment amount" value={model.bankRepaymentAmountUsd == null ? 'Pending' : fmtUsd(model.bankRepaymentAmountUsd)} />
            <Field label="Surplus / spread" value={model.surplusUsd == null ? 'Pending' : fmtUsd(model.surplusUsd)} />
            <Field label="P&L" value={
              model.pnlUsd == null
                ? 'Pending'
                : <span className={model.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {model.pnlUsd >= 0 ? '+' : ''}{fmtUsd(model.pnlUsd)}
                    {model.pnlPct != null && ` (${model.pnlPct >= 0 ? '+' : ''}${model.pnlPct.toFixed(2)}%)`}
                  </span>
            } />
            {model.settlementTxHash ? (
              <Field label="Settlement tx" value={<span className="font-mono text-[11px]">{shortHash(model.settlementTxHash)}</span>} />
            ) : model.settlementReference ? (
              <Field label="Settlement ref" value={
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px]">{shortHash(model.settlementReference)}</span>
                  <span className={`data-chip text-[9px] ${model.settlementReferenceType === 'treasury_notification' ? 'text-sky-400' : 'text-amber-400'}`}>
                    {model.settlementReferenceType ?? 'ref'}
                  </span>
                </span>
              } />
            ) : null}
            {model.custodySettlementStatus && (
              <Field label="Treasury USDC" value={
                <span className="flex items-center gap-1.5 flex-wrap">
                  {model.custodySettlementStatus === 'funds_returned' ? (
                    <>
                      <span className="data-chip text-[9px] text-emerald-400">USDC returned on-chain</span>
                      {model.depositReturnTxHash && (
                        <span className="font-mono text-[11px] text-slate-400">{shortHash(model.depositReturnTxHash)}</span>
                      )}
                    </>
                  ) : model.custodySettlementStatus === 'simulated_only' ? (
                    <span className="data-chip text-[9px] text-amber-400">SIMULATED — no real USDC returned · Treasury balance NOT updated</span>
                  ) : (
                    <span className="data-chip text-[9px] text-sky-400">on_chain (returned before Phase 9)</span>
                  )}
                </span>
              } />
            )}
            <Field label="Settled at" value={formatDateTime(model.settledAt ?? undefined)} />
            <Field label="Wallet retirement" value={model.isSettled ? 'Settled' : walletRetirementLabel(batch)} />
          </div>
          {model.deploymentLegs.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Per-leg Settlement
                {model.deploymentLegs[0]?.legSettlementMethod && (
                  <span className="data-chip text-[9px] text-amber-400 normal-case">
                    {model.deploymentLegs[0].legSettlementMethod}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      <th className="pb-2 pr-4">Leg</th>
                      <th className="pb-2 pr-4 text-right">Deployed</th>
                      <th className="pb-2 pr-4 text-right">Returned</th>
                      <th className="pb-2 pr-4 text-right">P&L</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.deploymentLegs.map(leg => (
                      <tr key={leg.legId} className="border-b border-slate-800/60">
                        <td className="py-2 pr-4 text-slate-300">{leg.destinationName ?? leg.provider}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmtUsd(leg.amountUsd)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{leg.settledAmountUsd != null ? fmtUsd(leg.settledAmountUsd) : '—'}</td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {leg.legPnlUsd != null
                            ? <span className={leg.legPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>{leg.legPnlUsd >= 0 ? '+' : ''}{fmtUsd(leg.legPnlUsd)}</span>
                            : '—'}
                        </td>
                        <td className="py-2">{titleCase(leg.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>
      ) : null}

      {activeTab === 'performance' ? (
        model.currentPhase < 5 && !model.isSettled
          ? <PhaseLocked message="Performance unavailable until allocation and deployment begin (Phase 5)." requiredPhase={5} />
          : <SectionCard title="Performance" icon={<LineChart size={18} />}>
          {model.isSettled ? (
            /* ── Settled: Phase 9 evidence is canonical ── */
            <div className="space-y-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`data-chip text-[9px] ${model.settlementSource === 'phase9_evidence' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {model.settlementSource === 'phase9_evidence' ? 'phase9_evidence' : 'batch_object (unconfirmed)'}
                </span>
                {model.settlementScenarioLabel && (
                  <span className="data-chip text-[9px] text-violet-300">
                    Scenario: {model.settlementScenarioLabel}
                  </span>
                )}
                {model.termMonthsEvidence != null && (
                  <span className="data-chip text-[9px] text-slate-400">
                    {model.termMonthsEvidence}M term
                  </span>
                )}
                {model.annualYieldBps != null && model.annualYieldBps > 0 && (
                  <span className="data-chip text-[9px] text-slate-400">
                    {(model.annualYieldBps / 100).toFixed(2)}% APR
                    {model.termAdjustedYieldBps != null && model.termAdjustedYieldBps !== model.annualYieldBps
                      ? ` → ${(model.termAdjustedYieldBps / 100).toFixed(2)}% term`
                      : ''}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Principal" value={
                  <span className="flex items-center gap-1.5">
                    {fmtUsd(model.principalUsd)}
                    <span className={`data-chip text-[9px] ${model.principalSource === 'phase1_evidence' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {model.principalSource}
                    </span>
                  </span>
                } />
                <Field label="Returned" value={
                  model.returnedAmountUsd != null
                    ? <span className="flex items-center gap-1.5">
                        {fmtUsd(model.returnedAmountUsd)}
                        <span className="data-chip text-[9px] text-emerald-400">{model.settlementSource}</span>
                      </span>
                    : 'Pending'
                } />
                <Field label="P&L" value={
                  model.pnlUsd != null
                    ? <span className="flex items-center gap-1.5">
                        <span className={model.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {model.pnlUsd >= 0 ? '+' : ''}{fmtUsd(model.pnlUsd)}
                          {model.pnlPct != null && ` (${model.pnlPct >= 0 ? '+' : ''}${model.pnlPct.toFixed(2)}%)`}
                        </span>
                        <span className="data-chip text-[9px] text-emerald-400">{model.settlementSource}</span>
                      </span>
                    : 'Pending'
                } />
                <Field label="Settled at" value={formatDateTime(model.settledAt ?? undefined)} />
                {model.termAdjustedYieldBps != null && model.termAdjustedYieldBps > 0 && model.grossReturnBpsForTerm != null && (
                  <Field label="Return vs promised" value={
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className={model.grossReturnBpsForTerm >= model.termAdjustedYieldBps ? 'text-emerald-400' : 'text-amber-400'}>
                        {model.grossReturnBpsForTerm >= 0 ? '+' : ''}{(model.grossReturnBpsForTerm / 100).toFixed(2)}% actual
                      </span>
                      <span className="text-slate-500">vs {(model.termAdjustedYieldBps / 100).toFixed(2)}% promised</span>
                    </span>
                  } />
                )}
                {model.treasurySurplusUsd != null && model.treasurySurplusUsd > 0 && (
                  <Field label="Treasury surplus" value={
                    <span className="flex items-center gap-1.5">
                      <span className="text-emerald-400">{fmtUsd(model.treasurySurplusUsd)}</span>
                      <span className="data-chip text-[9px] text-emerald-300">phase9_evidence</span>
                    </span>
                  } />
                )}
                {model.reserveCoverageUsd != null && model.reserveCoverageUsd > 0 && (
                  <Field label="Reserve coverage" value={
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-400">{fmtUsd(model.reserveCoverageUsd)}</span>
                      <span className="data-chip text-[9px] text-amber-300">phase9_evidence</span>
                    </span>
                  } />
                )}
                {model.uncoveredShortfallUsd != null && model.uncoveredShortfallUsd > 0 && (
                  <Field label="Uncovered shortfall" value={
                    <span className="flex items-center gap-1.5">
                      <span className="text-rose-400">{fmtUsd(model.uncoveredShortfallUsd)}</span>
                      <span className="data-chip text-[9px] text-rose-300">phase9_evidence</span>
                    </span>
                  } />
                )}
                {batch.performance.realizedYieldUsd != null && model.pnlUsd != null &&
                  Math.abs(batch.performance.realizedYieldUsd - model.pnlUsd) > 0.01 && (
                  <Field label="Realized yield (batch object)" value={
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-400">{fmtUsd(batch.performance.realizedYieldUsd)}</span>
                      <span className="data-chip text-[9px] text-amber-400">unconfirmed</span>
                    </span>
                  } />
                )}
              </div>
              {model.deploymentLegs.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Per-leg Breakdown</div>
                  <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          <th className="px-3 py-2">Leg</th>
                          <th className="px-3 py-2 text-right">Deployed</th>
                          <th className="px-3 py-2 text-right">Returned</th>
                          <th className="px-3 py-2 text-right">P&L</th>
                          <th className="px-3 py-2 text-right">P&L %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.deploymentLegs.map(leg => (
                          <tr key={leg.legId} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                            <td className="px-3 py-2 text-slate-300">
                              {leg.destinationName ?? PROVIDER_LABELS[leg.provider as keyof typeof PROVIDER_LABELS] ?? leg.provider}
                              <span className="ml-1.5 text-slate-500">{leg.asset}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{fmtUsd(leg.amountUsd)}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              {leg.settledAmountUsd != null ? fmtUsd(leg.settledAmountUsd) : <span className="text-slate-500">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {leg.legPnlUsd != null
                                ? <span className={leg.legPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {leg.legPnlUsd >= 0 ? '+' : ''}{fmtUsd(leg.legPnlUsd)}
                                  </span>
                                : <span className="text-slate-500">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {leg.legPnlPct != null
                                ? <span className={leg.legPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {leg.legPnlPct >= 0 ? '+' : ''}{leg.legPnlPct.toFixed(2)}%
                                  </span>
                                : <span className="text-slate-500">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Active: server valuation snapshot ── */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Principal" value={
                  <span className="flex items-center gap-1.5">
                    {fmtUsd(model.principalUsd)}
                    <span className={`data-chip text-[9px] ${model.principalSource === 'phase1_evidence' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {model.principalSource}
                    </span>
                  </span>
                } />
                <Field label="Projected yield" value={fmtUsd(batch.performance.projectedYieldUsd)} />
                <Field label="Projected return at maturity" value={fmtUsd(model.principalUsd + batch.performance.projectedYieldUsd)} />
                <Field label="Current value" value={
                  batch.performance.currentValueUsd != null
                    ? fmtUsd(batch.performance.currentValueUsd)
                    : 'Pending'
                } />
                {batch.performance.varianceBps != null && (
                  <Field label="Variance" value={`${batch.performance.varianceBps} bps`} />
                )}
                <Field label="Last marked at" value={formatDateTime(batch.performance.lastUpdatedAt)} />
              </div>
              {model.deploymentLegs.some(l => l.currentValueUsd != null) && (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Per-leg Mark-to-Market</div>
                  <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          <th className="px-3 py-2">Leg</th>
                          <th className="px-3 py-2 text-right">Deployed</th>
                          <th className="px-3 py-2 text-right">Current Value</th>
                          <th className="px-3 py-2 text-right">Unrealized</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.deploymentLegs.map(leg => {
                          const unrealized = leg.currentValueUsd != null ? leg.currentValueUsd - leg.amountUsd : null;
                          return (
                            <tr key={leg.legId} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                              <td className="px-3 py-2 text-slate-300">
                                {leg.destinationName ?? PROVIDER_LABELS[leg.provider as keyof typeof PROVIDER_LABELS] ?? leg.provider}
                                <span className="ml-1.5 text-slate-500">{leg.asset}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{fmtUsd(leg.amountUsd)}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {leg.currentValueUsd != null ? fmtUsd(leg.currentValueUsd) : <span className="text-slate-500">—</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {unrealized != null
                                  ? <span className={unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                      {unrealized >= 0 ? '+' : ''}{fmtUsd(unrealized)}
                                    </span>
                                  : <span className="text-slate-500">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* Banking reconciliation — only shown when Phase 9 evidence is present */}
      {evidence[9] && (
        <SectionCard title="Banking Reconciliation" icon={<Database size={18} />}>
          {reconSummary ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {model.settlementScenarioLabel && (
                  <span className="data-chip text-[9px] text-violet-300">
                    Scenario: {model.settlementScenarioLabel}
                  </span>
                )}
                {reconSummary.posted > 0 && (
                  <span className="data-chip text-emerald-400 text-[10px]">
                    {reconSummary.posted} posted
                  </span>
                )}
                {reconSummary.pending > 0 && (
                  <span className="data-chip text-amber-400 text-[10px]">
                    {reconSummary.pending} pending
                  </span>
                )}
                {reconSummary.failed > 0 && (
                  <span className="data-chip text-rose-400 text-[10px]">
                    {reconSummary.failed} failed
                  </span>
                )}
                {reconSummary.skipped > 0 && (
                  <span className="data-chip text-slate-400 text-[10px]">
                    {reconSummary.skipped} skipped
                  </span>
                )}
                {reconSummary.lastPostedAt && (
                  <span className="text-[10px] text-slate-500">
                    last posted {new Date(reconSummary.lastPostedAt).toLocaleString()}
                  </span>
                )}
              </div>
              {reconRows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="px-3 py-2">Institution</th>
                        <th className="px-3 py-2 text-right">Principal</th>
                        <th className="px-3 py-2 text-right">Payout</th>
                        <th className="px-3 py-2 text-right">P&L</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Scenario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconRows.map(row => {
                        const principal = Number(row.principal_usd6) / 1_000_000;
                        const payout    = Number(row.user_payout_usd6) / 1_000_000;
                        const pnl       = Number(row.realized_pnl_usd6) / 1_000_000;
                        const statusColor =
                          row.fineract_writeback_status === 'posted'  ? 'text-emerald-400' :
                          row.fineract_writeback_status === 'failed'  ? 'text-rose-400' :
                          row.fineract_writeback_status === 'pending' ? 'text-amber-400' :
                          'text-slate-400';
                        return (
                          <tr key={row.reconciliation_id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                            <td className="px-3 py-2 text-slate-300">
                              {row.institution_display_name ?? row.origin_institution_id}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{fmtUsd(principal)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtUsd(payout)}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              <span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`data-chip text-[9px] ${statusColor}`}>
                                {row.fineract_writeback_status}
                              </span>
                              {row.error_code && (
                                <span className="ml-1 text-[9px] text-rose-400" title={row.error_code}>
                                  {row.error_code}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-400 text-[10px]">
                              {row.settlement_scenario ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>No reconciliation records yet.</span>
              <span className="data-chip text-[9px]">Run POST /banking/escrow/reconcile-settlements to populate.</span>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === 'audit' ? (() => {
        // ── Helpers ──────────────────────────────────────────────────────────
        const STATUS_COLOR: Record<string, string> = {
          confirmed:       'text-emerald-400',
          observed:        'text-sky-400',
          simulated_dev:   'text-amber-400',
          internal_record: 'text-slate-400',
          missing:         'text-red-400',
          mismatch:        'text-red-400',
        };
        const KIND_CHIP: Record<string, string> = {
          ONCHAIN_TRANSACTION: 'text-emerald-300',
          TOKEN_TRANSFER:      'text-emerald-300',
          CONTRACT_EVENT:      'text-emerald-300',
          PHASE_EVIDENCE:      'text-sky-400',
          DEV_SIMULATION_RECORD:    'text-amber-400',
          TREASURY_ACCOUNTING_RECORD: 'text-slate-400',
          TERM_POSITION_UPDATE:     'text-slate-400',
          FINERACT_RECEIPT:    'text-purple-400',
          CLIENT_SESSION_PREVIEW: 'text-slate-500',
        };
        const isOnChainProof = (e: BatchAuditEvent) =>
          ['ONCHAIN_TRANSACTION', 'TOKEN_TRANSFER', 'CONTRACT_EVENT'].includes(e.eventKind);
        const isInternalOrDev = (e: BatchAuditEvent) =>
          ['DEV_SIMULATION_RECORD', 'TREASURY_ACCOUNTING_RECORD', 'TERM_POSITION_UPDATE',
           'FINERACT_RECEIPT', 'CLIENT_SESSION_PREVIEW', 'PHASE_EVIDENCE'].includes(e.eventKind);
        const RECON_STATUS_COLOR: Record<string, string> = {
          pass:    'text-emerald-400',
          fail:    'text-red-400',
          missing: 'text-amber-400',
          warning: 'text-amber-400',
        };
        const OVERALL_STATUS_STYLE: Record<string, { color: string; label: string }> = {
          verified:      { color: 'text-emerald-400', label: 'Verified' },
          missing_proof: { color: 'text-amber-400',   label: 'Missing Proof' },
          mismatch:      { color: 'text-red-400',     label: 'Mismatch' },
          incomplete:    { color: 'text-slate-400',   label: 'Incomplete' },
        };
        const explorerBase = process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? '';
        const explorerLink = (hash: string | null) =>
          explorerBase && hash ? `${explorerBase.replace(/\/$/, '')}/tx/${hash}` : null;

        const exportAudit = () => {
          if (!auditTrail) return;
          const blob = new Blob([JSON.stringify(auditTrail, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `audit-onchain-${batch.batchId.slice(0, 8)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        };

        const onChainEvents = auditTrail?.events.filter(isOnChainProof) ?? [];
        const moneyMovement = auditTrail?.events.filter(
          e => ['treasury_to_escrow_transfer', 'escrow_batch_received', 'wallet_funded',
                 'leg_deployed', 'leg_returned', 'settlement_finalized', 'treasury_return_recorded'].includes(e.movementType)
        ) ?? [];
        const internalDevEvents = auditTrail?.events.filter(isInternalOrDev) ?? [];

        const summary = auditTrail?.summary;
        const overallStyle = summary ? (OVERALL_STATUS_STYLE[summary.overallAuditStatus] ?? OVERALL_STATUS_STYLE.incomplete) : null;

        return (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-200">On-Chain Audit Trail</span>
                {summary && overallStyle && (
                  <span className={`data-chip text-[10px] font-bold ${overallStyle.color}`}>
                    {overallStyle.label}
                  </span>
                )}
                {auditLoading && <span className="text-[10px] text-slate-500 animate-pulse">Loading…</span>}
              </div>
              <button type="button" className="text-[11px] text-slate-400 hover:text-slate-200" onClick={exportAudit} disabled={!auditTrail}>
                Export JSON
              </button>
            </div>

            {auditError && (
              <div className="rounded border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                Audit load error: {auditError}
              </div>
            )}

            {/* ── Section 1: Verification Summary ─────────────────────────── */}
            {summary && (
              <SectionCard title="Verification Summary" icon={<ShieldCheck size={16} />}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    { label: 'Status',            value: overallStyle?.label ?? '—', color: overallStyle?.color ?? 'text-slate-400' },
                    { label: 'Chain Txs Confirmed', value: String(summary.confirmedOnchainTxCount), color: summary.confirmedOnchainTxCount > 0 ? 'text-emerald-400' : 'text-slate-400' },
                    { label: 'Missing Proof',      value: String(summary.missingProofCount),    color: summary.missingProofCount > 0 ? 'text-red-400' : 'text-emerald-400' },
                    { label: 'Mismatches',         value: String(summary.mismatchCount),         color: summary.mismatchCount > 0 ? 'text-red-400' : 'text-emerald-400' },
                    { label: 'Internal / Dev',     value: String(summary.internalRecordCount + summary.simulatedDevCount), color: 'text-slate-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded border border-slate-700/40 bg-slate-800/30 p-2 text-center">
                      <div className={`text-base font-bold ${color}`}>{value}</div>
                      <div className="mt-0.5 text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
                {summary.overallAuditStatus === 'mismatch' && (
                  <div className="mt-3 rounded border border-red-500/30 bg-red-900/10 px-3 py-2 text-xs text-red-400">
                    Financial mismatch detected. Batch cannot be considered audit-verified.
                    Check Accounting Reconciliation section below for details.
                  </div>
                )}
                {summary.overallAuditStatus === 'missing_proof' && (
                  <div className="mt-3 rounded border border-amber-500/30 bg-amber-900/10 px-3 py-2 text-xs text-amber-400">
                    Expected on-chain transaction proof is missing. See On-chain Transactions below for missing rows.
                  </div>
                )}
              </SectionCard>
            )}

            {/* ── Section 2: On-chain Transactions ─────────────────────────── */}
            <SectionCard title="On-chain Transactions" icon={<Database size={16} />}>
              {auditLoading && <div className="py-4 text-center text-xs text-slate-500 animate-pulse">Loading audit data…</div>}
              {!auditLoading && onChainEvents.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-500">
                  No on-chain transaction proof collected yet.
                  {!auditTrail && ' Audit trail not loaded — open this tab to fetch.'}
                </div>
              )}
              {onChainEvents.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="pb-2 pr-3">Phase</th>
                        <th className="pb-2 pr-3">Movement</th>
                        <th className="pb-2 pr-3">From → To</th>
                        <th className="pb-2 pr-3">Amount</th>
                        <th className="pb-2 pr-3">Tx Hash</th>
                        <th className="pb-2 pr-3">Block</th>
                        <th className="pb-2 pr-3">Kind</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onChainEvents.map(e => {
                        const link = explorerLink(e.txHash);
                        return (
                          <tr key={e.id} className={`border-b border-slate-800/40 hover:bg-slate-800/20 ${e.status === 'missing' ? 'bg-red-900/10' : ''}`}>
                            <td className="py-2 pr-3 text-slate-400">{e.phase != null ? `P${e.phase}` : '—'}</td>
                            <td className="py-2 pr-3 text-slate-300 font-medium">{e.movementType.replace(/_/g, ' ')}</td>
                            <td className="py-2 pr-3 font-mono text-[10px] text-slate-500">
                              {e.fromAddress ? shortHash(e.fromAddress) : '—'}
                              {(e.fromAddress || e.toAddress) ? ' → ' : ''}
                              {e.toAddress ? shortHash(e.toAddress) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-slate-300">{e.amountDisplay ?? '—'}</td>
                            <td className="py-2 pr-3 font-mono text-[10px]">
                              {e.txHash ? (
                                link
                                  ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline flex items-center gap-1">{shortHash(e.txHash)}<ExternalLink size={10}/></a>
                                  : <span className="text-slate-300">{shortHash(e.txHash)}</span>
                              ) : (
                                <span className="text-red-400 italic">missing</span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-slate-500">{e.blockNumber ?? '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`data-chip text-[9px] ${KIND_CHIP[e.eventKind] ?? 'text-slate-400'}`}>{e.eventKind}</span>
                            </td>
                            <td className="py-2">
                              <span className={`data-chip text-[9px] ${STATUS_COLOR[e.status] ?? 'text-slate-400'}`}>{e.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* ── Section 3: Money Movement ─────────────────────────────────── */}
            <SectionCard title="Money Movement" icon={<ArrowRight size={16} />}>
              {moneyMovement.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">No money movement events collected.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="pb-2 pr-3">Phase</th>
                        <th className="pb-2 pr-3">Movement</th>
                        <th className="pb-2 pr-3">From → To</th>
                        <th className="pb-2 pr-3">Asset</th>
                        <th className="pb-2 pr-3">Amount</th>
                        <th className="pb-2 pr-3">Source Authority</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moneyMovement.map(e => (
                        <tr key={e.id} className={`border-b border-slate-800/40 hover:bg-slate-800/20 ${e.status === 'missing' ? 'bg-red-900/10' : ''}`}>
                          <td className="py-2 pr-3 text-slate-400">{e.phase != null ? `P${e.phase}` : '—'}</td>
                          <td className="py-2 pr-3 text-slate-300">{e.movementType.replace(/_/g, ' ')}</td>
                          <td className="py-2 pr-3 font-mono text-[10px] text-slate-500">
                            {e.fromAddress ? shortHash(e.fromAddress) : '—'}
                            {(e.fromAddress || e.toAddress) ? ' → ' : ''}
                            {e.toAddress ? shortHash(e.toAddress) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-slate-400">{e.assetSymbol ?? '—'}</td>
                          <td className="py-2 pr-3 text-slate-300 font-medium">{e.amountDisplay ?? '—'}</td>
                          <td className="py-2 pr-3">
                            <span className="data-chip text-[9px] text-slate-400">{e.sourceAuthority}</span>
                          </td>
                          <td className="py-2">
                            <span className={`data-chip text-[9px] ${STATUS_COLOR[e.status] ?? 'text-slate-400'}`}>{e.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* ── Section 4: Accounting Reconciliation ─────────────────────── */}
            <SectionCard title="Accounting Reconciliation" icon={<FileCheck size={16} />}>
              {!auditTrail || auditTrail.reconciliationChecks.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">No reconciliation checks available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="pb-2 pr-3">Check</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2 pr-3">Expected (Source A)</th>
                        <th className="pb-2 pr-3">Observed (Source B)</th>
                        <th className="pb-2 pr-3">Tolerance</th>
                        <th className="pb-2">Resolution Hint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditTrail.reconciliationChecks.map(c => (
                        <tr key={c.checkName} className={`border-b border-slate-800/40 hover:bg-slate-800/20 ${c.status === 'fail' ? 'bg-red-900/10' : c.status === 'missing' ? 'bg-amber-900/10' : ''}`}>
                          <td className="py-2 pr-3 font-mono text-[10px] text-slate-300">{c.checkName}</td>
                          <td className="py-2 pr-3">
                            <span className={`data-chip text-[9px] font-bold ${RECON_STATUS_COLOR[c.status] ?? 'text-slate-400'}`}>
                              {c.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-slate-400">
                            <div className="font-mono text-[10px]">{c.expected != null ? (Number(c.expected) / 1e6).toFixed(2) : '—'}</div>
                            <div className="text-[9px] text-slate-600 truncate max-w-[180px]" title={c.sourceA}>{c.sourceA}</div>
                          </td>
                          <td className="py-2 pr-3 text-slate-400">
                            <div className="font-mono text-[10px]">{c.observed != null ? (Number(c.observed) / 1e6).toFixed(2) : '—'}</div>
                            <div className="text-[9px] text-slate-600 truncate max-w-[180px]" title={c.sourceB}>{c.sourceB}</div>
                          </td>
                          <td className="py-2 pr-3 text-slate-500 font-mono text-[10px]">
                            {c.tolerance != null ? `±${(Number(c.tolerance) / 1e6).toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 text-[10px] text-slate-500 max-w-[200px]">{c.resolutionHint ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* ── Section 5: Internal / Dev / Client Records (collapsed) ─────── */}
            <div>
              <button
                type="button"
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 mb-2"
                onClick={() => setInternalCollapsed(v => !v)}
              >
                {internalCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                Internal / Dev / Client Records ({internalDevEvents.length})
                <span className="data-chip text-[9px] text-slate-500">phase_evidence · dev_simulation · fineract · client_session</span>
              </button>
              {!internalCollapsed && (
                <SectionCard title="" icon={null}>
                  <div className="mb-2 rounded border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[10px] text-amber-500">
                    These records are NOT on-chain proof. Dev simulation records, internal accounting rows,
                    and client-session events are shown for context only.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          <th className="pb-2 pr-3">Phase</th>
                          <th className="pb-2 pr-3">Kind</th>
                          <th className="pb-2 pr-3">Movement</th>
                          <th className="pb-2 pr-3">Amount</th>
                          <th className="pb-2 pr-3">Authority</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {internalDevEvents.map(e => (
                          <tr key={e.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                            <td className="py-2 pr-3 text-slate-500">{e.phase != null ? `P${e.phase}` : '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`data-chip text-[9px] ${KIND_CHIP[e.eventKind] ?? 'text-slate-500'}`}>{e.eventKind}</span>
                            </td>
                            <td className="py-2 pr-3 text-slate-400">{e.movementType.replace(/_/g, ' ')}</td>
                            <td className="py-2 pr-3 text-slate-400">{e.amountDisplay ?? '—'}</td>
                            <td className="py-2 pr-3">
                              <span className="data-chip text-[9px] text-slate-500">{e.sourceAuthority}</span>
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`data-chip text-[9px] ${STATUS_COLOR[e.status] ?? 'text-slate-400'}`}>{e.status}</span>
                            </td>
                            <td className="py-2 text-[10px] text-slate-500 max-w-[260px] truncate" title={e.notes ?? undefined}>{e.notes ?? '—'}</td>
                          </tr>
                        ))}
                        {internalDevEvents.length === 0 && (
                          <tr><td colSpan={7} className="py-4 text-center text-slate-500">No internal records.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}
            </div>

            {/* Legacy phase evidence / admin events / client session — preserved below internal section */}
            {batch.auditTrail.length > 0 && !internalCollapsed && (
              <SectionCard title="Client Session Events" icon={<Clock3 size={16} />}>
                <div className="mb-2 rounded border border-slate-700/30 bg-slate-800/20 px-3 py-2 text-[10px] text-slate-500">
                  CLIENT_SESSION_PREVIEW only — not proof of any on-chain action.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="pb-2 pr-3">Timestamp</th>
                        <th className="pb-2 pr-3">Event</th>
                        <th className="pb-2 pr-3">Actor</th>
                        <th className="pb-2">Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.auditTrail.map(ev => (
                        <tr key={ev.eventId} className="border-b border-slate-800/40 hover:bg-slate-800/20 opacity-60">
                          <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{formatDateTime(ev.timestamp)}</td>
                          <td className="py-2 pr-3 text-slate-400">{ev.eventType}</td>
                          <td className="py-2 pr-3 text-slate-500">{ev.actor ?? '—'}</td>
                          <td className="py-2 font-mono text-[10px] text-slate-600">{shortHash(ev.txHash ?? ev.reference ?? undefined)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}
          </div>
        );
      })() : null}
      </div>{/* tabs */}
    </section>
  );
}

const WALLET_FACTORY_URL = (process.env.NEXT_PUBLIC_WALLET_FACTORY_URL ?? '').replace(/\/$/, '');

function applyOnChainWalletBindingToBatch(
  batch: EscrowBatch,
  onChainBinding: OnChainBatchWalletBinding,
  opts?: { creationTxHash?: string; bindingTxHash?: string }
): EscrowBatch {
  if (!onChainBinding.exists) return batch;
  const walletAddress = onChainBinding.walletAddress;
  const eventId = `${batch.batchId}-batch-wallet-bound`;
  const hasEvent = batch.auditTrail.some((e) => e.eventId === eventId);
  const nextStatus: EscrowBatch['status'] =
    batch.status === 'treasury_received' || batch.status === 'wallet_requested'
      ? 'wallet_created'
      : batch.status;
  // Patch the legacy batchWalletBinding so its canonical hash stays consistent
  // with the real wallet address — prevents the mismatch guard from firing.
  const patchedBinding = batch.batchWalletBinding
    ? patchWalletBindingAddress(batch.batchWalletBinding, walletAddress)
    : createBatchWalletBinding(
        batch,
        {
          ...batch.wallet,
          address: walletAddress,
          walletAddress,
          walletType: 'batch_multisig',
          provider: 'wallet_factory',
          custodyMode: 'role_based_multisig',
          threshold: 2,
          signerAuthorities: batch.wallet.signerAuthorities ?? getDefaultEscrowSigningAuthorities(),
          fundingStatus: batch.wallet.fundingStatus === 'not_created' ? 'created' : batch.wallet.fundingStatus,
          createdAt: batch.wallet.createdAt ?? onChainBinding.boundAt,
          createdBy: 'Wallet Factory Service',
        },
        batch.wallet.createdAt ?? onChainBinding.boundAt
      );
  const bindingEventId = `${batch.batchId}-wallet-binding-created`;
  const hasBindingEvent = batch.auditTrail.some((e) => e.eventId === bindingEventId);

  return {
    ...batch,
    status: nextStatus,
    batchWalletBinding: patchedBinding,
    wallet: {
      ...batch.wallet,
      address: walletAddress,
      walletAddress,
      walletType: 'batch_multisig',
      provider: 'wallet_factory',
      custodyMode: 'role_based_multisig',
      threshold: 2,
      fundingStatus: batch.wallet.fundingStatus === 'not_created' ? 'created' : batch.wallet.fundingStatus,
      createdAt: batch.wallet.createdAt ?? onChainBinding.boundAt,
      createdBy: 'Wallet Factory Service',
      creationTxHash: opts?.creationTxHash ?? batch.wallet.creationTxHash,
      bindingTxHash: opts?.bindingTxHash ?? batch.wallet.bindingTxHash,
      boundAuthorityBindingHash: onChainBinding.batchAuthorityBindingHash,
      owners: {
        treasury: onChainBinding.ownerTreasury,
        escrow: onChainBinding.ownerEscrow,
        continuity: onChainBinding.ownerContinuity,
      },
    },
    auditTrail: [
      ...batch.auditTrail,
      ...(hasEvent
        ? []
        : [{
            eventId,
            timestamp: onChainBinding.boundAt,
            actor: 'Wallet Factory Service',
            eventType: 'Batch 2-of-3 multisig wallet created and bound',
            description: `BatchMultisigWallet deployed at ${walletAddress}. Owners: Treasury=${onChainBinding.ownerTreasury}, Escrow=${onChainBinding.ownerEscrow}, Continuity=${onChainBinding.ownerContinuity}. Threshold=2. Bound to batchAuthorityBindingHash ${onChainBinding.batchAuthorityBindingHash}.`,
            reference: walletAddress,
          }]),
      ...(!batch.batchWalletBinding && !hasBindingEvent ? [createWalletBindingAuditEvent(batch, patchedBinding)] : []),
    ],
  };
}

function applyBatchLifecycleStateFromChain(
  batch: EscrowBatch,
  chainState: OnChainBatchLifecycleState,
): EscrowBatch {
  let next = batch;

  if (chainState.anchor) {
    next = applyOnChainAnchorToBatch(next, chainState.anchor);
  }

  if (chainState.wallet) {
    next = applyOnChainWalletBindingToBatch(next, chainState.wallet);
  }

  const fundingVerified =
    next.custodyMode === 'batch_wallet_custody'
      ? chainState.walletFunded
      : chainState.treasuryBatchReceived && chainState.expectedAmountUsd > 0;

  if (fundingVerified && getFundingValidation(next).state !== 'verified') {
    next = applyFundingConfirmationToBatch(
      next,
      createFundingConfirmation({
        batch: next,
        observedAmountUsd: chainState.observedWalletBalanceUsd ?? chainState.expectedAmountUsd,
        confirmedBy: 'Escrow Chain State',
        confirmedAt: new Date().toISOString(),
        asset: next.asset || 'USDC',
        custodyMode: next.custodyMode,
        sourceContract: next.custodyMode === 'batch_wallet_custody'
          ? chainState.wallet?.walletAddress
          : next.sourceContract,
        sourceBatchId: chainState.sourceBatchId,
        sourceContractBalanceUsd: next.sourceContractBalanceUsd,
        batchPositionCollateralUsd: chainState.expectedAmountUsd || next.batchPositionCollateralUsd,
        fundingSource: next.custodyMode === 'batch_wallet_custody'
          ? 'InvestmentEscrow BatchWalletFunded'
          : 'InvestmentEscrow escrowBatchPositions',
        fundingStatus: 'verified',
      })
    );
  } else if (chainState.observedWalletBalanceUsd != null && next.observedWalletBalanceUsd !== chainState.observedWalletBalanceUsd) {
    next = {
      ...next,
      observedWalletBalanceUsd: chainState.observedWalletBalanceUsd,
    };
  }

  if (chainState.allocation) {
    const hasMatchingPlan = allocationPlanMatchesHash(
      next.aaaAllocation.allocationPlan,
      chainState.allocation.allocationPlanHash
    );
    const allocationStatus =
      next.aaaAllocation.status === 'validated' || hasMatchingPlan
        ? 'validated'
        : 'chain_only';
    next = {
      ...next,
      status: ['wallet_funded', 'wallet_created'].includes(next.status) ? 'aaa_plan_attached' : next.status,
      aaaAllocation: {
        ...next.aaaAllocation,
        allocationPlanHash: chainState.allocation.allocationPlanHash || next.aaaAllocation.allocationPlanHash,
        policyContextHash: chainState.allocation.policyContextHash || next.aaaAllocation.policyContextHash,
        portfolioRegistryVersion: chainState.allocation.portfolioRegistryVersion || next.aaaAllocation.portfolioRegistryVersion,
        attachedAt: chainState.allocation.attachedAt || next.aaaAllocation.attachedAt,
        status: allocationStatus,
      },
    };
  }

  return next;
}

function allocationPlanMatchesHash(plan: unknown, expectedHash?: string) {
  if (!plan || !expectedHash) return false;
  try {
    return canonicalKeccak(canonicalPlanFields(plan as any)).toLowerCase() === expectedHash.toLowerCase();
  } catch {
    return false;
  }
}

function aaaAllocationSnapshot(batch: EscrowBatch) {
  return JSON.stringify({
    planId: batch.aaaAllocation.planId,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    portfolioRegistryVersion: batch.aaaAllocation.portfolioRegistryVersion,
    targetYieldBps: batch.aaaAllocation.targetYieldBps,
    attachedAt: batch.aaaAllocation.attachedAt,
    status: batch.aaaAllocation.status,
    hasPlan: Boolean(batch.aaaAllocation.allocationPlan),
  });
}

type StoredAllocationPlanHydration = {
  planId: string;
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  status: EscrowBatch['aaaAllocation']['status'];
};

type HydrationAttemptBucket = 'lifecycle' | 'authority' | 'wallet' | 'funding' | 'allocation';
type HydrationAttemptState = Record<HydrationAttemptBucket, Set<string>>;

function sameHash(left?: string, right?: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function blendedYieldBpsFromPlan(plan: AaaTickResponse) {
  const weights = plan.target_weights ?? {};
  const roleByAsset = plan.role_by_asset ?? {};
  const roleYield: Record<string, number> = {
    core: 800, liquidity: 400, satellite: 600, defensive: 300,
    speculative: 1200, yield_fund: 700, external: 900,
  };
  return Math.round(
    Object.entries(weights).reduce(
      (sum, [symbol, weight]) => sum + Number(weight) * (roleYield[roleByAsset[symbol] ?? ''] ?? 900),
      0,
    )
  );
}

function hydrateBatchWithStoredAllocationPlan(
  batch: EscrowBatch,
  storedPlan: StoredAllocationPlanHydration,
): EscrowBatch {
  const effectiveStatus: EscrowBatch['aaaAllocation']['status'] =
    sameHash(batch.aaaAllocation.allocationPlanHash || storedPlan.allocationPlanHash, storedPlan.allocationPlanHash)
    && batch.aaaAllocation.status === 'chain_only'
      ? 'validated'
      : storedPlan.status;

  const nextStatus =
    effectiveStatus === 'validated' && ['wallet_funded', 'wallet_created'].includes(batch.status)
      ? 'aaa_plan_attached'
      : batch.status;

  return {
    ...batch,
    status: nextStatus,
    aaaAllocation: {
      ...batch.aaaAllocation,
      planId: storedPlan.planId || batch.aaaAllocation.planId,
      allocationPlan: storedPlan.allocationPlan,
      allocationPlanHash: storedPlan.allocationPlanHash || batch.aaaAllocation.allocationPlanHash,
      policyContextHash: storedPlan.policyContextHash || batch.aaaAllocation.policyContextHash,
      portfolioRegistryVersion: storedPlan.portfolioRegistryVersion || batch.aaaAllocation.portfolioRegistryVersion,
      targetYieldBps: blendedYieldBpsFromPlan(storedPlan.allocationPlan) || batch.aaaAllocation.targetYieldBps,
      status: effectiveStatus,
    },
  };
}

function hasHydrationAttempt(state: HydrationAttemptState, bucket: HydrationAttemptBucket, key: string) {
  return state[bucket].has(key);
}

function markHydrationAttempt(state: HydrationAttemptState, bucket: HydrationAttemptBucket, key: string) {
  state[bucket].add(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrow Batch Management Table — row model + pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveBatchOrigin(batch: EscrowBatch): 'Vault' | 'Bank' | 'Unknown' {
  // originBanks is always populated (it mirrors deposit.originBank), so it is NOT a reliable Bank signal.
  // Only trust adapter type (set by the ingestion layer, not derived) and explicit origin strings.
  if (batch.deposits.some(d =>
    d.adapterType === 'fineract' || d.adapterType === 'core_adapter' || d.adapterType === 'fintech_partner'
  )) return 'Bank';
  // On-chain bank lots use 'bank-receipt-' / 'bank-lot-' / 'bank-batch-' deposit ID prefixes
  if (batch.deposits.some(d =>
    d.depositId?.toLowerCase().startsWith('bank-receipt-') ||
    d.depositId?.toLowerCase().startsWith('bank-lot-') ||
    d.depositId?.toLowerCase().startsWith('bank-batch-')
  )) return 'Bank';
  if (batch.deposits.some(d =>
    d.depositId?.toLowerCase().includes('vault') ||
    d.originBank?.toLowerCase() === 'vault'
  )) return 'Vault';
  // Cannot determine origin reliably — do not guess; wrong origin is operationally dangerous
  return 'Unknown';
}

interface EscrowBatchManagementRow {
  batchId: string;
  sourceBatchId: string;
  escrowBatchIdShort: string;
  origin: 'Vault' | 'Bank' | 'Unknown';
  // wallet: typed source-of-truth field. walletAddress is only non-null when status === 'created_bound'.
  wallet: {
    status: 'not_created' | 'predicted' | 'created_bound';
    address?: string;
    source: 'phase3_evidence' | 'metadata_predicted' | 'none';
  };
  walletAddress: string | null;  // Derived from wallet; null unless Phase 3 evidence confirmed
  // amount: source-of-truth field for original principal.
  amount: {
    value: number;
    source: 'phase1_evidence' | 'execution_order_fallback';
    mismatch?: boolean;
  };
  originalAmountUsd: number;  // Derived from amount.value
  termMonths: number;
  depositSummaries: Array<{
    depositId: string;
    originBank: string;
    adapterType: string;
    amountUsd: number;
    bankClientRef?: string;
    depositAccountRef?: string;
    status: string;
    termMonths: number;
  }>;
  currentPhase: number;
  lcStatus: LifecycleRow['status'] | undefined;
  isSettled: boolean;
  isBlocked: boolean;
  isFailed: boolean;
  settlement: {
    batchStatus: string;
    returnedAmountUsd: number | null;
    pnlUsd: number | null;
    pnlPct: number | null;
    settlementTxHash?: string;
    source: 'phase9_evidence' | 'none';
  };
  blockingReason: string | null;
  nextActionLabel: string | null;
  deploymentLegs: Array<{
    legId: string;
    provider: string;
    asset: string;
    deployedUsd: number;
    currentValueUsd: number | null;
    settledAmountUsd: number | null;
    pnlUsd: number | null;
    pnlPct: number | null;
    status: string;
    destinationName?: string;
    destinationAddress?: string;
    deploymentTxHash?: string;
  }>;
}

// ── Lifecycle evidence hydration ─────────────────────────────────────────────
// Applies server-authoritative phase evidence onto a local EscrowBatch.
// Called whenever handoffs or lifecycle evidence changes.
// Non-destructive: only sets fields when evidence supplies authoritative values.
function hydrateEscrowBatchFromLifecycleEvidence(
  batch: EscrowBatch,
  evidence: Record<number, PhaseEvidenceRow>,
): EscrowBatch {
  let h = { ...batch };

  // Phase 2 — authority binding anchored
  const e2 = evidence[2]?.evidence_json;
  if (e2 && h.batchAuthorityBinding) {
    h = {
      ...h,
      batchAuthorityBinding: {
        ...h.batchAuthorityBinding,
        treasurySignatureStatus: 'signed',
        escrowSignatureStatus: 'signed',
        anchorStatus: 'anchored',
        anchorTxHash: String(e2.txHash ?? h.batchAuthorityBinding.anchorTxHash ?? ''),
        treasurySignerAddress: String(e2.treasurySignerAddress ?? (h.batchAuthorityBinding as any).treasurySignerAddress ?? ''),
        escrowSignerAddress: String(e2.escrowSignerAddress ?? (h.batchAuthorityBinding as any).escrowSignerAddress ?? ''),
      },
    };
  }

  // Phase 3 — multisig wallet created and bound on-chain
  const e3 = evidence[3]?.evidence_json;
  if (e3) {
    const walletAddr = String(e3.walletAddress ?? h.wallet.walletAddress ?? h.wallet.address ?? '');
    h = {
      ...h,
      wallet: {
        ...h.wallet,
        walletAddress: walletAddr,
        address: walletAddr,
        boundAuthorityBindingHash: String(e3.batchAuthorityBindingHash ?? h.wallet.boundAuthorityBindingHash ?? ''),
        creationTxHash: String(e3.creationTxHash ?? h.wallet.creationTxHash ?? ''),
        fundingStatus: h.wallet.fundingStatus === 'not_created' ? 'created' : h.wallet.fundingStatus,
      },
    };
  }

  // Phase 4 — wallet funded (only advance; never overwrite 'verified')
  if (evidence[4] && (h.wallet.fundingStatus === 'not_created' || h.wallet.fundingStatus === 'created')) {
    h = { ...h, wallet: { ...h.wallet, fundingStatus: 'funded' } };
  }

  // Phase 5 — AAA allocation computed and anchored on-chain
  const e5 = evidence[5]?.evidence_json;
  if (e5) {
    const attachedAtRaw = e5.attachedAt as number | string | undefined;
    const attachedAtIso = attachedAtRaw != null
      ? (typeof attachedAtRaw === 'number'
        ? new Date((attachedAtRaw as number) * 1000).toISOString()
        : String(attachedAtRaw))
      : undefined;
    h = {
      ...h,
      aaaAllocation: {
        ...h.aaaAllocation,
        allocationPlanHash: String(e5.allocationPlanHash ?? h.aaaAllocation.allocationPlanHash ?? ''),
        policyContextHash: String(e5.policyContextHash ?? h.aaaAllocation.policyContextHash ?? ''),
        portfolioRegistryVersion: String(e5.portfolioRegistryVersion ?? h.aaaAllocation.portfolioRegistryVersion ?? ''),
        attachedAt: attachedAtIso ?? h.aaaAllocation.attachedAt,
        attachTxHash: e5.attachTxHash != null ? String(e5.attachTxHash) : h.aaaAllocation.attachTxHash,
        allocationPlan: (e5.allocationPlanJson as any) ?? h.aaaAllocation.allocationPlan,
        // 'validated' satisfies hasValidatedAaaAllocation; Phase 5 evidence only exists on success
        status: 'validated',
      },
    };
  }

  // Phase 6 — destination approvals created
  const e6 = evidence[6]?.evidence_json;
  if (e6) {
    const rawLegApprovals = (e6.legApprovals ?? []) as Array<{
      legId: string;
      destinationAddress?: string;
      amountUsd6?: string | number;
      approvalStatus?: string;
    }>;
    const approvedAtRaw = e6.approvedAt as number | string | undefined;
    const approvedAtIso = approvedAtRaw != null
      ? (typeof approvedAtRaw === 'number'
        ? new Date((approvedAtRaw as number) * 1000).toISOString()
        : String(approvedAtRaw))
      : evidence[6].created_at;
    const destApprovalHash = String(e6.destinationApprovalHash ?? '');
    const destRegVersion = String(e6.destinationRegistryVersion ?? e5?.portfolioRegistryVersion ?? '');
    const alloPlanHash = String(e6.allocationPlanHash ?? e5?.allocationPlanHash ?? '');
    const policyCtxHash = String(e5?.policyContextHash ?? '');

    if (rawLegApprovals.length > 0 && (!h.destinationApprovals || h.destinationApprovals.length === 0)) {
      h = {
        ...h,
        destinationApprovals: rawLegApprovals.map((leg) => ({
          approvalId: `lc-phase6-${leg.legId}`,
          batchId: h.batchId,
          legId: leg.legId,
          sourceBatchId: h.sourceBatchId ?? h.batchId,
          escrowBatchId: h.batchId,
          walletAddress: h.wallet?.walletAddress ?? h.wallet?.address ?? '',
          assetSymbol: 'USDC',
          amount: Number(leg.amountUsd6 ?? 0) / 1_000_000,
          weight: 0,
          destinationId: leg.legId,
          destinationName: leg.legId,
          destinationType: 'liquidity',
          destinationAddress: String(leg.destinationAddress ?? ''),
          aaaAllocationHash: alloPlanHash,
          amountUsd: Number(leg.amountUsd6 ?? 0) / 1_000_000,
          asset: 'USDC',
          chain: h.wallet?.chain ?? 'arc_testnet',
          allocationPlanHash: alloPlanHash,
          policyContextHash: policyCtxHash,
          destinationRegistryVersion: destRegVersion,
          destinationApprovalHash: destApprovalHash,
          approvalStatus: (leg.approvalStatus === 'approved' ? 'approved' : 'pending') as 'approved' | 'pending',
          reviewedBy: 'lifecycle-controller',
          reviewedAt: approvedAtIso,
          approvedBy: 'lifecycle-controller',
          approvedAt: approvedAtIso,
        })),
      };
    }
  }

  // Phase 7 — deployment approved (evidence has hashes; no full payload available here)
  const e7 = evidence[7]?.evidence_json;
  if (e7 && h.deploymentApproval.status !== 'approved') {
    h = {
      ...h,
      deploymentApproval: {
        ...h.deploymentApproval,
        status: 'approved',
        deploymentApprovalHash: String(e7.deploymentApprovalHash ?? ''),
        destinationApprovalHash: String(e7.destinationApprovalHash ?? ''),
        allocationPlanHash: String(e7.allocationPlanHash ?? ''),
        policyContextHash: String(e7.policyContextHash ?? ''),
        destinationRegistryVersion: String(e7.destinationRegistryVersion ?? ''),
        approvedBy: String(e7.approvedBy ?? 'lifecycle-controller'),
        approvedAt: String(e7.approvedAt ? new Date(Number(e7.approvedAt) * 1000).toISOString() : evidence[7].created_at),
      },
    };
  }

  // Phase 8 — deployment legs executed
  const e8 = evidence[8]?.evidence_json;
  if (e8) {
    const rawLegs = (e8.legs ?? []) as Array<{
      legId: string;
      txHash?: string;
      destination?: string;
      amountUsd6?: string | number;
      executedAt?: number;
      status?: string;
    }>;

    // Build a Phase 7 planned-leg lookup so stubs can be hydrated with approved intent
    const p7PlannedLegsRaw = (e7?.plannedLegs ?? []) as Array<Record<string, unknown>>;
    const p7ByLegId = new Map(p7PlannedLegsRaw.map(l => [String(l.legId ?? ''), l]));

    // Populate deploymentLegs if empty — Phase 8 evidence confirms execution;
    // overlay with Phase 7 planned fields when available.
    if (h.deploymentLegs.length === 0 && rawLegs.length > 0) {
      h = {
        ...h,
        deploymentLegs: rawLegs.map((leg) => {
          const p7 = p7ByLegId.get(leg.legId);
          // Phase 7 provider uses AAA role names (core/satellite/liquidity…); batch type
          // expects a narrower set. Cast is safe: display model overlays Phase 7 anyway.
          return {
            legId: leg.legId,
            provider: ((p7?.provider as string | undefined) ?? 'liquidity') as 'liquidity',
            asset: (p7?.assetSymbol as string | undefined) ?? 'USDC',
            strategyType: ((p7?.strategyType as string | undefined) ?? 'liquidity') as 'liquidity',
            amountUsd: p7?.amountUsd6 != null
              ? Number(p7.amountUsd6) / 1_000_000
              : Number(leg.amountUsd6 ?? 0) / 1_000_000,
            allocationPercent: (p7?.allocationPercent as number | undefined) ?? 0,
            targetYieldBps: (p7?.targetYieldBps as number | undefined) ?? 0,
            destinationAddress: (p7?.destinationAddress as string | undefined) ?? String(leg.destination ?? ''),
            deploymentTxHash: leg.txHash ? String(leg.txHash) : undefined,
            status: 'executed' as const,
          };
        }),
      };
    } else if (h.deploymentLegs.length > 0 && rawLegs.length > 0) {
      // Legs already loaded from DB (status='planned' or 'approved') — update status and
      // tx hash from Phase 8 evidence without replacing the enriched planned fields.
      const p8ByLegId = new Map(rawLegs.map(l => [l.legId, l]));
      h = {
        ...h,
        deploymentLegs: h.deploymentLegs.map((leg) => {
          const p8 = p8ByLegId.get(leg.legId);
          if (!p8) return leg;
          return {
            ...leg,
            status: (p8.status === 'executed' ? 'executed' : leg.status) as typeof leg.status,
            deploymentTxHash: p8.txHash ? String(p8.txHash) : leg.deploymentTxHash,
          };
        }),
      };
    }

    // Add deployment execution with status 'deployed' if none exists yet
    if (!h.deploymentExecutions?.length) {
      const execAt = e8.executedAt
        ? new Date(Number(e8.executedAt) * 1000).toISOString()
        : evidence[8].created_at;
      h = {
        ...h,
        deploymentExecutions: [{
          deploymentId: `lc-phase8-${h.sourceBatchId ?? h.batchId}`,
          batchId: h.batchId,
          signingRequestId: `lc-phase8-${h.sourceBatchId ?? h.batchId}`,
          status: 'deployed' as const,
          executedBy: 'lifecycle-controller',
          executedAt: execAt,
          deploymentTxHash: rawLegs[0]?.txHash ? String(rawLegs[0].txHash) : undefined,
          deploymentLegResults: rawLegs.map((leg) => {
            const p7 = p7ByLegId.get(leg.legId);
            return {
              legId: leg.legId,
              provider: ((p7?.provider as string | undefined) ?? 'liquidity') as 'liquidity',
              asset: (p7?.assetSymbol as string | undefined) ?? 'USDC',
              amountUsd: p7?.amountUsd6 != null
                ? Number(p7.amountUsd6) / 1_000_000
                : Number(leg.amountUsd6 ?? 0) / 1_000_000,
              allocationPercent: (p7?.allocationPercent as number | undefined) ?? 0,
              targetYieldBps: (p7?.targetYieldBps as number | undefined) ?? 0,
              status: 'deployed' as const,
              providerReferenceId: leg.legId,
              deploymentTxHash: leg.txHash ? String(leg.txHash) : '',
              deployedAt: leg.executedAt
                ? new Date(Number(leg.executedAt) * 1000).toISOString()
                : execAt,
              destinationAddress: (p7?.destinationAddress as string | undefined) ?? String(leg.destination ?? ''),
            };
          }),
        }],
      };
    }
  }

  // Phase 9 — settlement finalized; mark legs as settled
  const e9 = evidence[9]?.evidence_json;
  if (e9) {
    const legSettlementResults = (e9.legSettlementResults ?? {}) as Record<string, unknown>;
    const settledLegIds = new Set(Object.keys(legSettlementResults));
    if (settledLegIds.size > 0 && h.deploymentLegs.length > 0) {
      h = {
        ...h,
        deploymentLegs: h.deploymentLegs.map((leg) =>
          settledLegIds.has(leg.legId)
            ? { ...leg, status: 'settled' as const }
            : leg
        ),
      };
    }
  }

  return h;
}

function buildEscrowBatchManagementRow(
  batch: EscrowBatch,
  lcRow: LifecycleRow | undefined,
  evidence: Record<number, PhaseEvidenceRow> = {},
): EscrowBatchManagementRow {
  const m = buildEscrowBatchDisplayModel(batch, lcRow, evidence);

  const wallet: EscrowBatchManagementRow['wallet'] = {
    status: m.walletStatus,
    address: m.walletAddress ?? m.predictedAddress ?? undefined,
    source: m.walletSource,
  };

  const amount: EscrowBatchManagementRow['amount'] = {
    value: m.principalUsd,
    source: m.principalSource === 'phase1_evidence' ? 'phase1_evidence' : 'execution_order_fallback',
  };

  const deploymentLegs = m.deploymentLegs.map(leg => ({
    legId: leg.legId,
    provider: leg.provider,
    asset: leg.asset,
    deployedUsd: leg.amountUsd,
    currentValueUsd: leg.currentValueUsd ?? null,
    settledAmountUsd: leg.settledAmountUsd,
    pnlUsd: leg.legPnlUsd,
    pnlPct: leg.legPnlPct,
    status: leg.status,
    destinationName: leg.destinationName,
    destinationAddress: leg.destinationAddress,
    deploymentTxHash: leg.deploymentTxHash,
  }));

  let blockingReason: string | null = null;
  let nextActionLabel: string | null = null;
  if (!m.isSettled) {
    if (m.isFailed) {
      blockingReason = m.blockingReason ?? 'Unknown failure';
    } else if (m.isBlocked) {
      blockingReason = m.blockingReason ?? 'Blocked';
    } else if (m.currentPhase === 0) {
      nextActionLabel = 'Register Treasury handoff';
    } else {
      const nextPhase = Math.min(m.currentPhase + 1, 9);
      nextActionLabel = PHASE_NAMES[nextPhase] ?? PHASE_NAMES[m.currentPhase] ?? '—';
    }
  }

  return {
    batchId: m.batchId,
    sourceBatchId: m.sourceBatchId,
    escrowBatchIdShort: m.escrowBatchIdShort,
    origin: m.origin,
    wallet,
    walletAddress: m.walletAddress,
    amount,
    originalAmountUsd: m.principalUsd,
    termMonths: m.termMonths,
    depositSummaries: batch.deposits.map(d => ({
      depositId: d.depositId,
      originBank: d.originBank,
      adapterType: d.adapterType,
      amountUsd: d.amountUsd,
      bankClientRef: d.bankClientRef,
      depositAccountRef: d.depositAccountRef,
      status: d.status,
      termMonths: d.termMonths,
    })),
    currentPhase: m.currentPhase,
    lcStatus: m.lcStatus ?? undefined,
    isSettled: m.isSettled,
    isBlocked: m.isBlocked,
    isFailed: m.isFailed,
    settlement: {
      batchStatus: batch.settlement.status,
      returnedAmountUsd: m.returnedAmountUsd,
      pnlUsd: m.pnlUsd,
      pnlPct: m.pnlPct,
      settlementTxHash: m.settlementTxHash ?? undefined,
      source: m.settlementSource === 'none' ? 'none' : 'phase9_evidence',
    },
    blockingReason,
    nextActionLabel,
    deploymentLegs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrow header stats — pure derivation, unit-testable
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_INTEGRITY_CODES = [
  'principal_mismatch',
  'zero_execution_context_hash',
  'hash_mismatch',
  'wallet_balance_mismatch',
  'signer_mismatch',
  'registry_mismatch',
  'destination_not_approved',
  'settlement_overdue',
  'settlement_impossible',
];

function buildEscrowHeaderStats(
  lifecycleBatches: LifecycleRow[],
  batches: EscrowBatch[],
  signerConfig: { treasurySignerUrl: string | null; escrowSignerUrl: string | null },
  escrowContractBalanceUsd: number | null,
  bankingApiUrl: string | null,
) {
  // Lifecycle Health counts — cross-referenced against on-chain batches so stale DB rows
  // from prior contract deployments don't inflate counts when the chain is clean.
  const knownLifecycleKeys = new Set(batches.flatMap((batch) => getBatchLifecycleLookupKeys(batch)));
  const knownLifecycleBatches = lifecycleBatches.filter((lc) =>
    getLifecycleRowLookupKeys(lc).some((key) => knownLifecycleKeys.has(key))
  );
  const lc_active  = knownLifecycleBatches.filter(lc => lc.status === 'active' || lc.status === 'running').length;
  const lc_blocked = knownLifecycleBatches.filter(lc => lc.status === 'blocked' || lc.status === 'admin_hold').length;
  const lc_failed  = knownLifecycleBatches.filter(lc => lc.status === 'failed').length;
  const lc_settled = knownLifecycleBatches.filter(lc => lc.status === 'settled').length;

  // Open Exposure: sum of principal for non-settled batches
  const settledLifecycleKeys = new Set(
    knownLifecycleBatches
      .filter((lc) => lc.status === 'settled')
      .flatMap((lc) => getLifecycleRowLookupKeys(lc))
  );
  const openBatches = batches.filter((batch) =>
    !getBatchLifecycleLookupKeys(batch).some((key) => settledLifecycleKeys.has(key))
  );
  const openExposureUsd = openBatches.reduce((sum, b) => sum + (b.totalAmountUsd ?? 0), 0);

  // Custody Health: expected = escrow-custody batches not yet deployed (phase < 8) and not settled
  const lcByKey = new Map<string, LifecycleRow>();
  for (const lc of lifecycleBatches) {
    for (const key of getLifecycleRowLookupKeys(lc)) {
      lcByKey.set(key, lc);
    }
  }
  const expectedCustodyUsd = batches.reduce((sum, b) => {
    if (b.custodyMode !== 'escrow_contract_custody') return sum;
    const lc = findLifecycleBatchForBatch(lcByKey, b);
    if (!lc || lc.status === 'settled' || lc.current_phase >= 8) return sum;
    return sum + (b.totalAmountUsd ?? 0);
  }, 0);

  const custodyDeltaUsd = escrowContractBalanceUsd !== null
    ? escrowContractBalanceUsd - expectedCustodyUsd
    : null;
  // Surplus = actual > expected (unexplained funds in escrow — warning, not danger).
  // Deficit  = actual < expected (funds missing from escrow — danger).
  const custodyHealthLabel: 'Unknown' | 'No Custody Expected' | 'Balanced' | 'Surplus' | 'Deficit' =
    escrowContractBalanceUsd === null ? 'Unknown' :
    expectedCustodyUsd === 0 && escrowContractBalanceUsd === 0 ? 'No Custody Expected' :
    custodyDeltaUsd! > 0.02 ? 'Surplus' :
    custodyDeltaUsd! < -0.02 ? 'Deficit' :
    'Balanced';

  // Integrity Checks: blocked/failed batches with recognised critical error codes
  const criticalBatches = knownLifecycleBatches.filter(lc => {
    if (lc.status !== 'blocked' && lc.status !== 'failed') return false;
    return lc.last_error_code
      ? CRITICAL_INTEGRITY_CODES.some(c => lc.last_error_code!.includes(c))
      : false;
  });
  const criticalCount = criticalBatches.length;
  const warnCount = knownLifecycleBatches.filter(lc => {
    if (lc.status !== 'blocked' && lc.status !== 'failed') return false;
    if (!lc.last_error_code) return true;
    return !CRITICAL_INTEGRITY_CODES.some(c => lc.last_error_code!.includes(c));
  }).length;
  // Short reason string surfaced directly on the card so operator doesn't need to hunt.
  const uniqueCriticalCodes = [
    ...new Set(criticalBatches.map(lc => lc.last_error_code).filter(Boolean)),
  ] as string[];
  const integrityReason =
    criticalCount > 0
      ? uniqueCriticalCodes.length > 0
        ? uniqueCriticalCodes.slice(0, 2).map(c => c.replace(/_/g, ' ')).join(', ')
        : `${criticalCount} batch${criticalCount > 1 ? 'es' : ''} failed`
      : warnCount > 0
      ? `${warnCount} batch${warnCount > 1 ? 'es' : ''} blocked`
      : 'All invariants passing';

  // Settlement Health
  const settlementPending = knownLifecycleBatches.filter(
    lc => lc.current_phase >= 8 && lc.status !== 'settled'
  ).length;

  // Authority Health — tracks the three protocol services: Treasury signer, Escrow signer, Banking server.
  const treasuryOk = Boolean(signerConfig.treasurySignerUrl);
  const escrowOk   = Boolean(signerConfig.escrowSignerUrl);
  const bankingOk  = Boolean(bankingApiUrl);
  const servicesHealthy = (treasuryOk ? 1 : 0) + (escrowOk ? 1 : 0) + (bankingOk ? 1 : 0);
  const authorityLabel =
    servicesHealthy === 3 ? '3/3 role signers' : `${servicesHealthy}/3 role signers`;

  return {
    escrowContractBalanceUsd,
    expectedCustodyUsd,
    custodyDeltaUsd,
    custodyHealthLabel,
    openExposureUsd,
    openBatchCount: openBatches.length,
    lc_active,
    lc_blocked,
    lc_failed,
    lc_settled,
    criticalCount,
    warnCount,
    integrityReason,
    settledCount: lc_settled,
    settlementPending,
    servicesHealthy,
    authorityLabel,
    treasuryOk,
    escrowOk,
    bankingOk,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrow Batch Management Table — inline panel sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DepositsPanel({
  deposits,
  origin,
}: {
  deposits: EscrowBatchManagementRow['depositSummaries'];
  origin: EscrowBatchManagementRow['origin'];
}) {
  if (deposits.length === 0) {
    return <div className="border-t border-slate-800/60 bg-slate-900/40 px-4 pb-3 pt-2 text-xs text-slate-500">Details unavailable</div>;
  }
  return (
    <div className="border-t border-slate-800/60 bg-slate-900/40 px-4 py-3 space-y-2">
      {deposits.map(d => (
        <div key={d.depositId} className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-2.5 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {origin === 'Vault' ? (
              <>
                <span><span className="text-slate-500">Lot ref:</span> <span className="font-mono text-slate-300">{d.depositId}</span></span>
                <span><span className="text-slate-500">Amount:</span> <span className="text-slate-200">{fmtUsd(d.amountUsd)}</span></span>
                <span><span className="text-slate-500">Term:</span> <span className="text-slate-300">{fmtTerm(d.termMonths)}</span></span>
                <span><span className="text-slate-500">Status:</span> <span className="text-slate-300">{d.status}</span></span>
                <span className="text-slate-500">Origin: Vault</span>
              </>
            ) : (
              <>
                {d.depositAccountRef && <span><span className="text-slate-500">Account:</span> <span className="font-mono text-slate-300">{d.depositAccountRef}</span></span>}
                {d.bankClientRef && <span><span className="text-slate-500">Client ref:</span> <span className="font-mono text-slate-300">{d.bankClientRef}</span></span>}
                <span><span className="text-slate-500">Bank:</span> <span className="text-slate-300">{d.originBank || '—'}</span></span>
                <span><span className="text-slate-500">Amount:</span> <span className="text-slate-200">{fmtUsd(d.amountUsd)}</span></span>
                <span><span className="text-slate-500">Term:</span> <span className="text-slate-300">{fmtTerm(d.termMonths)}</span></span>
                <span><span className="text-slate-500">Status:</span> <span className="text-slate-300">{d.status}</span></span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PnlPanel({
  settlement,
  legs,
}: {
  settlement: EscrowBatchManagementRow['settlement'];
  legs: EscrowBatchManagementRow['deploymentLegs'];
}) {
  const hasLegs = legs.length > 0 && legs.some(l => l.deployedUsd > 0);
  return (
    <div className="border-t border-slate-800/60 bg-slate-900/40 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Settlement Summary</div>
        {settlement.source === 'none' && (
          <span className="text-[9px] text-slate-600 italic">Phase 9 evidence pending</span>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {settlement.returnedAmountUsd !== null ? (
          <span><span className="text-slate-500">Returned:</span> <span className="text-slate-200">{fmtUsd(settlement.returnedAmountUsd)}</span></span>
        ) : (
          <span className="text-slate-500">Not yet returned</span>
        )}
        {settlement.pnlUsd !== null && (
          <span>
            <span className="text-slate-500">P&L:</span>{' '}
            <span className={settlement.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {settlement.pnlUsd >= 0 ? '+' : ''}{fmtUsd(settlement.pnlUsd)}
              {settlement.pnlPct !== null && ` (${settlement.pnlPct >= 0 ? '+' : ''}${settlement.pnlPct.toFixed(2)}%)`}
            </span>
          </span>
        )}
      </div>
      {hasLegs ? (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Deployment Legs</div>
          {legs.map(leg => (
            <div key={leg.legId} className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-2.5 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="text-slate-500">Provider:</span> <span className="text-slate-300">{leg.provider}</span></span>
                <span><span className="text-slate-500">Asset:</span> <span className="text-slate-300">{leg.asset}</span></span>
                {leg.destinationName
                  ? <span><span className="text-slate-500">Destination:</span> <span className="text-slate-300">{leg.destinationName}</span></span>
                  : leg.destinationAddress
                  ? <span><span className="text-slate-500">Destination:</span> <span className="font-mono text-slate-300">{leg.destinationAddress}</span></span>
                  : null}
                {leg.deploymentTxHash && <span><span className="text-slate-500">Tx:</span> <span className="font-mono text-slate-400">{shortHash(leg.deploymentTxHash)}</span></span>}
                <span><span className="text-slate-500">Deployed:</span> <span className="text-slate-200">{fmtUsd(leg.deployedUsd)}</span></span>
                {(leg.settledAmountUsd ?? leg.currentValueUsd) !== null
                  ? <span><span className="text-slate-500">Returned:</span> <span className="text-slate-200">{fmtUsd((leg.settledAmountUsd ?? leg.currentValueUsd)!)}</span></span>
                  : <span className="text-slate-500">Not yet returned</span>
                }
                {leg.pnlUsd !== null && (
                  <span>
                    <span className="text-slate-500">P&L:</span>{' '}
                    <span className={leg.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {leg.pnlUsd >= 0 ? '+' : ''}{fmtUsd(leg.pnlUsd)}
                      {leg.pnlPct !== null && ` (${leg.pnlPct >= 0 ? '+' : ''}${leg.pnlPct.toFixed(2)}%)`}
                    </span>
                  </span>
                )}
                <span><span className="text-slate-500">Status:</span> <span className="text-slate-300">{leg.status}</span></span>
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="text-xs text-slate-500">No deployment leg data available</div>
      )}
    </div>
  );
}

function BatchManagementRow({
  row,
  isSelected,
  onSelect,
  explorerUrl,
}: {
  row: EscrowBatchManagementRow;
  isSelected: boolean;
  onSelect: () => void;
  explorerUrl: string;
}) {
  const [openPanel, setOpenPanel] = useState<'deposits' | 'pnl' | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function copyText(text: string, field: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  function togglePanel(panel: 'deposits' | 'pnl') {
    setOpenPanel(prev => (prev === panel ? null : panel));
  }

  const nextPhase = Math.min(row.currentPhase + 1, 9);

  const lcStatusClass =
    row.lcStatus === 'settled'    ? 'bg-green-900/40 text-green-300' :
    row.lcStatus === 'running'    ? 'bg-yellow-900/40 text-yellow-300' :
    row.lcStatus === 'blocked'    ? 'bg-orange-900/40 text-orange-300' :
    row.lcStatus === 'admin_hold' ? 'bg-purple-900/40 text-purple-300' :
    row.isFailed                  ? 'bg-red-900/40 text-red-300' :
                                    'bg-blue-900/40 text-blue-300';

  const originBadgeClass =
    row.origin === 'Vault'   ? 'bg-purple-900/40 text-purple-300' :
    row.origin === 'Bank'    ? 'bg-blue-900/40 text-blue-300' :
                               'bg-slate-800 text-slate-500';

  // Single compact summary line proves settlement at a glance; popover handles leg detail.
  const settlementSummary = (() => {
    if (row.isSettled) {
      const returned = row.settlement.returnedAmountUsd;
      const pnl      = row.settlement.pnlUsd;
      if (returned !== null && pnl !== null) {
        const pnlSign = pnl >= 0 ? '+' : '';
        const node = (
          <span>
            <span className="text-slate-300">{fmtUsd(returned)} returned</span>
            <span className="text-slate-500"> · </span>
            {pnl >= 0
              ? <span className="text-green-400 font-medium">{pnlSign}{fmtUsd(pnl)} P&amp;L</span>
              : <span className="text-red-400 font-medium">{pnlSign}{fmtUsd(pnl)} P&amp;L</span>}
          </span>
        );
        return { text: `${fmtUsd(returned)} returned · ${pnlSign}${fmtUsd(pnl)} P&L`, node, tone: 'settled' as const };
      }
      if (returned !== null) {
        return { text: `${fmtUsd(returned)} returned`, node: null, tone: 'settled' as const };
      }
      return { text: 'Settled · P&L unavailable', node: null, tone: 'settled' as const };
    }
    if (row.settlement.batchStatus === 'pending')
      return { text: 'Settlement pending', node: null, tone: 'pending' as const };
    if (row.currentPhase >= 8)
      return { text: 'Waiting external return', node: null, tone: 'pending' as const };
    return { text: 'Not settled', node: null, tone: 'none' as const };
  })();
  const settlementTone =
    settlementSummary.tone === 'settled' ? 'text-emerald-300' :
    settlementSummary.tone === 'pending'  ? 'text-yellow-400' :
    'text-slate-500';

  const depositLabel = (() => {
    const n = row.depositSummaries.length;
    if (n === 0) return 'No details';
    if (row.origin === 'Vault') return n === 1 ? '1 vault lot' : `${n} vault lots`;
    return n === 1 ? '1 deposit' : `${n} deposits`;
  })();

  const blockingNext = (() => {
    if (row.isSettled) return null;
    if (row.isFailed)  return { prefix: 'Failed',  reason: row.blockingReason, tone: 'failed'  as const };
    if (row.isBlocked) return { prefix: 'Blocked', reason: row.blockingReason, tone: 'blocked' as const };
    if (row.nextActionLabel) return { prefix: 'Next', reason: row.nextActionLabel, tone: 'next' as const };
    return null;
  })();

  const showPnlTrigger = row.isSettled || row.deploymentLegs.length > 0;

  return (
    <div>
      {/* ── Main row ── */}
      <div
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-slate-800/30 ${
          isSelected ? 'bg-indigo-950/25 ring-inset ring-1 ring-indigo-700/20' : ''
        } ${row.isBlocked && !isSelected ? 'bg-orange-950/10' : ''} ${
          row.isFailed && !isSelected ? 'bg-red-950/10' : ''
        }`}
        onClick={onSelect}
      >
        {/* Batch: number · origin · short id */}
        <div className="w-36 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-slate-100">
              {row.sourceBatchId ? `#${row.sourceBatchId}` : '—'}
            </span>
            <span className={`inline-flex shrink-0 rounded px-1.5 py-0 text-[9px] font-bold leading-4 ${originBadgeClass}`}>
              {row.origin}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="font-mono text-[10px] text-slate-500 truncate">{row.escrowBatchIdShort}</span>
            <button
              type="button"
              title="Copy batch ID"
              className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
              onClick={e => { e.stopPropagation(); copyText(row.batchId, 'id'); }}
            >
              {copiedField === 'id'
                ? <CheckCircle2 size={9} className="text-emerald-400" />
                : <Copy size={9} />}
            </button>
          </div>
        </div>

        {/* Wallet address — source-of-truth gated */}
        <div className="hidden w-32 shrink-0 md:block">
          {row.wallet.status === 'created_bound' && row.walletAddress ? (
            <>
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-slate-300">{shortHash(row.walletAddress)}</span>
                <button
                  type="button"
                  title="Copy wallet address"
                  className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
                  onClick={e => { e.stopPropagation(); copyText(row.walletAddress!, 'wallet'); }}
                >
                  {copiedField === 'wallet'
                    ? <CheckCircle2 size={9} className="text-emerald-400" />
                    : <Copy size={9} />}
                </button>
                {explorerUrl && (
                  <a
                    href={`${explorerUrl}/address/${row.walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on explorer"
                    className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-600">{fmtTerm(row.termMonths)} term</div>
            </>
          ) : row.wallet.status === 'predicted' ? (
            // Precomputed/factory address exists but Phase 3 not yet confirmed on-chain.
            // Show "Predicted" label only — never treat as confirmed wallet state.
            <div>
              <span
                className="text-[11px] text-amber-400/60 cursor-default"
                title={`Predicted address — not created or bound on-chain.\nAddress: ${row.wallet.address ?? 'unknown'}`}
              >
                Predicted
              </span>
              <div className="mt-0.5 text-[10px] text-slate-600">{fmtTerm(row.termMonths)} term</div>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">Not created</span>
          )}
        </div>

        {/* Original amount + deposits trigger */}
        <div className="w-28 shrink-0">
          <div className="font-mono text-xs text-slate-200">{fmtUsd(row.originalAmountUsd)}</div>
          <button
            type="button"
            className={`mt-0.5 flex items-center gap-0.5 text-[10px] transition-colors hover:text-slate-300 ${
              openPanel === 'deposits' ? 'text-blue-400' : 'text-slate-500'
            }`}
            onClick={e => { e.stopPropagation(); togglePanel('deposits'); }}
          >
            {depositLabel}
            <ChevronDown size={9} className={`transition-transform ${openPanel === 'deposits' ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Batch state: phase name + mini bar + lc status */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-slate-300">
            {row.isSettled
              ? <><span className="text-emerald-300 font-medium">Settled</span> <span className="text-slate-500">· Phase {row.currentPhase} complete</span></>
              : row.currentPhase === 0
              ? <span className="text-yellow-400">Pending Registration</span>
              : `Phase ${row.currentPhase} · ${PHASE_NAMES[row.currentPhase] ?? '—'}`}
          </div>
          <div className="mt-1 flex items-center gap-px">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(phase => {
              const done = row.isSettled || phase <= row.currentPhase;
              const cur  = !row.isSettled && phase === nextPhase;
              return (
                <div
                  key={phase}
                  title={`Phase ${phase}: ${PHASE_NAMES[phase]}`}
                  className={`h-1 w-3 rounded-full ${
                    done ? 'bg-emerald-500' :
                    cur  ? row.isFailed ? 'bg-red-500' : row.isBlocked ? 'bg-orange-500' : 'bg-blue-500' :
                    'bg-slate-700'
                  }`}
                />
              );
            })}
          </div>
          {row.lcStatus && (
            <span className={`mt-1 inline-flex rounded-full px-1.5 py-0 text-[9px] font-semibold leading-4 ${lcStatusClass}`}>
              {row.lcStatus}
            </span>
          )}
        </div>

        {/* Settlement / P&L */}
        <div className="hidden w-36 shrink-0 lg:block">
          <div className={`text-[11px] leading-snug ${settlementTone}`}>{settlementSummary.node ?? settlementSummary.text}</div>
          {showPnlTrigger && (
            <button
              type="button"
              className={`mt-0.5 flex items-center gap-0.5 text-[10px] transition-colors hover:text-slate-300 ${
                openPanel === 'pnl' ? 'text-blue-400' : 'text-slate-500'
              }`}
              onClick={e => { e.stopPropagation(); togglePanel('pnl'); }}
            >
              P&amp;L details
              <ChevronDown size={9} className={`transition-transform ${openPanel === 'pnl' ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {/* Blocking / Next */}
        <div className="hidden w-36 shrink-0 xl:block">
          {blockingNext ? (
            <div className="flex items-start gap-1">
              {(blockingNext.tone === 'failed' || blockingNext.tone === 'blocked') && (
                <AlertTriangle
                  size={10}
                  className={`mt-0.5 shrink-0 ${blockingNext.tone === 'failed' ? 'text-red-400' : 'text-orange-400'}`}
                />
              )}
              <div className="min-w-0">
                <div className={`text-[10px] font-semibold ${
                  blockingNext.tone === 'failed'  ? 'text-red-400' :
                  blockingNext.tone === 'blocked' ? 'text-orange-400' :
                  'text-slate-500'
                }`}>
                  {blockingNext.prefix}:
                </div>
                <div className="line-clamp-2 text-[10px] leading-tight text-slate-400">
                  {blockingNext.reason}
                </div>
              </div>
            </div>
          ) : row.isSettled ? (
            <span className="text-[11px] font-medium text-emerald-400">Complete</span>
          ) : null}
        </div>

        {/* Actions */}
        <div className="w-24 shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
              onClick={e => { e.stopPropagation(); onSelect(); }}
            >
              <ArrowRight size={11} />
              View
            </button>
            <button
              type="button"
              disabled
              title="Export audit packet — not yet available"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-slate-600 cursor-not-allowed"
              onClick={e => e.stopPropagation()}
            >
              <FileCheck size={11} />
              Export
            </button>
          </div>
          {row.isFailed && (
            <button
              type="button"
              disabled
              title={`Recovery unavailable${row.blockingReason ? ': ' + row.blockingReason : ' — batch evidence invalid'}`}
              className="inline-flex items-center gap-1 rounded border border-slate-700/50 px-2 py-0.5 text-[10px] text-slate-600 cursor-not-allowed"
              onClick={e => e.stopPropagation()}
            >
              Recover (disabled)
            </button>
          )}
        </div>
      </div>

      {/* Inline deposit details panel */}
      {openPanel === 'deposits' && (
        <DepositsPanel deposits={row.depositSummaries} origin={row.origin} />
      )}

      {/* Inline P&L panel */}
      {openPanel === 'pnl' && (
        <PnlPanel settlement={row.settlement} legs={row.deploymentLegs} />
      )}
    </div>
  );
}

export default function EscrowTab() {
  const { selectedChain } = useProtocolChain();
  const [handoffs, setHandoffs] = useState<TreasuryHandoffPackage[]>([]);
  const [batches, setBatches] = useState<EscrowBatch[]>([]);
  const [lifecycleBatches, setLifecycleBatches] = useState<LifecycleRow[]>([]);
  const [lifecycleEvidenceByBatchId, setLifecycleEvidenceByBatchId] = useState<Map<string, Record<number, PhaseEvidenceRow>>>(new Map());
  const [selectedBatchEvidence, setSelectedBatchEvidence] = useState<Record<number, PhaseEvidenceRow>>({});
  const [selectedBatchAllAttempts, setSelectedBatchAllAttempts] = useState<PhaseAttemptRow[]>([]);
  const [escrowContractBalanceUsd, setEscrowContractBalanceUsd] = useState<number | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [verifyingFundingBatchId, setVerifyingFundingBatchId] = useState<string>('');
  const [fundingVerificationError, setFundingVerificationError] = useState<string | null>(null);
  const [signingAuthorityKey, setSigningAuthorityKey] = useState<string>('');
  const [signingAuthorityError, setSigningAuthorityError] = useState<string | null>(null);
  const [anchoringBatchId, setAnchoringBatchId] = useState<string>('');
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [walletCreatingBatchId, setWalletCreatingBatchId] = useState<string>('');
  const [walletCreationError, setWalletCreationError] = useState<string | null>(null);
  const [requestingAllocationBatchId, setRequestingAllocationBatchId] = useState<string>('');
  const [allocationRequestError, setAllocationRequestError] = useState<string | null>(null);
  const [recoveringPlanBatchId, setRecoveringPlanBatchId] = useState<string>('');
  const [planRecoveryError, setPlanRecoveryError] = useState<string | null>(null);
  const [approvingDeploymentBatchId, setApprovingDeploymentBatchId] = useState<string>('');
  const [deploymentApprovalError, setDeploymentApprovalError] = useState<string | null>(null);
  const [executingDeploymentBatchId, setExecutingDeploymentBatchId] = useState<string>('');
  const [deploymentExecutionError, setDeploymentExecutionError] = useState<string | null>(null);
  const [onChainRoleAuthorities, setOnChainRoleAuthorities] = useState<OnChainRoleAuthorities | null>(null);
  const [roleAuthoritiesRefreshTick, setRoleAuthoritiesRefreshTick] = useState(0);
  const [storedAllocationPlans, setStoredAllocationPlans] = useState<Record<string, StoredAllocationPlanHydration>>({});
  // Signer service URLs from env — stable for the lifetime of the page.
  const signerServiceConfig = useMemo(() => getSignerServiceConfig(), []);
  const [connectedAddress, setConnectedAddress] = useState<string>('');
  // Tracks which auto-actions have already been attempted this session to prevent infinite loops.
  const autoActionsAttempted = useRef<Set<string>>(new Set());
  // Batch IDs where deployment execution hydration (DB + chain check) has completed.
  // Auto-execute waits until a batch appears here to avoid re-deploying an already-executed batch.
  const [executionHydrationCompleted, setExecutionHydrationCompleted] = useState<ReadonlySet<string>>(new Set());
  const hydrationAttempts = useRef<HydrationAttemptState>({
    lifecycle: new Set<string>(),
    authority: new Set<string>(),
    wallet: new Set<string>(),
    funding: new Set<string>(),
    allocation: new Set<string>(),
  });

  // ── Batch management table — sort + filter state ──────────────────────────
  type SortColumn = 'batch' | 'principal' | 'phase' | 'settlement';
  const [sortCol, setSortCol] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterOrigin, setFilterOrigin] = useState<'' | 'Vault' | 'Bank'>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'active' | 'blocked' | 'failed' | 'settled'>('');
  const [institutionNames, setInstitutionNames] = useState<Map<string, string>>(new Map());

  function handleSort(col: SortColumn) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  useEffect(() => {
    fetchInstitutions().then((list) => {
      setInstitutionNames(new Map(list.map((i) => [i.institutionId, i.displayName])));
    }).catch(() => {});
  }, []);

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.batchId === selectedBatchId) ?? batches[0],
    [batches, selectedBatchId]
  );

  const lifecycleBatchByKey = useMemo(
    () => {
      const next = new Map<string, LifecycleRow>();
      for (const lc of lifecycleBatches) {
        for (const key of getLifecycleRowLookupKeys(lc)) {
          next.set(key, lc);
        }
      }
      return next;
    },
    [lifecycleBatches]
  );

  useEffect(() => {
    const batch = selectedBatch;
    const planData = batch?.aaaAllocation.allocationPlan as (Record<string, unknown> | undefined);
    const targetWeights = planData?.target_weights as Record<string, number> | undefined;
    const registryAddress = getRuntimeAddress('PortfolioRegistry');

    if (!batch || !canGenerateDeploymentLegs(batch)) return;
    if (!targetWeights || Object.keys(targetWeights).length === 0) return;
    if (!selectedChain?.rpcUrl || !isValidAddress(registryAddress)) return;

    let cancelled = false;
    readDestinationApprovalPreviewRows({
      rpcUrl: selectedChain.rpcUrl,
      registryAddress,
      targetWeights,
      totalAmountUsd: batch.totalAmountUsd,
    }).then((rows) => {
      if (cancelled) return;
      setBatches((current) =>
        current.map((item) => {
          if (item.batchId !== batch.batchId) return item;
          const nextLegs = buildDeploymentLegsFromDestinationPreviewRows(item, rows);
          return deploymentLegSnapshot(item.deploymentLegs) === deploymentLegSnapshot(nextLegs)
            ? item
            : { ...item, deploymentLegs: nextLegs };
        })
      );
    }).catch(() => {
      // Best-effort sync only. The AAA tab surfaces destination preview errors directly.
    });

    return () => {
      cancelled = true;
    };
  }, [
    selectedBatch?.batchId,
    selectedBatch?.aaaAllocation.status,
    selectedBatch?.aaaAllocation.allocationPlanHash,
    selectedBatch?.aaaAllocation.portfolioRegistryVersion,
    selectedBatch?.totalAmountUsd,
    selectedBatch?.fundingVerifiedAt,
    selectedBatch?.wallet.walletAddress,
    selectedBatch?.wallet.address,
    selectedBatch?.deploymentApproval.status,
    selectedChain?.rpcUrl,
  ]);

  useEffect(() => {
    const batch = selectedBatch;
    if (!batch || !canAutoApproveDestinationRecords(batch)) return;
    if (areBatchDestinationsApproved(batch)) return;

    setBatches((current) =>
      current.map((item) => {
        if (item.batchId !== batch.batchId) return item;
        if (!canAutoApproveDestinationRecords(item)) return item;
        const next = approveBatchDestinations(item);
        const approvalsChanged = destinationApprovalSnapshot(item.destinationApprovals) !== destinationApprovalSnapshot(next.destinationApprovals);
        const auditChanged = item.auditTrail.length !== next.auditTrail.length;
        const statusChanged = item.status !== next.status;
        return approvalsChanged || auditChanged || statusChanged ? next : item;
      })
    );
  }, [
    selectedBatch?.batchId,
    selectedBatch?.aaaAllocation.status,
    selectedBatch?.aaaAllocation.allocationPlanHash,
    selectedBatch?.aaaAllocation.policyContextHash,
    selectedBatch?.fundingVerifiedAt,
    selectedBatch?.wallet.walletAddress,
    selectedBatch?.wallet.address,
    selectedBatch?.batchAuthorityBinding?.bindingId,
    selectedBatch?.batchAuthorityBinding?.batchAuthorityBindingHash,
    selectedBatch?.batchAuthorityBinding?.anchorStatus,
    selectedBatch ? deploymentLegSnapshot(selectedBatch.deploymentLegs) : '',
    selectedBatch ? destinationApprovalSnapshot(selectedBatch.destinationApprovals) : '',
    selectedBatch?.deploymentApproval.status,
  ]);

  useEffect(() => {
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    const liveBatches = selectedBatch ? [selectedBatch] : batches.slice(0, 1);
    if (!isValidAddress(escrowAddress) || !selectedChain?.rpcUrl || liveBatches.length === 0) return;

    const targets = liveBatches
      .map((batch) => ({
        batchId: batch.batchId,
        sourceBatchId: batch.sourceBatchId || batch.treasuryHandoff.handoffId,
        key: `${batch.batchId}:${batch.sourceBatchId || batch.treasuryHandoff.handoffId}`,
      }))
      .filter((target) => {
        if (!target.sourceBatchId) return false;
        try { BigInt(target.sourceBatchId); return true; } catch { return false; }
      });

    const pendingTargets = targets.filter((target) => !hasHydrationAttempt(hydrationAttempts.current, 'lifecycle', target.key));
    if (pendingTargets.length === 0) return;

    let cancelled = false;
    const hydrate = async () => {
      const states = await Promise.all(
        pendingTargets.map(async (target) => ({
          batchId: target.batchId,
          state: await readBatchLifecycleStateFromChain({
            escrowAddress,
            sourceBatchId: target.sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          }).catch(() => null),
        }))
      );
      if (cancelled) return;
      pendingTargets.forEach((target) => markHydrationAttempt(hydrationAttempts.current, 'lifecycle', target.key));
      const stateByBatchId = new Map(states.filter((item) => item.state).map((item) => [item.batchId, item.state!]));
      if (stateByBatchId.size === 0) return;
      setBatches((current) => {
        let changed = false;
        const next = current.map((batch) => {
          const state = stateByBatchId.get(batch.batchId);
          if (!state) return batch;
          const updated = applyBatchLifecycleStateFromChain(batch, state);
          if (updated !== batch) changed = true;
          return updated;
        });
        return changed ? next : current;
      });
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [selectedBatch?.batchId, selectedBatch?.sourceBatchId, selectedBatch?.treasuryHandoff.handoffId, selectedChain?.rpcUrl, batches.length]);

  // [REMOVED] Auto-compute AAA allocation effect removed. Phase 5 (AAA allocation) is now
  // handled server-side by the lifecycle controller. Browser allocation paths are prohibited.

  // [REMOVED] Wallet binding mismatch detection effect removed. Mismatch detection is now
  // done server-side in the lifecycle checklist (Phase 3). BatchLifecycleCard displays results.

  // [REMOVED] Authority binding mismatch detection effect removed. Phase 2 checklist on the
  // server detects anchor_hash_mismatch and surfaces it via the lifecycle checklist.

  // [REMOVED] Role authority drift detection effect removed. Phase 2 checklist on the server
  // reads on-chain role authority state and reports drift as a checklist item.

  // [REMOVED] Treasury batch reconciliation effect — replaced with lifecycle registration below.
  // All wallet/binding/funding/allocation state now comes from the lifecycle controller.
  // Keeping a lean registration-only effect: for each confirmed handoff, ensure a lifecycle row exists.
  useEffect(() => {
    if (!selectedChain?.key) return;
    const confirmed = handoffs.filter((h) => h.chainConfirmed && (h.handoffId || h.proposedBatchId));
    for (const handoff of confirmed) {
      const sourceBatchId = handoff.handoffId || handoff.proposedBatchId;
      if (!sourceBatchId) continue;
      fetch('/api/banking/escrow/lifecycle/register-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainKey: selectedChain.key, sourceBatchId }),
      }).catch(() => { /* non-fatal: lifecycle card shows unregistered state */ });
    }
  }, [handoffs, selectedChain?.key]);

  // Convert handoffs → EscrowBatch objects, then apply lifecycle evidence hydration.
  // lifecycleEvidenceByBatchId dependency ensures re-hydration when new evidence arrives.
  useEffect(() => {
    if (handoffs.length === 0) return;
    setBatches((current) => {
      const currentById = new Map(current.map((b) => [b.batchId, b]));
      return handoffs.map((handoff) => {
        const created = createEscrowBatchFromHandoff(handoff);
        const existing = currentById.get(created.batchId);
        const base = existing ?? created;
        const evidence = findLifecycleEvidenceForBatch(lifecycleEvidenceByBatchId, base);
        return evidence && Object.keys(evidence).length > 0
          ? hydrateEscrowBatchFromLifecycleEvidence(base, evidence)
          : base;
      });
    });
  }, [handoffs, lifecycleEvidenceByBatchId]);

  // Load lifecycle batch list + phase evidence from server.
  // Polls every 5 s so newly completed phases appear without a full page reload.
  useEffect(() => {
    if (!selectedChain?.key) return;
    let cancelled = false;
    async function loadLifecycleBatches() {
      try {
        const treasuryAddr = getRuntimeAddress('Treasury');
        const escrowAddr   = getRuntimeAddress('InvestmentEscrow');
        const qs = new URLSearchParams({ chainKey: selectedChain.key });
        if (isValidAddress(treasuryAddr)) qs.set('treasuryAddress', treasuryAddr!.toLowerCase());
        if (isValidAddress(escrowAddr))   qs.set('escrowAddress',   escrowAddr!.toLowerCase());
        const res = await fetch(`/api/banking/escrow/lifecycle/list?${qs.toString()}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const items: Array<{ lifecycle: LifecycleRow; evidence: Record<number, PhaseEvidenceRow> }> = Array.isArray(data) ? data : [];
        const lcRows: LifecycleRow[] = [];
        const evidenceMap = new Map<string, Record<number, PhaseEvidenceRow>>();
        for (const item of items) {
          const lc: LifecycleRow = item.lifecycle ?? (item as unknown as LifecycleRow);
          const ev: Record<number, PhaseEvidenceRow> = item.evidence ?? {};
          lcRows.push(lc);
          for (const key of getLifecycleRowLookupKeys(lc)) {
            evidenceMap.set(key, ev);
          }
        }
        setLifecycleBatches(lcRows);
        setLifecycleEvidenceByBatchId(evidenceMap);
      } catch { /* non-fatal */ }
    }
    loadLifecycleBatches();
    const interval = setInterval(loadLifecycleBatches, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedChain?.key]);

  // Read-only: poll ERC20 balance of the InvestmentEscrow contract to drive Custody Health card.
  useEffect(() => {
    if (!selectedChain?.rpcUrl) return;
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    const usdcAddress   = getRuntimeAddress('MockUSDC');
    if (!isValidAddress(escrowAddress) || !isValidAddress(usdcAddress)) return;

    let cancelled = false;
    async function fetchEscrowBalance() {
      try {
        const provider = new JsonRpcProvider(selectedChain.rpcUrl);
        const usdc = new Contract(usdcAddress, ERC20_BALANCE_READER_ABI, provider);
        const raw: bigint = await usdc.balanceOf(escrowAddress);
        if (!cancelled) setEscrowContractBalanceUsd(Number(formatUnits(raw, 6)));
      } catch { /* non-fatal — card shows Unknown */ }
    }
    fetchEscrowBalance();
    const interval = setInterval(fetchEscrowBalance, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedChain?.rpcUrl]);

  // [REMOVED] Stored allocation plans hydration effect removed. Allocation state now comes
  // from Phase 5 frozen evidence in the lifecycle controller — never from DB-loaded plan stubs.

  useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      setSelectedBatchId(batches[0].batchId);
    }
  }, [batches, selectedBatchId]);

  // Fetch full lifecycle state (including phase evidence) for the selected batch.
  useEffect(() => {
    const batch = batches.find((candidate) => candidate.batchId === selectedBatchId);
    const lcRow = findLifecycleBatchForBatch(lifecycleBatchByKey, batch);
    const escrowBatchId = lcRow?.escrow_batch_id;
    if (!escrowBatchId) { setSelectedBatchEvidence({}); setSelectedBatchAllAttempts([]); return; }
    let cancelled = false;
    fetch(`/api/banking/escrow/lifecycle?escrowBatchId=${encodeURIComponent(escrowBatchId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.evidence) setSelectedBatchEvidence(data.evidence as Record<number, PhaseEvidenceRow>);
        if (data?.allAttempts) setSelectedBatchAllAttempts(data.allAttempts as PhaseAttemptRow[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedBatchId, batches, lifecycleBatchByKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadIncomingTreasuryBatches() {
      try {
        const [response, institutionList] = await Promise.all([
          fetch(`${bankingUrl('/state')}?chainKey=${encodeURIComponent(selectedChain.key)}`),
          fetchInstitutions().catch(() => [] as { institutionId: string; displayName: string }[]),
        ]);
        if (!response.ok) return;
        const resolvedInstitutionNames = new Map<string, string>(institutionList.map((i) => [i.institutionId, i.displayName] as [string, string]));
        setInstitutionNames(resolvedInstitutionNames);
        const payload = await response.json();
        const state = payload.state ?? payload;
        const orders = (state.escrowExecutionOrders ?? payload.escrowExecutionOrders ?? []) as any[];
        const allocationPlans = (state.escrowAllocationPlans ?? payload.escrowAllocationPlans ?? []) as any[];
        const termPositions = (state.termPositions ?? payload.termPositions ?? []) as any[];
        const nextStoredAllocationPlans = allocationPlans.reduce((acc, row) => {
          const batchId = typeof row?.batchId === 'string' ? row.batchId : '';
          const planPayload = row?.planPayload;
          if (!batchId || !planPayload) return acc;
          acc[batchId] = {
            planId: row.planId ?? '',
            allocationPlan: planPayload as AaaTickResponse,
            allocationPlanHash: row?.allocationResult?.allocationPlanHash ?? row?.allocationPlanHash ?? '',
            policyContextHash: row?.allocationResult?.policyContextHash ?? row?.policyContextHash ?? '',
            portfolioRegistryVersion: row?.allocationResult?.portfolioRegistryVersion ?? row?.portfolioRegistryVersion ?? '',
            status: row?.status ?? 'computed',
          };
          return acc;
        }, {} as Record<string, StoredAllocationPlanHydration>);
        const backendDerivedBatches = orders
          .map((order) => buildIncomingTreasuryBatch(order, termPositions, resolvedInstitutionNames))
          .filter((batch): batch is TreasuryHandoffPackage => Boolean(batch));
        let onChainTreasuryBatches: TreasuryHandoffPackage[] = [];
        const treasuryAddress = getRuntimeAddress('Treasury');
        const escrowAddress = getRuntimeAddress('InvestmentEscrow');
        if (isValidAddress(treasuryAddress) && isValidAddress(escrowAddress)) {
          onChainTreasuryBatches = await loadOnChainTreasurySentBatches({
            rpcUrl: selectedChain.rpcUrl,
            chainId: selectedChain.chainId ?? 1337,
            treasuryAddress,
            escrowAddress,
          }).catch(() => []);
        }
        const backendByNaturalKey = new Map(
          backendDerivedBatches
            .map((batch) => [getHandoffNaturalKey(batch), batch] as const)
            .filter(([key]) => Boolean(key))
        );
        const incoming = onChainTreasuryBatches.map((onChainBatch) => {
          const naturalKey = getHandoffNaturalKey(onChainBatch);
          const matchedBackend = naturalKey ? backendByNaturalKey.get(naturalKey) : undefined;
          return mergeBackendMetadataIntoOnChainBatch(onChainBatch, matchedBackend);
        });

        if (cancelled) return;

        setStoredAllocationPlans(nextStoredAllocationPlans);

        setHandoffs((current) => {
          const currentById = new Map(current.map((batch) => [getHandoffLookupKey(batch), batch]));
          const merged = incoming.map((batch) => {
            const key = getHandoffLookupKey(batch);
            return { ...currentById.get(key), ...batch };
          });
          return merged;
        });
      } catch {
        // The Escrow console can still render while the Treasury sender is unavailable.
      }
    }

    loadIncomingTreasuryBatches();
    return () => {
      cancelled = true;
    };
  }, [selectedChain.rpcUrl, selectedChain.key]);

  // Load on-chain role authority signers — the source of truth for anchor signature verification.
  useEffect(() => {
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress)) {
      setOnChainRoleAuthorities(null);
      return;
    }
    readOnChainRoleAuthorities({ escrowAddress, rpcUrl: selectedChain.rpcUrl })
      .then(setOnChainRoleAuthorities)
      .catch(() => setOnChainRoleAuthorities(null));
  }, [selectedChain.rpcUrl, roleAuthoritiesRefreshTick]);

  // Track connected browser wallet at the EscrowTab level for auto-sign logic.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    setConnectedAddress((eth.selectedAddress ?? '').toLowerCase());
    const handle = (accounts: string[]) => setConnectedAddress((accounts[0] ?? '').toLowerCase());
    eth.on?.('accountsChanged', handle);
    return () => eth.removeListener?.('accountsChanged', handle);
  }, []);

  // [REMOVED] Auto-sign authority binding effect removed. Phase 2 (authority anchor) is now
  // handled server-side by the lifecycle controller. Browser signing paths are prohibited.

  // Auto-approve deployment once all prerequisites are satisfied.
  // Fires at most once per batch per session (tracked via autoActionsAttempted).
  // Does not fire while another approval save is already in flight.
  useEffect(() => {
    const batch = selectedBatch;
    if (!batch || batch.deploymentApproval.status === 'approved') return;
    if (!batch.batchId) return;

    let cancelled = false;
    fetchDeploymentApprovalFromDb(batch.batchId)
      .then((evidence) => {
        if (!evidence || cancelled) return;
        setBatches((current) =>
          current.map((item) =>
            item.batchId !== batch.batchId
              ? item
              : {
                  ...item,
                  status: ['deployed', 'active', 'settlement_pending', 'settled', 'retired'].includes(item.status)
                    ? item.status
                    : 'deployment_pending',
                  deploymentApproval: {
                    status: 'approved',
                    approvedBy: evidence.approvedBy,
                    approvedAt: evidence.approvedAt,
                    deploymentApprovalHash: evidence.deploymentApprovalHash,
                    destinationApprovalHash: evidence.destinationApprovalHash,
                    allocationPlanHash: evidence.allocationPlanHash,
                    policyContextHash: evidence.policyContextHash,
                    destinationRegistryVersion: evidence.destinationRegistryVersion,
                    payload: evidence.payload,
                    evidence,
                  },
                  deploymentLegs: rehydrateDeploymentLegsFromApprovalPayload(
                    {
                      ...item,
                      deploymentApproval: {
                        ...item.deploymentApproval,
                        status: 'approved',
                        approvedBy: evidence.approvedBy,
                        approvedAt: evidence.approvedAt,
                        deploymentApprovalHash: evidence.deploymentApprovalHash,
                        destinationApprovalHash: evidence.destinationApprovalHash,
                        allocationPlanHash: evidence.allocationPlanHash,
                        policyContextHash: evidence.policyContextHash,
                        destinationRegistryVersion: evidence.destinationRegistryVersion,
                        payload: evidence.payload,
                        evidence,
                      },
                    },
                    evidence.payload,
                  ),
                }
          )
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedBatch?.batchId, selectedBatch?.deploymentApproval.status]);

  useEffect(() => {
    const batch = selectedBatch;
    if (!batch || !batch.batchId) return;
    if ((batch.deploymentExecutions ?? []).length > 0) {
      // Already have execution records — mark as checked so auto-execute can proceed if needed.
      setExecutionHydrationCompleted((prev) => prev.has(batch.batchId) ? prev : new Set([...prev, batch.batchId]));
      return;
    }
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress) || !selectedChain?.rpcUrl) return;

    let cancelled = false;
    fetchDeploymentExecutionFromDb(batch.batchId)
      .then(async (execution) => {
        if (cancelled) return;
        if (execution) {
          setBatches((current) =>
            current.map((item) =>
              item.batchId !== batch.batchId
                ? item
                : applyDeploymentExecutionToBatch(item, execution)
            )
          );
          // Hydration complete — mark after applying so auto-execute sees the correct state.
          setExecutionHydrationCompleted((prev) => new Set([...prev, batch.batchId]));
          return;
        }

        const onChainExecution = await rehydrateDeploymentExecutionFromChain({
          batch,
          rpcUrl: selectedChain.rpcUrl,
          escrowAddress,
        });
        if (!onChainExecution || cancelled) {
          // No execution found anywhere — safe to unblock auto-execute for genuinely new batches.
          if (!cancelled) setExecutionHydrationCompleted((prev) => new Set([...prev, batch.batchId]));
          return;
        }

        saveDeploymentExecutionToDb(batch.batchId, onChainExecution).catch(() => undefined);
        setBatches((current) =>
          current.map((item) =>
            item.batchId !== batch.batchId
              ? item
              : applyDeploymentExecutionToBatch(item, onChainExecution)
          )
        );
        setExecutionHydrationCompleted((prev) => new Set([...prev, batch.batchId]));
      })
      .catch(() => {
        setExecutionHydrationCompleted((prev) => new Set([...prev, batch.batchId]));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBatch?.batchId, selectedBatch?.deploymentExecutions?.length, selectedBatch?.deploymentApproval.status, selectedChain?.rpcUrl]);

  useEffect(() => {
    if (approvingDeploymentBatchId) return;
    for (const batch of batches) {
      if (hasDeploymentApproval(batch)) continue;
      if (!canApproveDeployment(batch)) continue;
      const key = `${batch.batchId}:deployment-approve`;
      if (autoActionsAttempted.current.has(key)) continue;
      autoActionsAttempted.current.add(key);
      approveDeploymentForBatch(batch);
      return;
    }
  // approveDeploymentForBatch is a stable closure — intentionally omitted from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, approvingDeploymentBatchId]);

  useEffect(() => {
    if (executingDeploymentBatchId) return;
    if (!selectedChain?.key || !isLocalExecutionChain(selectedChain.key)) return;

    for (const batch of batches) {
      if (!canExecuteDeployment(batch)) continue;
      // Wait for execution hydration (DB + chain check) to complete before auto-executing.
      // Prevents re-deploying an already-executed batch on reload before records are loaded.
      if (!executionHydrationCompleted.has(batch.batchId)) continue;
      const nextLeg = getNextApprovedDeploymentTransferLeg(batch);
      if (!nextLeg) continue;

      const autoExecuteKey = `${batch.batchId}:deployment-execute:${nextLeg.leg.legId}`;
      if (autoActionsAttempted.current.has(autoExecuteKey)) continue;
      autoActionsAttempted.current.add(autoExecuteKey);
      executeDeploymentForBatch(batch);
      return;
    }
  // executeDeploymentForBatch is a stable closure for this component lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, executingDeploymentBatchId, executionHydrationCompleted, selectedChain?.key, signerServiceConfig.treasurySignerUrl, signerServiceConfig.escrowSignerUrl]);

  useEffect(() => {
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress)) return;

    const liveBatches = selectedBatch ? [selectedBatch] : batches.slice(0, 1);
    const batchesToCheck = liveBatches.filter((batch) => {
      const binding = batch.batchAuthorityBinding;
      if (!binding) return false;
      if (!requiresBatchAuthorityBinding(batch)) return false;
      if (binding.anchorStatus === 'anchored' || binding.anchorStatus === 'binding_mismatch') return false;
      const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      if (!sourceBatchId) return false;
      try { BigInt(sourceBatchId); return true; } catch { return false; }
    });

    const pendingBatches = batchesToCheck.filter((batch) => {
      const sourceBatchId = batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      return !hasHydrationAttempt(hydrationAttempts.current, 'authority', `${batch.batchId}:${sourceBatchId}`);
    });
    if (pendingBatches.length === 0) return;

    let cancelled = false;

    Promise.all(
      pendingBatches.map(async (batch) => {
        const binding = batch.batchAuthorityBinding!;
        const sourceBatchId = (binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId)!;
        try {
          const onChain = await readBatchAuthorityAnchorFromChain({
            escrowAddress,
            sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          });
          if (!onChain || cancelled) return;
          setBatches((current) =>
            current.map((item) =>
              item.batchId === batch.batchId ? applyOnChainAnchorToBatch(item, onChain) : item
            )
          );
        } catch {
          // Chain read failed — leave current state.
        }
      })
    );

    pendingBatches.forEach((batch) => {
      const sourceBatchId = batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      markHydrationAttempt(hydrationAttempts.current, 'authority', `${batch.batchId}:${sourceBatchId}`);
    });

    return () => { cancelled = true; };
  }, [selectedBatch?.batchId, selectedBatch?.batchAuthorityBinding?.bindingId, selectedBatch?.batchAuthorityBinding?.anchorStatus, selectedChain.rpcUrl, selectedChain.key]);

  // ── On-chain wallet binding polling ──────────────────────────────────────────
  // Only runs for batch_wallet_custody batches. escrow_contract_custody batches
  // don't have a separate wallet — funds sit in InvestmentEscrow.
  useEffect(() => {
    const escrowAddress = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress)) return;

    const liveBatches = selectedBatch ? [selectedBatch] : batches.slice(0, 1);
    const batchesToCheck = liveBatches.filter((batch) => {
      if (batch.custodyMode !== 'batch_wallet_custody') return false;
      const sourceBatchId = batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      if (!sourceBatchId) return false;
      try { BigInt(sourceBatchId); } catch { return false; }
      const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address;
      const walletMissing = !walletAddress || !isValidAddress(walletAddress);
      const bindingMissing = batch.batchWalletBinding?.bindingStatus !== 'binding_locked';
      return walletMissing || bindingMissing;
    });

    const pendingBatches = batchesToCheck.filter((batch) => {
      const sourceBatchId = batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      return !hasHydrationAttempt(hydrationAttempts.current, 'wallet', `${batch.batchId}:${sourceBatchId}`);
    });
    if (pendingBatches.length === 0) return;

    let cancelled = false;
    Promise.all(
      pendingBatches.map(async (batch) => {
        const sourceBatchId = (batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId)!;
        try {
          const onChainWallet = await readBatchWalletBindingFromChain({
            escrowAddress,
            sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          });
          if (!onChainWallet || !onChainWallet.exists || cancelled) return;
          setBatches((current) =>
            current.map((item) =>
              item.batchId === batch.batchId
                ? applyOnChainWalletBindingToBatch(item, onChainWallet)
                : item
            )
          );
        } catch {
          // Chain read failed — leave current state.
        }
      })
    );

    pendingBatches.forEach((batch) => {
      const sourceBatchId = batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      markHydrationAttempt(hydrationAttempts.current, 'wallet', `${batch.batchId}:${sourceBatchId}`);
    });

    return () => { cancelled = true; };
  }, [selectedBatch?.batchId, selectedBatch?.wallet.walletAddress, selectedBatch?.wallet.address, selectedBatch?.batchWalletBinding?.bindingStatus, selectedChain.rpcUrl]);

  // ── Auto-verify batch wallet funding from chain ───────────────────────────────
  // Runs when a batch_wallet_custody batch has an on-chain wallet but local
  // funding evidence is not verified. Reads wallet USDC balance and the
  // batchWalletFunded flag from chain so refresh state cannot regress to pending.
  useEffect(() => {
    const escrowAddr = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddr) || !selectedChain?.rpcUrl || !selectedChain?.key) return;

    const liveBatches = selectedBatch ? [selectedBatch] : batches.slice(0, 1);
    const batchesToVerify = liveBatches.filter((b) => {
      if (b.custodyMode !== 'batch_wallet_custody') return false;
      if (getFundingValidation(b).state === 'verified') return false;
      const walletAddr = b.wallet.walletAddress ?? b.wallet.address;
      if (!walletAddr || !isValidAddress(walletAddr)) return false;
      return true;
    });

    const pendingBatches = batchesToVerify.filter((batch) => {
      const walletAddr = batch.wallet.walletAddress ?? batch.wallet.address;
      return !hasHydrationAttempt(hydrationAttempts.current, 'funding', `${batch.batchId}:${walletAddr}`);
    });
    if (pendingBatches.length === 0) return;

    let cancelled = false;
    const verifyOnce = async () => {
      await Promise.all(
        pendingBatches.map(async (b) => {
        try {
          const verification = await readOnChainFundingVerification({
            batch: b,
            rpcUrl: selectedChain.rpcUrl,
            escrowAddress: escrowAddr,
          });
          if (cancelled || verification.fundingStatus !== 'verified') return;
          setBatches((current) =>
            current.map((item) => {
              if (item.batchId !== b.batchId || getFundingValidation(item).state === 'verified') return item;
              return applyFundingConfirmationToBatch(
                item,
                createFundingConfirmation({
                  batch: item,
                  observedAmountUsd: verification.observedAmountUsd,
                  fundingTxHash: verification.fundingTxHash,
                  confirmedBy: 'Escrow On-chain Verifier',
                  confirmedAt: verification.confirmedAt,
                  asset: item.asset || 'USDC',
                  custodyMode: 'batch_wallet_custody',
                  sourceContract: verification.sourceContract,
                  sourceBatchId: verification.sourceBatchId,
                  fundingSource: verification.fundingSource,
                  fundingStatus: 'verified',
                })
              );
            })
          );
        } catch { /* Chain read failed — user can manually trigger verification */ }
        })
      );
    };

    void verifyOnce();
    pendingBatches.forEach((batch) => {
      const walletAddr = batch.wallet.walletAddress ?? batch.wallet.address;
      markHydrationAttempt(hydrationAttempts.current, 'funding', `${batch.batchId}:${walletAddr}`);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBatch?.batchId, selectedBatch?.wallet.walletAddress, selectedBatch?.wallet.address, selectedBatch?.wallet.fundingStatus, selectedChain?.rpcUrl, selectedChain?.key]);

  // ── Resolve allocation status (DB content + chain authority) ─────────────────
  // DB = content source. Chain = authority source.
  // Status is only 'validated' when DB payload hash matches on-chain attachment.
  // Replaces the two separate DB-fetch and chain-read effects.
  useEffect(() => {
    const escrowAddr = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddr) || !selectedChain?.rpcUrl || !selectedChain?.key) return;

    const liveBatches = selectedBatch ? [selectedBatch] : batches.slice(0, 1);
    const batchesToResolve = liveBatches.filter((b) => {
      // Skip allocation transaction actively running in this session.
      if (requestingAllocationBatchId === b.batchId) return false;
      // Skip in-progress or terminal states set by user actions — background poll must not overwrite them.
      if (['validated', 'pending_anchor', 'requesting'].includes(b.aaaAllocation.status)) return false;
      const sourceBatchId = b.sourceBatchId || b.treasuryHandoff.handoffId;
      if (!sourceBatchId) return false;
      return true;
    });

    const pendingBatches = batchesToResolve.filter((batch) => {
      const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
      return !hasHydrationAttempt(hydrationAttempts.current, 'allocation', `${batch.batchId}:${sourceBatchId}:${batch.aaaAllocation.status}`);
    });
    if (pendingBatches.length === 0) return;

    let cancelled = false;
    Promise.all(
      pendingBatches.map(async (b) => {
        try {
          const resolved = await resolveAllocationStatus({
            batch:         b,
            rpcUrl:        selectedChain.rpcUrl,
            escrowAddress: escrowAddr,
            chainKey:      selectedChain.key,
          });
          const resolvedPlan = resolved.allocationPlan ?? b.aaaAllocation.allocationPlan;
          const chainValidatedFromCurrentPlan = Boolean(
            resolved.chainPlanHash && allocationPlanMatchesHash(resolvedPlan, resolved.chainPlanHash)
          );
          const effectiveResolvedStatus =
            resolved.status === 'validated' || chainValidatedFromCurrentPlan ? 'validated' : resolved.status;

          setBatches((current) =>
            current.map((item) => {
              if (item.batchId !== b.batchId) return item;
              if (cancelled) return item;

              if (resolved.status === 'missing') {
                if (item.aaaAllocation.allocationPlanHash || item.aaaAllocation.allocationPlan) {
                  const nextItem = {
                    ...item,
                    status: item.status === 'aaa_plan_attached' ? 'wallet_funded' : item.status,
                    aaaAllocation: {
                      ...item.aaaAllocation,
                      status: 'computed',
                    },
                  } as typeof item;
                  return (
                    nextItem.status === item.status &&
                    aaaAllocationSnapshot(nextItem) === aaaAllocationSnapshot(item)
                  )
                    ? item
                    : nextItem;
                }
                const nextItem = {
                  ...item,
                  aaaAllocation: {
                    ...item.aaaAllocation,
                    allocationPlan: undefined,
                    allocationPlanHash: '',
                    policyContextHash: '',
                    portfolioRegistryVersion: '',
                    targetYieldBps: 0,
                    status: 'missing',
                  },
                } as typeof item;
                return aaaAllocationSnapshot(nextItem) === aaaAllocationSnapshot(item)
                  ? item
                  : nextItem;
              }

              const currentPlan = resolved.allocationPlan ?? item.aaaAllocation.allocationPlan;
              const planHash = resolved.chainPlanHash || resolved.dbPlanHash || item.aaaAllocation.allocationPlanHash;
              const effectiveStatus =
                resolved.status === 'validated' || allocationPlanMatchesHash(currentPlan, resolved.chainPlanHash)
                  ? 'validated'
                  : resolved.status;
              const weights    = (currentPlan as any)?.target_weights ?? {};
              const roleByAss  = (currentPlan as any)?.role_by_asset  ?? {};
              const roleYield: Record<string, number> = {
                core: 800, liquidity: 400, satellite: 600, defensive: 300,
                speculative: 1200, yield_fund: 700, external: 900,
              };
              const blendedYieldBps = Math.round(
                Object.entries(weights).reduce(
                  (sum, [sym, w]) => sum + (w as number) * (roleYield[roleByAss[sym] ?? ''] ?? 900),
                  0,
                )
              );

              const batchStatus = ['wallet_funded', 'wallet_created'].includes(item.status)
                ? 'aaa_plan_attached'
                : item.status;

              const nextItem = {
                ...item,
                status:
                  effectiveStatus === 'validated'
                    ? batchStatus
                    : item.status === 'aaa_plan_attached'
                      ? 'wallet_funded'
                      : item.status,
                aaaAllocation: {
                  ...item.aaaAllocation,
                  planId:                   resolved.planId || item.aaaAllocation.planId,
                  allocationPlan:           currentPlan,
                  allocationPlanHash:       planHash,
                  policyContextHash:        resolved.policyContextHash || item.aaaAllocation.policyContextHash,
                  portfolioRegistryVersion: resolved.portfolioRegistryVersion || item.aaaAllocation.portfolioRegistryVersion,
                  attachedAt:               resolved.attachedAt || item.aaaAllocation.attachedAt,
                  targetYieldBps:           blendedYieldBps || item.aaaAllocation.targetYieldBps,
                  status:                   effectiveStatus,
                },
              } as typeof item;
              return (
                nextItem.status === item.status &&
                aaaAllocationSnapshot(nextItem) === aaaAllocationSnapshot(item)
              )
                ? item
                : nextItem;
            })
          );
        } catch { /* Resolution failed — batch stays in current state */ }
      })
    );
    pendingBatches.forEach((batch) => {
      const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
      markHydrationAttempt(hydrationAttempts.current, 'allocation', `${batch.batchId}:${sourceBatchId}:${batch.aaaAllocation.status}`);
    });
    return () => { cancelled = true; };
  }, [selectedBatch?.batchId, selectedBatch?.aaaAllocation.status, requestingAllocationBatchId, selectedChain?.rpcUrl, selectedChain?.chainId, selectedChain?.key, batches.length]);

  // Backfill attachedAt for validated batches hydrated from DB without it.
  // Uses a targeted chain read that only updates attachedAt — never changes status.
  useEffect(() => {
    const escrowAddr = getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddr) || !selectedChain?.rpcUrl) return;

    const batch = selectedBatch;
    if (!batch) return;
    if (batch.aaaAllocation.status !== 'validated') return;
    if (batch.aaaAllocation.attachedAt) return;

    const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
    if (!sourceBatchId) return;

    const attemptKey = `attachedAt:${batch.batchId}:${sourceBatchId}`;
    if (hasHydrationAttempt(hydrationAttempts.current, 'allocation', attemptKey)) return;
    markHydrationAttempt(hydrationAttempts.current, 'allocation', attemptKey);

    let cancelled = false;
    readAllocationFromChain({ sourceBatchId, rpcUrl: selectedChain.rpcUrl, escrowAddress: escrowAddr })
      .then((onChain) => {
        if (cancelled || !onChain?.attachedAt) return;
        const attachedAt = new Date(onChain.attachedAt * 1000).toISOString();
        setBatches((current) =>
          current.map((item) => {
            if (item.batchId !== batch.batchId) return item;
            if (item.aaaAllocation.attachedAt) return item;
            return { ...item, aaaAllocation: { ...item.aaaAllocation, attachedAt } };
          })
        );
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [selectedBatch?.batchId, selectedBatch?.aaaAllocation.status, selectedBatch?.aaaAllocation.attachedAt, selectedChain?.rpcUrl]);

  // ── createBatchWalletForBatch ─────────────────────────────────────────────────
  // Calls wallet-factory to deploy a real 2-of-3 BatchMultisigWallet and bind it
  // to the on-chain anchor record. Only valid for batch_wallet_custody batches
  // after anchor is confirmed.
  const createBatchWalletForBatch = React.useCallback((batch: EscrowBatch) => {
    if (batch.custodyMode !== 'batch_wallet_custody') {
      setWalletCreationError('Wallet creation is only applicable to batch_wallet_custody batches. escrow_contract_custody batches hold funds in InvestmentEscrow directly.');
      return;
    }

    if (!WALLET_FACTORY_URL) {
      setWalletCreationError('NEXT_PUBLIC_WALLET_FACTORY_URL is not configured. Set it in frontend/.env.local and restart.');
      return;
    }

    const binding = batch.batchAuthorityBinding;
    if (!binding || binding.anchorStatus !== 'anchored') {
      setWalletCreationError('Batch Authority Binding must be anchored before creating a wallet.');
      return;
    }

    const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
    const escrowBatchId = binding.canonicalPayload?.escrowBatchId ?? batch.batchId;
    if (!sourceBatchId) {
      setWalletCreationError('sourceBatchId is missing — cannot create wallet.');
      return;
    }

    setWalletCreatingBatchId(batch.batchId);
    setWalletCreationError(null);

    fetch(`${WALLET_FACTORY_URL}/create-batch-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBatchId,
        escrowBatchId,
        batchAuthorityBindingHash: binding.batchAuthorityBindingHash,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Wallet factory responded ${res.status}`);
        return data as {
          walletAddress: string;
          creationTxHash: string;
          bindingTxHash: string;
          boundAt: string;
          ownerTreasury: string;
          ownerEscrow: string;
          ownerContinuity: string;
          threshold: number;
          alreadyBound?: boolean;
          batchAuthorityBindingHash: string;
        };
      })
      .then((data) => {
        const onChainBinding: OnChainBatchWalletBinding = {
          exists: true,
          escrowBatchIdHash: '',
          batchAuthorityBindingHash: data.batchAuthorityBindingHash,
          walletAddress: data.walletAddress,
          ownerTreasury: data.ownerTreasury,
          ownerEscrow: data.ownerEscrow,
          ownerContinuity: data.ownerContinuity,
          threshold: data.threshold,
          factory: '',
          creationTxHash: data.creationTxHash,
          boundAt: data.boundAt,
          boundBy: '',
        };
        setBatches((current) =>
          current.map((item) =>
            item.batchId === batch.batchId
              ? applyOnChainWalletBindingToBatch(item, onChainBinding, {
                  creationTxHash: data.creationTxHash,
                  bindingTxHash: data.bindingTxHash,
                })
              : item
          )
        );
        setWalletCreatingBatchId('');
      })
      .catch((err: unknown) => {
        const reason = String((err as any)?.message ?? err ?? 'Unknown wallet creation error');
        setWalletCreationError(reason);
        setWalletCreatingBatchId('');
      });
  }, []);

  // Wallet creation is handled server-side by the escrow signer service immediately
  // after anchoring (for batch_wallet_custody batches). The on-chain polling effect
  // above recovers wallet state after a page reload. No separate auto-creation loop
  // is needed — if the signer service path was used, the wallet is already bound by
  // the time the anchor response arrives.

  // ── Custody mode toggle ───────────────────────────────────────────────────────
  // Only available before any signing has occurred. Switching the mode resets the
  // batch authority binding payload so the new mode is embedded in the next hash.
  const setCustodyModeForBatch = (batch: EscrowBatch, mode: 'escrow_contract_custody' | 'batch_wallet_custody') => {
    if (batch.custodyMode === mode) return;
    setBatches((current) =>
      current.map((item) => {
        if (item.batchId !== batch.batchId) return item;
        const binding = item.batchAuthorityBinding;
        const alreadySigned = binding && (
          binding.treasurySignatureStatus !== 'pending' || binding.escrowSignatureStatus !== 'pending'
        );
        if (alreadySigned) return item;
        return {
          ...item,
          custodyMode: mode,
          batchAuthorityBinding: undefined,
          auditTrail: [
            ...item.auditTrail,
            {
              eventId: `${item.batchId}-custody-mode-set-${mode}-${Date.now()}`,
              timestamp: new Date().toISOString(),
              actor: 'Escrow Operator',
              eventType: 'Custody mode set',
              description: `Batch custody mode set to ${mode} before signing. Batch Authority Binding payload will be regenerated with the new mode.`,
              reference: mode,
            },
          ],
        };
      })
    );
  };

  const applyManualFundingConfirmation = (batch: EscrowBatch, observedAmountUsd: number, fundingTxHash: string) => {
    if (!['treasury_received', 'wallet_created', 'wallet_funded'].includes(batch.status)) return;
    if (batch.batchWalletBinding?.bindingStatus !== 'binding_locked') {
      setSelectedBatchId(batch.batchId);
      return;
    }
    if (getBatchWalletBindingValidation(batch).state !== 'valid') {
      setBatches((current) =>
        current.map((item) =>
          item.batchId === batch.batchId
            ? recordBatchWalletBindingMismatch(item, getBatchWalletBindingValidation(item), { markException: true })
            : item
        )
      );
      setSelectedBatchId(batch.batchId);
      return;
    }

    setBatches((current) =>
      current.map((item) =>
        item.batchId === batch.batchId
          ? getBatchWalletBindingValidation(item).state === 'valid'
            ? applyFundingConfirmationToBatch(
                item,
                createFundingConfirmation({
                  batch: item,
                  observedAmountUsd,
                  fundingTxHash: fundingTxHash || undefined,
                  confirmedBy: 'Escrow Operator',
                })
              )
            : recordBatchWalletBindingMismatch(item, getBatchWalletBindingValidation(item), { markException: true })
          : item
      )
    );
    setSelectedBatchId(batch.batchId);
  };

  const verifyFundingForBatch = async (batch: EscrowBatch) => {
    if (!['treasury_received', 'wallet_created', 'wallet_funded'].includes(batch.status)) return;
    setFundingVerificationError(null);
    setSelectedBatchId(batch.batchId);

    if (batch.batchWalletBinding?.bindingStatus !== 'binding_locked') {
      setFundingVerificationError('Batch wallet binding has not been locked.');
      return;
    }

    const bindingValidation = getBatchWalletBindingValidation(batch);
    if (bindingValidation.state !== 'valid') {
      setBatches((current) =>
        current.map((item) =>
          item.batchId === batch.batchId
            ? recordBatchWalletBindingMismatch(item, getBatchWalletBindingValidation(item), { markException: true })
            : item
        )
      );
      setFundingVerificationError(bindingValidation.blockingReason ?? 'Batch wallet binding is invalid.');
      return;
    }

    if (requiresBatchAuthorityBinding(batch)) {
      const authorityValidation = getBatchAuthorityBindingValidation(batch);
      if (authorityValidation.state !== 'valid') {
        setBatches((current) =>
          current.map((item) =>
            item.batchId === batch.batchId
              ? recordBatchAuthorityBindingMismatch(item, getBatchAuthorityBindingValidation(item), { markException: true })
              : item
          )
        );
        setFundingVerificationError(authorityValidation.blockingReason ?? 'Batch authority binding is missing or invalid.');
        return;
      }
    }

    const escrowAddress = batch.sourceContract && isValidAddress(batch.sourceContract)
      ? batch.sourceContract
      : getRuntimeAddress('InvestmentEscrow');
    if (!isValidAddress(escrowAddress)) {
      setFundingVerificationError('InvestmentEscrow contract address is missing.');
      return;
    }

    try {
      setVerifyingFundingBatchId(batch.batchId);
      const verification = await readOnChainFundingVerification({
        batch,
        rpcUrl: selectedChain.rpcUrl,
        escrowAddress,
      });
      const chainVerification = verification;

      setBatches((current) =>
        current.map((item) => {
          if (item.batchId !== batch.batchId) return item;
          const confirmation = createFundingConfirmation({
            batch: {
              ...item,
              custodyMode: chainVerification.custodyMode,
              sourceContract: chainVerification.sourceContract,
              sourceBatchId: chainVerification.sourceBatchId,
              sourceContractBalanceUsd: chainVerification.sourceContractBalanceUsd,
              batchPositionCollateralUsd: chainVerification.batchPositionCollateralUsd,
              fundingSource: chainVerification.fundingSource,
            },
            observedAmountUsd: chainVerification.observedAmountUsd,
            fundingTxHash: chainVerification.fundingTxHash,
            confirmedBy: 'Escrow On-chain Verifier',
            confirmedAt: chainVerification.confirmedAt,
            asset: item.asset || 'USDC',
            custodyMode: chainVerification.custodyMode,
            sourceContract: chainVerification.sourceContract,
            sourceBatchId: chainVerification.sourceBatchId,
            sourceContractBalanceUsd: chainVerification.sourceContractBalanceUsd,
            batchPositionCollateralUsd: chainVerification.batchPositionCollateralUsd,
            fundingSource: chainVerification.fundingSource,
            fundingStatus: chainVerification.fundingStatus,
          });
          return applyFundingConfirmationToBatch(item, confirmation);
        })
      );

      if (chainVerification.fundingStatus === 'mismatch') {
        setFundingVerificationError(
          `Funding mismatch. Expected ${fmtUsd(chainVerification.expectedAmountUsd)}, observed ${fmtUsd(chainVerification.observedAmountUsd)}.`
        );
      }
    } catch (error: any) {
      setFundingVerificationError(String(error?.message || error));
    } finally {
      setVerifyingFundingBatchId('');
    }
  };

  // [REMOVED] onRequestAaaAllocation — browser-signing allocation path removed.
  // Phase 5 (AAA allocation) is handled server-side by the lifecycle controller.
  // Use the BatchLifecycleCard advance button to trigger Phase 5.

  // ── Recover allocation plan (read-only, no tx) ───────────────────────────────
  const onRecoverAllocationPlan = async (batch: EscrowBatch) => {
    const escrowAddr    = getRuntimeAddress('InvestmentEscrow');
    const registryAddr  = getRuntimeAddress('PortfolioRegistry');
    const routeRegistryAddr = getRuntimeAddress('ExecutionRouteRegistry');
    if (!isValidAddress(escrowAddr) || !isValidAddress(registryAddr)) {
      setPlanRecoveryError('Contract addresses not configured.');
      return;
    }
    setRecoveringPlanBatchId(batch.batchId);
    setPlanRecoveryError(null);
    try {
      const recovered: RecoveredAllocationPlan = await recoverAllocationPlan({
        batch,
        rpcUrl:           selectedChain.rpcUrl,
        escrowAddress:    escrowAddr,
        registryAddress:  registryAddr,
        routeRegistryAddress: isValidAddress(routeRegistryAddr) ? routeRegistryAddr : undefined,
        chainId:          selectedChain.chainId,
        chainKey:         selectedChain.key,
        onChainHash:      batch.aaaAllocation.allocationPlanHash || undefined,
        onChainPolicyHash:batch.aaaAllocation.policyContextHash  || undefined,
      });
      setBatches((current) =>
        current.map((item) =>
          item.batchId === batch.batchId
            ? applyRecoveredPlanToBatch(item, recovered)
            : item
        )
      );
    } catch (err: any) {
      setPlanRecoveryError(err?.reason ?? err?.message ?? 'Plan recovery failed.');
    } finally {
      setRecoveringPlanBatchId('');
    }
  };

  // Shared logic: apply a completed authority signature (from service or browser wallet) to batch state.
  const applyAuthoritySignatureToBatch = (
    batch: EscrowBatch,
    role: BatchAuthoritySignerRole,
    updatedBinding: BatchAuthorityBinding,
  ) => {
    const sigStatus = role === 'treasury' ? updatedBinding!.treasurySignatureStatus : updatedBinding!.escrowSignatureStatus;
    const recoveredAddr = role === 'treasury' ? updatedBinding!.treasuryRecoveredSignerAddress : updatedBinding!.escrowRecoveredSignerAddress;
    const isVerified = sigStatus === 'signed';
    const isMismatch = sigStatus === 'invalid';
    const signedEventId = `${batch.batchId}-authority-binding-${role}-signed`;
    const mismatchEventId = `${batch.batchId}-authority-binding-${role}-sig-mismatch`;

    setBatches((current) => current.map((item) => {
      if (item.batchId !== batch.batchId) return item;
      const existingIds = new Set(item.auditTrail.map((e) => e.eventId));
      const newEvents: EscrowBatch['auditTrail'] = [];

      const registryRecord = role === 'treasury' ? getTreasuryVaultAuthority() : getEscrowAuthority();
      const verifiedEventLabel = role === 'treasury'
        ? 'Treasury/Vault authority signature verified'
        : 'Escrow authority signature verified';
      const rejectedEventLabel = role === 'treasury'
        ? 'Signature rejected: signer mismatch (Treasury/Vault)'
        : 'Signature rejected: signer mismatch (Escrow)';

      if (!existingIds.has(signedEventId)) {
        newEvents.push({
          eventId: signedEventId,
          timestamp: new Date().toISOString(),
          actor: role === 'treasury' ? 'Treasury Authority' : 'Escrow Authority',
          eventType: isVerified ? verifiedEventLabel : rejectedEventLabel,
          description: `EIP-712 Batch Authority Binding ${isVerified ? 'signed and verified' : 'signed with signer mismatch'} by ${registryRecord.roleLabel}. Recovered signer: ${recoveredAddr ?? 'unknown'}. Expected: ${registryRecord.expectedSignerAddress}. Registry: ${registryRecord.registryVersion}.`,
          reference: updatedBinding!.batchAuthorityBindingHash,
        });
      }

      if (isMismatch && !existingIds.has(mismatchEventId)) {
        newEvents.push({
          eventId: mismatchEventId,
          timestamp: new Date().toISOString(),
          actor: 'Role Authority Registry',
          eventType: 'Signature rejected: signer mismatch',
          description: updatedBinding!.signatureMismatchReason ?? `${registryRecord.roleLabel} signature mismatch detected.`,
          reference: updatedBinding!.batchAuthorityBindingHash,
        });
      }

      const bothSigned = updatedBinding!.treasurySignatureStatus === 'signed' && updatedBinding!.escrowSignatureStatus === 'signed';
      const verifiedEventId = `${batch.batchId}-authority-binding-signatures-verified`;
      if (bothSigned && !existingIds.has(verifiedEventId) && !newEvents.some((e) => e.eventId === verifiedEventId)) {
        newEvents.push({
          eventId: verifiedEventId,
          timestamp: new Date().toISOString(),
          actor: 'Escrow Service',
          eventType: 'Batch Authority Binding signature verified',
          description: `Both Treasury/Vault and Escrow signatures verified. Batch Authority Binding is fully signed and ready for funding verification, destination approval, and deployment signing.`,
          reference: updatedBinding!.batchAuthorityBindingHash,
        });
      }

      return {
        ...item,
        batchAuthorityBinding: updatedBinding,
        auditTrail: [...item.auditTrail, ...newEvents],
      };
    }));

    setSelectedBatchId(batch.batchId);
    setSigningAuthorityKey('');
  };

  const signAuthorityBindingForBatch = (batch: EscrowBatch, role: BatchAuthoritySignerRole) => {
    const binding = batch.batchAuthorityBinding;
    if (!binding) return;

    setSigningAuthorityError(null);
    setSigningAuthorityKey(`${binding.bindingId}:${role}`);

    const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
    if (!sourceBatchId) {
      setSigningAuthorityError('sourceBatchId is missing from batch — cannot advance the lifecycle.');
      setSigningAuthorityKey('');
      return;
    }

    // Signing and anchoring are both Phase 2, executed server-side. The browser
    // asks the lifecycle controller to advance; the banking server calls the
    // signer services with its own credential. See lib/escrow/lifecycleActions.
    //
    // `role` no longer selects a service to call — both role signatures are
    // produced within the one phase — but it is retained so the UI can report
    // which button the operator pressed.
    advanceEscrowLifecycleOrThrow({
      sourceBatchId,
      escrowBatchId: batch.batchId,
      chainKey: selectedChain.key,
    })
      .then(async () => {
        // Re-derive from chain. The anchor record carries the recovered signer
        // addresses, so it — not a response body — is what proves the binding
        // was signed by the expected role authorities.
        const onChainAnchor = await readBatchAuthorityAnchorFromChain({
          escrowAddress: getRuntimeAddress('InvestmentEscrow'),
          sourceBatchId,
          rpcUrl: selectedChain.rpcUrl,
        });

        if (!onChainAnchor || !onChainAnchor.exists) {
          // Phase 2 may legitimately not have reached the anchor yet.
          setSigningAuthorityKey('');
          setSelectedBatchId(batch.batchId);
          return;
        }

        if (onChainAnchor.batchAuthorityBindingHash.toLowerCase() !== binding.batchAuthorityBindingHash.toLowerCase()) {
          throw new Error(
            `On-chain anchor hash mismatch: local ${binding.batchAuthorityBindingHash} vs on-chain ` +
            `${onChainAnchor.batchAuthorityBindingHash}. Contract addresses or batch data may have changed ` +
            'since the binding was created.'
          );
        }

        const updatedBinding = {
          ...binding,
          treasurySignerAddress: onChainAnchor.treasurySignerAddress,
          treasuryRecoveredSignerAddress: onChainAnchor.treasurySignerAddress,
          treasurySignatureStatus: 'signed' as const,
          treasurySignedAt: onChainAnchor.anchoredAt,
          escrowSignerAddress: onChainAnchor.escrowSignerAddress,
          escrowRecoveredSignerAddress: onChainAnchor.escrowSignerAddress,
          escrowSignatureStatus: 'signed' as const,
          escrowSignedAt: onChainAnchor.anchoredAt,
          signatureVerificationStatus: 'verified' as const,
        };

        applyAuthoritySignatureToBatch(batch, role, updatedBinding as NonNullable<EscrowBatch['batchAuthorityBinding']>);
      })
      .catch((err: unknown) => {
        setSigningAuthorityError(String((err as any)?.message ?? err ?? 'Lifecycle advance failed.'));
        setSigningAuthorityKey('');
      });
  };

  const anchorBatchForBatch = (batch: EscrowBatch) => {
    const binding = batch.batchAuthorityBinding;
    if (!binding) return;
    const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
    if (!sourceBatchId) return;

    setAnchorError(null);
    setAnchoringBatchId(batch.batchId);

    const escrowAddress = getRuntimeAddress('InvestmentEscrow');

    // ── Lifecycle path: the banking server signs, anchors, and binds the wallet ──
    // Phase 2 performs all of it behind an authenticated boundary. Everything
    // below is re-derived from chain, never from a response body.
    {
      advanceEscrowLifecycleOrThrow({
        sourceBatchId,
        escrowBatchId: batch.batchId,
        chainKey: selectedChain.key,
      })
        .then(async () => {
          const onChainAnchor = await readBatchAuthorityAnchorFromChain({
            escrowAddress,
            sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          });
          if (!onChainAnchor || !onChainAnchor.exists) {
            throw new Error('Lifecycle advanced but no anchor record was found on-chain. Please refresh.');
          }
          const localHash = binding.batchAuthorityBindingHash.toLowerCase();
          const chainHash = onChainAnchor.batchAuthorityBindingHash.toLowerCase();
          if (localHash !== chainHash) {
            throw new Error(`On-chain anchor hash mismatch: local ${localHash} vs on-chain ${chainHash}.`);
          }

          const txHash = '';                       // anchor tx hash lives in Phase 2 evidence
          const blockNumber = 0;
          const anchoredAt = onChainAnchor.anchoredAt;

          const anchorEventId = `${batch.batchId}-authority-binding-anchored`;
          const walletEventId = `${batch.batchId}-batch-wallet-bound`;

          // Wallet binding comes from the on-chain record the factory wrote.
          const onChainWallet = await readBatchWalletBindingFromChain({
            escrowAddress,
            sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          }).catch(() => null);

          const wr = onChainWallet?.exists && onChainWallet.walletAddress
            ? {
                walletAddress: onChainWallet.walletAddress,
                creationTxHash: onChainWallet.creationTxHash,
                bindingTxHash: onChainWallet.creationTxHash,
                boundAt: onChainWallet.boundAt,
                ownerTreasury: onChainWallet.ownerTreasury,
                ownerEscrow: onChainWallet.ownerEscrow,
                ownerContinuity: onChainWallet.ownerContinuity,
                threshold: onChainWallet.threshold,
                batchAuthorityBindingHash: onChainWallet.batchAuthorityBindingHash,
                fundingTxHash: undefined as string | undefined,
              }
            : null;

          // Verify funding from chain before updating state so we can apply it in one pass.
          let walletFundingVerification: FundingVerificationResult | null = null;
          if (wr?.walletAddress) {
            try {
              walletFundingVerification = await readOnChainFundingVerification({
                batch: {
                  ...batch,
                  custodyMode: 'batch_wallet_custody',
                  sourceBatchId: batch.sourceBatchId ?? sourceBatchId,
                  wallet: { ...batch.wallet, walletAddress: wr.walletAddress },
                } as EscrowBatch,
                rpcUrl: selectedChain.rpcUrl,
                escrowAddress,
                fundingTxHashOverride: wr.fundingTxHash,
              });
            } catch { /* non-blocking — auto-verify effect will retry */ }
          }

          setBatches((current) => current.map((item) => {
            if (item.batchId !== batch.batchId) return item;
            const b = item.batchAuthorityBinding;
            if (!b) return item;
            const hasAnchorEvent = item.auditTrail.some((e) => e.eventId === anchorEventId);
            const hasWalletEvent = item.auditTrail.some((e) => e.eventId === walletEventId);
            const withAnchor: EscrowBatch = {
              ...item,
              batchAuthorityBinding: { ...b, anchorStatus: 'anchored', anchorTxHash: txHash, anchorBlockNumber: blockNumber, anchoredAt },
              auditTrail: hasAnchorEvent ? item.auditTrail : [
                ...item.auditTrail,
                {
                  eventId: anchorEventId,
                  timestamp: anchoredAt,
                  actor: 'Escrow Signer Service',
                  eventType: 'Batch Authority Binding anchored on-chain',
                  description: `batchAuthorityBindingHash anchored on-chain for sourceBatchId ${sourceBatchId}. Block: ${blockNumber}.`,
                  txHash,
                  reference: binding.batchAuthorityBindingHash,
                },
              ],
            };
            if (!wr || hasWalletEvent) {
              if (walletFundingVerification?.fundingStatus === 'verified') {
                return applyFundingConfirmationToBatch(
                  withAnchor,
                  createFundingConfirmation({
                    batch: withAnchor,
                    observedAmountUsd: walletFundingVerification.observedAmountUsd,
                    fundingTxHash: walletFundingVerification.fundingTxHash,
                    confirmedBy: 'Escrow On-chain Verifier',
                    confirmedAt: walletFundingVerification.confirmedAt,
                    asset: item.asset || 'USDC',
                    custodyMode: 'batch_wallet_custody',
                    sourceContract: walletFundingVerification.sourceContract,
                    fundingSource: walletFundingVerification.fundingSource,
                    fundingStatus: 'verified',
                  })
                );
              }
              return withAnchor;
            }
            const withWallet = applyOnChainWalletBindingToBatch(
              withAnchor,
              { exists: true, escrowBatchIdHash: '', batchAuthorityBindingHash: wr.batchAuthorityBindingHash, walletAddress: wr.walletAddress, ownerTreasury: wr.ownerTreasury, ownerEscrow: wr.ownerEscrow, ownerContinuity: wr.ownerContinuity, threshold: wr.threshold, factory: '', creationTxHash: wr.creationTxHash, boundAt: wr.boundAt, boundBy: '' },
              { creationTxHash: wr.creationTxHash, bindingTxHash: wr.bindingTxHash }
            );
            if (!walletFundingVerification) return withWallet;
            // Apply funding confirmation — marks wallet_funded if balance matches.
            return applyFundingConfirmationToBatch(
              withWallet,
              createFundingConfirmation({
                batch: withWallet,
                observedAmountUsd: walletFundingVerification.observedAmountUsd,
                fundingTxHash: walletFundingVerification.fundingTxHash ?? wr.fundingTxHash,
                confirmedBy: 'Escrow On-chain Verifier',
                confirmedAt: walletFundingVerification.confirmedAt,
                asset: item.asset || 'USDC',
                custodyMode: 'batch_wallet_custody',
                sourceContract: walletFundingVerification.sourceContract,
                fundingSource: walletFundingVerification.fundingSource,
                fundingStatus: walletFundingVerification.fundingStatus,
              })
            );
          }));
          setAnchoringBatchId('');
          setSelectedBatchId(batch.batchId);
        })
        .catch((err: unknown) => {
          const reason = String((err as any)?.message ?? err ?? 'Unknown anchor error');
          setAnchorError(reason);
          setAnchoringBatchId('');
        });
      return;
    }

  };

  const approveDestinationsForBatch = (batch: EscrowBatch) => {
    if (getFundingValidation(batch).state !== 'verified') return;
    if (!hasValidatedAaaAllocation(batch)) return;

    setBatches((current) =>
      current.map((item) =>
        item.batchId === batch.batchId
          ? approveBatchDestinations(item)
          : item
      )
    );
    setSelectedBatchId(batch.batchId);
  };

  const createDeploymentSigningRequestForBatch = (batch: EscrowBatch) => {
    if (!canCreateDeploymentSigningRequest(batch)) return;

    const request = createDeploymentSigningRequest(batch);
    setBatches((current) =>
      current.map((item) =>
        item.batchId === batch.batchId
          ? attachSigningRequestToBatch(item, request)
          : item
      )
    );
    setSelectedBatchId(batch.batchId);
  };

  const approveDeploymentForBatch = async (batch: EscrowBatch) => {
    if (!canApproveDeployment(batch)) return;

    setApprovingDeploymentBatchId(batch.batchId);
    setDeploymentApprovalError(null);

    // Compute the approved batch object and its evidence before any state update.
    const updated = approveDeployment(batch);
    const evidence = updated.deploymentApproval.evidence ??
      createDeploymentApprovalEvidence({ batch });

    let persistedEvidence = evidence;
    try {
      // Persist to backend FIRST — fail closed: do not advance state if save fails.
      persistedEvidence = await saveDeploymentApprovalToDb(evidence);
    } catch (err: any) {
      setDeploymentApprovalError(err?.message ?? 'Deployment approval save failed.');
      setApprovingDeploymentBatchId('');
      return;
    }

    const persistedUpdate = {
      ...updated,
      deploymentApproval: {
        ...updated.deploymentApproval,
        approvedBy: persistedEvidence.approvedBy,
        approvedAt: persistedEvidence.approvedAt,
        deploymentApprovalHash: persistedEvidence.deploymentApprovalHash,
        destinationApprovalHash: persistedEvidence.destinationApprovalHash,
        allocationPlanHash: persistedEvidence.allocationPlanHash,
        policyContextHash: persistedEvidence.policyContextHash,
        destinationRegistryVersion: persistedEvidence.destinationRegistryVersion,
        payload: persistedEvidence.payload,
        evidence: persistedEvidence,
      },
    };

    setBatches((current) =>
      current.map((item) =>
        item.batchId === batch.batchId ? persistedUpdate : item
      )
    );
    setApprovingDeploymentBatchId('');
    setSelectedBatchId(batch.batchId);
  };

  const approveSigningRequestForBatch = (batch: EscrowBatch, authorityRole: 'treasury' | 'escrow' | 'continuity') => {
    const latestRequest = getLatestSigningRequest(batch);
    if (!latestRequest) return;

    setBatches((current) =>
      current.map((item) =>
        item.batchId === batch.batchId
          ? approveSigningRequest(item, latestRequest.requestId, authorityRole)
          : item
      )
    );
    setSelectedBatchId(batch.batchId);
  };

  const executeDeploymentForBatch = async (batch: EscrowBatch) => {
    if (!canExecuteDeployment(batch)) return;

    setExecutingDeploymentBatchId(batch.batchId);
    setDeploymentExecutionError(null);
    setSelectedBatchId(batch.batchId);

    try {
      if (!selectedChain?.rpcUrl || !selectedChain?.key) {
        throw new Error('Selected chain RPC is unavailable.');
      }
      if (!isLocalExecutionChain(selectedChain.key)) {
        throw new Error('One-leg deployment execution is currently enabled only on the local protocol chain.');
      }
      // Signer reachability is the banking server's concern now — the browser
      // never contacts those services. If one is down, the lifecycle advance
      // returns treasury_signer_service_unreachable with a real explanation.
      if (getFundingValidation(batch).state !== 'verified') {
        throw new Error('Funding is not verified.');
      }
      if (!hasValidatedAaaAllocation(batch)) {
        throw new Error('AAA allocation is not validated.');
      }
      if (!areBatchDestinationsApproved(batch)) {
        throw new Error('Destination approval is incomplete.');
      }
      if (!hasDeploymentApproval(batch) || !batch.deploymentApproval.payload) {
        throw new Error('Deployment approval is missing.');
      }

      const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address;
      if (!isValidAddress(walletAddress)) {
        throw new Error('Batch wallet address is missing.');
      }
      const sourceBatchId = batch.sourceBatchId ?? batch.batchAuthorityBinding?.canonicalPayload?.sourceBatchId;
      if (!sourceBatchId) {
        throw new Error('Source batch ID is missing.');
      }

      const targetLeg = getNextApprovedDeploymentTransferLeg(batch);
      if (!targetLeg) {
        throw new Error('No approved deployment leg is available for execution.');
      }

      const requestedAssetSymbol = targetLeg.legAssetSymbol;
      const approvedDestinationAddress = targetLeg.destinationAddress;
      const legAmount = targetLeg.amountUsd;
      const priorExecution = getLatestDeploymentExecution(batch);

      const escrowAddress = getRuntimeAddress('InvestmentEscrow');
      if (!isValidAddress(escrowAddress)) {
        throw new Error('InvestmentEscrow address is missing.');
      }

      const provider = new JsonRpcProvider(selectedChain.rpcUrl);
      const escrow = new Contract(escrowAddress, ESCROW_BATCH_READER_ABI, provider);
      const usdcAddress = String(await escrow.usdc());
      if (!isValidAddress(usdcAddress)) {
        throw new Error('USDC token address is unavailable on-chain.');
      }

      const usdc = new Contract(usdcAddress, ERC20_BALANCE_READER_ABI, provider);
      const [walletBalanceBeforeRaw, destinationBalanceBeforeRaw] = await Promise.all([
        usdc.balanceOf(walletAddress),
        usdc.balanceOf(approvedDestinationAddress),
      ]);

      const amountUnits = parseUnits(legAmount.toFixed(6), 6);
      if (walletBalanceBeforeRaw < amountUnits) {
        throw new Error(`Batch wallet USDC balance is insufficient. Need ${legAmount}, have ${formatUnits(walletBalanceBeforeRaw, 6)}.`);
      }
      const amountText = legAmount.toFixed(6);
      // ── Lifecycle path: the banking server drives both signer services ──────
      // Phase 8 submits the multisig transfer as ROLE_TREASURY_VAULT and
      // confirms it as ROLE_ESCROW. The browser cannot do this itself: it would
      // need the signer credential, which must never leave the server.
      await advanceEscrowLifecycleOrThrow({
        sourceBatchId,
        escrowBatchId: batch.batchId,
        chainKey: selectedChain.key,
      });

      // Reconstruct the execution record from chain. Every field the UI used to
      // take from the signer responses — tx index, tx hashes, signer addresses,
      // executed-at — is recovered from the multisig's own events.
      const execution = await rehydrateDeploymentExecutionFromChain({
        batch,
        rpcUrl: selectedChain.rpcUrl,
        escrowAddress,
        existingExecution: priorExecution,
        legIdHint: targetLeg.leg.legId,
        destinationAddressHint: approvedDestinationAddress,
        amountHint: legAmount,
      });

      if (!execution?.deploymentTxHash) {
        throw new Error(
          'Lifecycle advanced but no on-chain deployment transaction was found for this leg. ' +
          'Check the batch lifecycle phase state.'
        );
      }

      // Independent confirmation that the money actually moved, and by exactly
      // the approved amount. The lifecycle reporting success is not sufficient.
      const [walletBalanceAfterRaw, destinationBalanceAfterRaw] = await Promise.all([
        usdc.balanceOf(walletAddress),
        usdc.balanceOf(approvedDestinationAddress),
      ]);

      if (BigInt(walletBalanceBeforeRaw) - BigInt(walletBalanceAfterRaw) !== amountUnits) {
        throw new Error('Batch wallet USDC balance delta does not match the approved leg amount.');
      }
      if (BigInt(destinationBalanceAfterRaw) - BigInt(destinationBalanceBeforeRaw) !== amountUnits) {
        throw new Error('Destination USDC balance delta does not match the approved leg amount.');
      }

      await saveDeploymentExecutionToDb(batch.batchId, execution).catch(() => undefined);

      setBatches((current) =>
        current.map((item) =>
          item.batchId === batch.batchId
            ? applyDeploymentExecutionToBatch(item, execution)
            : item
        )
      );
    } catch (err: any) {
      setDeploymentExecutionError(err?.message ?? 'Deployment execution failed.');
    } finally {
      setExecutingDeploymentBatchId('');
    }
  };

  const bankingApiUrl = process.env.NEXT_PUBLIC_BANKING_API_URL ?? null;
  const headerStats = useMemo(
    () => buildEscrowHeaderStats(lifecycleBatches, batches, signerServiceConfig, escrowContractBalanceUsd, bankingApiUrl),
    [lifecycleBatches, batches, signerServiceConfig, escrowContractBalanceUsd, bankingApiUrl],
  );

  const batchManagementRows = useMemo(
    () => batches.map(b =>
      buildEscrowBatchManagementRow(
        b,
        findLifecycleBatchForBatch(lifecycleBatchByKey, b),
        findLifecycleEvidenceForBatch(lifecycleEvidenceByBatchId, b),
      )
    ),
    [batches, lifecycleBatchByKey, lifecycleEvidenceByBatchId],
  );

  const sortedFilteredRows = useMemo(() => {
    let rows = [...batchManagementRows];
    // Filter by origin
    if (filterOrigin) rows = rows.filter(r => r.origin === filterOrigin);
    // Filter by status
    if (filterStatus === 'settled') rows = rows.filter(r => r.isSettled);
    else if (filterStatus === 'active') rows = rows.filter(r => !r.isSettled && !r.isBlocked && !r.isFailed);
    else if (filterStatus === 'blocked') rows = rows.filter(r => r.isBlocked);
    else if (filterStatus === 'failed') rows = rows.filter(r => r.isFailed);
    // Sort
    if (sortCol) {
      rows.sort((a, b) => {
        let cmp = 0;
        if (sortCol === 'batch') cmp = Number(a.sourceBatchId || 0) - Number(b.sourceBatchId || 0);
        else if (sortCol === 'principal') cmp = a.originalAmountUsd - b.originalAmountUsd;
        else if (sortCol === 'phase') cmp = a.currentPhase - b.currentPhase;
        else if (sortCol === 'settlement') {
          const aV = a.settlement.returnedAmountUsd ?? -1;
          const bV = b.settlement.returnedAmountUsd ?? -1;
          cmp = aV - bV;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [batchManagementRows, sortCol, sortDir, filterOrigin, filterStatus]);

  return (
    <div className="tab-screen">
      <PageHeader
        eyebrow="Escrow Operations"
        title="Escrow Batch Console"
        description="A batch-container workbench for Treasury-sent funds, reconciliation, wallet binding, funding verification, deployment, settlement, and audit proof."
        meta={
          <div className="flex flex-wrap gap-2">
            <span className="data-chip" data-tone="purple">Treasury Batch Reconciliation</span>
            <span className="data-chip">Wallet metadata only</span>
            <span className="data-chip">Contracts unchanged</span>
          </div>
        }
      />

      {/* Primary header row — 4 cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Custody Health: value = status label so the operator reads the verdict immediately */}
        <MetricCard
          title="Custody Health"
          value={headerStats.custodyHealthLabel}
          hint={
            headerStats.custodyHealthLabel === 'Unknown'
              ? 'chain data unavailable'
              : headerStats.custodyHealthLabel === 'No Custody Expected'
              ? `${fmtUsd(headerStats.escrowContractBalanceUsd!)} actual / ${fmtUsd(headerStats.expectedCustodyUsd)} expected`
              : headerStats.custodyHealthLabel === 'Balanced'
              ? `${fmtUsd(headerStats.escrowContractBalanceUsd!)} actual / ${fmtUsd(headerStats.expectedCustodyUsd)} expected`
              : headerStats.custodyHealthLabel === 'Surplus'
              ? `${fmtUsd(headerStats.escrowContractBalanceUsd!)} actual / ${fmtUsd(headerStats.expectedCustodyUsd)} expected · +${fmtUsd(headerStats.custodyDeltaUsd!)} unexplained`
              : /* Deficit */ `${fmtUsd(headerStats.escrowContractBalanceUsd!)} actual / ${fmtUsd(headerStats.expectedCustodyUsd)} expected · ${fmtUsd(headerStats.custodyDeltaUsd!)} shortage`
          }
          tone={
            headerStats.custodyHealthLabel === 'Deficit' ? 'danger' :
            headerStats.custodyHealthLabel === 'Surplus' || headerStats.custodyHealthLabel === 'Unknown' ? 'warning' :
            headerStats.custodyHealthLabel === 'No Custody Expected' ? 'neutral' :
            'success'
          }
          icon={<Lock size={20} />}
        />
        {/* Open Exposure: uses "unsettled" to distinguish from lifecycle-active status */}
        <MetricCard
          title="Open Exposure"
          value={fmtUsd(headerStats.openExposureUsd)}
          hint={
            headerStats.openBatchCount === 0 ? 'No unsettled batches' :
            headerStats.openBatchCount === 1 ? '1 unsettled batch' :
            `${headerStats.openBatchCount} unsettled batches`
          }
          tone={headerStats.openExposureUsd > 0 ? 'neutral' : 'success'}
          icon={<Layers size={20} />}
        />
        {/* Lifecycle Health: full breakdown in hint; active = currently running lifecycle phases */}
        <MetricCard
          title="Lifecycle Health"
          value={`${headerStats.lc_active} active`}
          hint={`${headerStats.lc_blocked} blocked · ${headerStats.lc_failed} failed · ${headerStats.lc_settled} settled`}
          tone={
            headerStats.lc_failed > 0 ? 'danger' :
            headerStats.lc_blocked > 0 ? 'warning' :
            'success'
          }
          icon={<Database size={20} />}
        />
        {/* Integrity Checks: short reason visible on the card; no hunting required */}
        <MetricCard
          title="Integrity Checks"
          value={`${headerStats.criticalCount} critical`}
          hint={headerStats.integrityReason}
          tone={
            headerStats.criticalCount > 0 ? 'danger' :
            headerStats.warnCount > 0 ? 'warning' :
            'success'
          }
          icon={<ShieldCheck size={20} />}
        />
      </section>

      {/* Secondary strip — Settlement Health + Authority Health */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MetricCard
          title="Settlement Health"
          value={`${headerStats.settledCount} finalized`}
          hint={
            headerStats.settlementPending > 0
              ? `${headerStats.settlementPending} settlement pending`
              : 'No pending settlement'
          }
          tone={headerStats.settlementPending > 0 ? 'warning' : 'success'}
          icon={<CheckCircle2 size={20} />}
        />
        {/* Authority Health: Treasury signer · Escrow signer · Banking server */}
        <MetricCard
          title="Authority Health"
          value={headerStats.authorityLabel}
          hint={[
            headerStats.treasuryOk ? 'Treasury' : 'Treasury missing',
            headerStats.escrowOk   ? 'Escrow'   : 'Escrow missing',
            headerStats.bankingOk  ? 'Banking'  : 'Banking missing',
          ].join(' · ')}
          tone={
            headerStats.servicesHealthy === 3 ? 'success' :
            headerStats.servicesHealthy === 0 ? 'danger' :
            'warning'
          }
          icon={<KeyRound size={20} />}
        />
      </section>

      <section className="sagitta-cell">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="section-title !mb-0">Escrow Batch Management</h3>
            <p className="mt-1 text-sm text-slate-400">
              Origin, wallet, principal, phase, settlement, and blocking state for all Treasury-sent batches. Select a batch to open the lifecycle panel.
            </p>
          </div>
          <span className="data-chip" data-tone="purple">Batch-Controlled Escrow</span>
        </div>

        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Filter size={12} className="shrink-0 text-slate-500" />

          {/* Origin filter */}
          <div className="flex overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/50 text-[11px]">
            {(['', 'Vault', 'Bank'] as const).map(v => (
              <button
                key={v || 'all-origin'}
                type="button"
                className={`px-2.5 py-1 transition-colors ${filterOrigin === v ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => setFilterOrigin(v)}
              >
                {v || 'All Origins'}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/50 text-[11px]">
            {(['', 'active', 'blocked', 'failed', 'settled'] as const).map(v => (
              <button
                key={v || 'all-status'}
                type="button"
                className={`px-2.5 py-1 capitalize transition-colors ${filterStatus === v
                  ? v === 'failed'   ? 'bg-red-900/60 text-red-200'
                  : v === 'blocked'  ? 'bg-orange-900/60 text-orange-200'
                  : v === 'settled'  ? 'bg-emerald-900/60 text-emerald-200'
                  : v === 'active'   ? 'bg-blue-900/60 text-blue-200'
                  : 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => setFilterStatus(v)}
              >
                {v || 'All States'}
              </button>
            ))}
          </div>

          {/* Row count */}
          <span className="ml-1 text-[11px] text-slate-500">
            {sortedFilteredRows.length}{sortedFilteredRows.length !== batchManagementRows.length && ` of ${batchManagementRows.length}`} batch{sortedFilteredRows.length !== 1 ? 'es' : ''}
          </span>

          {/* Clear filters */}
          {(filterOrigin || filterStatus || sortCol) && (
            <button
              type="button"
              className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => { setFilterOrigin(''); setFilterStatus(''); setSortCol(null); }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-700/50">
          {/* Sortable column header */}
          {(() => {
            const SortBtn = ({ col, label, className }: { col: SortColumn; label: string; className?: string }) => {
              const active = sortCol === col;
              return (
                <button
                  type="button"
                  className={`flex items-center gap-1 uppercase tracking-[0.14em] text-[10px] transition-colors select-none ${active ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'} ${className ?? ''}`}
                  onClick={() => handleSort(col)}
                >
                  {label}
                  {active
                    ? sortDir === 'asc'
                      ? <ChevronUp size={9} />
                      : <ChevronDown size={9} />
                    : <ChevronUp size={9} className="opacity-20" />}
                </button>
              );
            };
            return (
              <div className="flex items-center gap-3 border-b border-slate-700/80 bg-slate-900/90 px-4 py-2">
                <div className="w-36 shrink-0"><SortBtn col="batch" label="Batch · Origin" /></div>
                <div className="hidden w-32 shrink-0 md:block">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Wallet</span>
                </div>
                <div className="w-28 shrink-0"><SortBtn col="principal" label="Principal · Deposits" /></div>
                <div className="min-w-0 flex-1"><SortBtn col="phase" label="Batch State" /></div>
                <div className="hidden w-36 shrink-0 lg:block"><SortBtn col="settlement" label="Settlement · P&L" /></div>
                <div className="hidden w-36 shrink-0 xl:block">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Blocking / Next</span>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Actions</span>
                </div>
              </div>
            );
          })()}

          {/* Row list — inline panels expand in place */}
          <div className="max-h-[520px] divide-y divide-slate-800/60 overflow-y-auto">
            {batches.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                No Treasury-sent batch has been registered as an Escrow batch container.
              </div>
            ) : sortedFilteredRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No batches match the current filters.
                <button
                  type="button"
                  className="ml-2 text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => { setFilterOrigin(''); setFilterStatus(''); }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              sortedFilteredRows.map(row => (
                <BatchManagementRow
                  key={row.batchId}
                  row={row}
                  isSelected={row.batchId === selectedBatch?.batchId}
                  onSelect={() => setSelectedBatchId(row.batchId)}
                  explorerUrl={selectedChain?.explorerUrl ?? ''}
                />
              ))
            )}
          </div>
        </div>
      </section>

      {selectedBatch ? (
        <div>
          <BatchDetail
            batch={selectedBatch}
            evidence={selectedBatchEvidence}
            allAttempts={selectedBatchAllAttempts}
            lcRow={findLifecycleBatchForBatch(lifecycleBatchByKey, selectedBatch)}
            chainKey={selectedChain?.key}
            sourceBatchId={selectedBatch.sourceBatchId}
            onVerifyFunding={verifyFundingForBatch}
            onManualConfirmFunding={applyManualFundingConfirmation}
            isVerifyingFunding={verifyingFundingBatchId === selectedBatch.batchId}
            fundingVerificationError={verifyingFundingBatchId === selectedBatch.batchId || selectedBatch.batchId === selectedBatchId ? fundingVerificationError : null}
            onCreateDeploymentSigningRequest={createDeploymentSigningRequestForBatch}
            onApproveSigningRequest={approveSigningRequestForBatch}
            onExecuteDeployment={executeDeploymentForBatch}
            onSignAuthorityBinding={signAuthorityBindingForBatch}
            onAnchorBinding={anchorBatchForBatch}
            isAnchoring={anchoringBatchId === selectedBatch.batchId}
            anchorError={anchoringBatchId === selectedBatch.batchId || anchoringBatchId === '' ? anchorError : null}
            onCreateBatchWallet={createBatchWalletForBatch}
            isCreatingWallet={walletCreatingBatchId === selectedBatch.batchId}
            walletCreationError={walletCreatingBatchId === selectedBatch.batchId || walletCreatingBatchId === '' ? walletCreationError : null}
            signingAuthorityRole={signingAuthorityKey.startsWith(selectedBatch.batchAuthorityBinding?.bindingId ?? '__none__') ? signingAuthorityKey.split(':')[1] : undefined}
            signingAuthorityError={signingAuthorityKey.startsWith(selectedBatch.batchAuthorityBinding?.bindingId ?? '__none__') || !signingAuthorityKey ? signingAuthorityError : null}
            onChainRoleAuthorities={onChainRoleAuthorities}
            onRoleAuthoritiesInitialized={() => setRoleAuthoritiesRefreshTick((t) => t + 1)}
            signerServicesConfigured={{
              treasury: isSignerServiceConfigured(signerServiceConfig, 'treasury'),
              escrow: isSignerServiceConfigured(signerServiceConfig, 'escrow'),
            }}
          />
        </div>
      ) : (
        <section className="sagitta-cell">
          <div className="text-sm text-slate-400">
            Select a registered Escrow batch to inspect readiness, wallet funding, deployment legs, settlement, and audit trail.
          </div>
        </section>
      )}
    </div>
  );
}
