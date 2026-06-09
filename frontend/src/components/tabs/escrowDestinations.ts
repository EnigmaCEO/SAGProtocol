import {
  EscrowBatch,
  EscrowBatchDestinationApproval,
  EscrowDaoDestination,
} from '../../lib/escrow/batches';
import { canonicalKeccak } from '../../lib/escrow/canonicalHash';
import { getAllocationValidationBlockingReason, hasValidatedAaaAllocation } from './escrowAllocationStatus';

export type {
  EscrowBatchDestinationApproval,
  EscrowDaoDestination,
  EscrowDestinationApprovalStatus,
} from '../../lib/escrow/batches';

export const DAO_DESTINATION_REGISTRY_VERSION = process.env.NEXT_PUBLIC_DAO_DESTINATION_REGISTRY_VERSION ?? 'dao-destination-registry-v1';

// DAO-approved destination addresses are configured via environment variables.
// Set these to the real on-chain contract addresses for the target network.
const LIQUIDITY_DESTINATION_ADDRESS = process.env.NEXT_PUBLIC_DAO_DESTINATION_LIQUIDITY_ADDRESS ?? '';
const STAKING_DESTINATION_ADDRESS = process.env.NEXT_PUBLIC_DAO_DESTINATION_STAKING_ADDRESS ?? '';
const MANUAL_DESTINATION_ADDRESS = process.env.NEXT_PUBLIC_DAO_DESTINATION_MANUAL_ADDRESS ?? '';

export const DAO_DESTINATION_REGISTRY: EscrowDaoDestination[] = [
  {
    destinationId: 'dao-dest-arc-usdc-liquidity',
    destinationAddress: LIQUIDITY_DESTINATION_ADDRESS,
    label: 'Arc USDC Liquidity Sleeve',
    chain: 'arc_testnet',
    asset: 'USDC',
    providerType: 'liquidity',
    riskTier: 'low',
    allowedActions: ['deploy_batch', 'settle_batch'],
    maxExposureUsd: 100_000_000,
    approvalStatus: LIQUIDITY_DESTINATION_ADDRESS ? 'dao_approved' : 'dao_pending',
    destinationRegistryVersion: DAO_DESTINATION_REGISTRY_VERSION,
  },
  {
    destinationId: 'dao-dest-arc-usdc-staking',
    destinationAddress: STAKING_DESTINATION_ADDRESS,
    label: 'Arc USDC Staking Route',
    chain: 'arc_testnet',
    asset: 'USDC',
    providerType: 'staking',
    riskTier: 'medium',
    allowedActions: ['deploy_batch', 'settle_batch'],
    maxExposureUsd: 50_000_000,
    approvalStatus: STAKING_DESTINATION_ADDRESS ? 'dao_approved' : 'dao_pending',
    destinationRegistryVersion: DAO_DESTINATION_REGISTRY_VERSION,
  },
  {
    destinationId: 'dao-dest-arc-usdc-manual-review',
    destinationAddress: MANUAL_DESTINATION_ADDRESS,
    label: 'Manual Review Destination',
    chain: 'arc_testnet',
    asset: 'USDC',
    providerType: 'manual',
    riskTier: 'high',
    allowedActions: ['deploy_batch'],
    maxExposureUsd: 5_000_000,
    approvalStatus: MANUAL_DESTINATION_ADDRESS ? 'dao_approved' : 'dao_pending',
    destinationRegistryVersion: DAO_DESTINATION_REGISTRY_VERSION,
  },
];

function makeAuditEvent(
  batch: EscrowBatch,
  eventId: string,
  timestamp: string,
  actor: string,
  eventType: string,
  description: string,
  reference?: string
): EscrowBatch['auditTrail'][number] {
  return {
    eventId: `${batch.batchId}-${eventId}`,
    timestamp,
    actor,
    eventType,
    description,
    reference,
  };
}

function pushAuditEventOnce(
  auditTrail: EscrowBatch['auditTrail'],
  event: EscrowBatch['auditTrail'][number],
) {
  if (auditTrail.some((existing) => existing.eventId === event.eventId)) return;
  auditTrail.push(event);
}

