import { Contract, JsonRpcProvider, BrowserProvider, TypedDataEncoder, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import {
  BatchAuthorityBinding,
  BatchAuthorityBindingCanonicalPayload,
  BatchAuthorityBindingEip712Domain,
  BatchAuthoritySignatureStatus,
  Eip712TypeField,
  Eip712Types,
  EscrowBatch,
} from '../../lib/escrow/batches';
import { getActiveDeployment } from '../../lib/config/deployments';
import { getChainById } from '../../lib/config/chains';
import { getRuntimeAddress, ZERO_ADDRESS } from '../../lib/runtime-addresses';
import { TreasuryHandoffPackage } from './escrowHandoff';
import {
  getEscrowAuthority,
  getTreasuryVaultAuthority,
  isRoleSigningAllowed,
} from '../../lib/escrow/roleAuthorityRegistry';

export type BatchAuthorityBindingValidation = {
  state: 'missing' | 'valid' | 'mismatch';
  label: string;
  recomputedHash?: string;
  blockingReason: string | null;
  mismatchedFields: string[];
};

export type DAOSystemAddressMatrix = {
  activeTreasuryAddress: string;
  activeVaultAddress: string;
  activeEscrowAddress: string;
  daoSystemRegistryVersion: string;
  systemMapHash: string;
  chainId: number;
};

export type BatchAuthoritySignerRole = 'treasury' | 'escrow';

// ─── EIP-712 constants ────────────────────────────────────────────────────────

const EIP712_DOMAIN_NAME = 'Sagitta Batch Authority Binding';
const EIP712_VERSION = '1';
const DAO_SYSTEM_REGISTRY_VERSION = 'v1.0.0-arc-testnet';

// chainId is uint256 (numeric) in both domain and typed payload
export const BATCH_AUTHORITY_BINDING_EIP712_TYPES: Eip712Types = {
  BatchAuthorityBinding: [
    { name: 'sourceType', type: 'string' },
    { name: 'sourceContractAddress', type: 'address' },
    { name: 'activeTreasuryAddress', type: 'address' },
    { name: 'activeVaultAddress', type: 'address' },
    { name: 'activeEscrowAddress', type: 'address' },
    { name: 'daoSystemRegistryVersion', type: 'string' },
    { name: 'systemMapHash', type: 'bytes32' },
    { name: 'sourceBatchId', type: 'string' },
    { name: 'escrowBatchId', type: 'string' },
    { name: 'custodyMode', type: 'string' },
    { name: 'custodyLocation', type: 'address' },
    { name: 'asset', type: 'string' },
    { name: 'totalAmountUsd', type: 'uint256' },
    { name: 'termMonths', type: 'uint256' },
    { name: 'depositManifestHash', type: 'bytes32' },
    { name: 'allocationPlanHash', type: 'bytes32' },
    { name: 'policyContextHash', type: 'bytes32' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ] as Eip712TypeField[],
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toAddress(value: string | undefined): string {
  if (value && /^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  return ZERO_ADDRESS;
}

function toBytes32(value: string | undefined): string {
  if (!value) return '0x' + '0'.repeat(64);
  const raw = value.startsWith('0x') ? value.slice(2) : value;
  if (raw.length === 64) return '0x' + raw;
  return '0x' + raw.padStart(64, '0');
}

function resolveNetworkLabel(chainId: number): string {
  const chain = getChainById(chainId);
  return chain?.name ?? `Chain ${chainId}`;
}

// ─── DAO system address matrix ────────────────────────────────────────────────

export function getDAOSystemAddressMatrix(chainId?: number): DAOSystemAddressMatrix {
  const resolvedChainId = chainId ?? getActiveDeployment().chainId;
  const activeTreasuryAddress = getRuntimeAddress('Treasury');
  const activeVaultAddress = getRuntimeAddress('Vault');
  const activeEscrowAddress = getRuntimeAddress('InvestmentEscrow');

  // systemMapHash binds: contract addresses + registry version + numeric chainId
  const systemMapSource = JSON.stringify({
    treasury: activeTreasuryAddress.toLowerCase(),
    vault: activeVaultAddress.toLowerCase(),
    escrow: activeEscrowAddress.toLowerCase(),
    chainId: resolvedChainId,
    version: DAO_SYSTEM_REGISTRY_VERSION,
  });

  return {
    activeTreasuryAddress,
    activeVaultAddress,
    activeEscrowAddress,
    daoSystemRegistryVersion: DAO_SYSTEM_REGISTRY_VERSION,
    systemMapHash: keccak256(toUtf8Bytes(systemMapSource)),
    chainId: resolvedChainId,
  };
}

// ─── EIP-712 domain ───────────────────────────────────────────────────────────

export function createEip712Domain(activeEscrowAddress: string, chainId: number): BatchAuthorityBindingEip712Domain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_VERSION,
    chainId,
    verifyingContract: toAddress(activeEscrowAddress),
  };
}

// ─── Deterministic nonce ──────────────────────────────────────────────────────

function createDeterministicNonce(escrowBatchId: string, sourceBatchId: string): string {
  // keccak256 of a canonical input → deterministic 256-bit nonce, stable across refreshes
  return keccak256(toUtf8Bytes(`sagitta:authority-nonce:${escrowBatchId}:${sourceBatchId}`));
}

// ─── EIP-712 value builder ────────────────────────────────────────────────────

function buildEip712Value(payload: BatchAuthorityBindingCanonicalPayload) {
  return {
    sourceType: payload.sourceType,
    sourceContractAddress: toAddress(payload.sourceContractAddress),
    activeTreasuryAddress: toAddress(payload.activeTreasuryAddress),
    activeVaultAddress: toAddress(payload.activeVaultAddress),
    activeEscrowAddress: toAddress(payload.activeEscrowAddress),
    daoSystemRegistryVersion: payload.daoSystemRegistryVersion,
    systemMapHash: toBytes32(payload.systemMapHash),
    sourceBatchId: payload.sourceBatchId,
    escrowBatchId: payload.escrowBatchId,
    custodyMode: payload.custodyMode,
    custodyLocation: toAddress(payload.custodyLocation),
    asset: payload.asset,
    // totalAmountUsd is stored as a floating-point USD value; encode as micro-USD uint256
    totalAmountUsd: BigInt(Math.round(payload.totalAmountUsd * 1_000_000)),
    termMonths: BigInt(payload.termMonths),
    depositManifestHash: toBytes32(payload.depositManifestHash),
    allocationPlanHash: toBytes32(payload.allocationPlanHash),
    policyContextHash: toBytes32(payload.policyContextHash),
    chainId: BigInt(payload.chainId),
    nonce: BigInt(payload.nonce),
  };
}

export function computeEip712BindingHash(
  domain: BatchAuthorityBindingEip712Domain,
  payload: BatchAuthorityBindingCanonicalPayload
): string {
  return TypedDataEncoder.hash(domain, BATCH_AUTHORITY_BINDING_EIP712_TYPES, buildEip712Value(payload));
}

// ─── Payload builder ──────────────────────────────────────────────────────────

function deriveSourceType(handoff: TreasuryHandoffPackage): 'treasury' | 'vault' {
  if (handoff.custodyMode === 'batch_wallet_custody') return 'treasury';
  if (handoff.custodyMode === 'escrow_contract_custody') return 'vault';
  return 'treasury';
}

export function createBatchAuthorityBindingPayload(
  handoff: TreasuryHandoffPackage,
  escrowBatchId: string,
  addressMatrix: DAOSystemAddressMatrix
): BatchAuthorityBindingCanonicalPayload {
  const custodyMode = handoff.custodyMode ?? 'batch_wallet_custody';
  const custodyLocation = handoff.sourceContract ?? handoff.batchWalletAddress ?? addressMatrix.activeEscrowAddress;
  const sourceBatchId = handoff.sourceBatchId;
  if (!sourceBatchId) {
    throw new Error(
      `createBatchAuthorityBindingPayload: sourceBatchId is required but missing (handoffId=${handoff.handoffId}). ` +
      'Authority binding must not be created without a confirmed on-chain source batch ID.'
    );
  }

  return {
    sourceType: deriveSourceType(handoff),
    sourceContractAddress: handoff.sourceContract ?? addressMatrix.activeEscrowAddress,
    activeTreasuryAddress: addressMatrix.activeTreasuryAddress,
    activeVaultAddress: addressMatrix.activeVaultAddress,
    activeEscrowAddress: addressMatrix.activeEscrowAddress,
    daoSystemRegistryVersion: addressMatrix.daoSystemRegistryVersion,
    systemMapHash: addressMatrix.systemMapHash,
    sourceBatchId,
    escrowBatchId,
    custodyMode,
    custodyLocation,
    asset: handoff.asset ?? 'USDC',
    totalAmountUsd: handoff.totalAmountUsd,
    termMonths: handoff.termMonths,
    depositManifestHash: handoff.depositManifestHash,
    allocationPlanHash: undefined,
    policyContextHash: undefined,
    chainId: addressMatrix.chainId,
    nonce: createDeterministicNonce(escrowBatchId, sourceBatchId),
  };
}

// ─── Public factory ───────────────────────────────────────────────────────────

export function createBatchAuthorityBinding(
  handoff: TreasuryHandoffPackage,
  escrowBatchId: string,
  createdAt = new Date().toISOString(),
  chainId?: number
): BatchAuthorityBinding {
  const addressMatrix = getDAOSystemAddressMatrix(chainId);
  const canonicalPayload = createBatchAuthorityBindingPayload(handoff, escrowBatchId, addressMatrix);
  const eip712Domain = createEip712Domain(addressMatrix.activeEscrowAddress, addressMatrix.chainId);
  const batchAuthorityBindingHash = computeEip712BindingHash(eip712Domain, canonicalPayload);

  return {
    bindingId: `${escrowBatchId}-authority-binding`,
    batchId: escrowBatchId,
    eip712Domain,
    eip712Types: BATCH_AUTHORITY_BINDING_EIP712_TYPES,
    canonicalPayload,
    batchAuthorityBindingHash,
    networkLabel: resolveNetworkLabel(addressMatrix.chainId),
    treasurySignatureStatus: 'pending',
    escrowSignatureStatus: 'pending',
    // Expected signer addresses sourced from Role Authority Registry — public addresses only.
    treasurySignerAddress: getTreasuryVaultAuthority().expectedSignerAddress,
    escrowSignerAddress: getEscrowAuthority().expectedSignerAddress,
    anchorStatus: 'pending_onchain_anchor',
    createdAt,
    createdBy: 'Escrow Service',
  };
}

// ─── EIP-712 signature signing ────────────────────────────────────────────────

type EIP712Signer = {
  signTypedData: (domain: any, types: any, value: any) => Promise<string>;
  getAddress: () => Promise<string>;
};

/**
 * Sign a BatchAuthorityBinding with the given signer.
 *
 * Expected signer addresses come from the Role Authority Registry.
 * The recovered signer must match the registry expected signer for the role.
 * Signing is blocked if the role is frozen or retired.
 *
 * No private keys are produced, stored, or returned by this function.
 * The signer object is a transient ethers Signer from the connected browser wallet.
 */
export async function signBatchAuthorityBinding(
  binding: BatchAuthorityBinding,
  signerRole: BatchAuthoritySignerRole,
  signer: EIP712Signer,
): Promise<BatchAuthorityBinding> {
  const registryRecord = signerRole === 'treasury' ? getTreasuryVaultAuthority() : getEscrowAuthority();
  const roleCheck = isRoleSigningAllowed(registryRecord);
  if (!roleCheck.allowed) {
    throw new Error(
      `Signature rejected: ${roleCheck.reason}. Role: ${registryRecord.roleLabel} (${registryRecord.registryVersion}).`,
    );
  }

  const typedValue = buildEip712Value(binding.canonicalPayload);
  const signature = await signer.signTypedData(binding.eip712Domain, binding.eip712Types, typedValue);
  const recoveredAddress = verifyTypedData(binding.eip712Domain, binding.eip712Types, typedValue, signature);
  const signedAt = new Date().toISOString();

  const expectedSignerAddress = registryRecord.expectedSignerAddress;
  const isValid = recoveredAddress.toLowerCase() === expectedSignerAddress.toLowerCase();

  const mismatchReason = isValid
    ? undefined
    : `${signerRole === 'treasury' ? 'Treasury/Vault' : 'Escrow'} signature: recovered signer ${recoveredAddress} does not match expected signer ${expectedSignerAddress} (Role Authority Registry ${registryRecord.registryVersion}).`;

  const newStatus: BatchAuthoritySignatureStatus = isValid ? 'signed' : 'invalid';

  if (signerRole === 'treasury') {
    const bothSigned = newStatus === 'signed' && binding.escrowSignatureStatus === 'signed';
    return {
      ...binding,
      treasurySignature: signature,
      treasurySignerAddress: registryRecord.expectedSignerAddress,
      treasuryRecoveredSignerAddress: recoveredAddress,
      treasurySignedAt: signedAt,
      treasurySignatureStatus: newStatus,
      signatureVerificationStatus: newStatus === 'invalid' ? 'invalid' : bothSigned ? 'verified' : 'unverified',
      signatureMismatchReason: mismatchReason,
    };
  } else {
    const bothSigned = newStatus === 'signed' && binding.treasurySignatureStatus === 'signed';
    return {
      ...binding,
      escrowSignature: signature,
      escrowSignerAddress: registryRecord.expectedSignerAddress,
      escrowRecoveredSignerAddress: recoveredAddress,
      escrowSignedAt: signedAt,
      escrowSignatureStatus: newStatus,
      signatureVerificationStatus: newStatus === 'invalid' ? 'invalid' : bothSigned ? 'verified' : 'unverified',
      signatureMismatchReason: mismatchReason,
    };
  }
}

// ─── EIP-712 signature verification ──────────────────────────────────────────

/**
 * Verify that a signature over this binding recovers to the expected signer address.
 * Uses ethers.verifyTypedData (EIP-712 ECDSA).
 */
export function verifyBatchAuthoritySignature(
  binding: BatchAuthorityBinding,
  signerRole: BatchAuthoritySignerRole,
  signature: string,
  expectedSignerAddress: string,
): { valid: boolean; recoveredAddress: string; mismatchReason?: string } {
  const value = buildEip712Value(binding.canonicalPayload);
  const recoveredAddress = verifyTypedData(binding.eip712Domain, binding.eip712Types, value, signature);
  const valid = recoveredAddress.toLowerCase() === expectedSignerAddress.toLowerCase();
  return {
    valid,
    recoveredAddress,
    mismatchReason: valid
      ? undefined
      : `Recovered ${recoveredAddress} does not match expected ${signerRole} signer ${expectedSignerAddress}.`,
  };
}

/**
 * Recover the signer address from a raw EIP-712 signature over this binding.
 */
export function recoverBatchAuthoritySigner(binding: BatchAuthorityBinding, signature: string): string {
  const value = buildEip712Value(binding.canonicalPayload);
  return verifyTypedData(binding.eip712Domain, binding.eip712Types, value, signature);
}

// ─── Signature status helpers ─────────────────────────────────────────────────

export function isBatchAuthorityFullySigned(binding: BatchAuthorityBinding): boolean {
  return binding.treasurySignatureStatus === 'signed' && binding.escrowSignatureStatus === 'signed';
}

export function getBatchAuthoritySignatureStatus(binding: BatchAuthorityBinding): {
  treasuryStatus: BatchAuthoritySignatureStatus;
  escrowStatus: BatchAuthoritySignatureStatus;
  overallStatus: 'pending' | 'partial' | 'signed' | 'invalid';
  blockingReason?: string;
} {
  const t = binding.treasurySignatureStatus;
  const e = binding.escrowSignatureStatus;
  const hasInvalid = t === 'invalid' || e === 'invalid';
  const bothSigned = t === 'signed' && e === 'signed';
  const partial = !hasInvalid && !bothSigned && (t === 'signed' || e === 'signed');
  return {
    treasuryStatus: t,
    escrowStatus: e,
    overallStatus: hasInvalid ? 'invalid' : bothSigned ? 'signed' : partial ? 'partial' : 'pending',
    blockingReason: hasInvalid ? (binding.signatureMismatchReason ?? 'One or more authority signatures are invalid.') : undefined,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function recomputeBatchAuthorityBindingHash(binding: BatchAuthorityBinding): string {
  return computeEip712BindingHash(binding.eip712Domain, binding.canonicalPayload);
}

export function requiresBatchAuthorityBinding(_batch: EscrowBatch): boolean {
  return true;
}

export function getBatchAuthorityBindingValidation(batch: EscrowBatch, liveChainId?: number): BatchAuthorityBindingValidation {
  const binding = batch.batchAuthorityBinding;

  if (!binding) {
    return {
      state: 'missing',
      label: 'Authority Binding Missing',
      blockingReason: 'Batch authority binding has not been created.',
      mismatchedFields: [],
    };
  }

  const mismatchedFields: string[] = [];

  const recomputedHash = recomputeBatchAuthorityBindingHash(binding);
  if (recomputedHash !== binding.batchAuthorityBindingHash) {
    mismatchedFields.push('batchAuthorityBindingHash');
  }

  const storedPayload = binding.canonicalPayload;

  // Use liveChainId if provided, else fall back to the active deployment's chain ID
  const resolvedLiveChainId = liveChainId ?? getActiveDeployment().chainId;
  const liveMatrix = getDAOSystemAddressMatrix(resolvedLiveChainId);

  // Chain ID must match the live provider
  if (resolvedLiveChainId !== storedPayload.chainId) mismatchedFields.push('chainId');

  if (liveMatrix.activeTreasuryAddress !== storedPayload.activeTreasuryAddress) mismatchedFields.push('activeTreasuryAddress');
  if (liveMatrix.activeVaultAddress !== storedPayload.activeVaultAddress) mismatchedFields.push('activeVaultAddress');
  if (liveMatrix.activeEscrowAddress !== storedPayload.activeEscrowAddress) mismatchedFields.push('activeEscrowAddress');
  if (liveMatrix.daoSystemRegistryVersion !== storedPayload.daoSystemRegistryVersion) mismatchedFields.push('daoSystemRegistryVersion');
  if (liveMatrix.systemMapHash !== storedPayload.systemMapHash) mismatchedFields.push('systemMapHash');

  if (batch.batchId !== storedPayload.escrowBatchId) mismatchedFields.push('escrowBatchId');
  if (batch.totalAmountUsd !== storedPayload.totalAmountUsd) mismatchedFields.push('totalAmountUsd');
  if ((batch.asset ?? 'USDC') !== storedPayload.asset) mismatchedFields.push('asset');
  if (batch.termMonths !== storedPayload.termMonths) mismatchedFields.push('termMonths');
  if (batch.treasuryHandoff.depositManifestHash !== storedPayload.depositManifestHash) mismatchedFields.push('depositManifestHash');

  const batchCustodyMode = batch.custodyMode ?? 'batch_wallet_custody';
  if (batchCustodyMode !== storedPayload.custodyMode) mismatchedFields.push('custodyMode');

  if (mismatchedFields.length > 0) {
    const chainIdMismatch = mismatchedFields.includes('chainId');
    return {
      state: 'mismatch',
      label: 'Authority Binding Mismatch',
      recomputedHash,
      blockingReason: chainIdMismatch
        ? `Authority binding chainId mismatch: binding has ${storedPayload.chainId}, live provider is ${resolvedLiveChainId}.`
        : `Authority binding invariant mismatch detected for: ${mismatchedFields.join(', ')}.`,
      mismatchedFields,
    };
  }

  return {
    state: 'valid',
    label: 'Authority Binding Valid',
    recomputedHash,
    blockingReason: null,
    mismatchedFields: [],
  };
}

export function isBatchAuthorityBindingValid(batch: EscrowBatch): boolean {
  if (!requiresBatchAuthorityBinding(batch)) return true;
  if (getBatchAuthorityBindingValidation(batch).state !== 'valid') return false;
  const binding = batch.batchAuthorityBinding;
  return binding != null && isBatchAuthorityFullySigned(binding);
}

export function recordBatchAuthorityBindingMismatch(
  batch: EscrowBatch,
  validation = getBatchAuthorityBindingValidation(batch),
  options: { markException?: boolean; detectedAt?: string } = {}
): EscrowBatch {
  if (validation.state !== 'mismatch') return batch;

  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const eventId = `${batch.batchId}-authority-binding-mismatch-detected`;
  const hasMismatchEvent = batch.auditTrail.some((e) => e.eventId === eventId);
  const mismatchReason = validation.blockingReason ?? 'Batch authority binding invariant mismatch detected.';

  // Invalidate any existing signatures — payload has changed, existing signatures are no longer valid.
  const existingBinding = batch.batchAuthorityBinding;
  const updatedBinding = existingBinding
    ? {
        ...existingBinding,
        treasurySignatureStatus: (existingBinding.treasurySignatureStatus === 'signed'
          ? 'invalid'
          : existingBinding.treasurySignatureStatus) as BatchAuthoritySignatureStatus,
        escrowSignatureStatus: (existingBinding.escrowSignatureStatus === 'signed'
          ? 'invalid'
          : existingBinding.escrowSignatureStatus) as BatchAuthoritySignatureStatus,
        signatureVerificationStatus: 'invalid' as const,
        signatureMismatchReason: mismatchReason,
      }
    : existingBinding;

  return {
    ...batch,
    batchAuthorityBinding: updatedBinding,
    status: options.markException ? 'exception' : batch.status,
    exceptionReason: options.markException ? mismatchReason : batch.exceptionReason,
    auditTrail: hasMismatchEvent
      ? batch.auditTrail
      : [
          ...batch.auditTrail,
          {
            eventId,
            timestamp: detectedAt,
            actor: 'Escrow Service',
            eventType: 'Batch authority binding mismatch detected',
            description: mismatchReason,
            reference: batch.batchAuthorityBinding?.batchAuthorityBindingHash,
          },
        ],
  };
}

// ─── On-chain anchor ABI ──────────────────────────────────────────────────────

export const BATCH_AUTHORITY_ANCHOR_ABI = [
  // Anchor — signer addresses come from on-chain role registry, not calldata
  'function anchorBatchAuthorityBinding(uint256 sourceBatchId, bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, bytes32 systemMapHash, address sourceContractAddress, address activeEscrowAddress, bytes treasurySignature, bytes escrowSignature) external',
  'function getBatchAuthorityAnchor(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, bytes32 systemMapHash, address sourceContractAddress, address activeEscrowAddress, address treasurySignerAddress, address escrowSignerAddress, address anchoredBy, uint64 anchoredAt, bool exists))',
  // Batch wallet binding
  'function getBatchWalletBinding(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, address walletAddress, address ownerTreasury, address ownerEscrow, address ownerContinuity, uint8 threshold, address factory, bytes32 creationTxHash, uint64 boundAt, address boundBy, bool exists))',
  // Role authority registry
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer, uint8 status, uint64 updatedAt, address updatedBy, bool exists))',
  'function setRoleAuthority(uint8 roleId, address signer, uint8 status) external',
  'function ROLE_TREASURY_VAULT() view returns (uint8)',
  'function ROLE_ESCROW() view returns (uint8)',
  'function ROLE_CONTINUITY_SCE() view returns (uint8)',
  // Custom errors
  'error AlreadyAnchored(uint256 sourceBatchId, bytes32 existingHash)',
  'error AnchorHashMismatch(uint256 sourceBatchId, bytes32 existingHash, bytes32 newHash)',
  'error InvalidTreasurySigner(address recovered, address expected)',
  'error InvalidEscrowSigner(address recovered, address expected)',
  'error RoleSignerNotSet(uint8 roleId)',
  'error RoleNotActive(uint8 roleId, uint8 status)',
  'error WalletAlreadyBound(uint256 sourceBatchId, address existingWallet)',
  'error AnchorNotFound(uint256 sourceBatchId)',
  'error WalletBindingHashMismatch(bytes32 anchorHash, bytes32 providedHash)',
  'error WalletBindingEscrowIdMismatch(bytes32 anchorId, bytes32 providedId)',
  'error ZeroWalletAddress()',
  'error WalletThresholdInvalid(uint8 walletThreshold)',
  'error WalletOwnersMissing()',
  // Events
  'event RoleAuthorityUpdated(uint8 indexed roleId, address indexed signer, uint8 indexed status, address updatedBy)',
  'event BatchWalletBound(uint256 indexed sourceBatchId, address indexed walletAddress, bytes32 indexed batchAuthorityBindingHash, bytes32 escrowBatchIdHash, address ownerTreasury, address ownerEscrow, address ownerContinuity, address factory, bytes32 creationTxHash, address boundBy)',
];

export type OnChainAnchorResult = {
  exists: boolean;
  batchAuthorityBindingHash: string;
  escrowBatchIdHash: string;
  systemMapHash: string;
  sourceContractAddress: string;
  activeEscrowAddress: string;
  treasurySignerAddress: string;
  escrowSignerAddress: string;
  anchoredBy: string;
  anchoredAt: string;
};

export type AnchorOutcome =
  | { status: 'anchored'; txHash: string; blockNumber: number; anchoredAt: string }
  | { status: 'binding_mismatch'; onChainHash: string }
  | { status: 'not_found' };

export type OnChainBatchWalletBinding = {
  exists: boolean;
  escrowBatchIdHash: string;
  batchAuthorityBindingHash: string;
  walletAddress: string;
  ownerTreasury: string;
  ownerEscrow: string;
  ownerContinuity: string;
  threshold: number;
  factory: string;
  creationTxHash: string;
  boundAt: string;
  boundBy: string;
};

// ─── On-chain role authority types ───────────────────────────────────────────

export type OnChainRoleStatus = 'active' | 'frozen' | 'retired';

export type OnChainRoleAuthority = {
  roleId: number;
  signer: string;
  status: OnChainRoleStatus;
  updatedAt: string;
  updatedBy: string;
  exists: boolean;
};

export type OnChainRoleAuthorities = {
  treasury: OnChainRoleAuthority | null;
  escrow: OnChainRoleAuthority | null;
  continuitySce: OnChainRoleAuthority | null;
};

// Role status uint8 from Solidity enum: Active=0, Frozen=1, Retired=2
function decodeRoleStatus(status: bigint | number): OnChainRoleStatus {
  const n = Number(status);
  if (n === 1) return 'frozen';
  if (n === 2) return 'retired';
  return 'active';
}

export async function readOnChainRoleAuthorities(params: {
  escrowAddress: string;
  rpcUrl: string;
}): Promise<OnChainRoleAuthorities> {
  const { escrowAddress, rpcUrl } = params;
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(escrowAddress, BATCH_AUTHORITY_ANCHOR_ABI, provider);

  const readRole = async (roleId: number): Promise<OnChainRoleAuthority | null> => {
    try {
      const raw = await contract.getRoleAuthority(roleId);
      if (!raw?.exists) return null;
      return {
        roleId,
        signer: String(raw.signer),
        status: decodeRoleStatus(raw.status),
        updatedAt: new Date(Number(raw.updatedAt) * 1000).toISOString(),
        updatedBy: String(raw.updatedBy),
        exists: true,
      };
    } catch {
      return null;
    }
  };

  const [treasury, escrow, continuitySce] = await Promise.all([
    readRole(0), // ROLE_TREASURY_VAULT
    readRole(1), // ROLE_ESCROW
    readRole(2), // ROLE_CONTINUITY_SCE
  ]);

  return { treasury, escrow, continuitySce };
}

// ─── Read on-chain anchor record ──────────────────────────────────────────────

export async function readBatchAuthorityAnchorFromChain(params: {
  escrowAddress: string;
  sourceBatchId: string;
  rpcUrl: string;
}): Promise<OnChainAnchorResult | null> {
  const { escrowAddress, sourceBatchId, rpcUrl } = params;
  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(sourceBatchId);
  } catch {
    return null;
  }
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(escrowAddress, BATCH_AUTHORITY_ANCHOR_ABI, provider);
  const raw = await contract.getBatchAuthorityAnchor(sourceBatchIdNum);
  if (!raw || !raw.exists) return null;
  return {
    exists: Boolean(raw.exists),
    batchAuthorityBindingHash: String(raw.batchAuthorityBindingHash),
    escrowBatchIdHash: String(raw.escrowBatchIdHash),
    systemMapHash: String(raw.systemMapHash),
    sourceContractAddress: String(raw.sourceContractAddress),
    activeEscrowAddress: String(raw.activeEscrowAddress),
    treasurySignerAddress: String(raw.treasurySignerAddress),
    escrowSignerAddress: String(raw.escrowSignerAddress),
    anchoredBy: String(raw.anchoredBy),
    anchoredAt: new Date(Number(raw.anchoredAt) * 1000).toISOString(),
  };
}

// ─── Read on-chain batch wallet binding ───────────────────────────────────────

export async function readBatchWalletBindingFromChain(params: {
  escrowAddress: string;
  sourceBatchId: string;
  rpcUrl: string;
}): Promise<OnChainBatchWalletBinding | null> {
  const { escrowAddress, sourceBatchId, rpcUrl } = params;
  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(sourceBatchId);
  } catch {
    return null;
  }
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(escrowAddress, BATCH_AUTHORITY_ANCHOR_ABI, provider);
  try {
    const raw = await contract.getBatchWalletBinding(sourceBatchIdNum);
    if (!raw || !raw.exists) return null;
    return {
      exists: Boolean(raw.exists),
      escrowBatchIdHash: String(raw.escrowBatchIdHash),
      batchAuthorityBindingHash: String(raw.batchAuthorityBindingHash),
      walletAddress: String(raw.walletAddress),
      ownerTreasury: String(raw.ownerTreasury),
      ownerEscrow: String(raw.ownerEscrow),
      ownerContinuity: String(raw.ownerContinuity),
      threshold: Number(raw.threshold),
      factory: String(raw.factory),
      creationTxHash: String(raw.creationTxHash),
      boundAt: new Date(Number(raw.boundAt) * 1000).toISOString(),
      boundBy: String(raw.boundBy),
    };
  } catch {
    return null;
  }
}

