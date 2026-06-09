import { EscrowBatch } from '../../lib/escrow/batches';

const VALIDATED_ALLOCATION_STATUSES = new Set<EscrowBatch['aaaAllocation']['status']>([
  'validated',
  'locked',
  'deployed',
]);

export function hasValidatedAaaAllocation(batch: EscrowBatch): boolean {
  const allocation = batch.aaaAllocation;
  return (
    VALIDATED_ALLOCATION_STATUSES.has(allocation.status) &&
    Boolean(allocation.allocationPlan) &&
    Boolean(allocation.allocationPlanHash) &&
    Boolean(allocation.policyContextHash) &&
    Boolean(allocation.portfolioRegistryVersion)
  );
}

export function getAllocationValidationBlockingReason(batch: EscrowBatch): string | null {
  if (hasValidatedAaaAllocation(batch)) return null;

  switch (batch.aaaAllocation.status) {
    case 'computed':
      return 'AAA allocation computed — pending on-chain anchor.';
    case 'pending_anchor':
    case 'requesting':
      return 'AAA allocation anchor is awaiting on-chain confirmation.';
    case 'chain_only':
      return 'On-chain allocation attachment exists, but the DB allocation plan is missing.';
    case 'hash_mismatch':
      return 'DB allocation does not match the on-chain allocation attachment.';
    case 'failed':
      return 'AAA allocation anchor failed.';
    default:
      return 'AAA allocation has not been validated against its on-chain attachment.';
  }
}
