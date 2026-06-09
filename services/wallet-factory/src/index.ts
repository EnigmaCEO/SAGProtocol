import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  Wallet,
  JsonRpcProvider,
  Contract,
  ContractFactory,
  keccak256,
  toUtf8Bytes,
} from 'ethers';
import * as path from 'path';
import * as fs from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4003);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const ESCROW_ADDRESS = process.env.INVESTMENT_ESCROW_ADDRESS ?? '';

const privateKey = process.env.WALLET_FACTORY_PRIVATE_KEY;
if (!privateKey) {
  console.error('[wallet-factory] WALLET_FACTORY_PRIVATE_KEY is not set. Exiting.');
  process.exit(1);
}
if (!ESCROW_ADDRESS) {
  console.error('[wallet-factory] INVESTMENT_ESCROW_ADDRESS is not set. Exiting.');
  process.exit(1);
}

const signerWallet = new Wallet(privateKey);
const FACTORY_ADDRESS = signerWallet.address;

console.log(`[wallet-factory] Factory address: ${FACTORY_ADDRESS}`);
console.log(`[wallet-factory] RPC: ${RPC_URL}, chain: ${CHAIN_ID}`);
console.log(`[wallet-factory] Escrow: ${ESCROW_ADDRESS}`);

// ─── Contract artifacts ───────────────────────────────────────────────────────
// BatchMultisigWallet artifact is resolved from the Hardhat build output at the
// repo root. The path is relative to the project root, two levels above services/.

const ARTIFACT_PATH = path.resolve(
  __dirname,
  '../../../artifacts/contracts/BatchMultisigWallet.sol/BatchMultisigWallet.json'
);

let MULTISIG_ABI: any[];
let MULTISIG_BYTECODE: string;
try {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  MULTISIG_ABI = artifact.abi;
  MULTISIG_BYTECODE = artifact.bytecode;
  console.log(`[wallet-factory] BatchMultisigWallet artifact loaded (${MULTISIG_BYTECODE.length / 2} bytes)`);
} catch (err) {
  console.error('[wallet-factory] Failed to load BatchMultisigWallet artifact:', err);
  console.error('[wallet-factory] Run `npm run compile` from the repo root first.');
  process.exit(1);
}

// ─── InvestmentEscrow ABI (minimal) ──────────────────────────────────────────

const ESCROW_ABI = [
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer, uint8 status, uint64 updatedAt, address updatedBy, bool exists))',
  'function getBatchAuthorityAnchor(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, bytes32 systemMapHash, address sourceContractAddress, address activeEscrowAddress, address treasurySignerAddress, address escrowSignerAddress, address anchoredBy, uint64 anchoredAt, bool exists))',
  'function getBatchWalletBinding(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, address walletAddress, address ownerTreasury, address ownerEscrow, address ownerContinuity, uint8 threshold, address factory, bytes32 creationTxHash, uint64 boundAt, address boundBy, bool exists))',
  'function batchWalletFunded(uint256 sourceBatchId) view returns (bool)',
  'function bindBatchWallet(uint256 sourceBatchId, bytes32 escrowBatchIdHash, bytes32 batchAuthorityBindingHash, address walletAddress, address factory, bytes32 creationTxHash) external',
  'function fundBatchWallet(uint256 sourceBatchId) external',
  // Errors
  'error WalletAlreadyBound(uint256 sourceBatchId, address existingWallet)',
  'error WalletNotBound(uint256 sourceBatchId)',
  'error AnchorNotFound(uint256 sourceBatchId)',
  'error WalletBindingHashMismatch(bytes32 anchorHash, bytes32 providedHash)',
  'error WalletBindingEscrowIdMismatch(bytes32 anchorId, bytes32 providedId)',
  'error ZeroWalletAddress()',
  'error WalletThresholdInvalid(uint8 walletThreshold)',
  'error WalletOwnersMissing()',
  'error AlreadyFunded(uint256 sourceBatchId)',
  'error BatchPositionNotFound(uint256 sourceBatchId)',
  'error InsufficientEscrowBalance(uint256 required, uint256 available)',
  'error RoleSignerNotSet(uint8 roleId)',
  'error RoleNotActive(uint8 roleId, uint8 status)',
];

const ROLE_TREASURY_VAULT  = 0;
const ROLE_ESCROW          = 1;
const ROLE_CONTINUITY_SCE  = 2;

// ─── Audit log ─────────────────────────────────────────────────────────────────

