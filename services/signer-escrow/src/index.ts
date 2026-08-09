import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  Wallet,
  TypedDataEncoder,
  verifyTypedData,
  JsonRpcProvider,
  Contract,
  Interface,
  NonceManager,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from 'ethers';

// ─── Config ───────────────────────────────────────────────────────────────────

const ROLE = 'escrow' as const;
const ROLE_ID = 1;
const PORT = Number(process.env.PORT ?? 4002);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const DAO_SYSTEM_REGISTRY_VERSION = process.env.DAO_SYSTEM_REGISTRY_VERSION ?? 'v1.0.0-arc-testnet';

const TREASURY_ADDRESS = process.env.TREASURY_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.INVESTMENT_ESCROW_ADDRESS ?? '';
const VAULT_ADDRESS = process.env.VAULT_CONTRACT_ADDRESS ?? '';
const WALLET_FACTORY_URL = (process.env.WALLET_FACTORY_URL ?? '').replace(/\/$/, '');

const privateKey = process.env.ESCROW_SIGNER_PRIVATE_KEY;
if (!privateKey) {
  console.error('[signer-escrow] ESCROW_SIGNER_PRIVATE_KEY is not set. Exiting.');
  process.exit(1);
}

const wallet = new Wallet(privateKey);
const SIGNER_ADDRESS = wallet.address.toLowerCase();

// LEGACY: deterministic derivation from sourceBatchId alone.
// Invariant: signer services receive the authoritative UUID from the server lifecycle controller.
// This function exists only for backward compatibility with old flows. New code must not reach it.
function escrowBatchUuid(sourceBatchId: string): string {
  const hex = keccak256(toUtf8Bytes(JSON.stringify({
    sourceBatchId: String(sourceBatchId || '').trim(),
    type: 'sagitta_escrow_batch_uuid_v1',
  }))).slice(2);
  const variantByte = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantByte}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

console.log(`[signer-escrow] Role: ROLE_ESCROW (${ROLE_ID})`);
console.log(`[signer-escrow] Signer address: ${SIGNER_ADDRESS}`);
console.log(`[signer-escrow] RPC: ${RPC_URL}, chain: ${CHAIN_ID}`);

// ─── Contract ABIs ────────────────────────────────────────────────────────────

const TREASURY_ABI = [
  'function getTreasuryBatch(uint256 batchId) view returns (tuple(uint256 batchId,uint8 originType,uint256[] lotIds,uint256 principalAllocated,uint64 openedAt,uint64 expectedReturnAt,uint64 settlementDeadlineAt,uint64 actualReturnedAt,uint8 status))',
  'function originLots(uint256 lotId) view returns (uint256 id,uint8 originType,bytes32 originRefId,uint256 amount,uint64 fundedAt,uint64 liabilityUnlockAt,uint8 status,uint256 batchId)',
];

const ESCROW_ABI = [
  'function escrowBatchPositions(uint256 batchId) view returns (uint256 batchId,uint256 deployedPrincipal,uint64 expectedReturnAt,uint64 settlementDeadlineAt,bytes32 executionContextHash,uint64 actualReturnedAt,uint256 settlementAmount,uint8 status)',
  'function getBatchAccounting(uint256 batchId) view returns (tuple(uint256 principalAuthorizedUsd6,uint256 principalFundedUsd6,uint256 principalCommittedUsd6,uint256 principalReturnedUsd6,uint256 feesUsd6,int256 realizedPnlUsd6,int256 unrealizedPnlUsd6,uint256 lastMarkedAt,bool frozen))',
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer,uint8 status,uint64 updatedAt,address updatedBy,bool exists))',
  'function getBatchWalletBinding(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, address walletAddress, address ownerTreasury, address ownerEscrow, address ownerContinuity, uint8 threshold, address factory, bytes32 creationTxHash, uint64 boundAt, address boundBy, bool exists))',
  'function anchorBatchAuthorityBinding(uint256 sourceBatchId,bytes32 escrowBatchIdHash,bytes32 batchAuthorityBindingHash,bytes32 systemMapHash,address sourceContractAddress,address activeEscrowAddress,bytes treasurySignature,bytes escrowSignature) external',
  'function getBatchAuthorityAnchor(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash,bytes32 batchAuthorityBindingHash,bytes32 systemMapHash,address sourceContractAddress,address activeEscrowAddress,address treasurySignerAddress,address escrowSignerAddress,address anchoredBy,uint64 anchoredAt,bool exists))',
  'function keeper() view returns (address)',
  'function attachAllocation(uint256 sourceBatchId, bytes32 allocationPlanHash, bytes32 policyContextHash, string portfolioRegistryVersion) external',
  'function getAllocationAttachment(uint256 sourceBatchId) view returns (tuple(bytes32 allocationPlanHash, bytes32 policyContextHash, string portfolioRegistryVersion, address attachedBy, uint64 attachedAt, bool exists))',
  'function usdc() view returns (address)',
];

