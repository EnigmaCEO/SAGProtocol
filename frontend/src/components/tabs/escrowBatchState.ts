import { EscrowBatch, EscrowBatchStatus } from '../../lib/escrow/batches';
import { areBatchDestinationsApproved, getDestinationApprovalBlockingReason } from './escrowDestinations';
import { getDeploymentExecutionStatus } from './escrowDeployment';
import {
  getFundingValidation,
  getManifestValidation,
  hasActiveCustody,
  isFundingGateOpen,
  isAuthorityBindingAnchored,
} from './escrowBatchValidation';
import { getAllocationValidationBlockingReason, hasValidatedAaaAllocation } from './escrowAllocationStatus';
import { getDeploymentApprovalBlockingReason, hasDeploymentApproval } from './escrowDeploymentApproval';

export type LifecycleStepState = 'complete' | 'current' | 'future' | 'blocked';

export type LifecycleStep = {
  id:
    | 'treasury_handoff'
    | 'wallet_created'
    | 'wallet_funded'
    | 'aaa_attached'
    | 'destinations_approved'
    | 'deployment_approved'
    | 'deployed'
    | 'active'
    | 'settlement'
    | 'retired';
  label: string;
  state: LifecycleStepState;
};

function lifecycleStepsForBatch(batch?: EscrowBatch | null): Omit<LifecycleStep, 'state'>[] {
  const fundingLabel = batch?.custodyMode === 'batch_wallet_custody' ? 'Wallet Funded' : 'Funding Verified';
  const custodyLabel = batch?.custodyMode === 'escrow_contract_custody' ? 'Custody Bound' : 'Wallet Created';
  return [
  { id: 'treasury_handoff', label: 'Treasury Batch' },
  { id: 'wallet_created', label: custodyLabel },
  { id: 'wallet_funded', label: fundingLabel },
  { id: 'aaa_attached', label: 'AAA Attached' },
  { id: 'destinations_approved', label: 'Destinations Approved' },
  { id: 'deployment_approved', label: 'Deployment Approved' },
  { id: 'deployed', label: 'Deployed' },
  { id: 'active', label: 'Active' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'retired', label: 'Retired' },
  ];
}

const LIFECYCLE_STEPS = lifecycleStepsForBatch();

const PRIMARY_ACTION_BY_STATUS: Partial<Record<EscrowBatchStatus, string>> = {
  draft: 'Review Batch',
  treasury_handoff_pending: 'Review Treasury Batch',
  treasury_sent: 'Reconcile Treasury Batch',
  treasury_received: 'Verify Funding',
  handoff_approved: 'Reconcile Treasury Batch',
  wallet_requested: 'Reconcile Treasury Batch',
  wallet_created: 'Verify Funding',
  wallet_funded: 'Request AAA Allocation',
  deployment_pending: 'Deploy Batch',
  deployed: 'Monitor Batch',
  active: 'Monitor Batch',
  settlement_pending: 'Settle Batch',
  settled: 'Retire Wallet',
  disputed: 'Resolve Dispute',
  retired: 'View Archive',
  exception: 'Resolve Exception',
};

const STEP_ORDER = LIFECYCLE_STEPS.map((step) => step.id);

function hasBatch(batch?: EscrowBatch | null): batch is EscrowBatch {
  return Boolean(batch?.status);
}

function hasWallet(batch: EscrowBatch) {
  return batch.wallet.fundingStatus !== 'not_created' && Boolean(batch.wallet.address);
}

function hasVerifiedFunding(batch: EscrowBatch) {
  return getFundingValidation(batch).state === 'verified';
}

function hasLockedBatchWalletBinding(batch: EscrowBatch) {
  return batch.batchWalletBinding?.bindingStatus === 'binding_locked';
}

function hasAaaPlan(batch: EscrowBatch) {
  return hasValidatedAaaAllocation(batch);
}

function hasApprovedDestinations(batch: EscrowBatch) {
  return areBatchDestinationsApproved(batch);
}

function hasDeploymentExecution(batch: EscrowBatch) {
  return getDeploymentExecutionStatus(batch) === 'monitoring' || batch.deploymentLegs.some((leg) => ['deployed', 'monitoring', 'settled'].includes(leg.status));
}