export function getDeploymentLegsForDestinationApproval(batch: EscrowBatch): EscrowBatch['deploymentLegs'] {
  const allocationHash = batch.aaaAllocation.allocationPlanHash.toLowerCase();
  return batch.deploymentLegs.filter((leg) =>
    !leg.aaaAllocationHash
    || !allocationHash
    || leg.aaaAllocationHash.toLowerCase() === allocationHash
  );
}

function providerTypeForLeg(leg: EscrowBatch['deploymentLegs'][number]): EscrowDaoDestination['providerType'] {
  if (typeof leg.destinationTypeId === 'number') {
    switch (leg.destinationTypeId) {
      case 0:
        return 'liquidity';
      case 1:
        return 'staking';
      case 2:
        return leg.strategyType === 'private_credit' ? 'private_credit' : 'manual';
      case 3:
        return leg.strategyType === 'stabilizer' ? 'stabilizer' : 'manual';
      default:
        break;
    }
  }
  if (leg.strategyType === 'staking') return 'staking';
  if (leg.strategyType === 'private_credit') return 'private_credit';
  if (leg.strategyType === 'stabilizer') return 'stabilizer';
  if (leg.strategyType === 'liquidity') return 'liquidity';
  if (leg.provider === 'liquidity') return 'liquidity';
  if (leg.provider === 'manual') return 'manual';
  return 'manual';
}

export function getDaoDestinationForLeg(batch: EscrowBatch, leg: EscrowBatch['deploymentLegs'][number]) {
  const chain = batch.wallet.chain || 'arc_testnet';
  const asset = leg.assetSymbol || leg.asset || batch.asset || 'USDC';
  const providerType = providerTypeForLeg(leg);

  if (leg.destinationId && leg.destinationName) {
    return {
      destinationId: leg.destinationId,
      destinationAddress: leg.destinationAddress ?? '',
      label: leg.destinationName,
      chain,
      asset,
      providerType,
      riskTier: 'medium' as const,
      allowedActions: ['deploy_batch', 'settle_batch'] as const,
      maxExposureUsd: Number.MAX_SAFE_INTEGER,
      approvalStatus: 'dao_approved' as const,
      destinationRegistryVersion: leg.destinationRegistryVersion ?? DAO_DESTINATION_REGISTRY_VERSION,
    } satisfies EscrowDaoDestination;
  }

  return DAO_DESTINATION_REGISTRY.find(
    (destination) =>
      destination.chain === chain &&
      destination.asset === asset &&
      destination.providerType === providerType
  );
}

export function validateDestinationForLeg(
  batch: EscrowBatch,
  leg: EscrowBatch['deploymentLegs'][number],
  destination?: EscrowDaoDestination
) {
  if (!hasValidatedAaaAllocation(batch)) {
    return getAllocationValidationBlockingReason(batch) ?? 'AAA allocation must be validated before destination approval.';
  }
  if (!destination) return 'No DAO destination is registered for this deployment leg.';
  if (destination.approvalStatus !== 'dao_approved') return 'Destination is not DAO-approved.';
  if (!destination.destinationRegistryVersion) return 'Destination registry version is missing.';
  if (!destination.allowedActions.includes('deploy_batch')) return 'Destination is not approved for deployment actions.';
  if (destination.chain !== batch.wallet.chain) return 'Destination chain does not match the batch wallet chain.';
  if (destination.asset !== (leg.assetSymbol || leg.asset || batch.asset || 'USDC')) return 'Destination asset does not match the allocation leg.';
  if (leg.amountUsd > destination.maxExposureUsd) return 'Allocation amount exceeds DAO max exposure for this destination.';
  if (leg.destinationTypeId !== 0 && !destination.destinationAddress) return 'Destination address is required for this destination type.';
  if (!batch.aaaAllocation.allocationPlanHash || !batch.aaaAllocation.policyContextHash) return 'Allocation plan hash and policy context hash are required.';
  return null;
}