function audit(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'wallet-factory', event, ...data }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toAddr(v: string | undefined): string {
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : '0x0000000000000000000000000000000000000000';
}

function toB32(v: string | undefined): string {
  if (!v) return '0x' + '0'.repeat(64);
  const raw = v.startsWith('0x') ? v.slice(2) : v;
  return '0x' + (raw.length === 64 ? raw : raw.padStart(64, '0'));
}

// ─── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ service: 'wallet-factory', factoryAddress: FACTORY_ADDRESS, chainId: CHAIN_ID, version: '1.0.0' });
});

// ─── POST /create-batch-wallet ─────────────────────────────────────────────────
// Body: { sourceBatchId: string, escrowBatchId: string, batchAuthorityBindingHash: string }
//
// 1. Verifies the Batch Authority Binding anchor exists on-chain.
// 2. Reads the three on-chain role authority signer addresses.
// 3. Deploys a BatchMultisigWallet with those owners.
// 4. Calls InvestmentEscrow.bindBatchWallet() to record the binding on-chain.
// 5. Returns wallet address, creation tx hash, binding tx hash, and owner evidence.

app.post('/create-batch-wallet', async (req: Request, res: Response) => {
  const { sourceBatchId, escrowBatchId, batchAuthorityBindingHash } = req.body ?? {};

  if (!sourceBatchId || typeof sourceBatchId !== 'string') {
    res.status(400).json({ error: 'sourceBatchId is required' });
    return;
  }
  if (!escrowBatchId || typeof escrowBatchId !== 'string') {
    res.status(400).json({ error: 'escrowBatchId is required' });
    return;
  }
  if (!batchAuthorityBindingHash || typeof batchAuthorityBindingHash !== 'string') {
    res.status(400).json({ error: 'batchAuthorityBindingHash is required' });
    return;
  }

  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(sourceBatchId);
  } catch {
    res.status(400).json({ error: `sourceBatchId "${sourceBatchId}" cannot be converted to uint256` });
    return;
  }

  audit('create_wallet_requested', { sourceBatchId, escrowBatchId, batchAuthorityBindingHash });

  const provider = new JsonRpcProvider(RPC_URL);
  const connected = signerWallet.connect(provider);
  const escrow = new Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

  // ── 1. Verify on-chain anchor exists ──────────────────────────────────────────
  let anchor: any;
  try {
    anchor = await escrow.getBatchAuthorityAnchor(sourceBatchIdNum);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('create_wallet_rejected', { reason: 'anchor_read_failed', sourceBatchId, error: msg });
    res.status(500).json({ error: `Failed to read anchor: ${msg}` });
    return;
  }

  if (!anchor?.exists) {
    audit('create_wallet_rejected', { reason: 'anchor_not_found', sourceBatchId });
    res.status(400).json({ error: `Batch Authority Binding not yet anchored for sourceBatchId ${sourceBatchId}. Anchor first.` });
    return;
  }

  const onChainHash = String(anchor.batchAuthorityBindingHash).toLowerCase();
  if (onChainHash !== batchAuthorityBindingHash.toLowerCase()) {
    audit('create_wallet_rejected', { reason: 'binding_hash_mismatch', sourceBatchId, onChainHash, provided: batchAuthorityBindingHash });
    res.status(400).json({
      error: 'batchAuthorityBindingHash does not match the on-chain anchor record.',
      onChainHash,
      provided: batchAuthorityBindingHash,
    });
    return;
  }

  // ── 2. Check if wallet already bound ─────────────────────────────────────────
  let existingBinding: any;
  try {
    existingBinding = await escrow.getBatchWalletBinding(sourceBatchIdNum);
  } catch {
    existingBinding = null;
  }
  if (existingBinding?.exists) {
    audit('create_wallet_already_bound', { sourceBatchId, walletAddress: String(existingBinding.walletAddress) });
    // Attempt to fund the wallet if not already funded — idempotent on the contract side.
    let alreadyBoundFundingTxHash: string | null = null;
    let alreadyBoundFundingError: string | null = null;
    try {
      const alreadyFunded = await escrow.batchWalletFunded(sourceBatchIdNum).catch(() => false);
      if (!alreadyFunded) {
        const escrowWithSigner = new Contract(ESCROW_ADDRESS, ESCROW_ABI, signerWallet.connect(provider));
        const fundTx = await escrowWithSigner.fundBatchWallet(sourceBatchIdNum);
        const fundReceipt = await fundTx.wait();
        alreadyBoundFundingTxHash = String(fundReceipt.hash ?? fundTx.hash);
        audit('fund_wallet_funded', { sourceBatchId, walletAddress: String(existingBinding.walletAddress), fundingTxHash: alreadyBoundFundingTxHash });
      } else {
        audit('fund_wallet_already_funded', { sourceBatchId });
      }
    } catch (fundErr: unknown) {
      alreadyBoundFundingError = fundErr instanceof Error ? fundErr.message : String(fundErr);
      audit('fund_wallet_failed', { sourceBatchId, error: alreadyBoundFundingError });
    }
    res.json({
      alreadyBound: true,
      walletAddress: String(existingBinding.walletAddress),
      ownerTreasury: String(existingBinding.ownerTreasury),
      ownerEscrow: String(existingBinding.ownerEscrow),
      ownerContinuity: String(existingBinding.ownerContinuity),
      threshold: 2,
      factory: String(existingBinding.factory),
      creationTxHash: String(existingBinding.creationTxHash),
      boundAt: new Date(Number(existingBinding.boundAt) * 1000).toISOString(),
      sourceBatchId,
      escrowBatchId,
      batchAuthorityBindingHash,
      ...(alreadyBoundFundingTxHash ? { fundingTxHash: alreadyBoundFundingTxHash } : {}),
      ...(alreadyBoundFundingError ? { fundingError: alreadyBoundFundingError } : {}),
    });
    return;
  }

  // ── 3. Read on-chain role authority signer addresses ──────────────────────────
  let tvRole: any;
  let escrowRole: any;
  let sceRole: any;
  try {
    [tvRole, escrowRole, sceRole] = await Promise.all([
      escrow.getRoleAuthority(ROLE_TREASURY_VAULT),
      escrow.getRoleAuthority(ROLE_ESCROW),
      escrow.getRoleAuthority(ROLE_CONTINUITY_SCE),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('create_wallet_rejected', { reason: 'role_read_failed', sourceBatchId, error: msg });
    res.status(500).json({ error: `Failed to read role authorities: ${msg}` });
    return;
  }

  if (!tvRole?.exists || !escrowRole?.exists || !sceRole?.exists) {
    audit('create_wallet_rejected', { reason: 'roles_not_set', sourceBatchId });
    res.status(400).json({ error: 'One or more role authorities (Treasury, Escrow, Continuity) are not set on InvestmentEscrow.' });
    return;
  }
  if (Number(tvRole.status) !== 0 || Number(escrowRole.status) !== 0 || Number(sceRole.status) !== 0) {
    audit('create_wallet_rejected', { reason: 'role_not_active', sourceBatchId });
    res.status(400).json({ error: 'One or more role authorities are not Active.' });
    return;
  }

  const ownerTreasury  = toAddr(String(tvRole.signer));
  const ownerEscrow    = toAddr(String(escrowRole.signer));
  const ownerContinuity = toAddr(String(sceRole.signer));

  audit('create_wallet_deploying', {
    sourceBatchId,
    ownerTreasury,
    ownerEscrow,
    ownerContinuity,
    batchAuthorityBindingHash,
  });

  // ── 4. Deploy BatchMultisigWallet ─────────────────────────────────────────────
  // Read the nonce once and pass it explicitly to both transactions. In Hardhat
  // automine mode, eth_getTransactionCount can return the same value for two
  // back-to-back calls because the first tx is mined before the second query,
  // but the RPC response hasn't propagated yet — causing a nonce collision.
  let baseNonce: number;
  try {
    baseNonce = await provider.getTransactionCount(FACTORY_ADDRESS, 'pending');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch nonce: ${msg}` });
    return;
  }

  const factory = new ContractFactory(MULTISIG_ABI, MULTISIG_BYTECODE, connected);

  let walletAddress: string;
  let creationTxHash: string;
  try {
    const deployedWallet = await factory.deploy(
      [ownerTreasury, ownerEscrow, ownerContinuity],
      sourceBatchIdNum,
      toB32(batchAuthorityBindingHash),
      { nonce: baseNonce },
    );
    const receipt = await deployedWallet.deploymentTransaction()?.wait();
    walletAddress = await deployedWallet.getAddress();
    creationTxHash = String(receipt?.hash ?? deployedWallet.deploymentTransaction()?.hash ?? '0x' + '0'.repeat(64));
    audit('create_wallet_deployed', { sourceBatchId, walletAddress, creationTxHash });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('create_wallet_deploy_failed', { sourceBatchId, error: msg });
    res.status(500).json({ error: `BatchMultisigWallet deployment failed: ${msg}` });
    return;
  }

  // ── 5. Call InvestmentEscrow.bindBatchWallet() ────────────────────────────────
  const escrowBatchIdHash = keccak256(toUtf8Bytes(escrowBatchId));
  const escrowWithSigner = new Contract(ESCROW_ADDRESS, ESCROW_ABI, connected);

  let bindingTxHash: string;
  let boundAt: string;
  try {
    // creationTxHash is passed as indexed evidence — the contract stores it
    // but cannot verify it. The authoritative proof is this receipt plus
    // the BatchWalletBound event emitted by bindBatchWallet().
    const bindTx = await escrowWithSigner.bindBatchWallet(
      sourceBatchIdNum,
      escrowBatchIdHash,
      toB32(batchAuthorityBindingHash),
      toAddr(walletAddress),
      toAddr(FACTORY_ADDRESS),
      toB32(creationTxHash),
      { nonce: baseNonce + 1 },
    );
    const bindReceipt = await bindTx.wait();
    bindingTxHash = String(bindReceipt.hash ?? bindTx.hash);
    boundAt = new Date().toISOString();
    audit('create_wallet_bound', { sourceBatchId, walletAddress, bindingTxHash, boundAt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    audit('create_wallet_bind_failed', { sourceBatchId, walletAddress, error: msg });
    res.status(500).json({ error: `bindBatchWallet() failed: ${msg}`, walletAddress, creationTxHash });
    return;
  }

  // ── 6. Fund the batch wallet via InvestmentEscrow.fundBatchWallet() ─────────────
  // Funding failure is returned as a warning — the authority anchor and wallet
  // binding are already committed and must not be rolled back.
  let fundingTxHash: string | null = null;
  let fundingError: string | null = null;
  try {
    const fundTx = await escrowWithSigner.fundBatchWallet(
      sourceBatchIdNum,
      { nonce: baseNonce + 2 },
    );
    const fundReceipt = await fundTx.wait();
    fundingTxHash = String(fundReceipt.hash ?? fundTx.hash);
    audit('fund_wallet_funded', { sourceBatchId, walletAddress, fundingTxHash });
  } catch (err: unknown) {
    fundingError = err instanceof Error ? err.message : String(err);
    audit('fund_wallet_failed', { sourceBatchId, walletAddress, error: fundingError });
  }

  res.json({
    walletAddress,
    creationTxHash,
    bindingTxHash,
    boundAt,
    ownerTreasury,
    ownerEscrow,
    ownerContinuity,
    threshold: 2,
    factory: FACTORY_ADDRESS,
    sourceBatchId,
    escrowBatchId,
    batchAuthorityBindingHash,
    ...(fundingTxHash ? { fundingTxHash } : {}),
    ...(fundingError ? { fundingError } : {}),
  });
});

// ─── GET /wallet-binding/:sourceBatchId ───────────────────────────────────────
// Read the on-chain BatchWalletBinding record for a given sourceBatchId.

app.get('/wallet-binding/:sourceBatchId', async (req: Request, res: Response) => {
  const { sourceBatchId } = req.params;
  let sourceBatchIdNum: bigint;
  try {
    sourceBatchIdNum = BigInt(sourceBatchId);
  } catch {
    res.status(400).json({ error: 'Invalid sourceBatchId' });
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const escrow = new Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

  try {
    const binding = await escrow.getBatchWalletBinding(sourceBatchIdNum);
    if (!binding?.exists) {
      res.json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      walletAddress: String(binding.walletAddress),
      escrowBatchIdHash: String(binding.escrowBatchIdHash),
      batchAuthorityBindingHash: String(binding.batchAuthorityBindingHash),
      ownerTreasury: String(binding.ownerTreasury),
      ownerEscrow: String(binding.ownerEscrow),
      ownerContinuity: String(binding.ownerContinuity),
      threshold: 2,
      factory: String(binding.factory),
      creationTxHash: String(binding.creationTxHash),
      boundAt: new Date(Number(binding.boundAt) * 1000).toISOString(),
      boundBy: String(binding.boundBy),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to read wallet binding: ${msg}` });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[wallet-factory] Unhandled error:', msg);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[wallet-factory] Listening on port ${PORT}`);
  audit('startup', { port: PORT, factoryAddress: FACTORY_ADDRESS, chainId: CHAIN_ID });
});