function isFundingVerificationFailure(batch: EscrowBatch) {
  return getFundingValidation(batch).state === 'mismatch';
}

function firstUnmetStep(batch: EscrowBatch): LifecycleStep['id'] {
  if (!batch.treasuryHandoff.approvedByTreasury) return 'treasury_handoff';
  if (!hasActiveCustody(batch)) return 'wallet_created';
  if (!isFundingGateOpen(batch)) return 'wallet_funded';
  if (!hasVerifiedFunding(batch)) return 'wallet_funded';
  if (!hasAaaPlan(batch)) return 'aaa_attached';
  if (!hasApprovedDestinations(batch)) return 'destinations_approved';
  if (!hasDeploymentApproval(batch)) return 'deployment_approved';
  if (!hasDeploymentExecution(batch)) return 'deployed';
  if (!['active', 'settlement_pending', 'settled', 'retired'].includes(batch.status)) return 'active';
  if (!['settled', 'retired'].includes(batch.status) && batch.settlement.status !== 'settled') return 'settlement';
  return 'retired';
}

function currentStep(batch: EscrowBatch): LifecycleStep['id'] {
  if (!batch.treasuryHandoff.approvedByTreasury || ['draft', 'treasury_handoff_pending'].includes(batch.status)) {
    return 'treasury_handoff';
  }

  if (!hasActiveCustody(batch) || ['treasury_sent', 'handoff_approved', 'wallet_requested'].includes(batch.status)) {
    return 'wallet_created';
  }

  if (!isFundingGateOpen(batch) || !hasVerifiedFunding(batch) || batch.status === 'wallet_created') {
    return 'wallet_funded';
  }

  if (!hasAaaPlan(batch)) {
    return 'aaa_attached';
  }

  if (!hasApprovedDestinations(batch)) {
    return 'destinations_approved';
  }

  if (!hasDeploymentApproval(batch)) {
    return 'deployment_approved';
  }

  if (['wallet_funded', 'aaa_plan_attached', 'deployment_pending'].includes(batch.status) || !hasDeploymentExecution(batch)) {
    return 'deployed';
  }

  if (batch.status === 'deployed') {
    return 'deployed';
  }

  if (batch.status === 'active') {
    return 'active';
  }

  if (batch.status === 'settlement_pending') {
    return 'settlement';
  }

  return 'retired';
}

function completedSteps(batch: EscrowBatch) {
  return new Set<LifecycleStep['id']>([
    ...(batch.treasuryHandoff.approvedByTreasury ? (['treasury_handoff'] as const) : []),
    ...(hasActiveCustody(batch) ? (['wallet_created'] as const) : []),
    ...(hasVerifiedFunding(batch) ? (['wallet_funded'] as const) : []),
    ...(hasAaaPlan(batch) ? (['aaa_attached'] as const) : []),
    ...(hasApprovedDestinations(batch) ? (['destinations_approved'] as const) : []),
    ...(hasDeploymentApproval(batch) ? (['deployment_approved'] as const) : []),
    ...(hasDeploymentExecution(batch) || ['active', 'settlement_pending', 'settled', 'retired'].includes(batch.status)
      ? (['deployed'] as const)
      : []),
    ...(['settlement_pending', 'settled', 'retired'].includes(batch.status) ? (['active'] as const) : []),
    ...(['settled', 'retired'].includes(batch.status) || batch.settlement.status === 'settled' ? (['settlement'] as const) : []),
  ]);
}

export function getLifecycleSteps(batch?: EscrowBatch | null): LifecycleStep[] {
  const steps = lifecycleStepsForBatch(batch);
  const stepOrder = steps.map((step) => step.id);
  if (!hasBatch(batch)) {
    return steps.map((step, index) => ({
      ...step,
      state: index === 0 ? 'current' : 'future',
    }));
  }

  if (isFundingVerificationFailure(batch)) {
    return steps.map((step) => ({
      ...step,
      state:
        step.id === 'treasury_handoff'
          ? 'complete'
          : step.id === 'wallet_created' || step.id === 'wallet_funded'
            ? 'blocked'
            : 'future',
    }));
  }

  if (['treasury_sent', 'handoff_approved'].includes(batch.status) && !hasActiveCustody(batch)) {
    return steps.map((step) => ({
      ...step,
      state: step.id === 'treasury_handoff' ? 'complete' : 'future',
    }));
  }

  const complete = completedSteps(batch);
  const current = batch.status === 'exception' ? firstUnmetStep(batch) : currentStep(batch);
  const currentIndex = stepOrder.indexOf(current);

  return steps.map((step, index) => {
    if (batch.status === 'exception' && step.id === current) {
      return { ...step, state: 'blocked' };
    }

    if (step.id === current) {
      return { ...step, state: 'current' };
    }

    if (complete.has(step.id) || index < currentIndex) {
      return { ...step, state: 'complete' };
    }

    return { ...step, state: 'future' };
  });
}