const BATCH_MULTISIG_WALLET_ABI = [
  'function transactionCount() view returns (uint256)',
  'function transactions(uint256 txIndex) view returns (address to, uint256 value, bytes data, bool executed, uint8 confirmationCount)',
  'function confirmed(uint256 txIndex, address owner) view returns (bool)',
  'function confirmTransaction(uint256 txIndex)',
  'event TransactionExecuted(uint256 indexed txIndex, address indexed executor)',
];

import { canonicalKeccak } from '../../shared/canonicalHash';
import {
  loadServiceSecurityConfig,
  createServiceAuthGuard,
  routeResolverFor,
  serviceSecuritySummary,
  ServiceSecurityConfigError,
  type ServiceSecurityConfig,
} from '../../shared/serviceGuard';
import { SERVICE_IDS } from '../../shared/routeAuthority';

// ─── EIP-712 helpers ──────────────────────────────────────────────────────────

function toAddr(v: string | undefined): string {
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : '0x0000000000000000000000000000000000000000';
}

function toB32(v: string | undefined): string {
  if (!v) return '0x' + '0'.repeat(64);
  const raw = v.startsWith('0x') ? v.slice(2) : v;
  return '0x' + (raw.length === 64 ? raw : raw.padStart(64, '0'));
}

const EIP712_DOMAIN_NAME = 'Sagitta Batch Authority Binding';
const EIP712_VERSION = '1';

const BINDING_TYPES = {
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
  ],
};

type ReconstructedPayload = {
  sourceType: string;
  sourceContractAddress: string;
  activeTreasuryAddress: string;
  activeVaultAddress: string;
  activeEscrowAddress: string;
  daoSystemRegistryVersion: string;
  systemMapHash: string;
  sourceBatchId: string;
  escrowBatchId: string;
  custodyMode: string;
  custodyLocation: string;
  asset: string;
  totalAmountUsd: number;
  termMonths: number;
  depositManifestHash: string;
  allocationPlanHash?: string;
  policyContextHash?: string;
  chainId: number;
  nonce: string;
};

function buildEip712Value(p: ReconstructedPayload) {
  return {
    sourceType: p.sourceType,
    sourceContractAddress: toAddr(p.sourceContractAddress),
    activeTreasuryAddress: toAddr(p.activeTreasuryAddress),
    activeVaultAddress: toAddr(p.activeVaultAddress),
    activeEscrowAddress: toAddr(p.activeEscrowAddress),
    daoSystemRegistryVersion: p.daoSystemRegistryVersion,
    systemMapHash: toB32(p.systemMapHash),
    sourceBatchId: p.sourceBatchId,
    escrowBatchId: p.escrowBatchId,
    custodyMode: p.custodyMode,
    custodyLocation: toAddr(p.custodyLocation),
    asset: p.asset,
    totalAmountUsd: BigInt(Math.round(p.totalAmountUsd * 1_000_000)),
    termMonths: BigInt(p.termMonths),
    depositManifestHash: toB32(p.depositManifestHash),
    allocationPlanHash: toB32(p.allocationPlanHash),
    policyContextHash: toB32(p.policyContextHash),
    chainId: BigInt(p.chainId),
    nonce: BigInt(p.nonce),
  };
}

// ─── Payload reconstruction ────────────────────────────────────────────────────

function termMonthsFrom(openedAt: number, endAt: number): number {
  if (!openedAt || !endAt || endAt <= openedAt) return 0;
  return Math.max(1, Math.round((endAt - openedAt) / (30 * 24 * 3600)));
}

