import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import {
  Activity,
  AlertTriangle,
  Anchor,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  FileCheck,
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
  canAdvanceBatch,
  getBatchBlockingReason,
  getLifecycleSteps,
  getPrimaryAction,
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
  areBothSignerServicesConfigured,
  getSignerServiceConfig,
  isSignerServiceConfigured,
  requestEscrowDeployLegConfirmationFromService,
  requestAllocationAnchorFromService,
  requestAnchorFromService,
  requestSignatureFromService,
  requestTreasuryDeployLegFromService,
} from '../../lib/escrow/signerServiceClient';
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
import { escrowBatchUuid, resolveEscrowBatchId, isUuid } from '../../lib/escrow/ids';
import { BatchLifecycleCard, type LifecycleRow } from '../BatchLifecycleCard';

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

const formatDateTime = (value?: string) => {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

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
    originBank: order.originInstitutionId || order.sourceType || 'Treasury',
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
  return Math.max(1, Math.round((endMs - startMs) / (30 * 24 * 60 * 60 * 1000)));
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
          depositId: receiptId ? `vault-receipt-${receiptId}` : `vault-lot-${lotId}`,
          originBank: originLabel,
          adapterType: 'manual' as const,
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
      proposedBatchId: escrowBatchUuid({ chainId: params.chainId, treasuryAddress: params.treasuryAddress, sourceBatchId: String(batchId), openedAt }),
      chainConfirmed: true,
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
function buildIncomingTreasuryBatch(order: any, termPositions: any[]): TreasuryHandoffPackage | null {
  const treasuryBatchId = String(order.batchId ?? '');
  if (!treasuryBatchId) return null;

  const sourceEntries = termPositions
    .filter((position) => String(position.treasuryBatchId ?? position.treasury_batch_id ?? '') === treasuryBatchId)
    .map((position, index) => ({
      depositId: String(position.id ?? position.termPositionId ?? `${treasuryBatchId}-source-${index + 1}`),
      originBank: String(position.originInstitutionId ?? position.origin_institution_id ?? order.originInstitutionId ?? order.sourceType ?? 'Treasury'),
      adapterType: 'manual' as const,
      amountUsd: Number(position.amountUsd ?? position.amount_usd ?? position.principalUsd ?? 0),
      termMonths: termMonthsFromOrder(position),
      status: 'batched' as const,
    }));
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

  return {
    handoffId: treasuryBatchId,
    proposedBatchId: resolveEscrowBatchId(order.escrowBatchId ?? order.batchId ?? metadata.escrowBatchId, {
      chainId: order.chainId ?? 0,
      treasuryAddress: getRuntimeAddress('Treasury') ?? '',
      sourceBatchId,
      openedAt: order.openedAt ?? metadata.openedAt ?? 0,
    }),
    chainConfirmed: false,
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
  return {
    ...backendBatch,
    ...onChainBatch,
    proposedBatchId: canonicalBatchId,
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
    { label: 'Term', value: `${p.termMonths}M` },
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
        { label: 'Term', value: `${batch.termMonths}M` },
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
  onVerifyFunding,
  onManualConfirmFunding,
  isVerifying,
  verificationError,
}: {
  batch: EscrowBatch;
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
  const bindingLocked = batch.batchWalletBinding?.bindingStatus === 'binding_locked';
  const bindingValidation = getBatchWalletBindingValidation(batch);
  const bindingValid = bindingValidation.state === 'valid';
  const authorityBindingValid = hasValidAuthorityBinding(batch);
  const authorityBindingAnchored = isAuthorityBindingAnchored(batch);
  const blockingReason = isEscrowContractCustody
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
        <Field label="Custody mode" value={custodyModeLabel(batch)} />
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
            <ReadinessBadge label={bindingValidation.label} state={bindingValid ? 'passed' : 'blocked'} />
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
          {!bindingValid && bindingValidation.blockingReason ? (
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
  return (
    <SectionCard title="Role Authority Registry" icon={<ShieldCheck size={18} />}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="data-chip" data-tone="purple">Role Authority Registry</span>
        <span className="data-chip">{ROLE_AUTHORITY_REGISTRY[0].registryVersion}</span>
        <span className="data-chip">{ROLE_AUTHORITY_REGISTRY.length} roles</span>
      </div>
      <div className="mb-3 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-400">
        Canonical expected signer addresses for Batch Authority Binding. Public addresses only — no private keys, seed phrases, or signing secrets.
        Connect a wallet matching the expected signer address to sign for that role.
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {ROLE_AUTHORITY_REGISTRY.map((role) => {
          const roleCheck = isRoleSigningAllowed(role);
          return (
            <div
              key={role.roleId}
              className={`rounded-lg border p-3 ${
                role.status === 'active' ? 'border-slate-700/50 bg-slate-900/35' :
                role.status === 'rotation_pending' ? 'border-amber-700/40 bg-amber-900/10' :
                'border-rose-700/40 bg-rose-900/10'
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">{role.roleLabel}</span>
                <StatusBadge
                  label={titleCase(role.status.replace(/_/g, ' '))}
                  tone={roleStatusTone(role.status)}
                />
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                <div className="flex flex-col gap-0.5">
                  <span className="uppercase tracking-[0.14em] text-slate-500">Expected signer</span>
                  <span className="break-all font-mono text-slate-300">{role.expectedSignerAddress}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="uppercase tracking-[0.14em] text-slate-500">Custody domain</span>
                  <span className="text-slate-400">{role.custodyDomain}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="uppercase tracking-[0.14em] text-slate-500">Registry version</span>
                  <span className="text-slate-400">{role.registryVersion}</span>
                </div>
                {!roleCheck.allowed ? (
                  <div className="mt-1 rounded bg-rose-900/40 px-2 py-1 text-[10px] text-rose-200">
                    {roleCheck.reason} — signing blocked
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
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
        <span className="data-chip" data-tone={binding.anchorStatus === 'anchored' ? 'success' : binding.anchorStatus === 'binding_mismatch' ? 'danger' : 'purple'}>
          {binding.anchorStatus === 'anchored' ? 'On-chain Anchored' : binding.anchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending On-chain Anchor'}
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
            label={binding.anchorStatus === 'anchored' ? 'Anchored' : binding.anchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending Anchor'}
            tone={binding.anchorStatus === 'anchored' ? 'success' : binding.anchorStatus === 'binding_mismatch' ? 'danger' : 'warning'}
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

        {onSignAsRole ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="action-button action-button--secondary inline-flex items-center gap-2"
              disabled={!canSignAsTreasury || isSigningTreasury || isSigningEscrow}
              aria-disabled={!canSignAsTreasury || isSigningTreasury || isSigningEscrow}
              onClick={() => onSignAsRole(batch, 'treasury')}
            >
              <KeyRound size={15} />
              {isSigningTreasury ? 'Requesting…' : tvServiceMode ? 'Request Treasury Signature' : 'Sign as Treasury/Vault'}
            </button>
            <button
              type="button"
              className="action-button action-button--secondary inline-flex items-center gap-2"
              disabled={!canSignAsEscrow || isSigningTreasury || isSigningEscrow}
              aria-disabled={!canSignAsEscrow || isSigningTreasury || isSigningEscrow}
              onClick={() => onSignAsRole(batch, 'escrow')}
            >
              <KeyRound size={15} />
              {isSigningEscrow ? 'Requesting…' : escrowServiceMode ? 'Request Escrow Signature' : 'Sign as Escrow'}
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

        {binding.anchorStatus === 'binding_mismatch' ? (
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
  onRequestAllocation,
  isRequesting,
  requestError,
  onRecoverPlan,
  isRecovering,
  recoveryError,
}: {
  batch: EscrowBatch;
  onRequestAllocation: (batch: EscrowBatch) => void;
  isRequesting: boolean;
  requestError: string | null;
  onRecoverPlan: (batch: EscrowBatch) => void;
  isRecovering: boolean;
  recoveryError: string | null;
}) {
  const alloc = batch.aaaAllocation;
  const fundingVerified = getFundingValidation(batch).state === 'verified';
  const isAttached = hasValidatedAaaAllocation(batch);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const planData = alloc.allocationPlan as (Record<string, unknown> | null | undefined);
  const isPayloadMissing = alloc.status === 'chain_only' && !planData;
  const canRequest = fundingVerified && !isAttached && !isRequesting && !isPayloadMissing;
  const canRecover = isPayloadMissing && !isRecovering;
  const allocationActionLabel = isRequesting
    ? 'Requesting...'
    : isRecovering && isPayloadMissing
      ? 'Recovering...'
      : isPayloadMissing
        ? 'Recover Plan Data'
        : isAttached
          ? 'Allocation Attached'
          : alloc.status === 'computed'
            ? 'Anchor AAA Allocation'
            : 'Request AAA Allocation';
  const targetWeights   = planData?.target_weights    as Record<string, number> | undefined;
  const roleByAsset     = planData?.role_by_asset     as Record<string, string> | undefined;
  const scoreTrace      = planData?.score_trace_by_asset as Record<string, Record<string, unknown>> | undefined;
  const riskSummary     = planData?.risk_summary      as Record<string, Record<string, number>> | undefined;
  const stabilityMetrics= planData?.stability_metrics as Record<string, unknown> | undefined;
  const metaData        = planData?.meta              as Record<string, unknown> | undefined;

  const planJson = planData ? JSON.stringify(planData, null, 2) : null;
  let canonicalPlanData: Record<string, unknown> | null = null;
  let recomputedPlanHash = '';
  try {
    if (planData) {
      canonicalPlanData = canonicalPlanFields(planData as any);
      recomputedPlanHash = canonicalKeccak(canonicalPlanData);
    }
  } catch {
    canonicalPlanData = null;
    recomputedPlanHash = '';
  }
  const canonicalPlanJson = canonicalPlanData ? JSON.stringify(canonicalPlanData, null, 2) : null;
  const planHashMatches = Boolean(
    recomputedPlanHash &&
    alloc.allocationPlanHash &&
    recomputedPlanHash.toLowerCase() === alloc.allocationPlanHash.toLowerCase()
  );
  const hasChainAllocationAnchor = ['validated', 'attached', 'locked', 'deployed', 'chain_only', 'hash_mismatch'].includes(alloc.status);

  const copyJson = () => {
    if (!planJson) return;
    navigator.clipboard.writeText(planJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <SectionCard title="AAA Allocation" icon={<ShieldCheck size={18} />}>
      {/* ── Status badges ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge
          label={allocationStatusLabel(alloc.status)}
          state={allocationStatusTone(alloc.status)}
        />
        {alloc.status === 'hash_mismatch' && (
          <span className="data-chip text-rose-300">Local plan hash ≠ on-chain hash</span>
        )}
        {isAttached && alloc.portfolioRegistryVersion && (
          <span className="data-chip font-mono">registry {alloc.portfolioRegistryVersion.slice(0, 10)}…</span>
        )}
        {metaData && (
          <span className="data-chip">{String(metaData.allocator ?? 'allocator')} · v{String(metaData.allocator_version_effective ?? '1')}</span>
        )}
        {planData?.schema_version && (
          <span className="data-chip font-mono">{String(planData.schema_version)}</span>
        )}
        {planData && alloc.allocationPlanHash && (
          <span className={`data-chip ${planHashMatches ? 'text-emerald-300' : 'text-rose-300'}`}>
            {planHashMatches
              ? hasChainAllocationAnchor ? 'JSON hash matches on-chain' : 'JSON hash verified'
              : 'JSON hash mismatch'}
          </span>
        )}
      </div>

      {/* ── Summary fields ── */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Plan ID"             value={alloc.planId || 'Pending'} />
        <Field label="Status"              value={allocationStatusLabel(alloc.status)} />
        <Field label="Target yield"        value={alloc.targetYieldBps ? `${alloc.targetYieldBps} bps` : 'Pending'} />
        <Field label="Allocation plan hash"
          value={<span className="break-all font-mono text-[11px] text-[var(--gold-300)]">{alloc.allocationPlanHash || '—'}</span>} />
        <Field label="Policy context hash"
          value={<span className="break-all font-mono text-[11px]">{alloc.policyContextHash || '—'}</span>} />
        <Field label="Registry version"
          value={alloc.portfolioRegistryVersion
            ? <span className="break-all font-mono text-[11px]">{alloc.portfolioRegistryVersion}</span>
            : 'Pending'} />
        {alloc.attachedAt && <Field label="Attached at"  value={formatDateTime(alloc.attachedAt)} />}
        {alloc.attachTxHash && <Field label="Attach tx"  value={<span className="font-mono text-[11px]">{alloc.attachTxHash}</span>} />}
        {planData?.tick_id && <Field label="Tick ID"     value={<span className="font-mono">{String(planData.tick_id)}</span>} />}
        {planData?.timestamp && <Field label="Computed at" value={String(planData.timestamp)} />}
        {recomputedPlanHash && (
          <Field
            label="Recomputed canonical JSON hash"
            value={<span className="break-all font-mono text-[11px]">{recomputedPlanHash}</span>}
          />
        )}
        {recomputedPlanHash && alloc.allocationPlanHash && (
          <Field
            label="JSON evidence verification"
            value={
              <span className={planHashMatches ? 'text-emerald-300' : 'text-rose-300'}>
                {planHashMatches
                  ? hasChainAllocationAnchor ? 'Matches on-chain allocationPlanHash' : 'Matches computed allocationPlanHash'
                  : 'Does not match allocationPlanHash'}
              </span>
            }
          />
        )}
      </div>

      {/* ── Allocation weights + score trace ── */}
      {targetWeights && roleByAsset && (
        <div className="mb-5">
          <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Target Allocation Weights</div>
          <div className="overflow-x-auto rounded-lg border border-slate-700/40">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  {scoreTrace && <th className="px-3 py-2 text-right">Score</th>}
                  {scoreTrace && <th className="px-3 py-2 text-right">ER adj</th>}
                  {scoreTrace && <th className="px-3 py-2 text-right">Vol adj</th>}
                </tr>
              </thead>
              <tbody>
                {Object.entries(targetWeights)
                  .sort(([, a], [, b]) => b - a)
                  .map(([symbol, weight]) => {
                    const trace = scoreTrace?.[symbol];
                    return (
                      <tr key={symbol} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                        <td className="px-3 py-2 font-mono font-semibold text-slate-100">{symbol}</td>
                        <td className="px-3 py-2 text-slate-400">{roleByAsset[symbol] ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--gold-300)]">
                          {(weight * 100).toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtUsd(weight * batch.totalAmountUsd)}</td>
                        {scoreTrace && (
                          <td className="px-3 py-2 text-right font-mono text-slate-300">
                            {trace ? Number(trace.score_v1).toFixed(4) : '—'}
                          </td>
                        )}
                        {scoreTrace && (
                          <td className="px-3 py-2 text-right font-mono text-slate-400">
                            {trace ? Number(trace.expected_return_used_role_adj).toFixed(4) : '—'}
                          </td>
                        )}
                        {scoreTrace && (
                          <td className="px-3 py-2 text-right font-mono text-slate-400">
                            {trace ? Number(trace.volatility_used_role_adj).toFixed(4) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DestinationApprovalPreviewSection batch={batch} targetWeights={targetWeights} />

      {/* ── Risk summary + stability ── */}
      {(riskSummary || stabilityMetrics) && (
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {riskSummary?.pre?.portfolio_volatility != null && (
            <Field label="Portfolio vol (pre)"  value={`${(riskSummary.pre.portfolio_volatility * 100).toFixed(2)}%`} />
          )}
          {riskSummary?.post?.portfolio_volatility != null && (
            <Field label="Portfolio vol (post)" value={`${(riskSummary.post.portfolio_volatility * 100).toFixed(2)}%`} />
          )}
          {riskSummary?.delta?.portfolio_volatility != null && (
            <Field label="Vol delta" value={`${(riskSummary.delta.portfolio_volatility * 100).toFixed(2)}%`} />
          )}
          {stabilityMetrics?.churn_pct != null && (
            <Field label="Churn" value={`${Number(stabilityMetrics.churn_pct).toFixed(2)}%`} />
          )}
        </div>
      )}

      {/* ── Action button ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="action-button action-button--primary inline-flex items-center gap-2"
          disabled={isPayloadMissing ? !canRecover : !canRequest}
          aria-disabled={isPayloadMissing ? !canRecover : !canRequest}
          onClick={() => isPayloadMissing ? onRecoverPlan(batch) : onRequestAllocation(batch)}
        >
          <ShieldCheck size={16} />
          {allocationActionLabel}
        </button>
      </div>

      {/* ── Full tick JSON evidence ── */}
      {(planData || alloc.allocationPlanHash) && (
        <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-900/40">
          <div className="flex items-center justify-between px-4 py-2.5">
            <button
              type="button"
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-200"
              onClick={() => setJsonExpanded((v) => !v)}
            >
              <FileCheck size={13} />
              {jsonExpanded ? 'Hide' : 'Show'} Allocation Plan JSON (tick_v1 evidence)
              <span className="ml-1 text-slate-600">{jsonExpanded ? '▲' : '▼'}</span>
            </button>
            {planJson && (
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-300"
                onClick={copyJson}
              >
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
                    <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Full tick_v1 JSON stored in DB
                    </div>
                    <pre className="max-h-[520px] overflow-auto rounded bg-[rgba(0,0,0,0.35)] p-4 text-[11px] leading-5 text-slate-300">
                      {planJson}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded bg-[rgba(0,0,0,0.25)] p-4 text-xs">
                  <p className="font-semibold text-slate-200">
                    {alloc.status === 'chain_only'
                      ? 'Chain anchor found — no DB payload.'
                      : 'Plan payload not in DB for this session.'}
                  </p>
                  <p className="text-slate-400">
                    {alloc.status === 'chain_only'
                      ? 'The chain anchor exists but the full tick JSON was never written to the database. Run "Recover Plan Data" to re-derive it from the current PortfolioRegistry. The allocator is deterministic — if the registry is unchanged, the hash will match the anchor.'
                      : 'The tick payload was not found in the database. Re-run the deterministic allocator to recover it — the hash will match if the registry has not changed since the allocation was anchored.'}
                  </p>
                  <div className="space-y-1 font-mono text-[11px] text-slate-400">
                    <div><span className="text-slate-500">allocationPlanHash: </span>{alloc.allocationPlanHash || '—'}</div>
                    <div><span className="text-slate-500">policyContextHash:  </span>{alloc.policyContextHash  || '—'}</div>
                    <div><span className="text-slate-500">registryVersion:    </span>{alloc.portfolioRegistryVersion || '—'}</div>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      className="action-button action-button--primary inline-flex items-center gap-2 text-xs"
                      disabled={isRecovering}
                      onClick={() => onRecoverPlan(batch)}
                    >
                      <ShieldCheck size={13} />
                      {isRecovering ? 'Running allocator…' : 'Recover Plan Data from PortfolioRegistry'}
                    </button>
                  </div>
                  {recoveryError && (
                    <div className="rounded border border-rose-700/40 bg-rose-900/20 p-2 text-[11px] text-rose-200">
                      {recoveryError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Inline messages ── */}
      {!fundingVerified && !isAttached ? (
        <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          Funding must be verified before AAA allocation can be requested.
        </div>
      ) : null}

      {fundingVerified && alloc.status === 'computed' ? (
        <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          AAA allocation computed — pending on-chain anchor.
        </div>
      ) : null}

      {alloc.status === 'hash_mismatch' ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <p className="mb-1 font-semibold">Hash Mismatch — PortfolioRegistry has changed since this allocation was anchored.</p>
          <p className="mb-2 text-rose-200">
            The deterministic allocator produced a different hash with the current registry state.
            The allocation plan below shows what the allocator computed now (for reference only).
            To re-anchor, run a new allocation — this will require a new on-chain transaction.
          </p>
          <p className="font-mono text-[11px]">
            <span className="text-rose-400">On-chain: </span>{alloc.allocationPlanHash}
          </p>
        </div>
      ) : null}

      {(alloc.status === 'failed' || (requestError && alloc.status === 'requesting')) ? (
        <div className="mt-3 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <span className="font-semibold">Error:</span> {requestError}
        </div>
      ) : null}
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
  onApproveDestinations,
}: {
  batch: EscrowBatch;
  onApproveDestinations: (batch: EscrowBatch) => void;
}) {
  const [showChecklist, setShowChecklist] = useState(false);
  const progress = getDestinationApprovalProgress(batch);
  const approved = areBatchDestinationsApproved(batch);
  const blockingReason = getDestinationApprovalBlockingReason(batch);
  const legs = getDeploymentLegsForDestinationApproval(batch);
  const fundingVerified = getFundingValidation(batch).state === 'verified';
  const authorityBindingValid = hasValidAuthorityBinding(batch);
  const allocationAttached = hasValidatedAaaAllocation(batch);
  const { batchChecks, legChecks } = buildDestinationChecklist(batch);
  const failCount = [...batchChecks, ...legChecks.flatMap((l) => l.items)].filter((c) => !c.ok).length;

  return (
    <SectionCard title="DAO Approval" icon={<ShieldCheck size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReadinessBadge label={approved ? 'DAO Approved' : 'DAO Pending'} state={approved ? 'passed' : 'pending'} />
        <span className="data-chip">Approval progress {progress.label}</span>
        <span className="data-chip">DAO registry {DAO_DESTINATION_REGISTRY[0]?.destinationRegistryVersion ?? 'Missing'}</span>
        {!approved && failCount > 0 && (
          <span className="data-chip" data-tone="danger">{failCount} check{failCount !== 1 ? 's' : ''} failing</span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="DAO registry entries" value={String(DAO_DESTINATION_REGISTRY.length)} />
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
          {!approved && failCount > 0 && <span className="ml-1 rounded bg-rose-900/60 px-1 text-[10px] text-rose-300">{failCount}</span>}
        </button>
      </div>

      {!authorityBindingValid && !approved ? (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          {getBatchAuthorityBindingValidation(batch).blockingReason ?? 'Batch authority binding is missing or invalid.'}
        </div>
      ) : !allocationAttached && !approved ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          {batch.aaaAllocation.status === 'computed'
            ? 'AAA allocation computed — pending on-chain anchor.'
            : 'AAA allocation must be validated against the on-chain attachment before destination approval.'}
        </div>
      ) : !fundingVerified ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          Funding must be verified before DAO approval.
        </div>
      ) : blockingReason && !approved ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          <span className="font-semibold">Blocking Reason:</span> {blockingReason}
        </div>
      ) : null}

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
  onApproveDeployment,
  isApprovingDeployment = false,
  deploymentApprovalError = null,
}: {
  batch: EscrowBatch;
  onApproveDeployment: (batch: EscrowBatch) => void;
  isApprovingDeployment?: boolean;
  deploymentApprovalError?: string | null;
}) {
  const approved = hasDeploymentApproval(batch);
  const blockingReason = approved ? null : getDeploymentApprovalBlockingReason(batch);
  const mismatchReason = getExistingDeploymentApprovalMismatch(batch);
  const approval = batch.deploymentApproval;
  const payload = approval.payload;
  const canApprove = canApproveDeployment(batch);

  return (
    <SectionCard title="Deployment Approval" icon={<ShieldCheck size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge
          label={approved ? 'Deployment Approved' : 'Deployment Approval Pending'}
          tone={approved ? 'success' : blockingReason ? 'warning' : 'purple'}
        />
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

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="action-button action-button--primary inline-flex items-center gap-2"
          disabled={!canApprove || approved || isApprovingDeployment}
          aria-disabled={!canApprove || approved || isApprovingDeployment}
          onClick={() => onApproveDeployment(batch)}
        >
          <CheckCircle2 size={16} />
          {isApprovingDeployment ? 'Saving…' : approved ? 'Deployment Approved' : 'Approve Deployment'}
        </button>
      </div>

      {deploymentApprovalError ? (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <span className="font-semibold">Save Error:</span> {deploymentApprovalError}
        </div>
      ) : mismatchReason ? (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <span className="font-semibold">Approval Mismatch:</span> {mismatchReason}
        </div>
      ) : blockingReason && !approved ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          <span className="font-semibold">Blocking Reason:</span> {blockingReason}
        </div>
      ) : null}

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
  onExecuteDeployment,
  isExecuting = false,
  deploymentExecutionError = null,
}: {
  batch: EscrowBatch;
  onExecuteDeployment: (batch: EscrowBatch) => void;
  isExecuting?: boolean;
  deploymentExecutionError?: string | null;
}) {
  const latestExecution = getLatestDeploymentExecution(batch);
  const deploymentStatus = getDeploymentExecutionStatus(batch);
  const blockingReason = getDeploymentExecutionBlockingReason(batch);
  const deploymentReady = canExecuteDeployment(batch);
  const legResults = latestExecution?.deploymentLegResults ?? [];
  const latestLegResult = [...legResults].sort((left, right) => right.deployedAt.localeCompare(left.deployedAt))[0];

  return (
    <SectionCard title="Deployment Execution" icon={<Layers size={18} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge
          label={titleCase(deploymentStatus)}
          tone={deploymentStatus === 'monitoring' || deploymentStatus === 'deployed' ? 'success' : deploymentStatus === 'failed' ? 'danger' : 'warning'}
        />
        <span className="data-chip">{hasDeploymentApproval(batch) ? 'Deployment Approved' : 'Approval Pending'}</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Deployment status" value={titleCase(deploymentStatus)} />
        <Field label="Deployment approval hash" value={<span className="font-mono">{shortHash(batch.deploymentApproval.deploymentApprovalHash)}</span>} />
        <Field label="Destination approval hash" value={<span className="font-mono">{shortHash(batch.deploymentApproval.destinationApprovalHash)}</span>} />
        <Field label="Deployment tx hash" value={<span className="font-mono">{shortHash(latestExecution?.deploymentTxHash)}</span>} />
        <Field label="Executed by" value={latestExecution?.executedBy ?? 'Pending'} />
        <Field label="Executed at" value={formatDateTime(latestExecution?.executedAt)} />
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

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="action-button action-button--primary inline-flex items-center gap-2"
          disabled={!deploymentReady || isExecuting}
          aria-disabled={!deploymentReady || isExecuting}
          onClick={() => onExecuteDeployment(batch)}
        >
          <ArrowRight size={16} />
          {isExecuting ? 'Executing…' : 'Deploy Batch'}
        </button>
      </div>

      {deploymentExecutionError ? (
        <div className="mb-4 rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-3 text-xs leading-6 text-rose-100">
          <span className="font-semibold">Execution Error:</span> {deploymentExecutionError}
        </div>
      ) : null}

      {blockingReason && deploymentStatus !== 'monitoring' ? (
        <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-xs leading-6 text-amber-200">
          <span className="font-semibold">Blocking Reason:</span> {blockingReason}
        </div>
      ) : null}

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
  onVerifyFunding,
  onManualConfirmFunding,
  isVerifyingFunding,
  fundingVerificationError,
  onApproveDestinations,
  onApproveDeployment,
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
  onSetCustodyMode,
  signingAuthorityRole,
  signingAuthorityError,
  onChainRoleAuthorities,
  onRoleAuthoritiesInitialized,
  signerServicesConfigured,
  onRequestAaaAllocation,
  isRequestingAllocation,
  allocationRequestError,
  onRecoverAllocationPlan,
  isRecoveringPlan,
  planRecoveryError,
  isApprovingDeployment,
  deploymentApprovalError,
  isExecutingDeployment,
  deploymentExecutionError,
}: {
  batch: EscrowBatch;
  onVerifyFunding: (batch: EscrowBatch) => void;
  onManualConfirmFunding: (batch: EscrowBatch, observedAmountUsd: number, fundingTxHash: string) => void;
  isVerifyingFunding: boolean;
  fundingVerificationError: string | null;
  onApproveDestinations: (batch: EscrowBatch) => void;
  onApproveDeployment: (batch: EscrowBatch) => void;
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
  onSetCustodyMode: (batch: EscrowBatch, mode: 'escrow_contract_custody' | 'batch_wallet_custody') => void;
  signingAuthorityRole?: string;
  signingAuthorityError?: string | null;
  onChainRoleAuthorities: OnChainRoleAuthorities | null;
  onRoleAuthoritiesInitialized?: () => void;
  signerServicesConfigured?: { treasury: boolean; escrow: boolean };
  onRequestAaaAllocation: (batch: EscrowBatch) => void;
  isRequestingAllocation: boolean;
  allocationRequestError: string | null;
  onRecoverAllocationPlan: (batch: EscrowBatch) => void;
  isRecoveringPlan: boolean;
  planRecoveryError: string | null;
  isApprovingDeployment: boolean;
  deploymentApprovalError: string | null;
  isExecutingDeployment: boolean;
  deploymentExecutionError: string | null;
}) {
  const [activeTab, setActiveTab] = useState<BatchDetailTab>('overview');
  const primaryAction = getPrimaryAction(batch);
  const blockingReason = getBatchBlockingReason(batch);
  const canAdvance = canAdvanceBatch(batch);
  const manifestValidation = getManifestValidation(batch);
  const fundingValidation = getFundingValidation(batch);
  const computedDepositTotal = getComputedDepositTotal(batch);
  const walletCreated = Boolean(walletDisplay(batch)) && batch.wallet.fundingStatus !== 'not_created';
  const isVerifyFundingAction = primaryAction === 'Verify Funding';
  const isRequestAaaAllocationAction = ['Request AAA Allocation', 'Anchor AAA Allocation'].includes(primaryAction);
  const isApproveDestinationAction = primaryAction === 'Approve Destination';
  const isApproveDeploymentAction = primaryAction === 'Approve Deployment';
  const isCreateDeploymentSigningRequestAction = primaryAction === 'Create Deployment Signing Request';
  const isExecuteDeploymentAction = primaryAction === 'Execute Deployment' || primaryAction === 'Deploy Batch';
  const primaryActionEnabled =
    isVerifyFundingAction ||
    isRequestAaaAllocationAction ||
    isApproveDestinationAction ||
    isApproveDeploymentAction ||
    isCreateDeploymentSigningRequestAction ||
    isExecuteDeploymentAction ||
    canAdvance;

  const runPrimaryAction = () => {
    if (isVerifyFundingAction) onVerifyFunding(batch);
    if (isRequestAaaAllocationAction) onRequestAaaAllocation(batch);
    if (isApproveDestinationAction) onApproveDestinations(batch);
    if (isApproveDeploymentAction) onApproveDeployment(batch);
    if (isCreateDeploymentSigningRequestAction) onCreateDeploymentSigningRequest(batch);
    if (isExecuteDeploymentAction) onExecuteDeployment(batch);
  };

  return (
    <section className="sagitta-cell">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge label={batchStatusLabel(batch)} tone={statusTone(batch)} />
            <span className="data-chip">{batch.termMonths}M Term</span>
            <span className="data-chip">{batch.deposits.length} Deposits</span>
          </div>
          <h2 className="text-2xl font-bold">{batch.batchId}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Batch container for Treasury-sent funds, wallet binding, funding verification, DAO approval,
            deployment, settlement, performance, and audit evidence.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <button
            type="button"
            className="action-button action-button--primary inline-flex items-center gap-2"
            data-can-advance={primaryActionEnabled}
            aria-disabled={!primaryActionEnabled}
            onClick={runPrimaryAction}
          >
            <Activity size={16} />
            {primaryAction}
          </button>
          {blockingReason && !isApproveDestinationAction && !isApproveDeploymentAction && !isCreateDeploymentSigningRequestAction && !isExecuteDeploymentAction && !(isVerifyFundingAction && fundingValidation.state !== 'mismatch') ? (
            <div className="max-w-md text-left text-xs text-amber-200 sm:text-right">
              <span className="font-semibold">Blocking Reason:</span> {blockingReason}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Wallet" value={<span className="font-mono">{shortHash(walletDisplay(batch))}</span>} />
        <Field label="Funding" value={fundingStatusLabel(batch)} />
        <Field label="Deployment" value={deploymentExecutionLabel(batch)} />
        {batch.batchAuthorityBinding ? (
          <Field
            label="Authority Binding"
            value={
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-xs text-[var(--gold-300)]">{shortHash(batch.batchAuthorityBinding.batchAuthorityBindingHash)}</span>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge label={`T:${batch.batchAuthorityBinding.treasurySignatureStatus}`} tone={sigStatusTone(batch.batchAuthorityBinding.treasurySignatureStatus)} />
                  <StatusBadge label={`E:${batch.batchAuthorityBinding.escrowSignatureStatus}`} tone={sigStatusTone(batch.batchAuthorityBinding.escrowSignatureStatus)} />
                  <span className="data-chip" data-tone={batch.batchAuthorityBinding.anchorStatus === 'anchored' ? 'success' : batch.batchAuthorityBinding.anchorStatus === 'binding_mismatch' ? 'danger' : 'purple'}>
                    {batch.batchAuthorityBinding.anchorStatus === 'anchored' ? 'Anchored' : batch.batchAuthorityBinding.anchorStatus === 'binding_mismatch' ? 'Binding Mismatch' : 'Pending Anchor'}
                  </span>
                </div>
              </div>
            }
          />
        ) : null}
      </div>

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
        <div className="space-y-4">
          {batch.exception ? (
            <div className="rounded-lg border border-[rgba(236,86,86,0.34)] bg-[rgba(60,20,20,0.42)] p-4 text-sm text-rose-100">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} />
                Exception: {batch.exception.type}
              </div>
              <p className="mb-4 text-rose-100/90">{batch.exceptionReason}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Expected amount" value={fmtUsd(batch.exception.expectedAmountUsd)} />
                <Field label="Observed amount" value={fmtUsd(batch.exception.observedAmountUsd)} />
                <Field label="Blocking step" value={batch.exception.blockingStep} />
                <Field label="Resolution action" value={batch.exception.resolutionAction} />
              </div>
            </div>
          ) : null}

          <LifecycleTimeline batch={batch} />
          <BatchReadinessPanel batch={batch} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard title="Overview" icon={<Database size={18} />}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Batch ID" value={batch.batchId} />
                <Field label="Total amount" value={fmtUsd(batch.totalAmountUsd)} />
                <Field label="Status" value={batchStatusLabel(batch)} />
                <Field label="Primary action" value={primaryAction} />
              </div>
            </SectionCard>

            <SectionCard title="Custody Mode" icon={<Wallet size={18} />}>
              {(() => {
                const binding = batch.batchAuthorityBinding;
                const canChange = !binding ||
                  (binding.treasurySignatureStatus === 'pending' && binding.escrowSignatureStatus === 'pending');
                const isBatchWallet = batch.custodyMode === 'batch_wallet_custody';
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Field label="Current mode" value={isBatchWallet ? 'Batch Wallet Custody' : 'Escrow Contract Custody'} />
                      <Field label="Wallet creation" value={isBatchWallet ? 'Required after anchor' : 'Not required'} />
                    </div>
                    {canChange ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400">
                          {isBatchWallet
                            ? 'Batch wallet custody: funds move to a 2-of-3 multisig wallet after anchor.'
                            : 'Escrow contract custody: funds remain in InvestmentEscrow. Switch to batch wallet custody to enable multisig wallet creation after anchor.'}
                        </p>
                        <button
                          type="button"
                          className="action-button action-button--primary"
                          onClick={() => onSetCustodyMode(batch, isBatchWallet ? 'escrow_contract_custody' : 'batch_wallet_custody')}
                        >
                          Switch to {isBatchWallet ? 'Escrow Contract Custody' : 'Batch Wallet Custody'}
                        </button>
                      </div>
                    ) : (
                      <div className="panel-note text-xs">
                        Custody mode is locked once signing begins. Current mode: <strong>{isBatchWallet ? 'Batch Wallet Custody' : 'Escrow Contract Custody'}</strong>.
                      </div>
                    )}
                  </div>
                );
              })()}
            </SectionCard>

            <SectionCard title="Treasury Reconciliation" icon={<Landmark size={18} />}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Treasury state" value={batch.treasuryHandoff.approvedByTreasury ? 'Sent by Treasury' : 'Pending Treasury send'} />
                <Field label="Sent at" value={formatDateTime(batch.treasuryHandoff.approvedAt)} />
                <Field label="Source wallet" value={<span className="font-mono">{shortHash(batch.treasuryHandoff.treasurySourceWallet)}</span>} />
                <Field label="Manifest hash" value={<span className="font-mono">{shortHash(batch.treasuryHandoff.depositManifestHash)}</span>} />
              </div>
            </SectionCard>
          </div>
        </div>
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
            <Field label="Term" value={`${batch.termMonths}M`} />
            <Field label="Asset" value={batch.asset ?? 'USDC'} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <th className="pb-2 pr-4">Deposit</th>
                  <th className="pb-2 pr-4">Adapter</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 pr-4 text-right">Term</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {batch.deposits.map((deposit) => (
                  <tr key={deposit.depositId} className="border-b border-slate-800/60">
                    <td className="py-3 pr-4 font-mono text-slate-100">{deposit.depositId}</td>
                    <td className="py-3 pr-4 text-slate-400">{titleCase(deposit.adapterType)}</td>
                    <td className="py-3 pr-4 text-right font-mono">{fmtUsd(deposit.amountUsd)}</td>
                    <td className="py-3 pr-4 text-right font-mono">{deposit.termMonths}M</td>
                    <td className="py-3 text-right">{titleCase(deposit.status)}</td>
                  </tr>
                ))}
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
                  <Field label="Wallet address" value={<span className="font-mono">{walletDisplay(batch)}</span>} />
                  <Field label="Wallet type" value="2-of-3 Multisig" />
                  <Field label="Threshold" value={`${batch.wallet.threshold ?? 2} of 3`} />
                  <Field label="Signers" value="Treasury / Escrow / Continuity SCE" />
                  <Field label="Owner Treasury" value={<span className="font-mono">{shortHash(batch.wallet.owners?.treasury)}</span>} />
                  <Field label="Owner Escrow" value={<span className="font-mono">{shortHash(batch.wallet.owners?.escrow)}</span>} />
                  <Field label="Owner Continuity" value={<span className="font-mono">{shortHash(batch.wallet.owners?.continuity)}</span>} />
                  <Field label="Chain" value={titleCase(batch.wallet.chain)} />
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

          <BatchWalletBindingSection batch={batch} />

          <div className="xl:col-span-2">
            <RoleAuthorityRegistrySection />
          </div>

          <div className="xl:col-span-2">
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
          </div>

          <div className="xl:col-span-2">
            <TreasuryFundingSection
              batch={batch}
              onVerifyFunding={onVerifyFunding}
              onManualConfirmFunding={onManualConfirmFunding}
              isVerifying={isVerifyingFunding}
              verificationError={fundingVerificationError}
            />
          </div>
        </div>
      ) : null}

      {activeTab === 'aaa' ? (
        <AaaAllocationSection
          batch={batch}
          onRequestAllocation={onRequestAaaAllocation}
          isRequesting={isRequestingAllocation}
          requestError={allocationRequestError}
          onRecoverPlan={onRecoverAllocationPlan}
          isRecovering={isRecoveringPlan}
          recoveryError={planRecoveryError}
        />
      ) : null}

      {activeTab === 'deployment' ? (
        <div className="space-y-4">
          <DestinationApprovalSection batch={batch} onApproveDestinations={onApproveDestinations} />
          <DeploymentApprovalSection
            batch={batch}
            onApproveDeployment={onApproveDeployment}
            isApprovingDeployment={isApprovingDeployment}
            deploymentApprovalError={deploymentApprovalError}
          />
          <DeploymentExecutionSection
            batch={batch}
            onExecuteDeployment={onExecuteDeployment}
            isExecuting={isExecutingDeployment}
            deploymentExecutionError={deploymentExecutionError}
          />
          <SectionCard title="Deployment Legs" icon={<Layers size={18} />}>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Deployment approval" value={deploymentApprovalLabel(batch)} />
              <Field label="Deployment execution" value={deploymentExecutionLabel(batch)} />
              <Field label="Approved by" value={batch.deploymentApproval.approvedBy ?? 'Pending'} />
            </div>
            {getDeploymentLegsForDestinationApproval(batch).length === 0 ? (
              <div className="panel-note">No deployment legs are attached. Verify funding before deployment planning.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {getDeploymentLegsForDestinationApproval(batch).map((leg) => (
                  <div key={leg.legId} className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{PROVIDER_LABELS[leg.provider]}</div>
                        <div className="mt-1 font-semibold text-slate-100">{leg.asset}</div>
                      </div>
                      <StatusBadge label={titleCase(leg.status)} tone={leg.status === 'exception' ? 'danger' : ['executed', 'deployed', 'monitoring', 'settled'].includes(leg.status) ? 'success' : 'warning'} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Field label="Asset" value={leg.asset} />
                      <Field label="Allocation" value={fmtPct(leg.allocationPercent)} />
                      <Field label="Amount" value={fmtUsd(leg.amountUsd)} />
                      <Field label="Target yield" value={`${leg.targetYieldBps} bps`} />
                      <Field label="Destination" value={leg.destinationName ?? 'Pending'} />
                      <Field label="Destination type" value={leg.destinationType ?? titleCase(leg.strategyType)} />
                      <Field label="Status" value={titleCase(leg.status)} />
                      <Field label="Current" value={leg.currentValueUsd == null ? 'Pending' : fmtUsd(leg.currentValueUsd)} />
                      <div className="col-span-2">
                        <Field label="Destination address" value={leg.destinationAddress ? <span className="font-mono text-[11px]">{shortHash(leg.destinationAddress)}</span> : 'Pending'} />
                      </div>
                      <div className="col-span-2">
                        <Field label="Provider reference" value={leg.providerReferenceId ?? 'Pending'} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === 'settlement' ? (
        <SectionCard title="Settlement" icon={<FileCheck size={18} />}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Maturity date" value={formatDateTime(batch.settlement.maturityDate)} />
            <Field label="Settlement status" value={titleCase(batch.settlement.status)} />
            <Field label="Expected return" value={batch.settlement.expectedReturnUsd == null ? 'Pending' : fmtUsd(batch.settlement.expectedReturnUsd)} />
            <Field label="Returned amount" value={batch.settlement.returnedAmountUsd == null ? 'Pending' : fmtUsd(batch.settlement.returnedAmountUsd)} />
            <Field label="Bank repayment amount" value={batch.settlement.bankRepaymentAmountUsd == null ? 'Pending' : fmtUsd(batch.settlement.bankRepaymentAmountUsd)} />
            <Field label="Surplus / spread" value={batch.settlement.surplusUsd == null ? 'Pending' : fmtUsd(batch.settlement.surplusUsd)} />
            <Field label="Settlement tx" value={<span className="font-mono">{shortHash(batch.settlement.settlementTxHash)}</span>} />
            <Field label="Wallet retirement status" value={walletRetirementLabel(batch)} />
          </div>
        </SectionCard>
      ) : null}

      {activeTab === 'performance' ? (
        <SectionCard title="Performance" icon={<LineChart size={18} />}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Projected yield" value={fmtUsd(batch.performance.projectedYieldUsd)} />
            <Field label="Realized yield" value={batch.performance.realizedYieldUsd == null ? 'Pending' : fmtUsd(batch.performance.realizedYieldUsd)} />
            <Field label="Current value" value={fmtUsd(batch.performance.currentValueUsd)} />
            <Field label="Variance" value={`${batch.performance.varianceBps ?? 0} bps`} />
            <Field label="Last updated" value={formatDateTime(batch.performance.lastUpdatedAt)} />
          </div>
        </SectionCard>
      ) : null}

      {activeTab === 'audit' ? (
        <SectionCard title="Audit Trail" icon={<Lock size={18} />}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <th className="pb-2 pr-4">Timestamp</th>
                  <th className="pb-2 pr-4">Actor</th>
                  <th className="pb-2 pr-4">Event Type</th>
                  <th className="pb-2 pr-4">Description</th>
                  <th className="pb-2">Tx Hash / Reference</th>
                </tr>
              </thead>
              <tbody>
                {batch.auditTrail.map((event) => (
                  <tr key={event.eventId} className="border-b border-slate-800/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-slate-400">{formatDateTime(event.timestamp)}</td>
                    <td className="py-3 pr-4 text-slate-300">{event.actor}</td>
                    <td className="py-3 pr-4 font-semibold text-slate-100">{event.eventType}</td>
                    <td className="py-3 pr-4 text-slate-400">{event.description}</td>
                    <td className="py-3 font-mono text-xs text-slate-400">{shortHash(event.txHash ?? event.reference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}
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
    speculative: 1200, yield_fund: 700, external: 500,
  };
  return Math.round(
    Object.entries(weights).reduce(
      (sum, [symbol, weight]) => sum + Number(weight) * (roleYield[roleByAsset[symbol] ?? ''] ?? 500),
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

export default function EscrowTab() {
  const { selectedChain } = useProtocolChain();
  const [handoffs, setHandoffs] = useState<TreasuryHandoffPackage[]>([]);
  const [batches, setBatches] = useState<EscrowBatch[]>([]);
  const [lifecycleBatches, setLifecycleBatches] = useState<LifecycleRow[]>([]);
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

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.batchId === selectedBatchId) ?? batches[0],
    [batches, selectedBatchId]
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

  // Convert handoffs → EscrowBatch objects for the table.
  // Merges new handoffs into batches without overwriting existing hydrated state.
  useEffect(() => {
    if (handoffs.length === 0) return;
    setBatches((current) => {
      const currentById = new Map(current.map((b) => [b.batchId, b]));
      const next = handoffs.map((handoff) => {
        const created = createEscrowBatchFromHandoff(handoff);
        const existing = currentById.get(created.batchId);
        return existing ?? created;
      });
      return next;
    });
  }, [handoffs]);

  // Load lifecycle batch list from server — drives the MetricCard count.
  // Polls every 5 s so newly registered batches appear without a full page reload.
  useEffect(() => {
    if (!selectedChain?.key) return;
    let cancelled = false;
    async function loadLifecycleBatches() {
      try {
        const res = await fetch(`/api/banking/escrow/lifecycle/list?chainKey=${encodeURIComponent(selectedChain.key)}`);
        if (!res.ok || cancelled) return;
        const rows = await res.json();
        if (!cancelled) setLifecycleBatches(Array.isArray(rows) ? rows : []);
      } catch { /* non-fatal */ }
    }
    loadLifecycleBatches();
    const interval = setInterval(loadLifecycleBatches, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedChain?.key]);

  // [REMOVED] Stored allocation plans hydration effect removed. Allocation state now comes
  // from Phase 5 frozen evidence in the lifecycle controller — never from DB-loaded plan stubs.

  useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      setSelectedBatchId(batches[0].batchId);
    }
  }, [batches, selectedBatchId]);

  useEffect(() => {
    let cancelled = false;

    async function loadIncomingTreasuryBatches() {
      try {
        const response = await fetch(`${bankingUrl('/state')}?chainKey=${encodeURIComponent(selectedChain.key)}`);
        if (!response.ok) return;
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
          .map((order) => buildIncomingTreasuryBatch(order, termPositions))
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
        const incoming = onChainTreasuryBatches.map((onChainBatch) => {
          const matchedBackend = backendDerivedBatches.find((batch) =>
            batch.proposedBatchId === onChainBatch.proposedBatchId ||
            (batch.sourceBatchId && batch.sourceBatchId === (onChainBatch.sourceBatchId ?? onChainBatch.handoffId)) ||
            batch.handoffId === onChainBatch.handoffId
          );
          return mergeBackendMetadataIntoOnChainBatch(onChainBatch, matchedBackend);
        });

        if (cancelled) return;

        setStoredAllocationPlans(nextStoredAllocationPlans);

        setHandoffs((current) => {
          const currentById = new Map(current.map((batch) => [batch.handoffId || batch.proposedBatchId, batch]));
          const merged = incoming.map((batch) => {
            const key = batch.handoffId || batch.proposedBatchId;
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
    if (!areBothSignerServicesConfigured(signerServiceConfig)) return;

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
                speculative: 1200, yield_fund: 700, external: 500,
              };
              const blendedYieldBps = Math.round(
                Object.entries(weights).reduce(
                  (sum, [sym, w]) => sum + (w as number) * (roleYield[roleByAss[sym] ?? ''] ?? 500),
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

    // ── Service path: autonomous signer service reconstructs payload and signs ──
    const serviceUrl = role === 'treasury' ? signerServiceConfig.treasurySignerUrl : signerServiceConfig.escrowSignerUrl;
    if (serviceUrl) {
      const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
      if (!sourceBatchId) {
        setSigningAuthorityError('sourceBatchId is missing from batch — cannot request service signature.');
        setSigningAuthorityKey('');
        return;
      }

      requestSignatureFromService({
        serviceUrl,
        sourceBatchId,
        escrowBatchId: batch.batchId,
        chainId: selectedChain.chainId,
        custodyMode: batch.custodyMode ?? 'escrow_contract_custody',
      })
        .then((response) => {
          // Cross-check: service binding hash must match local binding hash.
          if (response.bindingHash.toLowerCase() !== binding.batchAuthorityBindingHash.toLowerCase()) {
            throw new Error(
              `Signer service returned binding hash mismatch. ` +
              `Service: ${response.bindingHash}, local: ${binding.batchAuthorityBindingHash}. ` +
              `This may mean contract addresses or batch data have changed since the binding was created.`
            );
          }

          const isValidSig = response.recoveredAddress.toLowerCase() === response.signerAddress.toLowerCase();
          const newStatus = isValidSig ? ('signed' as const) : ('invalid' as const);
          const bothSigned = newStatus === 'signed' && (
            role === 'treasury' ? binding.escrowSignatureStatus === 'signed' : binding.treasurySignatureStatus === 'signed'
          );

          let updatedBinding = { ...binding };
          if (role === 'treasury') {
            updatedBinding = {
              ...updatedBinding,
              treasurySignature: response.signature,
              treasurySignerAddress: response.signerAddress,
              treasuryRecoveredSignerAddress: response.recoveredAddress,
              treasurySignedAt: response.signedAt,
              treasurySignatureStatus: newStatus,
              signatureVerificationStatus: newStatus === 'invalid' ? 'invalid' : bothSigned ? 'verified' : 'unverified',
            };
          } else {
            updatedBinding = {
              ...updatedBinding,
              escrowSignature: response.signature,
              escrowSignerAddress: response.signerAddress,
              escrowRecoveredSignerAddress: response.recoveredAddress,
              escrowSignedAt: response.signedAt,
              escrowSignatureStatus: newStatus,
              signatureVerificationStatus: newStatus === 'invalid' ? 'invalid' : bothSigned ? 'verified' : 'unverified',
            };
          }

          applyAuthoritySignatureToBatch(batch, role, updatedBinding as NonNullable<EscrowBatch['batchAuthorityBinding']>);
        })
        .catch((err: unknown) => {
          const errMessage = String((err as any)?.message ?? err ?? 'Unknown service signing error');
          setSigningAuthorityError(errMessage);
          setSigningAuthorityKey('');
        });
      return;
    }

    // Browser wallet fallback removed. Phase 2 (authority binding anchor) is now handled
    // server-side by the lifecycle controller. Use the BatchLifecycleCard advance button.
    setSigningAuthorityError('Authority binding signing is now handled server-side (lifecycle Phase 2). Use the BatchLifecycleCard advance button.');
    setSigningAuthorityKey('');
  };

  const anchorBatchForBatch = (batch: EscrowBatch) => {
    const binding = batch.batchAuthorityBinding;
    if (!binding) return;
    const sourceBatchId = binding.canonicalPayload?.sourceBatchId ?? batch.sourceBatchId;
    if (!sourceBatchId) return;

    setAnchorError(null);
    setAnchoringBatchId(batch.batchId);

    const escrowAddress = getRuntimeAddress('InvestmentEscrow');

    // ── Service path: escrow signer service reconstructs and submits anchor ──
    const escrowSignerUrl = signerServiceConfig.escrowSignerUrl;
    if (escrowSignerUrl && binding.treasurySignature && binding.escrowSignature) {
      requestAnchorFromService({
        escrowSignerUrl,
        sourceBatchId,
        escrowBatchId: batch.batchId,
        treasurySignature: binding.treasurySignature,
        escrowSignature: binding.escrowSignature,
        batchAuthorityBindingHash: binding.batchAuthorityBindingHash,
        custodyMode: batch.custodyMode ?? 'escrow_contract_custody',
      })
        .then(async ({ txHash, blockNumber, anchoredAt, wallet: walletResult }) => {
          const onChainAnchor = await readBatchAuthorityAnchorFromChain({
            escrowAddress,
            sourceBatchId,
            rpcUrl: selectedChain.rpcUrl,
          });
          if (!onChainAnchor || !onChainAnchor.exists) {
            throw new Error('Anchor transaction succeeded but anchor record not found on-chain. Please refresh.');
          }
          const localHash = binding.batchAuthorityBindingHash.toLowerCase();
          const chainHash = onChainAnchor.batchAuthorityBindingHash.toLowerCase();
          if (localHash !== chainHash) {
            throw new Error(`On-chain anchor hash mismatch: local ${localHash} vs on-chain ${chainHash}.`);
          }
          const anchorEventId = `${batch.batchId}-authority-binding-anchored`;
          const walletEventId = `${batch.batchId}-batch-wallet-bound`;
          const walletBound = walletResult && !walletResult.error && walletResult.walletAddress;
          const wr = walletBound
            ? walletResult as { walletAddress: string; creationTxHash: string; bindingTxHash: string; boundAt: string; ownerTreasury: string; ownerEscrow: string; ownerContinuity: string; threshold: number; batchAuthorityBindingHash: string; fundingTxHash?: string; fundingError?: string }
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

    // ── Browser wallet fallback ──
    anchorBatchAuthorityBindingOnChain({ binding, escrowAddress, sourceBatchId })
      .then(async ({ txHash, blockNumber, anchoredAt }) => {
        // Read back from chain — on-chain record is the source of truth.
        const onChainAnchor = await readBatchAuthorityAnchorFromChain({
          escrowAddress,
          sourceBatchId,
          rpcUrl: selectedChain.rpcUrl,
        });

        if (!onChainAnchor || !onChainAnchor.exists) {
          throw new Error('Anchor transaction succeeded but anchor record not found on-chain. Please refresh and try again.');
        }

        const localHash = binding.batchAuthorityBindingHash.toLowerCase();
        const chainHash = onChainAnchor.batchAuthorityBindingHash.toLowerCase();
        if (localHash !== chainHash) {
          throw new Error(`On-chain anchor hash mismatch: local ${localHash} vs on-chain ${chainHash}.`);
        }

        const eventId = `${batch.batchId}-authority-binding-anchored`;
        setBatches((current) =>
          current.map((item) => {
            if (item.batchId !== batch.batchId) return item;
            const b = item.batchAuthorityBinding;
            if (!b) return item;
            const hasEvent = item.auditTrail.some((e) => e.eventId === eventId);
            return {
              ...item,
              batchAuthorityBinding: {
                ...b,
                anchorStatus: 'anchored',
                anchorTxHash: txHash,
                anchorBlockNumber: blockNumber,
                anchoredAt,
              },
              auditTrail: hasEvent ? item.auditTrail : [
                ...item.auditTrail,
                {
                  eventId,
                  timestamp: anchoredAt,
                  actor: 'Escrow Operator',
                  eventType: 'Batch Authority Binding anchored on-chain',
                  description: `batchAuthorityBindingHash anchored on-chain for sourceBatchId ${sourceBatchId}. Anchor verified by on-chain read. Block: ${blockNumber}.`,
                  txHash,
                  reference: binding.batchAuthorityBindingHash,
                },
              ],
            };
          })
        );
        setAnchoringBatchId('');
        setSelectedBatchId(batch.batchId);
      })
      .catch((err: any) => {
        // Extract revert reason from ethers custom errors and reverts.
        const reason: string =
          err?.revert?.name ??
          err?.reason ??
          err?.shortMessage ??
          err?.message ??
          'Unknown anchor error';
        setAnchorError(reason);
        setAnchoringBatchId('');
      });
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
      if (!areBothSignerServicesConfigured(signerServiceConfig)) {
        throw new Error('Treasury and Escrow signer services must both be configured for deployment execution.');
      }
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
      const treasuryResult = await requestTreasuryDeployLegFromService({
        treasurySignerUrl: signerServiceConfig.treasurySignerUrl!,
        sourceBatchId,
        escrowBatchId: batch.batchId,
        walletAddress,
        assetSymbol: requestedAssetSymbol,
        amount: amountText,
        destinationAddress: approvedDestinationAddress,
        chainId: Number(selectedChain.chainId ?? 31337),
      });
      const escrowResult = await requestEscrowDeployLegConfirmationFromService({
        escrowSignerUrl: signerServiceConfig.escrowSignerUrl!,
        sourceBatchId,
        escrowBatchId: batch.batchId,
        walletAddress,
        assetSymbol: requestedAssetSymbol,
        amount: amountText,
        destinationAddress: approvedDestinationAddress,
        txIndex: treasuryResult.txIndex,
        chainId: Number(selectedChain.chainId ?? 31337),
      });
      const multisigTxIndex = Number(escrowResult.txIndex);
      const signerProof = {
        treasurySignerAddress: treasuryResult.signerAddress,
        treasurySubmitTxHash: treasuryResult.submitTxHash,
        treasuryConfirmTxHash: treasuryResult.confirmTxHash,
        escrowSignerAddress: escrowResult.signerAddress,
        escrowConfirmTxHash: escrowResult.confirmTxHash,
      } satisfies Partial<Pick<
        DeploymentExecutionRecord['deploymentLegResults'][number],
        'treasurySignerAddress' | 'treasurySubmitTxHash' | 'treasuryConfirmTxHash' | 'escrowSignerAddress' | 'escrowConfirmTxHash'
      >>;
      if (treasuryResult.executed || escrowResult.alreadyExecuted) {
        const existingExecution = await rehydrateDeploymentExecutionFromChain({
          batch,
          rpcUrl: selectedChain.rpcUrl,
          escrowAddress,
          existingExecution: priorExecution,
          legIdHint: targetLeg.leg.legId,
          txIndexHint: multisigTxIndex,
          destinationAddressHint: approvedDestinationAddress,
          amountHint: legAmount,
          signerProof,
        });
        if (existingExecution) {
          await saveDeploymentExecutionToDb(batch.batchId, existingExecution).catch(() => undefined);
          setBatches((current) =>
            current.map((item) =>
              item.batchId === batch.batchId
                ? applyDeploymentExecutionToBatch(item, existingExecution)
                : item
            )
          );
          return;
        }
      }
      let deploymentTxHash = String(escrowResult.deploymentTxHash || escrowResult.confirmTxHash || treasuryResult.confirmTxHash || treasuryResult.submitTxHash);
      if (!deploymentTxHash) {
        const existingExecution = await rehydrateDeploymentExecutionFromChain({
          batch,
          rpcUrl: selectedChain.rpcUrl,
          escrowAddress,
          existingExecution: priorExecution,
          legIdHint: targetLeg.leg.legId,
          txIndexHint: multisigTxIndex,
          destinationAddressHint: approvedDestinationAddress,
          amountHint: legAmount,
          signerProof,
        });
        if (existingExecution?.deploymentTxHash) {
          await saveDeploymentExecutionToDb(batch.batchId, existingExecution).catch(() => undefined);
          setBatches((current) =>
            current.map((item) =>
              item.batchId === batch.batchId
                ? applyDeploymentExecutionToBatch(item, existingExecution)
                : item
            )
          );
          return;
        }
        throw new Error('Deployment execution completed without a transaction hash.');
      }

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

      const executedAt = escrowResult.executedAt || new Date().toISOString();
      const execution = await saveDeploymentExecutionToDb(
        batch.batchId,
        mergeDeploymentExecutionRecord(
          batch,
          priorExecution,
          {
            legId: targetLeg.leg.legId,
            provider: targetLeg.leg.provider,
            asset: requestedAssetSymbol,
            amountUsd: legAmount,
            allocationPercent: targetLeg.leg.allocationPercent,
            targetYieldBps: targetLeg.leg.targetYieldBps,
            status: 'executed',
            providerReferenceId: `multisig:${multisigTxIndex}`,
            deploymentTxHash,
            deployedAt: executedAt,
            walletAddress,
            destinationAddress: approvedDestinationAddress,
            sourceBalanceBefore: Number(formatUnits(walletBalanceBeforeRaw, 6)),
            sourceBalanceAfter: Number(formatUnits(walletBalanceAfterRaw, 6)),
            destinationBalanceBefore: Number(formatUnits(destinationBalanceBeforeRaw, 6)),
            destinationBalanceAfter: Number(formatUnits(destinationBalanceAfterRaw, 6)),
            multisigTxIndex,
            signingSource: 'signer_services',
            treasurySignerAddress: treasuryResult.signerAddress,
            treasurySubmitTxHash: treasuryResult.submitTxHash,
            treasuryConfirmTxHash: treasuryResult.confirmTxHash,
            escrowSignerAddress: escrowResult.signerAddress,
            escrowConfirmTxHash: escrowResult.confirmTxHash,
          },
          executedAt,
          deploymentTxHash,
        ),
      );

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

  const metrics = useMemo(() => {
    const verifiedRealBatches = batches.filter((batch) =>
      getFundingValidation(batch).state === 'verified'
    );
    return {
      totalEscrowed: verifiedRealBatches
        .reduce((sum, batch) => sum + (batch.observedWalletBalanceUsd ?? 0), 0),
      fundingVerified: verifiedRealBatches.length,
      walletsFunded: verifiedRealBatches.filter((batch) => batch.custodyMode === 'batch_wallet_custody' && batch.wallet.fundingStatus === 'verified').length,
      pendingHandoffs: batches.filter((batch) => getFundingValidation(batch).state !== 'verified').length,
      bindingPending: batches.filter((batch) => batch.batchWalletBinding?.bindingStatus !== 'binding_locked').length,
    };
  }, [batches]);

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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Batch Containers" value={String(lifecycleBatches.length)} hint="Treasury-sent batches" icon={<Database size={20} />} />
        <MetricCard title="Funding Verified" value={String(metrics.fundingVerified)} hint="verified custody sources" tone="success" icon={<Landmark size={20} />} />
        <MetricCard title="Wallets Funded" value={String(metrics.walletsFunded)} hint="batch-wallet custody only" tone="warning" icon={<KeyRound size={20} />} />
        <MetricCard title="Total Escrowed" value={fmtUsd(metrics.totalEscrowed)} hint="verified real custody" tone="success" icon={<CircleDollarSign size={20} />} />
      </section>

      <section className="sagitta-cell">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="section-title !mb-0">Escrow Batch Containers</h3>
            <p className="mt-1 text-sm text-slate-400">Treasury-sent batches automatically appear here under Escrow control.</p>
          </div>
          <span className="data-chip" data-tone="purple">Batch-Controlled Escrow</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <th className="whitespace-nowrap pb-3 pr-4">Batch ID</th>
                <th className="whitespace-nowrap pb-3 pr-4">Status</th>
                <th className="whitespace-nowrap pb-3 pr-4">Wallet</th>
                <th className="whitespace-nowrap pb-3 pr-4 text-right">Deposits</th>
                <th className="whitespace-nowrap pb-3 pr-4 text-right">Total</th>
                <th className="whitespace-nowrap pb-3 pr-4 text-right">Term</th>
                <th className="whitespace-nowrap pb-3 pr-4">Auth</th>
                <th className="whitespace-nowrap pb-3 pr-4">AAA</th>
                <th className="whitespace-nowrap pb-3 pr-4">Funding</th>
                <th className="whitespace-nowrap pb-3 pr-4">Deploy</th>
                <th className="whitespace-nowrap pb-3 pr-4">Settle</th>
                <th className="whitespace-nowrap pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr className="border-b border-slate-800/60">
                  <td className="py-6 text-center text-sm text-slate-400" colSpan={12}>
                    No Treasury-sent batch has been registered as an Escrow batch container.
                  </td>
                </tr>
              ) : null}
              {batches.map((batch) => {
                const isSelected = batch.batchId === selectedBatch?.batchId;
                const primaryAction = getPrimaryAction(batch);
                const fundingValidation = getFundingValidation(batch);
                const canAdvance = canAdvanceBatch(batch);
                const isVerifyFundingAction = primaryAction === 'Verify Funding';
                const isRequestAaaAllocationAction = ['Request AAA Allocation', 'Anchor AAA Allocation'].includes(primaryAction);
                const isRecoverPlanAction = primaryAction === 'Recover Plan Data';
                const isApproveDestinationAction = primaryAction === 'Approve Destination';
                const isApproveDeploymentAction = primaryAction === 'Approve Deployment';
                const isCreateDeploymentSigningRequestAction = primaryAction === 'Create Deployment Signing Request';
                const isExecuteDeploymentAction = primaryAction === 'Execute Deployment' || primaryAction === 'Deploy Batch';
                const compactPrimaryAction = compactPrimaryActionLabel(primaryAction);
                return (
                  <tr
                    key={batch.batchId}
                    className={`cursor-pointer border-b border-slate-800/60 transition-colors hover:bg-slate-800/30 ${isSelected ? 'bg-[rgba(80,40,160,0.18)]' : ''}`}
                    onClick={() => setSelectedBatchId(batch.batchId)}
                  >
                    <td className="whitespace-nowrap py-1.5 pr-4 font-mono text-xs text-slate-100" title={batch.batchId}>
                      {compactBatchId(batch.batchId)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4" title={batchStatusLabel(batch)}>
                      <StatusBadge label={compactBatchStatusLabel(batch)} tone={statusTone(batch)} />
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4 font-mono text-xs text-slate-300">{shortHash(walletDisplay(batch))}</td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-right font-mono text-xs">{batch.deposits.length}</td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-right font-mono text-xs">{fmtUsd(batch.totalAmountUsd)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-right font-mono text-xs">{batch.termMonths}M</td>
                    <td className="whitespace-nowrap py-1.5 pr-4">
                      {batch.batchAuthorityBinding ? (
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <EvidencePopover
                            title="Batch Authority Binding (EIP-712)"
                            rows={getAuthorityBindingEvidence(batch)}
                          >
                            <span className="cursor-pointer font-mono text-xs text-[var(--gold-300)] underline decoration-dotted hover:text-amber-200">
                              {shortHash(batch.batchAuthorityBinding.batchAuthorityBindingHash)}
                            </span>
                          </EvidencePopover>
                          <EvidencePopover title="Treasury/Vault Signature" rows={getSigBadgeEvidence(batch, 'treasury')}>
                            <span className="cursor-pointer">
                              <SigIndicator role="T" status={batch.batchAuthorityBinding.treasurySignatureStatus} />
                            </span>
                          </EvidencePopover>
                          <EvidencePopover title="Escrow Signature" rows={getSigBadgeEvidence(batch, 'escrow')}>
                            <span className="cursor-pointer">
                              <SigIndicator role="E" status={batch.batchAuthorityBinding.escrowSignatureStatus} />
                            </span>
                          </EvidencePopover>
                          <span
                            className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                              batch.batchAuthorityBinding.anchorStatus === 'anchored'
                                ? 'bg-emerald-900/40 text-emerald-300'
                                : batch.batchAuthorityBinding.anchorStatus === 'binding_mismatch'
                                  ? 'bg-rose-900/40 text-rose-300'
                                  : 'bg-slate-800/60 text-slate-500'
                            }`}
                            title={batch.batchAuthorityBinding.anchorTxHash ?? 'Pending on-chain anchor'}
                          >
                            <Anchor size={9} />
                            {batch.batchAuthorityBinding.anchorStatus === 'anchored'
                              ? 'Anch'
                              : batch.batchAuthorityBinding.anchorStatus === 'binding_mismatch'
                                ? 'Mism'
                                : 'Pend'}
                          </span>
                          {batch.batchAuthorityBinding.anchorStatus === 'anchored' && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-emerald-900/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200"
                              title={`Batch locked. Anchor tx: ${batch.batchAuthorityBinding.anchorTxHash ?? '—'}`}
                            >
                              <Lock size={8} /> Locked
                            </span>
                          )}
                          {batch.batchAuthorityBinding.anchorStatus === 'binding_mismatch' && (
                            <span className="text-[9px] text-rose-400">On-chain mismatch</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-xs" title={titleCase(batch.aaaAllocation.status)}>
                      {titleCase(batch.aaaAllocation.status)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-xs" title={fundingStatusLabel(batch)}>
                      {compactFundingStatusLabel(batch)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{deploymentExecutionLabel(batch)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-xs" title={titleCase(batch.settlement.status)}>
                      {compactSettlementStatusLabel(batch)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <button
                        type="button"
                        className={`action-button inline-flex min-h-0 items-center gap-2 whitespace-nowrap px-3 py-2 text-xs ${batch.status === 'exception' ? 'action-button--danger' : 'action-button--ghost'}`}
                        data-can-advance={isVerifyFundingAction || isRequestAaaAllocationAction || isRecoverPlanAction || isApproveDestinationAction || isApproveDeploymentAction || isCreateDeploymentSigningRequestAction || isExecuteDeploymentAction || canAdvance}
                        title={primaryAction}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isVerifyFundingAction) {
                            verifyFundingForBatch(batch);
                          } else if (isRequestAaaAllocationAction) {
                            setAllocationRequestError('AAA allocation is now handled by the lifecycle controller. Use the lifecycle Advance button for Phase 5.');
                          } else if (isRecoverPlanAction) {
                            onRecoverAllocationPlan(batch);
                          } else if (isApproveDestinationAction) {
                            approveDestinationsForBatch(batch);
                          } else if (isApproveDeploymentAction) {
                            approveDeploymentForBatch(batch);
                          } else if (isCreateDeploymentSigningRequestAction) {
                            createDeploymentSigningRequestForBatch(batch);
                          } else if (isExecuteDeploymentAction) {
                            executeDeploymentForBatch(batch);
                          } else {
                            setSelectedBatchId(batch.batchId);
                          }
                        }}
                      >
                        {batch.status === 'exception' ? <AlertTriangle size={14} /> : <ArrowRight size={14} />}
                        {compactPrimaryAction}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedBatch?.sourceBatchId && selectedChain?.key && (
        <BatchLifecycleCard
          chainKey={selectedChain.key}
          sourceBatchId={selectedBatch.sourceBatchId}
        />
      )}

      {selectedBatch ? (
        <BatchDetail
          batch={selectedBatch}
          onVerifyFunding={verifyFundingForBatch}
          onManualConfirmFunding={applyManualFundingConfirmation}
          isVerifyingFunding={verifyingFundingBatchId === selectedBatch.batchId}
          fundingVerificationError={verifyingFundingBatchId === selectedBatch.batchId || selectedBatch.batchId === selectedBatchId ? fundingVerificationError : null}
          onApproveDestinations={approveDestinationsForBatch}
          onApproveDeployment={approveDeploymentForBatch}
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
          onSetCustodyMode={setCustodyModeForBatch}
          signingAuthorityRole={signingAuthorityKey.startsWith(selectedBatch.batchAuthorityBinding?.bindingId ?? '__none__') ? signingAuthorityKey.split(':')[1] : undefined}
          signingAuthorityError={signingAuthorityKey.startsWith(selectedBatch.batchAuthorityBinding?.bindingId ?? '__none__') || !signingAuthorityKey ? signingAuthorityError : null}
          onChainRoleAuthorities={onChainRoleAuthorities}
          onRoleAuthoritiesInitialized={() => setRoleAuthoritiesRefreshTick((t) => t + 1)}
          signerServicesConfigured={{
            treasury: isSignerServiceConfigured(signerServiceConfig, 'treasury'),
            escrow: isSignerServiceConfigured(signerServiceConfig, 'escrow'),
          }}
          onRequestAaaAllocation={() => setAllocationRequestError('AAA allocation is now handled server-side by the lifecycle controller (Phase 5). Use the BatchLifecycleCard advance button.')}
          isRequestingAllocation={requestingAllocationBatchId === selectedBatch.batchId}
          allocationRequestError={requestingAllocationBatchId === selectedBatch.batchId || requestingAllocationBatchId === '' ? allocationRequestError : null}
          onRecoverAllocationPlan={onRecoverAllocationPlan}
          isRecoveringPlan={recoveringPlanBatchId === selectedBatch.batchId}
          planRecoveryError={recoveringPlanBatchId === selectedBatch.batchId || recoveringPlanBatchId === '' ? planRecoveryError : null}
          isApprovingDeployment={approvingDeploymentBatchId === selectedBatch.batchId}
          deploymentApprovalError={approvingDeploymentBatchId === selectedBatch.batchId || approvingDeploymentBatchId === '' ? deploymentApprovalError : null}
          isExecutingDeployment={executingDeploymentBatchId === selectedBatch.batchId}
          deploymentExecutionError={executingDeploymentBatchId === selectedBatch.batchId || executingDeploymentBatchId === '' ? deploymentExecutionError : null}
        />
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