function buildDestinationApprovalPayload(
  batch: EscrowBatch,
  leg: EscrowBatch['deploymentLegs'][number],
  destination: EscrowDaoDestination,
) {
  return {
    sourceBatchId: String(leg.sourceBatchId ?? batch.sourceBatchId ?? batch.treasuryHandoff.handoffId ?? ''),
    escrowBatchId: String(leg.escrowBatchId ?? batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId),
    walletAddress: String(leg.walletAddress ?? batch.wallet.walletAddress ?? batch.wallet.address ?? ''),
    assetSymbol: String(leg.assetSymbol ?? leg.asset ?? batch.asset ?? 'USDC'),
    amount: Number((leg.amount ?? leg.amountUsd).toFixed(6)),
    weight: Number((leg.weight ?? leg.allocationPercent / 100).toFixed(12)),
    destinationId: destination.destinationId,
    destinationName: destination.label,
    destinationType: String(leg.destinationType ?? destination.providerType),
    destinationAddress: String(destination.destinationAddress ?? leg.destinationAddress ?? ''),
    aaaAllocationHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
  };
}

function approvedDestinationMatchesLeg(
  batch: EscrowBatch,
  leg: EscrowBatch['deploymentLegs'][number],
  destination: EscrowDaoDestination,
  approval: EscrowBatchDestinationApproval | undefined,
) {
  if (!approval || approval.approvalStatus !== 'approved') return false;
  const payload = buildDestinationApprovalPayload(batch, leg, destination);
  return (
    approval.sourceBatchId === payload.sourceBatchId &&
    approval.escrowBatchId === payload.escrowBatchId &&
    approval.walletAddress === payload.walletAddress &&
    approval.assetSymbol === payload.assetSymbol &&
    approval.amount === payload.amount &&
    approval.weight === payload.weight &&
    approval.destinationId === payload.destinationId &&
    approval.destinationName === payload.destinationName &&
    approval.destinationType === payload.destinationType &&
    approval.destinationAddress === payload.destinationAddress &&
    approval.aaaAllocationHash === payload.aaaAllocationHash &&
    approval.policyContextHash === payload.policyContextHash &&
    approval.destinationApprovalHash === canonicalKeccak(payload)
  );
}

function createDestinationApproval(
  batch: EscrowBatch,
  leg: EscrowBatch['deploymentLegs'][number],
  destination: EscrowDaoDestination,
  reviewedAt: string
) {
  const payload = buildDestinationApprovalPayload(batch, leg, destination);
  return {
    approvalId: `${batch.batchId}-${leg.legId}-destination-approval`,
    batchId: batch.batchId,
    legId: leg.legId,
    sourceBatchId: payload.sourceBatchId,
    escrowBatchId: payload.escrowBatchId,
    walletAddress: payload.walletAddress,
    assetSymbol: payload.assetSymbol,
    amount: payload.amount,
    weight: payload.weight,
    destinationId: payload.destinationId,
    destinationName: payload.destinationName,
    destinationType: payload.destinationType,
    destinationAddress: payload.destinationAddress,
    aaaAllocationHash: payload.aaaAllocationHash,
    amountUsd: payload.amount,
    asset: payload.assetSymbol,
    chain: destination.chain,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    destinationRegistryVersion: destination.destinationRegistryVersion,
    destinationApprovalHash: canonicalKeccak(payload),
    approvalStatus: 'approved',
    reviewedBy: 'Escrow Operator',
    reviewedAt,
    approvedBy: 'Escrow Operator',
    approvedAt: reviewedAt,
  } satisfies EscrowBatchDestinationApproval;
}

export function getDestinationApprovalProgress(batch: EscrowBatch) {
  const legs = getDeploymentLegsForDestinationApproval(batch);
  const approvals = batch.destinationApprovals ?? [];
  const approvedCount = legs.filter((leg) =>
    approvals.some((approval) => {
      if (approval.legId !== leg.legId) return false;
      const destination = getDaoDestinationForLeg(batch, leg);
      return Boolean(
        destination &&
        isApprovalBoundToValidatedAllocation(batch, approval) &&
        approvedDestinationMatchesLeg(batch, leg, destination, approval)
      );
    })
  ).length;

  return {
    requiredCount: legs.length,
    approvedCount,
    label: `${approvedCount} of ${legs.length}`,
  };
}

