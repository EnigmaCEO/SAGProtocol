import {
  EscrowAuthorityRole,
  EscrowBatch,
  EscrowSigningApproval,
  EscrowSigningRequest,
  EscrowSigningRequestActionType,
  EscrowSigningRequestPath,
} from '../../lib/escrow/batches';
import { getSigningAuthorityByRole } from './escrowSigningAuthorities';

export type {
  EscrowSigningApproval,
  EscrowSigningApprovalStatus,
  EscrowSigningRequest,
  EscrowSigningRequestActionType,
  EscrowSigningRequestPath,
  EscrowSigningRequestStatus,
} from '../../lib/escrow/batches';

export const REQUIRED_SIGNING_APPROVAL_COUNT = 2;
export const NORMAL_SIGNING_PATH_LABEL = 'Treasury + Escrow';
export const CRISIS_SIGNING_PATH_LABEL = 'Crisis path available for incident mode';

function distinctApprovedRoles(request: EscrowSigningRequest) {
  return new Set(
    request.approvals
      .filter((approval) => approval.approvalStatus === 'approved')
      .map((approval) => approval.authorityRole)
  );
}

function signingRequestAuditEvent(
  batch: EscrowBatch,
  eventId: string,
  timestamp: string,
  actor: string,
  eventType: string,
  description: string,
  reference: string
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

export function getLatestSigningRequest(batch: EscrowBatch) {
  return [...(batch.signingRequests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function getSigningApprovalProgress(request?: EscrowSigningRequest | null) {
  if (!request) {
    return {
      approvedCount: 0,
      requiredApprovalCount: REQUIRED_SIGNING_APPROVAL_COUNT,
      label: `0 of ${REQUIRED_SIGNING_APPROVAL_COUNT}`,
    };
  }

  const approvedCount = distinctApprovedRoles(request).size;
  return {
    approvedCount,
    requiredApprovalCount: request.requiredApprovalCount,
    label: `${approvedCount} of ${request.requiredApprovalCount}`,
  };
}

export function createSigningRequest(params: {
  batch: EscrowBatch;
  actionType: EscrowSigningRequestActionType;
  requestedBy: string;
  requestPath?: EscrowSigningRequestPath;
  createdAt?: string;
  destinationLabel?: string;
  destinationAddress?: string;
}) {
  const createdAt = params.createdAt ?? new Date().toISOString();

  return {
    requestId: `${params.batch.batchId}-${params.actionType}-${createdAt.replace(/[^0-9]/g, '')}`,
    batchId: params.batch.batchId,
    batchWalletAddress: params.batch.wallet.walletAddress ?? params.batch.wallet.address,
    actionType: params.actionType,
    requestedBy: params.requestedBy,
    requestPath: params.requestPath ?? 'normal',
    amountUsd: params.batch.totalAmountUsd,
    destinationLabel: params.destinationLabel,
    destinationAddress: params.destinationAddress,
    allocationPlanHash: params.batch.aaaAllocation.allocationPlanHash,
    policyContextHash: params.batch.aaaAllocation.policyContextHash,
    status: 'proposed',
    approvals: [],
    requiredApprovalCount: REQUIRED_SIGNING_APPROVAL_COUNT,
    createdAt,
  } satisfies EscrowSigningRequest;
}

export function createDeploymentSigningRequest(batch: EscrowBatch, createdAt = new Date().toISOString()) {
  return createSigningRequest({
    batch,
    actionType: 'deploy_batch',
    requestedBy: 'Escrow Service',
    requestPath: 'normal',
    createdAt,
    destinationLabel: 'AAA deployment plan',
  });
}

export function attachSigningRequestToBatch(batch: EscrowBatch, request: EscrowSigningRequest) {
  const auditEvent = signingRequestAuditEvent(
    batch,
    `signing-request-created-${request.requestId}`,
    request.createdAt,
    request.requestedBy,
    'Deployment signing request created',
    `Deployment signing request ${request.requestId} created with ${request.requiredApprovalCount} required approvals.`,
    request.requestId
  );

  return {
    ...batch,
    deploymentApproval: {
      ...batch.deploymentApproval,
      status: 'pending' as const,
    },
    signingRequests: [...(batch.signingRequests ?? []), request],
    auditTrail: [...batch.auditTrail, auditEvent],
  };
}

export function approveSigningRequest(
  batch: EscrowBatch,
  requestId: string,
  authorityRole: EscrowAuthorityRole,
  approvedAt = new Date().toISOString()
) {
  const authority = getSigningAuthorityByRole(authorityRole);
  if (!authority) return batch;

  let approvalAdded = false;
  const signingRequests = (batch.signingRequests ?? []).map((request) => {
    if (request.requestId !== requestId) return request;

    const hasRoleApproval = request.approvals.some(
      (approval) => approval.authorityRole === authorityRole && approval.approvalStatus === 'approved'
    );
    if (hasRoleApproval || ['approved', 'executed', 'rejected', 'expired'].includes(request.status)) {
      return request;
    }

    const approval: EscrowSigningApproval = {
      authorityRole,
      authorityId: authority.authorityId,
      approvedAt,
      approvalStatus: 'approved',
      note: `${authority.displayName} metadata approval recorded. No private key or signature stored.`,
    };
    const approvals = [...request.approvals, approval];
    const approvedRoleCount = new Set(
      approvals
        .filter((item) => item.approvalStatus === 'approved')
        .map((item) => item.authorityRole)
    ).size;

    approvalAdded = true;
    return {
      ...request,
      approvals,
      status:
        approvedRoleCount >= request.requiredApprovalCount
          ? 'approved'
          : 'awaiting_second_approval',
      approvedAt: approvedRoleCount >= request.requiredApprovalCount ? approvedAt : request.approvedAt,
    } satisfies EscrowSigningRequest;
  });

  if (!approvalAdded) return batch;

  const auditEvent = signingRequestAuditEvent(
    batch,
    `signing-request-approved-${requestId}-${authorityRole}`,
    approvedAt,
    authority.displayName,
    'Deployment approval recorded',
    `${authority.displayName} approved signing request ${requestId}.`,
    requestId
  );
  const approvedRequest = signingRequests.find((request) => request.requestId === requestId);

  return {
    ...batch,
    deploymentApproval:
      approvedRequest?.status === 'approved'
        ? {
            status: 'approved' as const,
            approvedBy: '2-of-3 Signing Authorities',
            approvedAt: approvedRequest.approvedAt,
          }
        : batch.deploymentApproval,
    signingRequests,
    auditTrail: [...batch.auditTrail, auditEvent],
  };
}
