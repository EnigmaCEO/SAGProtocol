import { EscrowBatch } from '../../lib/escrow/batches';
import {
  getBatchAuthorityBindingValidation,
  isBatchAuthorityBindingValid,
  isBatchAuthorityFullySigned,
  requiresBatchAuthorityBinding,
} from './escrowAuthorityBinding';
import {
  getEscrowAuthority,
  getTreasuryVaultAuthority,
  isRoleSigningAllowed,
} from '../../lib/escrow/roleAuthorityRegistry';
import { areBatchDestinationsApproved } from './escrowDestinations';
import { getDeploymentExecutionStatus } from './escrowDeployment';
import { getExecutedDeploymentOutflowUsd, getLatestFundingConfirmation } from './escrowFunding';
import { hasValidatedAaaAllocation } from './escrowAllocationStatus';

export type ValidationState = 'verified' | 'mismatch' | 'pending';
export type ReadinessRowState = 'passed' | 'pending' | 'blocked' | 'exception';

export type ManifestValidation = {
  state: Extract<ValidationState, 'verified' | 'mismatch'>;
  label: 'Manifest Verified' | 'Manifest Mismatch';
  computedTotalUsd: number;
  expectedTotalUsd: number;
};

export type FundingValidation = {
  state: ValidationState;
  label: 'Funding Verified' | 'Escrow Contract Funding Verified' | 'Funding Mismatch' | 'Funding Pending Verification';
  expectedAmountUsd: number;
  observedAmountUsd?: number;
  verifiedAt?: string;
};

export type ReadinessRow = {
  label: string;
  state: ReadinessRowState;
};

function hasWallet(batch: EscrowBatch) {
  return batch.wallet.fundingStatus !== 'not_created' && Boolean(batch.wallet.address);
}

function hasFundedWallet(batch: EscrowBatch) {
  return ['funded', 'verified'].includes(batch.wallet.fundingStatus);
}

function hasCustodyFundingObserved(batch: EscrowBatch, funding: FundingValidation) {
  if (batch.custodyMode === 'batch_wallet_custody') return hasFundedWallet(batch);
  return funding.state === 'verified';
}

function hasLockedBatchWalletBinding(batch: EscrowBatch) {
  return batch.batchWalletBinding?.bindingStatus === 'binding_locked';
}

function hasContractCustodyBound(batch: EscrowBatch): boolean {
  return Boolean(batch.sourceContract) && Boolean(batch.sourceBatchId);
}

export function hasActiveCustody(batch: EscrowBatch): boolean {
  if (batch.custodyMode === 'escrow_contract_custody') return hasContractCustodyBound(batch);
  return hasWallet(batch);
}

export function isFundingGateOpen(batch: EscrowBatch): boolean {
  if (batch.custodyMode === 'escrow_contract_custody') return isAuthorityBindingAnchored(batch);
  return hasLockedBatchWalletBinding(batch);
}

export function hasValidAuthorityBinding(batch: EscrowBatch) {
  if (!requiresBatchAuthorityBinding(batch)) return true;
  const validation = getBatchAuthorityBindingValidation(batch);
  if (validation.state !== 'valid') return false;
  // A persisted binding_mismatch flag can be stale after local invariant rules change.
  // Both role records must be active for authority binding to be considered valid.
  return (
    isRoleSigningAllowed(getTreasuryVaultAuthority()).allowed &&
    isRoleSigningAllowed(getEscrowAuthority()).allowed
  );
}

export function isAuthorityBindingAnchored(batch: EscrowBatch): boolean {
  if (!requiresBatchAuthorityBinding(batch)) return true;
  return batch.batchAuthorityBinding?.anchorStatus === 'anchored';
}

function hasAaaPlan(batch: EscrowBatch) {
  return hasValidatedAaaAllocation(batch);
}

function hasApprovedDestinations(batch: EscrowBatch) {
  return areBatchDestinationsApproved(batch);
}