function isApprovalBoundToValidatedAllocation(
  batch: EscrowBatch,
  approval: EscrowBatchDestinationApproval,
): boolean {
  if (!hasValidatedAaaAllocation(batch)) return false;
  if (!approval.approvedAt) return false;
  if (!approval.approvalStatus || approval.approvalStatus !== 'approved') return false;
  if (!approval.destinationApprovalHash) return false;
  if (!approval.allocationPlanHash || approval.allocationPlanHash.toLowerCase() !== batch.aaaAllocation.allocationPlanHash.toLowerCase()) return false;
  if (!approval.policyContextHash || approval.policyContextHash.toLowerCase() !== batch.aaaAllocation.policyContextHash.toLowerCase()) return false;
  // Temporal check: approval must not predate the on-chain attachment.
  // When attachedAt is unavailable (not persisted across reloads), the hash
  // checks above already bind the approval to the validated allocation.
  const attachedAt = batch.aaaAllocation.attachedAt;
  if (attachedAt && new Date(approval.approvedAt).getTime() < new Date(attachedAt).getTime()) return false;
  return true;
}

export function areBatchDestinationsApproved(batch: EscrowBatch) {
  if (!hasValidatedAaaAllocation(batch)) return false;
  const legs = getDeploymentLegsForDestinationApproval(batch);
  if (legs.length === 0) return false;

  return legs.every((leg) => {
    const approval = (batch.destinationApprovals ?? []).find((item) => item.legId === leg.legId);
    const destination = getDaoDestinationForLeg(batch, leg);
    return (
      Boolean(approval && isApprovalBoundToValidatedAllocation(batch, approval)) &&
      Boolean(approval?.destinationRegistryVersion) &&
      Boolean(destination?.approvalStatus === 'dao_approved') &&
      Boolean(destination && approvedDestinationMatchesLeg(batch, leg, destination, approval))
    );
  });
}

export function getDestinationApprovalBlockingReason(batch: EscrowBatch) {
  const allocationBlockingReason = getAllocationValidationBlockingReason(batch);
  if (allocationBlockingReason) return allocationBlockingReason;
  const progress = getDestinationApprovalProgress(batch);
  if (progress.requiredCount === 0) return 'No deployment destinations are available for approval.';
  if (areBatchDestinationsApproved(batch)) return null;

  for (const leg of getDeploymentLegsForDestinationApproval(batch)) {
    const approval = (batch.destinationApprovals ?? []).find((item) => item.legId === leg.legId);
    if (!approval) return 'Destination approval is missing.';
    if (!isApprovalBoundToValidatedAllocation(batch, approval)) {
      return 'Destination approval was not created from the validated on-chain allocation.';
    }
    if (!approval.destinationApprovalHash) return 'Destination approval hash is missing.';
    if (approval.approvalStatus !== 'approved') return approval.rejectionReason || 'Destination approval is not approved.';
    if (!approval.destinationRegistryVersion) return 'Destination registry version is missing.';
    const destination = getDaoDestinationForLeg(batch, leg);
    if (!destination) return 'Destination is not DAO-whitelisted.';
    if (destination?.approvalStatus !== 'dao_approved') return 'Destination is not DAO-whitelisted.';
    if (!approvedDestinationMatchesLeg(batch, leg, destination, approval)) {
      return 'Destination approval no longer matches the generated deployment leg.';
    }
  }

  return 'Destination approval is incomplete.';
}

