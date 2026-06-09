import {
  EscrowBatch,
  EscrowDeploymentApprovalEvidence,
  EscrowDeploymentApprovalPayload,
} from '../../lib/escrow/batches';

// ── DB persistence (banking backend) ─────────────────────────────────────────

const DEPLOYMENT_APPROVALS_API = '/api/banking/escrow/deployment-approvals';

function mapDeploymentApprovalResponse(data: any): EscrowDeploymentApprovalEvidence {
  const record = data?.approval ?? data;
  return {
    approvalId:                 record.approvalId ?? `${record.batchUuid}-deployment-approval`,
    batchId:                    record.batchUuid,
    deploymentApprovalHash:     record.deploymentApprovalHash,
    destinationApprovalHash:    record.destinationApprovalHash,
    allocationPlanHash:         record.allocationPlanHash,
    policyContextHash:          record.policyContextHash,
    destinationRegistryVersion: record.destinationRegistryVersion ?? '',
    approvedBy:                 record.approvedBy,
    approvedAt:                 record.approvedAt,
    status:                     'deployment_approved',
    payload:                    record.payload,
  };
}

export async function saveDeploymentApprovalToDb(evidence: EscrowDeploymentApprovalEvidence): Promise<EscrowDeploymentApprovalEvidence> {
  const res = await fetch(DEPLOYMENT_APPROVALS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batchUuid:                  evidence.batchId,
      approvalId:                 evidence.approvalId,
      deploymentApprovalHash:     evidence.deploymentApprovalHash,
      destinationApprovalHash:    evidence.destinationApprovalHash,
      allocationPlanHash:         evidence.allocationPlanHash,
      policyContextHash:          evidence.policyContextHash,
      destinationRegistryVersion: evidence.destinationRegistryVersion,
      approvedBy:                 evidence.approvedBy,
      approvedAt:                 evidence.approvedAt,
      status:                     evidence.status,
      payload:                    evidence.payload,
    }),
  });
  const parsed = await res.json().catch(() => null);
  if (res.status === 409 && parsed?.existing) {
    return mapDeploymentApprovalResponse(parsed.existing);
  }
  if (!res.ok) {
    throw new Error(parsed?.error || `Deployment approval save failed (${res.status})`);
  }
  return mapDeploymentApprovalResponse(parsed);
}

