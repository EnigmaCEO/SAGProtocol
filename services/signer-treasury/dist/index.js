"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ethers_1 = require("ethers");
// ─── Config ───────────────────────────────────────────────────────────────────
const ROLE = 'treasury';
const ROLE_ID = 0;
const PORT = Number(process.env.PORT ?? 4001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const DAO_SYSTEM_REGISTRY_VERSION = process.env.DAO_SYSTEM_REGISTRY_VERSION ?? 'v1.0.0-arc-testnet';
const TREASURY_ADDRESS = process.env.TREASURY_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.INVESTMENT_ESCROW_ADDRESS ?? '';
const VAULT_ADDRESS = process.env.VAULT_CONTRACT_ADDRESS ?? '';
const privateKey = process.env.TREASURY_SIGNER_PRIVATE_KEY;
if (!privateKey) {
    console.error('[signer-treasury] TREASURY_SIGNER_PRIVATE_KEY is not set. Exiting.');
    process.exit(1);
}
const wallet = new ethers_1.Wallet(privateKey);
const SIGNER_ADDRESS = wallet.address.toLowerCase();
console.log(`[signer-treasury] Role: ROLE_TREASURY_VAULT (${ROLE_ID})`);
console.log(`[signer-treasury] Signer address: ${SIGNER_ADDRESS}`);
console.log(`[signer-treasury] RPC: ${RPC_URL}, chain: ${CHAIN_ID}`);
// ─── Contract ABIs (minimal read-only subsets) ────────────────────────────────
const TREASURY_ABI = [
    'function getTreasuryBatch(uint256 batchId) view returns (tuple(uint256 batchId,uint8 originType,uint256[] lotIds,uint256 principalAllocated,uint64 openedAt,uint64 expectedReturnAt,uint64 settlementDeadlineAt,uint64 actualReturnedAt,uint8 status))',
    'function originLots(uint256 lotId) view returns (uint256 id,uint8 originType,bytes32 originRefId,uint256 amount,uint64 fundedAt,uint64 liabilityUnlockAt,uint8 status,uint256 batchId)',
];
const ESCROW_ABI = [
    'function escrowBatchPositions(uint256 batchId) view returns (uint256 batchId,uint256 deployedPrincipal,uint64 expectedReturnAt,uint64 settlementDeadlineAt,bytes32 executionContextHash,uint64 actualReturnedAt,uint256 settlementAmount,uint8 status)',
    'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer,uint8 status,uint64 updatedAt,address updatedBy,bool exists))',
];
const canonicalHash_1 = require("../../shared/canonicalHash");
// ─── EIP-712 helpers (mirrors frontend escrowAuthorityBinding.ts) ──────────────
function toAddr(v) {
    return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : '0x0000000000000000000000000000000000000000';
}
function toB32(v) {
    if (!v)
        return '0x' + '0'.repeat(64);
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
function buildEip712Value(p) {
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
function secondsToIso(secs) {
    return Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : undefined;
}
function termMonthsFrom(openedAt, endAt) {
    if (!openedAt || !endAt || endAt <= openedAt)
        return 0;
    return Math.max(1, Math.round((endAt - openedAt) / (30 * 24 * 3600)));
}
async function reconstructPayload(sourceBatchId, escrowBatchId, custodyMode = 'batch_wallet_custody') {
    const provider = new ethers_1.JsonRpcProvider(RPC_URL);
    const treasury = new ethers_1.Contract(TREASURY_ADDRESS, TREASURY_ABI, provider);
    const escrow = new ethers_1.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
    // 1. Read Treasury batch.
    const batch = await treasury.getTreasuryBatch(BigInt(sourceBatchId));
    if (!batch || batch.batchId === 0n)
        throw new Error(`Treasury batch ${sourceBatchId} not found`);
    const originType = Number(batch.originType);
    const originSource = originType === 1 ? 'vault' : 'bank';
    const lotIds = batch.lotIds.map(Number);
    const openedAt = Number(batch.openedAt);
    const expectedReturnAt = Number(batch.expectedReturnAt);
    const settlementDeadlineAt = Number(batch.settlementDeadlineAt);
    // 2. Read individual lots for amount and term computation.
    const lots = await Promise.all(lotIds.map((id) => treasury.originLots(BigInt(id))));
    const totalAmountUsd = Number(batch.principalAllocated) / 1_000_000;
    // Term months: use batch expectedReturnAt relative to openedAt — matches frontend fallbackTermMonths.
    const termMonths = termMonthsFrom(openedAt, expectedReturnAt) || 12;
    // 3. Read escrow batch position for executionContextHash.
    const position = await escrow.escrowBatchPositions(BigInt(sourceBatchId));
    const executionContextHash = position?.executionContextHash
        ? String(position.executionContextHash)
        : '0x' + '0'.repeat(64);
    // 4. Verify treasury role is active on-chain and matches this service's key.
    const tvRole = await escrow.getRoleAuthority(ROLE_ID);
    if (!tvRole?.exists)
        throw new Error(`ROLE_TREASURY_VAULT (${ROLE_ID}) not set on InvestmentEscrow`);
    if (Number(tvRole.status) !== 0)
        throw new Error(`ROLE_TREASURY_VAULT is not Active (status=${tvRole.status})`);
    if (tvRole.signer.toLowerCase() !== SIGNER_ADDRESS) {
        throw new Error(`On-chain ROLE_TREASURY_VAULT signer (${tvRole.signer}) does not match this service's key (${SIGNER_ADDRESS}). ` +
            `Call setRoleAuthority(0, ${SIGNER_ADDRESS}, Active) on InvestmentEscrow before signing.`);
    }
    // 5. Compute deterministic hashes — same algorithm as frontend EscrowTab.tsx.
    const depositManifestHash = (0, canonicalHash_1.canonicalKeccak)({
        version: 1,
        type: 'treasury_deposit_manifest',
        treasuryBatchId: sourceBatchId,
        originSource,
        principalReceivedUsd: totalAmountUsd,
        lotIds,
        executionContextHash,
    });
    // 6. Build DAO system address matrix.
    const systemMapSource = JSON.stringify({
        treasury: TREASURY_ADDRESS.toLowerCase(),
        vault: VAULT_ADDRESS.toLowerCase(),
        escrow: ESCROW_ADDRESS.toLowerCase(),
        chainId: CHAIN_ID,
        version: DAO_SYSTEM_REGISTRY_VERSION,
    });
    const systemMapHash = (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(systemMapSource));
    // 7. Deterministic nonce.
    const nonce = (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(`sagitta:authority-nonce:${escrowBatchId}:${sourceBatchId}`));
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
function audit(event, data) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'signer-treasury', event, ...data }));
}
// ─── App ───────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json());
app.get('/health', (_req, res) => {
    res.json({ role: ROLE, roleId: ROLE_ID, signerAddress: SIGNER_ADDRESS, version: '1.0.0' });
});
// POST /request-signature
// Body: { sourceBatchId: string, escrowBatchId: string, chainId?: number }
// The service reconstructs the full canonical payload from chain state and signs it.
// The client never supplies the payload — only batch identifiers.
app.post('/request-signature', async (req, res) => {
    const { sourceBatchId, escrowBatchId, chainId, custodyMode } = req.body ?? {};
    if (!sourceBatchId || typeof sourceBatchId !== 'string') {
        res.status(400).json({ error: 'sourceBatchId is required' });
        return;
    }
    const resolvedEscrowBatchId = typeof escrowBatchId === 'string' && escrowBatchId
        ? escrowBatchId
        : `escrow-${sourceBatchId}`;
    const resolvedCustodyMode = typeof custodyMode === 'string' && custodyMode
        ? custodyMode
        : 'batch_wallet_custody';
    if (typeof chainId === 'number' && chainId !== CHAIN_ID) {
        audit('sign_rejected', { reason: 'chain_id_mismatch', sourceBatchId, requestedChainId: chainId, configuredChainId: CHAIN_ID });
        res.status(400).json({ error: `Chain ID mismatch: request says ${chainId}, service is configured for ${CHAIN_ID}` });
        return;
    }
    audit('sign_requested', { sourceBatchId, escrowBatchId: resolvedEscrowBatchId, custodyMode: resolvedCustodyMode });
    let payload;
    try {
        payload = await reconstructPayload(sourceBatchId, resolvedEscrowBatchId, resolvedCustodyMode);
    }
    catch (err) {
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
    const bindingHash = ethers_1.TypedDataEncoder.hash(domain, BINDING_TYPES, value);
    let signature;
    try {
        signature = await wallet.signTypedData(domain, BINDING_TYPES, value);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        audit('sign_error', { sourceBatchId, error: msg });
        res.status(500).json({ error: `Signing failed: ${msg}` });
        return;
    }
    const recovered = (0, ethers_1.verifyTypedData)(domain, BINDING_TYPES, value, signature).toLowerCase();
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
        // Return the reconstructed payload so the caller can verify or store it.
        // This is informational — the caller must NOT re-submit this to get a signature.
        reconstructedPayload: payload,
    });
});
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use((err, _req, res, _next) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[signer-treasury] Unhandled error:', msg);
    res.status(500).json({ error: 'Internal server error' });
});
app.listen(PORT, () => {
    console.log(`[signer-treasury] Listening on port ${PORT}`);
    audit('startup', { port: PORT, signerAddress: SIGNER_ADDRESS, chainId: CHAIN_ID });
});