export function approveBatchDestinations(batch: EscrowBatch, reviewedAt = new Date().toISOString()) {
  if (!hasValidatedAaaAllocation(batch)) return batch;
  const legs = getDeploymentLegsForDestinationApproval(batch);
  const existingByLeg = new Map((batch.destinationApprovals ?? []).map((approval) => [approval.legId, approval]));
  const approvals: EscrowBatchDestinationApproval[] = [];
  const auditTrail = [...batch.auditTrail];

  for (const leg of legs) {
    const destination = getDaoDestinationForLeg(batch, leg);
    const blockingReason = validateDestinationForLeg(batch, leg, destination);
    const reviewedEvent = makeAuditEvent(
      batch,
      `destination-reviewed-${leg.legId}`,
      reviewedAt,
      'Escrow Operator',
      'Destination reviewed',
      `Destination reviewed for leg ${leg.legId}.`,
      destination?.destinationId
    );

    if (blockingReason || !destination) {
      const existing = existingByLeg.get(leg.legId);
      if (
        existing &&
        existing.approvalStatus === 'rejected' &&
        existing.rejectionReason === (blockingReason || 'Destination is not DAO-whitelisted.')
      ) {
        approvals.push(existing);
        continue;
      }
      pushAuditEventOnce(auditTrail, reviewedEvent);
      const rejectedApproval = {
        approvalId: `${batch.batchId}-${leg.legId}-destination-approval`,
        batchId: batch.batchId,
        legId: leg.legId,
        sourceBatchId: String(leg.sourceBatchId ?? batch.sourceBatchId ?? batch.treasuryHandoff.handoffId ?? ''),
        escrowBatchId: String(leg.escrowBatchId ?? batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId),
        walletAddress: String(leg.walletAddress ?? batch.wallet.walletAddress ?? batch.wallet.address ?? ''),
        assetSymbol: String(leg.assetSymbol ?? leg.asset ?? batch.asset ?? 'USDC'),
        amount: Number((leg.amount ?? leg.amountUsd).toFixed(6)),
        weight: Number((leg.weight ?? leg.allocationPercent / 100).toFixed(12)),
        destinationId: destination?.destinationId ?? 'unregistered',
        destinationName: destination?.label ?? leg.destinationName ?? '',
        destinationType: String(leg.destinationType ?? destination?.providerType ?? ''),
        destinationAddress: destination?.destinationAddress ?? '',
        aaaAllocationHash: batch.aaaAllocation.allocationPlanHash,
        amountUsd: Number((leg.amount ?? leg.amountUsd).toFixed(6)),
        asset: String(leg.assetSymbol ?? leg.asset ?? batch.asset ?? 'USDC'),
        chain: batch.wallet.chain,
        allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
        policyContextHash: batch.aaaAllocation.policyContextHash,
        destinationRegistryVersion: destination?.destinationRegistryVersion ?? '',
        destinationApprovalHash: '',
        approvalStatus: 'rejected',
        reviewedBy: 'Escrow Operator',
        reviewedAt,
        rejectionReason: blockingReason || 'Destination is not DAO-whitelisted.',
      } satisfies EscrowBatchDestinationApproval;
      approvals.push(rejectedApproval);
      pushAuditEventOnce(
        auditTrail,
        makeAuditEvent(
          batch,
          `destination-rejected-${leg.legId}`,
          reviewedAt,
          'Escrow Operator',
          'Destination rejected',
          rejectedApproval.rejectionReason || 'Destination approval failed.',
          rejectedApproval.destinationId
        )
      );
      continue;
    }

    const existing = existingByLeg.get(leg.legId);
    if (approvedDestinationMatchesLeg(batch, leg, destination, existing)) {
      approvals.push(existing!);
      continue;
    }

    pushAuditEventOnce(auditTrail, reviewedEvent);
    const approval = createDestinationApproval(batch, leg, destination, reviewedAt);
    approvals.push(approval);
    pushAuditEventOnce(
      auditTrail,
      makeAuditEvent(
        batch,
        `destination-approved-${leg.legId}`,
        reviewedAt,
        'Escrow Operator',
        'Destination approved',
        `${destination.label} approved for batch ${batch.batchId}.`,
        approval.destinationApprovalHash
      )
    );
  }

  const nextByLeg = new Map([...existingByLeg, ...approvals.map((approval) => [approval.legId, approval] as const)]);

  const nextApprovals = Array.from(nextByLeg.values());
  const nextBatch = {
    ...batch,
    destinationApprovals: nextApprovals,
    auditTrail,
  } satisfies EscrowBatch;

  return areBatchDestinationsApproved(nextBatch)
    ? { ...nextBatch, status: 'deployment_pending' as const }
    : nextBatch;
}
