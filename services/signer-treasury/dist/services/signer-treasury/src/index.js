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
function escrowBatchUuid(sourceBatchId) {
    const hex = (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(JSON.stringify({
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
    'function getBatchWalletBinding(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, address walletAddress, address ownerTreasury, address ownerEscrow, address ownerContinuity, uint8 threshold, address factory, bytes32 creationTxHash, uint64 boundAt, address boundBy, bool exists))',
    'function usdc() view returns (address)',
];
const BATCH_MULTISIG_WALLET_ABI = [
    'function getOwners() view returns (address[3])',
    'function transactionCount() view returns (uint256)',
    'function transactions(uint256 txIndex) view returns (address to, uint256 value, bytes data, bool executed, uint8 confirmationCount)',
    'function confirmed(uint256 txIndex, address owner) view returns (bool)',
    'function submitTransaction(address to, uint256 value, bytes data) returns (uint256)',
    'function confirmTransaction(uint256 txIndex)',
];
const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
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
    // 2. Use treasury batch principal and timing for amount and term computation.
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
function normalizeAddress(value) {
    return String(value ?? '').toLowerCase();
}
function isAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
}
async function findMatchingTransaction(params) {
    const { multisig, to, data } = params;
    const txCount = Number(await multisig.transactionCount());
    for (let txIndex = txCount - 1; txIndex >= 0; txIndex -= 1) {
        const tx = await multisig.transactions(txIndex).catch(() => null);
        if (!tx)
            continue;
        const txTo = String(tx.to ?? tx[0] ?? '');
        const txValue = BigInt(tx.value ?? tx[1] ?? 0);
        const txData = String(tx.data ?? tx[2] ?? '').toLowerCase();
        if (normalizeAddress(txTo) !== normalizeAddress(to) || txValue !== 0n || txData !== data)
            continue;
        const treasuryConfirmed = Boolean(await multisig.confirmed(txIndex, SIGNER_ADDRESS).catch(() => false));
        return {
            txIndex,
            executed: Boolean(tx.executed ?? tx[3] ?? false),
            treasuryConfirmed,
        };
    }
    return null;
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
        : escrowBatchUuid(sourceBatchId);
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
app.post('/deploy-leg', async (req, res) => {
    const { sourceBatchId, escrowBatchId, walletAddress, assetSymbol, amount, destinationAddress, chainId, } = req.body ?? {};
    if (!sourceBatchId || !walletAddress || !assetSymbol || !amount || !destinationAddress) {
        res.status(400).json({ error: 'Required: sourceBatchId, walletAddress, assetSymbol, amount, destinationAddress' });
        return;
    }
    if (typeof chainId === 'number' && chainId !== CHAIN_ID) {
        res.status(400).json({ error: `Chain ID mismatch: request says ${chainId}, service is configured for ${CHAIN_ID}` });
        return;
    }
    if (String(assetSymbol).toUpperCase() !== 'USDC') {
        res.status(400).json({ error: 'Only USDC deployment is supported.' });
        return;
    }
    if (!isAddress(String(walletAddress)) || !isAddress(String(destinationAddress))) {
        res.status(400).json({ error: 'walletAddress and destinationAddress must be valid EVM addresses.' });
        return;
    }
    const provider = new ethers_1.JsonRpcProvider(RPC_URL);
    const signer = new ethers_1.NonceManager(wallet.connect(provider));
    const escrow = new ethers_1.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
    let sourceBatchIdNum;
    let amountUnits;
    try {
        sourceBatchIdNum = BigInt(String(sourceBatchId));
        amountUnits = (0, ethers_1.parseUnits)(String(amount), 6);
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
    }
    try {
        const binding = await escrow.getBatchWalletBinding(sourceBatchIdNum);
        if (!binding?.exists) {
            throw new Error(`Batch wallet binding not found for sourceBatchId ${sourceBatchId}.`);
        }
        if (normalizeAddress(binding.walletAddress) !== normalizeAddress(walletAddress)) {
            throw new Error('Batch wallet address does not match the on-chain binding.');
        }
        if (normalizeAddress(binding.ownerTreasury) !== SIGNER_ADDRESS) {
            throw new Error('Treasury signer service key does not match the bound Treasury wallet owner.');
        }
        if (Number(binding.threshold) !== 2) {
            throw new Error(`Batch wallet threshold must be 2. Found ${binding.threshold}.`);
        }
        const multisigRead = new ethers_1.Contract(String(walletAddress), BATCH_MULTISIG_WALLET_ABI, provider);
        const owners = await multisigRead.getOwners();
        if (normalizeAddress(owners[0]) !== normalizeAddress(binding.ownerTreasury) ||
            normalizeAddress(owners[1]) !== normalizeAddress(binding.ownerEscrow) ||
            normalizeAddress(owners[2]) !== normalizeAddress(binding.ownerContinuity)) {
            throw new Error('Batch wallet owners do not match the on-chain escrow binding.');
        }
        const usdcAddress = String(await escrow.usdc());
        if (!isAddress(usdcAddress)) {
            throw new Error('USDC token address is unavailable on-chain.');
        }
        const usdc = new ethers_1.Contract(usdcAddress, ERC20_ABI, provider);
        const walletBalance = BigInt(await usdc.balanceOf(String(walletAddress)));
        if (walletBalance < amountUnits) {
            throw new Error(`Batch wallet USDC balance is insufficient. Need ${String(amount)}, have ${(0, ethers_1.formatUnits)(walletBalance, 6)}.`);
        }
        const transferData = new ethers_1.Interface([
            'function transfer(address to, uint256 amount) returns (bool)',
        ]).encodeFunctionData('transfer', [String(destinationAddress), amountUnits]).toLowerCase();
        const existing = await findMatchingTransaction({
            multisig: multisigRead,
            to: usdcAddress,
            data: transferData,
        });
        const multisigWrite = new ethers_1.Contract(String(walletAddress), BATCH_MULTISIG_WALLET_ABI, signer);
        let txIndex = existing?.txIndex ?? Number(await multisigRead.transactionCount());
        let submitTxHash = '';
        let confirmTxHash = '';
        const alreadySubmitted = Boolean(existing);
        let alreadyConfirmed = Boolean(existing?.treasuryConfirmed);
        const submittedAt = new Date().toISOString();
        audit('deploy_leg_requested', {
            sourceBatchId,
            escrowBatchId,
            walletAddress,
            destinationAddress,
            amount,
            txIndex,
            alreadySubmitted,
            alreadyConfirmed,
        });
        if (!existing) {
            const submitTx = await multisigWrite.submitTransaction(usdcAddress, 0, transferData);
            const submitReceipt = await submitTx.wait();
            submitTxHash = String(submitReceipt?.hash ?? submitTx.hash);
            audit('deploy_leg_submitted', { sourceBatchId, txIndex, submitTxHash });
        }
        if (!alreadyConfirmed && !(existing?.executed)) {
            const confirmTx = await multisigWrite.confirmTransaction(txIndex);
            const confirmReceipt = await confirmTx.wait();
            confirmTxHash = String(confirmReceipt?.hash ?? confirmTx.hash);
            alreadyConfirmed = false;
            audit('deploy_leg_treasury_confirmed', { sourceBatchId, txIndex, confirmTxHash });
        }
        const confirmedAt = new Date().toISOString();
        const postTx = await multisigRead.transactions(txIndex);
        res.json({
            role: ROLE,
            signerAddress: SIGNER_ADDRESS,
            sourceBatchId: String(sourceBatchId),
            escrowBatchId: typeof escrowBatchId === 'string' && escrowBatchId ? escrowBatchId : escrowBatchUuid(String(sourceBatchId)),
            walletAddress: String(walletAddress),
            assetSymbol: 'USDC',
            amount: String(amount),
            destinationAddress: String(destinationAddress),
            txIndex,
            submitTxHash,
            confirmTxHash,
            submittedAt,
            confirmedAt,
            alreadySubmitted,
            alreadyConfirmed,
            executed: Boolean(postTx.executed ?? postTx[3] ?? false),
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        audit('deploy_leg_error', { sourceBatchId, walletAddress, destinationAddress, amount, error: msg });
        res.status(500).json({ error: `Treasury deploy-leg failed: ${msg}` });
    }
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