function hasDeploymentExecutionReady(batch: EscrowBatch) {
  if (batch.status === 'exception') return false;
  if (getDeploymentExecutionStatus(batch) === 'ready') return true;
  if (batch.deploymentLegs.some((leg) => leg.status === 'approved')) return true;
  if (batch.deploymentLegs.some((leg) => ['deployed', 'monitoring', 'settled'].includes(leg.status))) return true;
  return batch.deploymentLegs.length > 0 && batch.deploymentLegs.every((leg) => leg.status === 'approved');
}

function hasDeploymentApproval(batch: EscrowBatch) {
  return Boolean(
    batch.deploymentApproval.status === 'approved' &&
    batch.deploymentApproval.deploymentApprovalHash &&
    batch.deploymentApproval.destinationApprovalHash
  );
}

function statusFor(value: boolean, pendingWhenFalse = true): ReadinessRowState {
  if (value) return 'passed';
  return pendingWhenFalse ? 'pending' : 'blocked';
}

export function getComputedDepositTotal(batch: EscrowBatch) {
  return batch.deposits.reduce((sum, deposit) => sum + deposit.amountUsd, 0);
}

export function getManifestValidation(batch: EscrowBatch): ManifestValidation {
  const computedTotalUsd = getComputedDepositTotal(batch);
  const isVerified = computedTotalUsd === batch.totalAmountUsd;

  return {
    state: isVerified ? 'verified' : 'mismatch',
    label: isVerified ? 'Manifest Verified' : 'Manifest Mismatch',
    computedTotalUsd,
    expectedTotalUsd: batch.totalAmountUsd,
  };
}

export function getFundingValidation(batch: EscrowBatch): FundingValidation {
  const expectedAmountUsd = batch.expectedFundingAmountUsd;
  const observedAmountUsd = batch.observedWalletBalanceUsd;
  const latestConfirmation = getLatestFundingConfirmation(batch);
  const executedOutflowUsd = getExecutedDeploymentOutflowUsd(batch);
  const reconciledObservedAmountUsd =
    typeof observedAmountUsd === 'number'
      ? Number((observedAmountUsd + executedOutflowUsd).toFixed(6))
      : undefined;

  if (latestConfirmation?.fundingStatus === 'mismatch') {
    return {
      state: 'mismatch',
      label: 'Funding Mismatch',
      expectedAmountUsd,
      observedAmountUsd: latestConfirmation.observedAmountUsd,
      verifiedAt: batch.fundingVerifiedAt,
    };
  }

  if (latestConfirmation?.fundingStatus === 'verified') {
    return {
      state: 'verified',
      label: batch.custodyMode === 'escrow_contract_custody' ? 'Escrow Contract Funding Verified' : 'Funding Verified',
      expectedAmountUsd,
      observedAmountUsd: latestConfirmation.observedAmountUsd,
      verifiedAt: latestConfirmation.verifiedAt ?? batch.fundingVerifiedAt,
    };
  }

  const hasObservedBalance = typeof observedAmountUsd === 'number';

  if (!hasObservedBalance || !hasActiveCustody(batch)) {
    if (batch.fundingVerifiedAt || batch.wallet.fundingStatus === 'verified') {
      return {
        state: 'verified',
        label: batch.custodyMode === 'escrow_contract_custody' ? 'Escrow Contract Funding Verified' : 'Funding Verified',
        expectedAmountUsd,
        observedAmountUsd,
        verifiedAt: batch.fundingVerifiedAt,
      };
    }
    return {
      state: 'pending',
      label: 'Funding Pending Verification',
      expectedAmountUsd,
      observedAmountUsd,
      verifiedAt: batch.fundingVerifiedAt,
    };
  }

  if (reconciledObservedAmountUsd !== expectedAmountUsd) {
    return {
      state: 'mismatch',
      label: 'Funding Mismatch',
      expectedAmountUsd,
      observedAmountUsd,
      verifiedAt: batch.fundingVerifiedAt,
    };
  }

  return {
    state: batch.fundingVerifiedAt ? 'verified' : 'pending',
    label: batch.fundingVerifiedAt
      ? batch.custodyMode === 'escrow_contract_custody'
        ? 'Escrow Contract Funding Verified'
        : 'Funding Verified'
      : 'Funding Pending Verification',
    expectedAmountUsd,
    observedAmountUsd,
    verifiedAt: batch.fundingVerifiedAt,
  };
}