// ─── Write anchor to chain ────────────────────────────────────────────────────

export async function anchorBatchAuthorityBindingOnChain(params: {
  binding: BatchAuthorityBinding;
  escrowAddress: string;
  sourceBatchId: string;
}): Promise<{ txHash: string; blockNumber: number; anchoredAt: string }> {
  const { binding, escrowAddress, sourceBatchId } = params;

  if (!binding.treasurySignature) {
    throw new Error('Treasury/Vault signature is required to anchor on-chain. Sign the binding first.');
  }
  if (!binding.escrowSignature) {
    throw new Error('Escrow signature is required to anchor on-chain. Sign the binding first.');
  }

  const eth = (window as any).ethereum;
  if (!eth) throw new Error('No browser wallet connected.');

  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(sourceBatchId);
  } catch {
    throw new Error(`sourceBatchId "${sourceBatchId}" cannot be converted to uint256.`);
  }

  const provider = new BrowserProvider(eth);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  const contract = new Contract(escrowAddress, BATCH_AUTHORITY_ANCHOR_ABI, signer);

  const p = binding.canonicalPayload;
  const escrowBatchIdHash = keccak256(toUtf8Bytes(p.escrowBatchId));

  const tx = await contract.anchorBatchAuthorityBinding(
    sourceBatchIdNum,
    escrowBatchIdHash,
    binding.batchAuthorityBindingHash,
    toBytes32(p.systemMapHash),
    toAddress(p.sourceContractAddress),
    toAddress(p.activeEscrowAddress),
    binding.treasurySignature,
    binding.escrowSignature,
  );

  const receipt = await tx.wait();
  return {
    txHash: String(receipt.hash ?? tx.hash),
    blockNumber: Number(receipt.blockNumber ?? 0),
    anchoredAt: new Date().toISOString(),
  };
}

