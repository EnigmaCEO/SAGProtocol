import { EscrowBatch } from '../../lib/escrow/batches';
import { areBatchDestinationsApproved } from './escrowDestinations';
import { getAllocationValidationBlockingReason, hasValidatedAaaAllocation } from './escrowAllocationStatus';

export type {
  EscrowDeploymentExecution,
  EscrowDeploymentLegResult,
  EscrowDeploymentStatus,
} from '../../lib/escrow/batches';

function hasManifestMismatch(batch: EscrowBatch) {
  const computedTotal = batch.deposits.reduce((sum, deposit) => sum + deposit.amountUsd, 0);
  return computedTotal !== batch.totalAmountUsd;
}

function hasVerifiedFunding(batch: EscrowBatch) {
  const latestConfirmation = [...(batch.fundingConfirmations ?? [])].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0];
  if (latestConfirmation?.fundingStatus === 'verified') return true;
  if (latestConfirmation?.fundingStatus === 'mismatch') return false;

  const custodyVerified = batch.custodyMode === 'batch_wallet_custody'
    ? batch.wallet.fundingStatus === 'verified'
    : Boolean(batch.fundingVerifiedAt);

  return (
    batch.batchWalletBinding?.bindingStatus === 'binding_locked' &&
    custodyVerified &&
    batch.observedWalletBalanceUsd === batch.expectedFundingAmountUsd &&
    Boolean(batch.fundingVerifiedAt)
  );
}

function hasDeploymentApproval(batch: EscrowBatch) {
  return Boolean(
    batch.deploymentApproval.status === 'approved' &&
    batch.deploymentApproval.deploymentApprovalHash &&
    batch.deploymentApproval.destinationApprovalHash
  );
}

function isExecutedLegStatus(status: EscrowBatch['deploymentLegs'][number]['status']) {
  return ['executed', 'deployed', 'monitoring', 'settled'].includes(status);
}

function hasRemainingDeploymentLegs(batch: EscrowBatch) {
  if (batch.deploymentLegs.some((leg) => !isExecutedLegStatus(leg.status))) {
    // deploymentLegs may lag behind on reload (race with applyDeploymentExecutionToBatch).
    // Cross-reference execution records: only treat as fully done if every leg has a
    // matching executed result — not just that the partial results are all executed.
    const latestExecution = getLatestDeploymentExecution(batch);
    if (!latestExecution) return true;
    const allLegsCoveredAndDone = batch.deploymentLegs.every((leg) => {
      const result = latestExecution.deploymentLegResults.find((r) => r.legId === leg.legId);
      return result && isExecutedLegStatus(result.status);
    });
    return !allLegsCoveredAndDone;
  }
  return false;
}

export function getLatestDeploymentExecution(batch: EscrowBatch) {
  return [...(batch.deploymentExecutions ?? [])].sort((a, b) => b.executedAt.localeCompare(a.executedAt))[0];
}

export function getDeploymentExecutionStatus(batch: EscrowBatch) {
  const latestExecution = getLatestDeploymentExecution(batch);
  if (hasDeploymentApproval(batch) && hasRemainingDeploymentLegs(batch)) return 'ready';
  if (latestExecution) return latestExecution.status;
  if (hasDeploymentApproval(batch)) return 'ready';
  return 'not_started';
}

export function getDeploymentExecutionBlockingReason(batch: EscrowBatch) {
  if (batch.status === 'exception') return 'Batch is in exception state.';
  if (hasManifestMismatch(batch)) return 'Deposit manifest mismatch blocks deployment execution.';
  if (batch.deploymentLegs.length > 0 && !hasRemainingDeploymentLegs(batch)) {
    return 'All approved deployment legs have already been executed.';
  }
  if (!hasVerifiedFunding(batch)) return 'Wallet funding has not been verified.';
  if (!hasValidatedAaaAllocation(batch)) {
    return getAllocationValidationBlockingReason(batch) ?? 'AAA allocation has not been validated.';
  }
  if (!areBatchDestinationsApproved(batch)) return 'Destination approval is incomplete.';
  if (!hasDeploymentApproval(batch)) return 'Deployment approval is missing.';
  return null;
}

export function canExecuteDeployment(batch: EscrowBatch) {
  return (
    getDeploymentExecutionBlockingReason(batch) === null &&
    ['wallet_funded', 'aaa_plan_attached', 'deployment_pending'].includes(batch.status)
  );
}