export function getBatchReadiness(batch: EscrowBatch): ReadinessRow[] {
  const manifest = getManifestValidation(batch);
  const funding = getFundingValidation(batch);
  const isException = batch.status === 'exception';

  const needsAuthorityBinding = requiresBatchAuthorityBinding(batch);
  const authorityBindingValid = hasValidAuthorityBinding(batch);

  return [
    {
      label: 'Treasury batch sent',
      state: statusFor(batch.treasuryHandoff.approvedByTreasury),
    },
    {
      label: 'Deposit manifest verified',
      state: manifest.state === 'verified' ? 'passed' : 'blocked',
    },
    ...(batch.custodyMode === 'escrow_contract_custody'
      ? [
          {
            label: 'Custody bound',
            state: statusFor(hasContractCustodyBound(batch)),
          } as ReadinessRow,
        ]
      : [
          {
            label: 'Wallet created',
            state: statusFor(hasWallet(batch)),
          } as ReadinessRow,
          {
            label: 'Treasury binding locked',
            state: statusFor(hasLockedBatchWalletBinding(batch)),
          } as ReadinessRow,
        ]),
    ...(needsAuthorityBinding
      ? [
          {
            label: 'Authority binding signed',
            state: ((): ReadinessRowState => {
              if (!batch.batchAuthorityBinding) return 'pending';
              const v = getBatchAuthorityBindingValidation(batch);
              if (v.state === 'mismatch') return 'blocked';
              const binding = batch.batchAuthorityBinding;
              if (binding.treasurySignatureStatus === 'invalid' || binding.escrowSignatureStatus === 'invalid') return 'exception';
              if (isBatchAuthorityFullySigned(binding)) return 'passed';
              return 'pending';
            })(),
          },
          {
            label: 'Authority binding anchored',
            state: ((): ReadinessRowState => {
              const binding = batch.batchAuthorityBinding;
              if (!binding) return 'pending';
              if (binding.anchorStatus === 'binding_mismatch') return 'exception';
              if (binding.anchorStatus === 'anchored') return 'passed';
              return 'pending';
            })(),
          },
        ]
      : []),
    {
      label: batch.custodyMode === 'batch_wallet_custody' ? 'Wallet funded' : 'Escrow contract funded',
      state: !isFundingGateOpen(batch) ? 'pending' : funding.state === 'mismatch' ? 'blocked' : statusFor(hasCustodyFundingObserved(batch, funding)),
    },
    {
      label: 'Funding verified',
      state: !isFundingGateOpen(batch) ? 'pending' : funding.state === 'verified' ? 'passed' : funding.state === 'mismatch' ? 'blocked' : 'pending',
    },
    {
      label: 'AAA plan attached',
      state: isException && !hasAaaPlan(batch) ? 'exception' : statusFor(hasAaaPlan(batch)),
    },
    {
      label: 'Destination approved',
      state: isException && !hasApprovedDestinations(batch) ? 'exception' : statusFor(hasApprovedDestinations(batch)),
    },
    {
      label: 'Deployment approved',
      state: isException && !hasDeploymentApproval(batch)
        ? 'exception'
        : statusFor(hasDeploymentApproval(batch)),
    },
    {
      label: 'Deployment execution ready',
      state: isException ? 'exception' : statusFor(hasDeploymentExecutionReady(batch), false),
    },
  ];
}

export function isBatchDeploymentReady(batch: EscrowBatch) {
  const manifest = getManifestValidation(batch);
  const funding = getFundingValidation(batch);

  return (
    manifest.state === 'verified' &&
    funding.state === 'verified' &&
    batch.treasuryHandoff.approvedByTreasury &&
    hasActiveCustody(batch) &&
    isFundingGateOpen(batch) &&
    hasValidAuthorityBinding(batch) &&
    isAuthorityBindingAnchored(batch) &&
    hasCustodyFundingObserved(batch, funding) &&
    hasAaaPlan(batch) &&
    hasApprovedDestinations(batch) &&
    hasDeploymentApproval(batch) &&
    hasDeploymentExecutionReady(batch)
  );
}