export async function fetchDeploymentApprovalFromDb(
  batchUuid: string,
): Promise<EscrowDeploymentApprovalEvidence | null> {
  try {
    const res = await fetch(`${DEPLOYMENT_APPROVALS_API}?batchUuid=${encodeURIComponent(batchUuid)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.approval === null || !((data.approval ?? data).deploymentApprovalHash)) return null;
    return mapDeploymentApprovalResponse(data);
  } catch {
    return null;
  }
}
import { canonicalKeccak } from '../../lib/escrow/canonicalHash';
import { isUuid } from '../../lib/escrow/ids';
import {
  areBatchDestinationsApproved,
  getDaoDestinationForLeg,
  getDeploymentLegsForDestinationApproval,
  getDestinationApprovalBlockingReason,
} from './escrowDestinations';
import { canonicalPlanFields } from './escrowAllocation';
import { getAllocationValidationBlockingReason, hasValidatedAaaAllocation } from './escrowAllocationStatus';
import {
  getFundingValidation,
  hasActiveCustody,
  hasValidAuthorityBinding,
  isAuthorityBindingAnchored,
  isFundingGateOpen,
} from './escrowBatchValidation';

function equalHash(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function hasLockedWalletBinding(batch: EscrowBatch) {
  if (batch.custodyMode === 'escrow_contract_custody') return hasActiveCustody(batch);
  return batch.batchWalletBinding?.bindingStatus === 'binding_locked';
}

function hasRequiredAuthoritySignatures(batch: EscrowBatch) {
  const binding = batch.batchAuthorityBinding;
  return Boolean(
    binding &&
    binding.treasurySignature &&
    binding.escrowSignature &&
    binding.treasurySignatureStatus === 'signed' &&
    binding.escrowSignatureStatus === 'signed'
  );
}

function hasDeploymentStarted(batch: EscrowBatch) {
  return (
    (batch.deploymentExecutions ?? []).length > 0 ||
    batch.deploymentLegs.some((leg) => ['executed', 'deployed', 'monitoring', 'settled'].includes(leg.status)) ||
    ['deployed', 'active', 'settlement_pending', 'settled', 'retired'].includes(batch.status)
  );
}

function allocationPayloadHashMatches(batch: EscrowBatch) {
  const plan = batch.aaaAllocation.allocationPlan;
  if (!plan || !batch.aaaAllocation.allocationPlanHash) return false;
  return equalHash(canonicalKeccak(canonicalPlanFields(plan as any)), batch.aaaAllocation.allocationPlanHash);
}

export function getBatchDestinationApprovalHash(batch: EscrowBatch) {
  const approvals = batch.destinationApprovals ?? [];
  const approvedRecords = approvals
    .filter((approval) => approval.approvalStatus === 'approved')
    .slice()
    .sort((a, b) => a.legId.localeCompare(b.legId))
    .map((approval) => ({
      allocationLegId: approval.legId,
      asset: approval.assetSymbol,
      amount: approval.amount,
      weight: approval.weight,
      destinationId: approval.destinationId,
      destinationName: approval.destinationName,
      destinationType: approval.destinationType,
      destinationAddress: approval.destinationAddress,
      destinationChain: approval.chain,
      destinationApprovalHash: approval.destinationApprovalHash,
      destinationRegistryVersion: approval.destinationRegistryVersion,
    }));

  if (approvedRecords.length === 0 && !areBatchDestinationsApproved(batch)) return '';

  const records = approvedRecords.length > 0
    ? approvedRecords
    : getDeploymentLegsForDestinationApproval(batch)
        .slice()
        .sort((a, b) => a.legId.localeCompare(b.legId))
        .map((leg) => {
          const approval = approvals.find((item) => item.legId === leg.legId);
          const destination = getDaoDestinationForLeg(batch, leg);
          return {
            allocationLegId: leg.legId,
            asset: approval?.assetSymbol ?? leg.assetSymbol ?? leg.asset ?? batch.asset ?? 'USDC',
            amount: approval?.amount ?? Number((leg.amount ?? leg.amountUsd).toFixed(6)),
            weight: approval?.weight ?? Number((leg.weight ?? leg.allocationPercent / 100).toFixed(12)),
            destinationId: approval?.destinationId ?? leg.destinationId ?? '',
            destinationName: approval?.destinationName ?? leg.destinationName ?? destination?.label ?? '',
            destinationType: approval?.destinationType ?? leg.destinationType ?? destination?.providerType ?? '',
            destinationAddress: approval?.destinationAddress ?? leg.destinationAddress ?? '',
            destinationChain: approval?.chain ?? batch.wallet.chain,
            destinationApprovalHash: approval?.destinationApprovalHash ?? '',
            destinationRegistryVersion: approval?.destinationRegistryVersion ?? leg.destinationRegistryVersion ?? '',
          };
        });

  if (records.length === 0) return '';

  return canonicalKeccak({
    type: 'sagitta_destination_approval_set_v1',
    batchUuid: batch.batchId,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    destinationRegistryVersion: records[0]?.destinationRegistryVersion ?? '',
    deploymentLegs: records,
  });
}

export function buildDeploymentApprovalPayload(params: {
  batch: EscrowBatch;
  approvedBy: string;
  approvedAt: string;
}): EscrowDeploymentApprovalPayload {
  const { batch, approvedBy, approvedAt } = params;
  if (!batch.sourceBatchId) {
    throw new Error(
      `buildDeploymentApprovalPayload: sourceBatchId is required but missing (batchId=${batch.batchId}). ` +
      'Deployment approval must not be built without a confirmed on-chain source batch ID.'
    );
  }
  const destinationApprovalHash = getBatchDestinationApprovalHash(batch);
  const approvals = batch.destinationApprovals ?? [];
  const legs = getDeploymentLegsForDestinationApproval(batch)
    .slice()
    .sort((a, b) => a.legId.localeCompare(b.legId))
    .map((leg) => {
      const approval = approvals.find((item) => item.legId === leg.legId);
      const destination = getDaoDestinationForLeg(batch, leg);
      return {
        asset: approval?.assetSymbol ?? leg.assetSymbol ?? leg.asset ?? batch.asset ?? 'USDC',
        amount: approval?.amount ?? Number((leg.amount ?? leg.amountUsd).toFixed(6)),
        weight: approval?.weight ?? Number((leg.weight ?? leg.allocationPercent / 100).toFixed(12)),
        approvedDestinationId: approval?.destinationId ?? leg.destinationId ?? '',
        destinationAddress: approval?.destinationAddress ?? leg.destinationAddress ?? '',
        destinationType: approval?.destinationType ?? leg.destinationType ?? destination?.providerType ?? '',
        destinationChain: approval?.chain ?? batch.wallet.chain,
        allocationLegId: leg.legId,
      };
    });

  return {
    batchUuid: batch.batchId,
    batchWalletAddress: batch.wallet.walletAddress ?? batch.wallet.address,
    treasuryBatchId: batch.sourceBatchId,
    escrowBatchId: batch.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? batch.batchId,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    destinationApprovalHash,
    destinationRegistryVersion: approvals[0]?.destinationRegistryVersion ?? getDeploymentLegsForDestinationApproval(batch)[0]?.destinationRegistryVersion ?? '',
    deploymentLegs: legs,
    targetChainId: batch.wallet.chain,
    approvedBy,
    approvedAt,
    deploymentApprovalStatus: 'deployment_approved',
  };
}

export function getDeploymentApprovalBlockingReason(batch: EscrowBatch): string | null {
  if (!isUuid(batch.batchId)) return 'Batch UUID is missing or invalid.';
  if (batch.deploymentApproval.status === 'approved' && batch.deploymentApproval.deploymentApprovalHash) {
    return 'Deployment approval already exists for this batch UUID.';
  }
  if (batch.status === 'exception' || batch.status === 'disputed') return 'Incident, dispute, or SCE block is active.';
  if (hasDeploymentStarted(batch)) return 'Batch is already deployed or deployment execution has started.';
  if (!hasActiveCustody(batch)) return 'Batch custody is not active.';
  if (!isFundingGateOpen(batch)) return 'Wallet binding or authority gate is not locked.';
  if (!hasLockedWalletBinding(batch)) return 'Wallet binding is not locked.';
  if (getFundingValidation(batch).state !== 'verified') return 'Funding is not verified.';
  if (!hasValidAuthorityBinding(batch)) return 'Authority binding is invalid.';
  if (!hasRequiredAuthoritySignatures(batch)) return 'Treasury and Escrow signatures are both required.';
  if (!isAuthorityBindingAnchored(batch)) return 'Authority binding is not anchored.';
  if (!hasValidatedAaaAllocation(batch)) {
    return getAllocationValidationBlockingReason(batch) ?? 'AAA allocation is missing.';
  }
  if (!batch.aaaAllocation.allocationPlanHash) return 'Allocation plan hash is missing.';
  if (!batch.aaaAllocation.policyContextHash) return 'Policy context hash is missing.';
  if (!allocationPayloadHashMatches(batch)) return 'Recomputed allocation JSON hash does not match the stored allocation plan hash.';
  if (!areBatchDestinationsApproved(batch)) {
    return getDestinationApprovalBlockingReason(batch) ?? 'Destination approval is missing.';
  }

  const destinationApprovalHash = getBatchDestinationApprovalHash(batch);
  if (!destinationApprovalHash) return 'Destination approval hash is missing.';

  const approvals = batch.destinationApprovals ?? [];
  if (approvals.some((approval) => !approval.destinationRegistryVersion)) return 'Destination registry version is missing.';
  if (approvals.some((approval) => !approval.destinationApprovalHash)) return 'A destination approval hash is missing.';

  return null;
}

export function canApproveDeployment(batch: EscrowBatch) {
  return getDeploymentApprovalBlockingReason(batch) === null;
}

export function hasDeploymentApproval(batch: EscrowBatch) {
  if (batch.deploymentApproval.status !== 'approved') return false;
  if (!batch.deploymentApproval.deploymentApprovalHash || !batch.deploymentApproval.destinationApprovalHash) return false;
  const currentDestinationApprovalHash = getBatchDestinationApprovalHash(batch);
  return equalHash(currentDestinationApprovalHash, batch.deploymentApproval.destinationApprovalHash);
}

export function getExistingDeploymentApprovalMismatch(batch: EscrowBatch) {
  if (batch.deploymentApproval.status !== 'approved') return null;
  // If destination approvals haven't been (re-)populated yet (e.g. page reload), skip mismatch
  // check — it would produce a false positive since getBatchDestinationApprovalHash returns ''.
  if ((batch.destinationApprovals ?? []).length === 0) return null;
  const currentDestinationApprovalHash = getBatchDestinationApprovalHash(batch);
  if (!equalHash(currentDestinationApprovalHash, batch.deploymentApproval.destinationApprovalHash)) {
    return 'Destination approval hash has changed since deployment approval.';
  }
  if (!equalHash(batch.aaaAllocation.allocationPlanHash, batch.deploymentApproval.allocationPlanHash)) {
    return 'Allocation plan hash has changed since deployment approval.';
  }
  if (!equalHash(batch.aaaAllocation.policyContextHash, batch.deploymentApproval.policyContextHash)) {
    return 'Policy context hash has changed since deployment approval.';
  }
  return null;
}

export function createDeploymentApprovalEvidence(params: {
  batch: EscrowBatch;
  approvedBy?: string;
  approvedAt?: string;
}): EscrowDeploymentApprovalEvidence {
  const approvedBy = params.approvedBy ?? 'Escrow Operator';
  const approvedAt = params.approvedAt ?? new Date().toISOString();
  const payload = buildDeploymentApprovalPayload({ batch: params.batch, approvedBy, approvedAt });
  const deploymentApprovalHash = canonicalKeccak(payload);

  return {
    approvalId: `${params.batch.batchId}-deployment-approval`,
    batchId: params.batch.batchId,
    deploymentApprovalHash,
    destinationApprovalHash: payload.destinationApprovalHash,
    allocationPlanHash: payload.allocationPlanHash,
    policyContextHash: payload.policyContextHash,
    destinationRegistryVersion: payload.destinationRegistryVersion,
    approvedBy,
    approvedAt,
    status: 'deployment_approved',
    payload,
  };
}

export function approveDeployment(batch: EscrowBatch, approvedBy = 'Escrow Operator', approvedAt = new Date().toISOString()) {
  if (!canApproveDeployment(batch)) return batch;

  const evidence = createDeploymentApprovalEvidence({ batch, approvedBy, approvedAt });
  const eventId = `${batch.batchId}-deployment-approved`;
  const hasEvent = batch.auditTrail.some((event) => event.eventId === eventId);

  return {
    ...batch,
    status: 'deployment_pending' as const,
    deploymentApproval: {
      status: 'approved' as const,
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
    deploymentLegs: batch.deploymentLegs.map((leg) =>
      leg.status === 'planned' ? { ...leg, status: 'approved' as const } : leg
    ),
    auditTrail: hasEvent
      ? batch.auditTrail
      : [
          ...batch.auditTrail,
          {
            eventId,
            timestamp: evidence.approvedAt,
            actor: evidence.approvedBy,
            eventType: 'deployment_approved',
            description: `Deployment approved for batch UUID ${batch.batchId}.`,
            reference: evidence.deploymentApprovalHash,
          },
        ],
  } satisfies EscrowBatch;
}