async function reconstructPayload(sourceBatchId: string, escrowBatchId: string, custodyMode = 'batch_wallet_custody'): Promise<ReconstructedPayload> {
  const provider = new JsonRpcProvider(RPC_URL);
  const treasury = new Contract(TREASURY_ADDRESS, TREASURY_ABI, provider);
  const escrowContract = new Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

  // 1. Read Treasury batch.
  const batch = await treasury.getTreasuryBatch(BigInt(sourceBatchId));
  if (!batch || batch.batchId === 0n) throw new Error(`Treasury batch ${sourceBatchId} not found`);

  const originType = Number(batch.originType);
  const originSource = originType === 1 ? 'vault' : 'bank';
  const lotIds: number[] = (batch.lotIds as bigint[]).map(Number);
  const openedAt = Number(batch.openedAt);
  const expectedReturnAt = Number(batch.expectedReturnAt);

  const totalAmountUsd = Number(batch.principalAllocated) / 1_000_000;

  // Term months: use batch expectedReturnAt relative to openedAt — matches frontend fallbackTermMonths.
  const termMonths = termMonthsFrom(openedAt, expectedReturnAt) || 12;

  // 2. Read escrow batch position — must exist and show funded principal.
  const position = await escrowContract.escrowBatchPositions(BigInt(sourceBatchId));
  const executionContextHash = position?.executionContextHash
    ? String(position.executionContextHash)
    : '0x' + '0'.repeat(64);

  // Escrow signer requires the batch to be materialized on the escrow side.
  const deployedPrincipal = position ? Number(position.deployedPrincipal) / 1_000_000 : 0;
  const accounting = await escrowContract.getBatchAccounting(BigInt(sourceBatchId)).catch(() => null);
  const principalFunded = accounting ? Number(accounting.principalFundedUsd6) / 1_000_000 : 0;
  if (deployedPrincipal === 0 && principalFunded === 0) {
    throw new Error(
      `Escrow batch ${sourceBatchId} has no deployed principal or funded principal. ` +
      `The batch must be materialized and funded before the Escrow authority can sign.`
    );
  }

  // 3. Verify escrow role on-chain matches this service's key.
  const escrowRole = await escrowContract.getRoleAuthority(ROLE_ID);
  if (!escrowRole?.exists) throw new Error(`ROLE_ESCROW (${ROLE_ID}) not set on InvestmentEscrow`);
  if (Number(escrowRole.status) !== 0) throw new Error(`ROLE_ESCROW is not Active (status=${escrowRole.status})`);
  if (escrowRole.signer.toLowerCase() !== SIGNER_ADDRESS) {
    throw new Error(
      `On-chain ROLE_ESCROW signer (${escrowRole.signer}) does not match this service's key (${SIGNER_ADDRESS}). ` +
      `Call setRoleAuthority(1, ${SIGNER_ADDRESS}, Active) on InvestmentEscrow before signing.`
    );
  }

  // 4. Compute deterministic hashes — identical algorithm to signer-treasury and frontend.
  const depositManifestHash = canonicalKeccak({
    version: 1,
    type: 'treasury_deposit_manifest',
    treasuryBatchId: sourceBatchId,
    originSource,
    principalReceivedUsd: totalAmountUsd,
    lotIds,
    executionContextHash,
  });

  // 5. DAO system address matrix.
  const systemMapSource = JSON.stringify({
    treasury: TREASURY_ADDRESS.toLowerCase(),
    vault: VAULT_ADDRESS.toLowerCase(),
    escrow: ESCROW_ADDRESS.toLowerCase(),
    chainId: CHAIN_ID,
    version: DAO_SYSTEM_REGISTRY_VERSION,
  });
  const systemMapHash = keccak256(toUtf8Bytes(systemMapSource));

  // 6. Deterministic nonce.
  const nonce = keccak256(toUtf8Bytes(`sagitta:authority-nonce:${escrowBatchId}:${sourceBatchId}`));

  // sourceType mirrors frontend deriveSourceType(): escrow_contract_custody → 'vault'
  const sourceType = custodyMode === 'escrow_contract_custody' ? 'vault' : 'treasury';

  return {
    sourceType,
    sourceContractAddress: ESCROW_ADDRESS,
    activeTreasuryAddress: TREASURY_ADDRESS,
    activeVaultAddress: VAULT_ADDRESS,
    activeEscrowAddress: ESCROW_ADDRESS,
    daoSystemRegistryVersion: DAO_SYSTEM_REGISTRY_VERSION,
    systemMapHash,
    sourceBatchId,
    escrowBatchId,
    custodyMode,
    custodyLocation: ESCROW_ADDRESS,
    asset: 'USDC',
    totalAmountUsd,
    termMonths,
    depositManifestHash,
    allocationPlanHash: undefined,
    policyContextHash: undefined,
    chainId: CHAIN_ID,
    nonce,
  };
}

// ─── Audit log ─────────────────────────────────────────────────────────────────

function audit(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'signer-escrow', event, ...data }));
}

