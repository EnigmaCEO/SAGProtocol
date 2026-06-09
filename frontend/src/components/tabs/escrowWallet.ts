import { EscrowBatch } from '../../lib/escrow/batches';
import { canonicalKeccak } from '../../lib/escrow/canonicalHash';
import { getDefaultEscrowSigningAuthorities } from './escrowSigningAuthorities';

export type EscrowWalletMetadata = EscrowBatch['wallet'];
export type EscrowWalletBindingCanonicalPayload = NonNullable<EscrowBatch['batchWalletBinding']>['canonicalPayload'];
export type EscrowWalletBindingValidation = {
  state: 'missing' | 'valid' | 'mismatch';
  label: string;
  recomputedBindingHash?: string;
  blockingReason: string | null;
  mismatchedFields: string[];
};

const BINDING_PAYLOAD_FIELDS: (keyof EscrowWalletBindingCanonicalPayload)[] = [
  'batchId',
  'treasuryBatchId',
  'walletAddress',
  'totalAmountUsd',
  'asset',
  'termMonths',
  'depositManifestHash',
  'allocationPlanHash',
  'policyContextHash',
  'chainId',
];

const WALLET_BINDING_LIVE_INVARIANT_FIELDS: (keyof EscrowWalletBindingCanonicalPayload)[] =
  BINDING_PAYLOAD_FIELDS.filter((field) => field !== 'allocationPlanHash' && field !== 'policyContextHash');

export function createCanonicalWalletBindingPayload(batch: EscrowBatch, wallet: EscrowWalletMetadata): EscrowWalletBindingCanonicalPayload {
  const walletAddress = wallet.walletAddress ?? wallet.address;

  return {
    batchId: batch.batchId,
    treasuryBatchId: batch.treasuryHandoff.handoffId,
    walletAddress,
    totalAmountUsd: batch.totalAmountUsd,
    asset: batch.asset || 'USDC',
    termMonths: batch.termMonths,
    depositManifestHash: batch.treasuryHandoff.depositManifestHash,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    chainId: wallet.chain,
  };
}

export function createWalletBindingHash(payload: EscrowWalletBindingCanonicalPayload) {
  return canonicalKeccak(payload);
}

function getBindingStoredPayload(binding: NonNullable<EscrowBatch['batchWalletBinding']>): EscrowWalletBindingCanonicalPayload {
  return binding.canonicalPayload ?? {
    batchId: binding.batchId,
    treasuryBatchId: binding.treasuryBatchId,
    walletAddress: binding.walletAddress,
    totalAmountUsd: binding.totalAmountUsd,
    asset: binding.asset,
    termMonths: binding.termMonths,
    depositManifestHash: binding.depositManifestHash,
    allocationPlanHash: binding.allocationPlanHash,
    policyContextHash: binding.policyContextHash,
    chainId: binding.chainId,
  };
}

function recordMismatch(mismatchedFields: string[], fieldName: string) {
  if (!mismatchedFields.includes(fieldName)) {
    mismatchedFields.push(fieldName);
  }
}

export function getBatchWalletBindingValidation(batch: EscrowBatch): EscrowWalletBindingValidation {
  const binding = batch.batchWalletBinding;
  if (!binding) {
    return {
      state: 'missing',
      label: 'Binding Missing',
      blockingReason: 'Batch wallet binding has not been created.',
      mismatchedFields: [],
    };
  }

  const storedPayload = getBindingStoredPayload(binding);
  const currentPayload = createCanonicalWalletBindingPayload(batch, batch.wallet);
  const recomputedBindingHash = createWalletBindingHash(storedPayload);
  const mismatchedFields: string[] = [];

  if (recomputedBindingHash !== binding.bindingHash) {
    recordMismatch(mismatchedFields, 'bindingHash');
  }

  for (const field of BINDING_PAYLOAD_FIELDS) {
    if (binding[field] !== storedPayload[field]) {
      recordMismatch(mismatchedFields, field);
    }
  }

  for (const field of WALLET_BINDING_LIVE_INVARIANT_FIELDS) {
    if (currentPayload[field] !== storedPayload[field]) {
      recordMismatch(mismatchedFields, field);
    }
  }

  if (mismatchedFields.length > 0) {
    return {
      state: 'mismatch',
      label: 'Binding Mismatch',
      recomputedBindingHash,
      blockingReason: `Binding invariant mismatch detected for ${mismatchedFields.join(', ')}.`,
      mismatchedFields,
    };
  }

  return {
    state: 'valid',
    label: 'Binding Valid',
    recomputedBindingHash,
    blockingReason: null,
    mismatchedFields: [],
  };
}

export function isBatchWalletBindingValid(batch: EscrowBatch) {
  return getBatchWalletBindingValidation(batch).state === 'valid';
}