export function getPrimaryAction(batch?: EscrowBatch | null) {
  if (!hasBatch(batch)) return 'Review Batch';
  if (hasActiveCustody(batch) && isFundingGateOpen(batch) && !hasVerifiedFunding(batch)) {
    return 'Verify Funding';
  }

  if (['wallet_funded', 'aaa_plan_attached', 'deployment_pending'].includes(batch.status)) {
    if (!hasAaaPlan(batch)) {
      if (batch.aaaAllocation.status === 'chain_only') return 'Recover Plan Data';
      return batch.aaaAllocation.status === 'computed' ? 'Anchor AAA Allocation' : 'Request AAA Allocation';
    }
    if (!hasApprovedDestinations(batch)) return 'Approve Destination';
    if (!hasDeploymentApproval(batch)) return 'Approve Deployment';
    if (hasDeploymentApproval(batch)) return 'Deploy Batch';
    return 'Prepare Deployment';
  }

  return PRIMARY_ACTION_BY_STATUS[batch.status] ?? 'Review Batch';
}

export function getBatchBlockingReason(batch?: EscrowBatch | null) {
  if (!hasBatch(batch)) return 'Review Batch';

  const manifestValidation = getManifestValidation(batch);
  const fundingValidation = getFundingValidation(batch);

  if (manifestValidation.state === 'mismatch') {
    return `Deposit manifest mismatch. Expected $${manifestValidation.expectedTotalUsd.toLocaleString('en-US')}, computed $${manifestValidation.computedTotalUsd.toLocaleString('en-US')}.`;
  }

  if (isFundingVerificationFailure(batch)) {
    return `Wallet funding verification failed. Expected $${fundingValidation.expectedAmountUsd.toLocaleString('en-US')}, observed $${(fundingValidation.observedAmountUsd ?? 0).toLocaleString('en-US')}.`;
  }

  if (!batch.treasuryHandoff.approvedByTreasury) {
    return 'Treasury batch has not been approved.';
  }

  if (batch.custodyMode === 'escrow_contract_custody') {
    if (!isAuthorityBindingAnchored(batch)) {
      return 'Batch Authority Binding has not been anchored on-chain.';
    }
  } else {
    if (!hasWallet(batch)) {
      return 'Wallet has not been created.';
    }
    if (!hasLockedBatchWalletBinding(batch)) {
      return 'Batch wallet binding has not been locked by Treasury.';
    }
  }

  if (!hasVerifiedFunding(batch)) {
    return batch.custodyMode === 'escrow_contract_custody'
      ? 'Escrow position funding has not been verified.'
      : 'Wallet funding has not been verified.';
  }

  if (!hasAaaPlan(batch)) {
    return getAllocationValidationBlockingReason(batch) ?? 'AAA allocation plan is missing.';
  }

  if (!hasApprovedDestinations(batch)) {
    return getDestinationApprovalBlockingReason(batch) ?? 'Destination approval is incomplete.';
  }

  if (!hasDeploymentApproval(batch)) {
    return getDeploymentApprovalBlockingReason(batch) ?? 'Deployment approval is missing.';
  }

  if (batch.status === 'exception') {
    return 'Batch is in exception state.';
  }

  if (batch.status === 'settlement_pending' && batch.settlement.status === 'not_due') {
    return 'Settlement is not due yet.';
  }

  return null;
}

export function canAdvanceBatch(batch?: EscrowBatch | null) {
  return getBatchBlockingReason(batch) === null;
}