function normalizeAddress(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function getExecutedTransactionHash(multisig: Contract, txIndex: number): Promise<string> {
  const directEvents = await multisig.queryFilter(
    multisig.filters.TransactionExecuted(BigInt(txIndex)),
    -20000,
  ).catch(() => []);
  const directEvent = directEvents[directEvents.length - 1];
  if (directEvent?.transactionHash) {
    return String(directEvent.transactionHash);
  }

  const provider = (multisig.runner as any)?.provider;
  if (provider?.getLogs) {
    const rawLogs = await provider.getLogs({
      address: await multisig.getAddress(),
      fromBlock: 0,
      toBlock: 'latest',
      topics: multisig.interface.encodeFilterTopics('TransactionExecuted', [BigInt(txIndex)]),
    }).catch(() => []);
    const rawLog = rawLogs[rawLogs.length - 1];
    if (rawLog?.transactionHash) {
      return String(rawLog.transactionHash);
    }
  }

  const fallbackEvents = await multisig.queryFilter(
    multisig.filters.TransactionExecuted(),
    -20000,
  ).catch(() => []);
  const matchedEvent = [...fallbackEvents]
    .reverse()
    .find((event) => Number((event as any).args?.[0] ?? -1) === txIndex);

  return String(matchedEvent?.transactionHash ?? '');
}

// ─── App ───────────────────────────────────────────────────────────────────────

// ── Security configuration — fail closed before the listener exists ──────────
// This service holds ESCROW_SIGNER_PRIVATE_KEY and submits anchor and
// allocation transactions. A misconfigured start would expose both.
let SECURITY: ServiceSecurityConfig;
try {
  SECURITY = loadServiceSecurityConfig({ serviceId: SERVICE_IDS.signerEscrow });
} catch (err) {
  if (err instanceof ServiceSecurityConfigError) {
    console.error('[security] STARTUP ABORTED — signer-escrow security configuration is invalid');
    for (const problem of err.problems) console.error(`[security] ✗ ${problem}`);
    process.exit(1);
  }
  throw err;
}
console.log('[security] Configuration validated', serviceSecuritySummary(SECURITY));

// Contract binding is opt-in during rollout: both sides must resolve the same
// address or every call fails closed. Confirm agreement, then set this to true.
const BIND_CONTRACT = String(process.env.SIGNER_BIND_CONTRACT ?? '').toLowerCase() === 'true';

const app = express();
app.disable('x-powered-by');

// CORS supplements authentication for browsers. It is not the boundary.
app.use(cors({ origin: CORS_ORIGIN }));
// `verify` records the EXACT received bytes so the guard can bind the
// assertion's body digest to them.
app.use(express.json({
  limit: '256kb',
  verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); },
}));

// Minimal by contract — no signer address, role id, or chain configuration.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'signer-escrow', version: '1.0.0' });
});

app.get('/ready', (_req: Request, res: Response) => {
  res.json({ ready: true, environment: SECURITY.environment });
});

// Everything past this point requires an authenticated, approved service caller.
// Signer assertions must name the chain and contract this service is
// configured for, and the operation they authorize. A token minted for a
// different chain or a different operation is refused even if it is otherwise
// valid — signature production is bound to one concrete on-chain action.
app.use(createServiceAuthGuard(SECURITY, routeResolverFor(SERVICE_IDS.signerEscrow), {
  requiredContext: (route) => ({
    chainId: CHAIN_ID,
    op: route.path.slice(1),
    contract: BIND_CONTRACT ? ((ESCROW_ADDRESS || '').toLowerCase() || undefined) : undefined,
  }),
}) as any);


// ─── POST /request-signature ──────────────────────────────────────────────────
// Body: { sourceBatchId: string, escrowBatchId?: string, chainId?: number }
// Service reads chain state, independently reconstructs the canonical payload, and signs.

app.post('/request-signature', async (req: Request, res: Response) => {
  const { sourceBatchId, escrowBatchId, chainId, custodyMode } = req.body ?? {};

  if (!sourceBatchId || typeof sourceBatchId !== 'string') {
    res.status(400).json({ error: 'sourceBatchId is required' });
    return;
  }

  const resolvedEscrowBatchId = typeof escrowBatchId === 'string' && escrowBatchId
    ? escrowBatchId
    : escrowBatchUuid(sourceBatchId); // LEGACY FALLBACK — caller must pass server UUID

  const resolvedCustodyMode = typeof custodyMode === 'string' && custodyMode
    ? custodyMode
    : 'batch_wallet_custody';

  if (typeof chainId === 'number' && chainId !== CHAIN_ID) {
    audit('sign_rejected', { reason: 'chain_id_mismatch', sourceBatchId, requestedChainId: chainId, configuredChainId: CHAIN_ID });
    res.status(400).json({ error: `Chain ID mismatch: request says ${chainId}, service is configured for ${CHAIN_ID}` });
    return;
  }

  audit('sign_requested', { sourceBatchId, escrowBatchId: resolvedEscrowBatchId, custodyMode: resolvedCustodyMode });

  let payload: ReconstructedPayload;
  try {
    payload = await reconstructPayload(sourceBatchId, resolvedEscrowBatchId, resolvedCustodyMode);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('sign_rejected', { reason: 'reconstruction_failed', sourceBatchId, error: msg });
    res.status(400).json({ error: `Payload reconstruction failed: ${msg}` });
    return;
  }

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: toAddr(ESCROW_ADDRESS),
  };
  const value = buildEip712Value(payload);
  const bindingHash = TypedDataEncoder.hash(domain, BINDING_TYPES, value);

  let signature: string;
  try {
    signature = await wallet.signTypedData(domain, BINDING_TYPES, value);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('sign_error', { sourceBatchId, error: msg });
    res.status(500).json({ error: `Signing failed: ${msg}` });
    return;
  }

  const recovered = verifyTypedData(domain, BINDING_TYPES, value, signature).toLowerCase();
  if (recovered !== SIGNER_ADDRESS) {
    audit('sign_error', { reason: 'recovery_mismatch', sourceBatchId, expected: SIGNER_ADDRESS, recovered });
    res.status(500).json({ error: 'Internal error: recovered signer mismatch after signing.' });
    return;
  }

  const signedAt = new Date().toISOString();
  audit('signed', {
    sourceBatchId,
    escrowBatchId: resolvedEscrowBatchId,
    bindingHash,
    signerAddress: SIGNER_ADDRESS,
    totalAmountUsd: payload.totalAmountUsd,
    chainId: CHAIN_ID,
    signedAt,
  });

  res.json({
    role: ROLE,
    signature,
    signerAddress: SIGNER_ADDRESS,
    recoveredAddress: recovered,
    bindingHash,
    signedAt,
    sourceBatchId,
    escrowBatchId: resolvedEscrowBatchId,
    reconstructedPayload: payload,
  });
});