export function createBatchWalletBinding(batch: EscrowBatch, wallet: EscrowWalletMetadata, createdAt = wallet.createdAt ?? new Date().toISOString()): NonNullable<EscrowBatch['batchWalletBinding']> {
  const walletAddress = wallet.walletAddress ?? wallet.address;
  const canonicalPayload = createCanonicalWalletBindingPayload(batch, wallet);

  return {
    bindingId: `${batch.batchId}-wallet-binding`,
    batchId: batch.batchId,
    treasuryBatchId: batch.treasuryHandoff.handoffId,
    walletAddress,
    totalAmountUsd: canonicalPayload.totalAmountUsd,
    asset: canonicalPayload.asset,
    termMonths: canonicalPayload.termMonths,
    depositManifestHash: batch.treasuryHandoff.depositManifestHash,
    allocationPlanHash: batch.aaaAllocation.allocationPlanHash,
    policyContextHash: batch.aaaAllocation.policyContextHash,
    chainId: canonicalPayload.chainId,
    canonicalPayload,
    bindingHash: createWalletBindingHash(canonicalPayload),
    bindingStatus: 'binding_locked',
    createdAt,
    confirmedBy: 'Escrow Service',
    confirmedAt: createdAt,
  };
}

// When the wallet address becomes known post-anchor, update the legacy batchWalletBinding
// so its canonical payload and hash remain consistent with the real wallet address.
export function patchWalletBindingAddress(
  binding: NonNullable<EscrowBatch['batchWalletBinding']>,
  walletAddress: string,
): NonNullable<EscrowBatch['batchWalletBinding']> {
  const updatedPayload = { ...binding.canonicalPayload, walletAddress };
  return {
    ...binding,
    walletAddress,
    canonicalPayload: updatedPayload,
    bindingHash: createWalletBindingHash(updatedPayload),
  };
}

export function createWalletAuditEvent(batch: EscrowBatch, wallet: EscrowWalletMetadata, timestamp = wallet.createdAt ?? new Date().toISOString()): EscrowBatch['auditTrail'][number] {
  return {
    eventId: `${batch.batchId}-wallet-assigned`,
    timestamp,
    actor: 'Escrow Service',
    eventType: 'Escrow wallet assigned',
    description: 'Batch wallet metadata assigned from the Treasury-sent Escrow batch handoff.',
    reference: wallet.walletAddress ?? wallet.address,
  };
}

export function createWalletBindingAuditEvent(batch: EscrowBatch, binding: NonNullable<EscrowBatch['batchWalletBinding']>): EscrowBatch['auditTrail'][number] {
  return {
    eventId: `${batch.batchId}-wallet-binding-created`,
    timestamp: binding.createdAt,
    actor: 'Escrow Service',
    eventType: 'Batch wallet binding hash created',
    description: 'Canonical Batch ID, Treasury reference, wallet address, amount, term, chain, and wallet binding evidence were hashed and locked.',
    reference: binding.bindingHash,
  };
}

export function recordBatchWalletBindingMismatch(
  batch: EscrowBatch,
  validation = getBatchWalletBindingValidation(batch),
  options: { markException?: boolean; detectedAt?: string } = {}
): EscrowBatch {
  if (validation.state !== 'mismatch') {
    return batch;
  }

  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const eventId = `${batch.batchId}-wallet-binding-mismatch-detected`;
  const hasMismatchAuditEvent = batch.auditTrail.some((event) => event.eventId === eventId);
  const mismatchReason = validation.blockingReason ?? 'Batch wallet binding invariant mismatch detected.';

  return {
    ...batch,
    status: options.markException ? 'exception' : batch.status,
    exceptionReason: options.markException ? mismatchReason : batch.exceptionReason,
    auditTrail: hasMismatchAuditEvent
      ? batch.auditTrail
      : [
          ...batch.auditTrail,
          {
            eventId,
            timestamp: detectedAt,
            actor: 'Escrow Service',
            eventType: 'Batch wallet binding mismatch detected',
            description: mismatchReason,
            reference: batch.batchWalletBinding?.bindingHash,
          },
        ],
  };
}

// Treasury-assigned wallet — constructed from handoff data provided by Treasury.
// Treasury must supply a real wallet address in the handoff package.
// If no wallet address is provided, the batch enters exception state.
export function createTreasuryAssignedWalletMetadata(
  walletAddress: string,
  chain: string,
  createdAt: string,
): EscrowWalletMetadata {
  return {
    address: walletAddress,
    walletAddress,
    walletType: 'batch_multisig',
    provider: 'manual',
    chain: chain as EscrowWalletMetadata['chain'],
    custodyMode: 'role_based_multisig',
    threshold: 2,
    signerAuthorities: getDefaultEscrowSigningAuthorities(),
    fundingStatus: 'created',
    createdAt,
    createdBy: 'Treasury Service',
  };
}