// ─── Apply on-chain anchor to batch ──────────────────────────────────────────

export function applyOnChainAnchorToBatch(
  batch: EscrowBatch,
  onChainAnchor: OnChainAnchorResult,
  txHash?: string,
  blockNumber?: number,
): EscrowBatch {
  const binding = batch.batchAuthorityBinding;
  if (!binding) return batch;

  const localHash = binding.batchAuthorityBindingHash.toLowerCase();
  const chainHash = onChainAnchor.batchAuthorityBindingHash.toLowerCase();
  const isMatch = localHash === chainHash;

  const anchorStatus = isMatch ? 'anchored' as const : 'binding_mismatch' as const;
  const anchoredAt = onChainAnchor.anchoredAt;
  const eventId = `${batch.batchId}-authority-binding-${anchorStatus}`;
  const hasEvent = batch.auditTrail.some((e) => e.eventId === eventId);

  const updatedBinding: BatchAuthorityBinding = {
    ...binding,
    anchorStatus,
    anchorTxHash: isMatch ? (txHash ?? undefined) : undefined,
    anchorBlockNumber: isMatch ? blockNumber : undefined,
    anchoredAt: isMatch ? anchoredAt : undefined,
  };

  return {
    ...batch,
    batchAuthorityBinding: updatedBinding,
    status: !isMatch && batch.status !== 'exception' ? 'exception' : batch.status,
    exceptionReason: !isMatch ? 'On-chain anchor hash mismatch: local binding hash does not match anchored hash.' : batch.exceptionReason,
    auditTrail: hasEvent
      ? batch.auditTrail
      : [
          ...batch.auditTrail,
          {
            eventId,
            timestamp: new Date().toISOString(),
            actor: 'Escrow On-chain Verifier',
            eventType: isMatch
              ? 'Batch Authority Binding anchored on-chain'
              : 'Batch Authority Binding anchor hash mismatch',
            description: isMatch
              ? `batchAuthorityBindingHash anchored on-chain for sourceBatchId ${batch.sourceBatchId}. Anchor hash matches local binding. Batch is locked.`
              : `On-chain anchor for sourceBatchId ${batch.sourceBatchId} has hash ${onChainAnchor.batchAuthorityBindingHash} which does not match local hash ${binding.batchAuthorityBindingHash}. Batch is blocked.`,
            txHash: txHash,
            reference: binding.batchAuthorityBindingHash,
          },
        ],
  };
}

export function createAuthorityBindingAuditEvent(
  batchId: string,
  binding: BatchAuthorityBinding
): EscrowBatch['auditTrail'][number] {
  return {
    eventId: `${batchId}-authority-binding-created`,
    timestamp: binding.createdAt,
    actor: 'Escrow Service',
    eventType: 'Batch authority binding hash created',
    description: `EIP-712 Batch Authority Binding hash created and locked for chain ${binding.canonicalPayload.chainId} (${binding.networkLabel}): active Treasury, Vault, Escrow addresses, DAO system map hash, source batch, custody mode, amount, asset, term, and manifest hashes form the canonical typed payload.`,
    reference: binding.batchAuthorityBindingHash,
  };
}