// ─── POST /anchor ─────────────────────────────────────────────────────────────
// Body: { sourceBatchId, escrowBatchId?, treasurySignature, escrowSignature, batchAuthorityBindingHash }
// Submits anchorBatchAuthorityBinding() on-chain. Uses the escrow signer key to pay gas.
// The signatures must have been produced by the respective signer services.
// The binding hash is reconstructed locally and cross-checked against the provided hash before submitting.

app.post('/anchor', async (req: Request, res: Response) => {
  const { sourceBatchId, escrowBatchId, treasurySignature, escrowSignature, batchAuthorityBindingHash, custodyMode } = req.body ?? {};

  if (!sourceBatchId || !treasurySignature || !escrowSignature || !batchAuthorityBindingHash) {
    res.status(400).json({ error: 'Required: sourceBatchId, treasurySignature, escrowSignature, batchAuthorityBindingHash' });
    return;
  }

  const resolvedEscrowBatchId = typeof escrowBatchId === 'string' && escrowBatchId
    ? escrowBatchId
    : escrowBatchUuid(String(sourceBatchId)); // LEGACY FALLBACK — caller must pass server UUID

  const resolvedCustodyMode = typeof custodyMode === 'string' && custodyMode
    ? custodyMode
    : 'batch_wallet_custody';

  // Reconstruct payload from chain to get systemMapHash and verify binding hash.
  let payload: ReconstructedPayload;
  try {
    payload = await reconstructPayload(String(sourceBatchId), resolvedEscrowBatchId, resolvedCustodyMode);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('anchor_rejected', { reason: 'reconstruction_failed', sourceBatchId, error: msg });
    res.status(400).json({ error: `Payload reconstruction failed: ${msg}` });
    return;
  }

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: toAddr(ESCROW_ADDRESS),
  };
  const value = buildEip712Value(payload);
  const localBindingHash = TypedDataEncoder.hash(domain, BINDING_TYPES, value);

  if (localBindingHash.toLowerCase() !== String(batchAuthorityBindingHash).toLowerCase()) {
    audit('anchor_rejected', {
      reason: 'binding_hash_mismatch',
      sourceBatchId,
      localHash: localBindingHash,
      providedHash: batchAuthorityBindingHash,
    });
    res.status(400).json({
      error: 'Binding hash mismatch: locally reconstructed hash differs from provided batchAuthorityBindingHash.',
      localHash: localBindingHash,
      providedHash: batchAuthorityBindingHash,
    });
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const anchorWallet = wallet.connect(provider);
  const escrowContract = new Contract(ESCROW_ADDRESS, ESCROW_ABI, anchorWallet);

  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(String(sourceBatchId));
  } catch {
    res.status(400).json({ error: `sourceBatchId "${sourceBatchId}" cannot be converted to uint256` });
    return;
  }

  const escrowBatchIdHash = keccak256(toUtf8Bytes(resolvedEscrowBatchId));

  // ── Idempotency check: skip tx if already anchored with the same hash ─────────
  // This prevents nonce collisions when the frontend auto-anchor effect fires a
  // second time before the batch state has updated from the first response.
  try {
    const existing = await escrowContract.getBatchAuthorityAnchor(sourceBatchIdNum);
    if (existing?.exists) {
      if (String(existing.batchAuthorityBindingHash).toLowerCase() === localBindingHash.toLowerCase()) {
        audit('anchor_already_exists', { sourceBatchId, localBindingHash });
        const anchoredAt = new Date(Number(existing.anchoredAt) * 1000).toISOString();
        // Fall through to wallet creation using the existing anchor evidence.
        const txHash = '';
        const blockNumber = 0;
        let walletResult: Record<string, unknown> | null = null;
        if (custodyMode === 'batch_wallet_custody' && WALLET_FACTORY_URL) {
          try {
            const wfRes = await fetch(`${WALLET_FACTORY_URL}/create-batch-wallet`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceBatchId: String(sourceBatchId), escrowBatchId: resolvedEscrowBatchId, batchAuthorityBindingHash: localBindingHash }),
            });
            const wfData = await wfRes.json() as Record<string, unknown>;
            walletResult = wfRes.ok ? wfData : { error: wfData.error };
          } catch (wfErr: unknown) {
            walletResult = { error: wfErr instanceof Error ? wfErr.message : String(wfErr) };
          }
        }
        res.json({ txHash, blockNumber, anchoredAt, sourceBatchId, escrowBatchId: resolvedEscrowBatchId, bindingHash: localBindingHash, ...(walletResult ? { wallet: walletResult } : {}) });
        return;
      }
      res.status(400).json({ error: `Batch ${sourceBatchId} is already anchored with a different binding hash. Cannot re-anchor.` });
      return;
    }
  } catch {
    // On-chain read failed — proceed to submit tx and let the contract decide.
  }

  audit('anchor_submitting', {
    sourceBatchId,
    escrowBatchId: resolvedEscrowBatchId,
    localBindingHash,
    anchorCaller: SIGNER_ADDRESS,
  });

  try {
    const tx = await escrowContract.anchorBatchAuthorityBinding(
      sourceBatchIdNum,
      escrowBatchIdHash,
      localBindingHash,
      toB32(payload.systemMapHash),
      toAddr(payload.sourceContractAddress),
      toAddr(payload.activeEscrowAddress),
      treasurySignature,
      escrowSignature,
    );
    const receipt = await tx.wait();
    const txHash = String(receipt.hash ?? tx.hash);
    const blockNumber = Number(receipt.blockNumber ?? 0);
    const anchoredAt = new Date().toISOString();

    audit('anchor_confirmed', { sourceBatchId, txHash, blockNumber, anchoredAt });

    // ── Inline wallet creation for batch_wallet_custody ──────────────────────────
    // If the anchor request declared batch_wallet_custody and the wallet-factory is
    // configured, create and bind the 2-of-3 multisig immediately — no frontend
    // involvement required. The wallet evidence is returned in the same response.
    let walletResult: Record<string, unknown> | null = null;
    if (custodyMode === 'batch_wallet_custody' && WALLET_FACTORY_URL) {
      audit('wallet_create_starting', { sourceBatchId, escrowBatchId: resolvedEscrowBatchId });
      try {
        const wfRes = await fetch(`${WALLET_FACTORY_URL}/create-batch-wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBatchId: String(sourceBatchId),
            escrowBatchId: resolvedEscrowBatchId,
            batchAuthorityBindingHash: localBindingHash,
          }),
        });
        const wfData = await wfRes.json() as Record<string, unknown>;
        if (!wfRes.ok) {
          audit('wallet_create_failed', { sourceBatchId, error: wfData.error });
          walletResult = { error: wfData.error };
        } else {
          audit('wallet_create_succeeded', { sourceBatchId, walletAddress: wfData.walletAddress });
          walletResult = wfData;
        }
      } catch (wfErr: unknown) {
        const wfMsg = wfErr instanceof Error ? wfErr.message : String(wfErr);
        audit('wallet_create_error', { sourceBatchId, error: wfMsg });
        walletResult = { error: wfMsg };
      }
    }

    res.json({
      txHash,
      blockNumber,
      anchoredAt,
      sourceBatchId,
      escrowBatchId: resolvedEscrowBatchId,
      bindingHash: localBindingHash,
      ...(walletResult ? { wallet: walletResult } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('anchor_error', { sourceBatchId, error: msg });
    res.status(500).json({ error: `Anchor transaction failed: ${msg}` });
  }
});

// ─── POST /attach-allocation ──────────────────────────────────────────────────
// Submits attachAllocation() on-chain using the service's private key.
// Idempotent: if the exact same hashes are already attached, returns success.

app.post('/attach-allocation', async (req: Request, res: Response) => {
  const { sourceBatchId, allocationPlanHash, policyContextHash, portfolioRegistryVersion } = req.body ?? {};

  if (!sourceBatchId || !allocationPlanHash || !policyContextHash || !portfolioRegistryVersion) {
    res.status(400).json({ error: 'Required: sourceBatchId, allocationPlanHash, policyContextHash, portfolioRegistryVersion' });
    return;
  }

  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(String(sourceBatchId));
  } catch {
    res.status(400).json({ error: `sourceBatchId "${sourceBatchId}" cannot be converted to uint256` });
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const anchorWallet = wallet.connect(provider);
  const escrowContract = new Contract(ESCROW_ADDRESS, ESCROW_ABI, anchorWallet);

  try {
    // Idempotency: if already attached with matching hashes, return immediately.
    const existing = await escrowContract.getAllocationAttachment(sourceBatchIdNum);
    if (existing?.exists) {
      const chainPlanHash = String(existing.allocationPlanHash ?? existing[0]);
      const chainPolicyHash = String(existing.policyContextHash ?? existing[1]);
      const chainVersion = String(existing.portfolioRegistryVersion ?? existing[2]);
      if (
        chainPlanHash.toLowerCase() === String(allocationPlanHash).toLowerCase() &&
        chainPolicyHash.toLowerCase() === String(policyContextHash).toLowerCase() &&
        chainVersion === String(portfolioRegistryVersion)
      ) {
        audit('attach_allocation_already_exists', { sourceBatchId });
        const attachedAt = new Date(Number(existing.attachedAt ?? existing[4]) * 1000).toISOString();
        res.json({ txHash: '', attachedAt, alreadyAttached: true });
        return;
      }
    }

    const keeper = await escrowContract.keeper().catch(() => '');
    if (String(keeper).toLowerCase() !== SIGNER_ADDRESS) {
      throw new Error(
        `Escrow signer service is not InvestmentEscrow keeper. ` +
        `Current keeper: ${keeper || 'unavailable'}, service signer: ${SIGNER_ADDRESS}. ` +
        `Run npm run init-roles or node scripts/set-keeper.mjs, then restart signer-escrow.`
      );
    }

    audit('attach_allocation_submitting', { sourceBatchId, allocationPlanHash, policyContextHash, portfolioRegistryVersion });
    const tx = await escrowContract.attachAllocation(
      sourceBatchIdNum,
      String(allocationPlanHash),
      String(policyContextHash),
      String(portfolioRegistryVersion),
    );
    const receipt = await tx.wait();
    const attachedAt = new Date().toISOString();
    audit('attach_allocation_confirmed', { sourceBatchId, txHash: receipt?.hash ?? tx.hash });
    res.json({ txHash: receipt?.hash ?? tx.hash, attachedAt, alreadyAttached: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('attach_allocation_error', { sourceBatchId, error: msg });
    res.status(500).json({ error: `attachAllocation failed: ${msg}` });
  }
});

app.post('/confirm-deploy-leg', async (req: Request, res: Response) => {
  const {
    sourceBatchId,
    escrowBatchId,
    walletAddress,
    assetSymbol,
    amount,
    destinationAddress,
    txIndex,
    chainId,
  } = req.body ?? {};

  if (
    !sourceBatchId ||
    !walletAddress ||
    !assetSymbol ||
    !amount ||
    !destinationAddress ||
    txIndex == null
  ) {
    res.status(400).json({ error: 'Required: sourceBatchId, walletAddress, assetSymbol, amount, destinationAddress, txIndex' });
    return;
  }
  if (typeof chainId === 'number' && chainId !== CHAIN_ID) {
    res.status(400).json({ error: `Chain ID mismatch: request says ${chainId}, service is configured for ${CHAIN_ID}` });
    return;
  }
  if (!isAddress(String(walletAddress)) || !isAddress(String(destinationAddress))) {
    res.status(400).json({ error: 'walletAddress and destinationAddress must be valid EVM addresses.' });
    return;
  }

  const normalizedAssetSymbol = String(assetSymbol).trim().toUpperCase();
  if (!normalizedAssetSymbol) {
    res.status(400).json({ error: 'assetSymbol is required.' });
    return;
  }

  let sourceBatchIdNum: bigint;
  let txIndexNum: number;
  let amountUnits: bigint;
  try {
    sourceBatchIdNum = BigInt(String(sourceBatchId));
    txIndexNum = Number(txIndex);
    amountUnits = parseUnits(String(amount), 6);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!Number.isInteger(txIndexNum) || txIndexNum < 0) {
    res.status(400).json({ error: 'txIndex must be a non-negative integer.' });
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new NonceManager(wallet.connect(provider));
  const escrowContract = new Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

  try {
    const binding = await escrowContract.getBatchWalletBinding(sourceBatchIdNum);
    if (!binding?.exists) {
      throw new Error(`Batch wallet binding not found for sourceBatchId ${sourceBatchId}.`);
    }
    if (normalizeAddress(binding.walletAddress) !== normalizeAddress(walletAddress)) {
      throw new Error('Batch wallet address does not match the on-chain binding.');
    }
    if (normalizeAddress(binding.ownerEscrow) !== SIGNER_ADDRESS) {
      throw new Error('Escrow signer service key does not match the bound Escrow wallet owner.');
    }
    if (Number(binding.threshold) !== 2) {
      throw new Error(`Batch wallet threshold must be 2. Found ${binding.threshold}.`);
    }

    const usdcAddress = String(await escrowContract.usdc());
    if (!isAddress(usdcAddress)) {
      throw new Error('USDC token address is unavailable on-chain.');
    }

    const transferInterface = new Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]);

    const multisigRead = new Contract(String(walletAddress), BATCH_MULTISIG_WALLET_ABI, provider);
    const tx = await multisigRead.transactions(txIndexNum).catch(() => null);
    if (!tx) {
      throw new Error(`Batch multisig transaction ${txIndexNum} does not exist.`);
    }

    const txTo = String(tx.to ?? tx[0] ?? '');
    const txValue = BigInt(tx.value ?? tx[1] ?? 0);
    const txData = String(tx.data ?? tx[2] ?? '').toLowerCase();
    const alreadyExecuted = Boolean(tx.executed ?? tx[3] ?? false);

    // Decode actual transfer amount from on-chain tx data and verify within dust tolerance.
    // The submitted amount may be up to 100 micro-USDC less than requested due to per-leg
    // integer division rounding in simulate-leg-returns (treasury side adjusts to wallet balance).
    const DUST_TOLERANCE_UNITS = 100n;
    let actualAmountUnits = amountUnits;
    try {
      const decoded = transferInterface.decodeFunctionData('transfer', txData);
      actualAmountUnits = BigInt(decoded[1]);
    } catch { /* fall through to strict check below */ }

    const transferData = transferInterface.encodeFunctionData('transfer', [String(destinationAddress), actualAmountUnits]).toLowerCase();
    if (
      normalizeAddress(txTo) !== normalizeAddress(usdcAddress) ||
      txValue !== 0n ||
      txData !== transferData ||
      actualAmountUnits > amountUnits ||
      amountUnits - actualAmountUnits > DUST_TOLERANCE_UNITS
    ) {
      throw new Error('Batch multisig transaction does not match the approved deployment transfer leg.');
    }
    amountUnits = actualAmountUnits;

    const alreadyConfirmed = Boolean(await multisigRead.confirmed(txIndexNum, SIGNER_ADDRESS).catch(() => false));

    audit('deploy_leg_confirm_requested', {
      sourceBatchId,
      escrowBatchId,
      assetSymbol: normalizedAssetSymbol,
      walletAddress,
      destinationAddress,
      amount,
      txIndex: txIndexNum,
      alreadyConfirmed,
      alreadyExecuted,
    });

    let confirmTxHash = '';
    let deploymentTxHash = alreadyExecuted ? await getExecutedTransactionHash(multisigRead, txIndexNum) : '';

    if (!alreadyExecuted && !alreadyConfirmed) {
      const multisigWrite = new Contract(String(walletAddress), BATCH_MULTISIG_WALLET_ABI, signer);
      const confirmTx = await multisigWrite.confirmTransaction(txIndexNum);
      const receipt = await confirmTx.wait();
      confirmTxHash = String(receipt?.hash ?? confirmTx.hash);
      deploymentTxHash = confirmTxHash;
      audit('deploy_leg_escrow_confirmed', { sourceBatchId, txIndex: txIndexNum, confirmTxHash });
    } else if (!deploymentTxHash) {
      deploymentTxHash = await getExecutedTransactionHash(multisigRead, txIndexNum);
    }

    const finalTx = await multisigRead.transactions(txIndexNum);
    if (!Boolean(finalTx.executed ?? finalTx[3] ?? false)) {
      throw new Error('Batch multisig transaction is still not executed after escrow confirmation.');
    }

    const executedAt = new Date().toISOString();
    const confirmedAt = new Date().toISOString();
    res.json({
      role: ROLE,
      signerAddress: SIGNER_ADDRESS,
      sourceBatchId: String(sourceBatchId),
      escrowBatchId: typeof escrowBatchId === 'string' && escrowBatchId ? escrowBatchId : escrowBatchUuid(String(sourceBatchId)), // LEGACY FALLBACK
      walletAddress: String(walletAddress),
      assetSymbol: normalizedAssetSymbol,
      amount: String(amount),
      destinationAddress: String(destinationAddress),
      txIndex: txIndexNum,
      confirmTxHash,
      deploymentTxHash,
      confirmedAt,
      executedAt,
      alreadyConfirmed,
      alreadyExecuted,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('deploy_leg_confirm_error', { sourceBatchId, assetSymbol: normalizedAssetSymbol, walletAddress, destinationAddress, amount, txIndex, error: msg });
    res.status(500).json({ error: `Escrow confirm-deploy-leg failed: ${msg}` });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[signer-escrow] Unhandled error:', msg);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[signer-escrow] Listening on port ${PORT}`);
  audit('startup', { port: PORT, signerAddress: SIGNER_ADDRESS, chainId: CHAIN_ID });
});
