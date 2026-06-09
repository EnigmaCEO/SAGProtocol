/**
 * Initialises on-chain role authorities on InvestmentEscrow and propagates
 * the resulting signer addresses to every config file that needs them.
 *
 * What it does (all automated, no browser wallet, no UI click):
 *   1. Derives signer addresses from the three role private keys in root .env
 *   2. Calls setRoleAuthority(roleId, signerAddress, Active) for each role
 *      using the deployer key (contract owner) as the caller
 *   3. Writes NEXT_PUBLIC_*_SIGNER_ADDRESS into frontend/.env.local
 *   4. Writes services/signer-treasury/.env and services/signer-escrow/.env
 *
 * Prerequisites:
 *   - Root .env must have DEPLOYER_PRIVATE_KEY (owner of InvestmentEscrow)
 *   - Root .env must have TREASURY_SIGNER_PRIVATE_KEY, ESCROW_SIGNER_PRIVATE_KEY,
 *     CONTINUITY_SIGNER_PRIVATE_KEY (the three role signing keys)
 *   - Local chain must be running (or set RPC_URL / CHAIN env vars)
 *
 * Usage:
 *   node scripts/init-role-authorities.mjs
 *   node scripts/init-role-authorities.mjs --network arc
 *   node scripts/init-role-authorities.mjs --dry-run   (shows what would happen)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ROOT_ENV = resolve(REPO_ROOT, '.env');
const FRONTEND_ENV = resolve(REPO_ROOT, 'frontend', '.env.local');
const TREASURY_SVC_ENV = resolve(REPO_ROOT, 'services', 'signer-treasury', '.env');
const ESCROW_SVC_ENV = resolve(REPO_ROOT, 'services', 'signer-escrow', '.env');

const ESCROW_ABI = [
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer, uint8 status, uint64 updatedAt, address updatedBy, bool exists))',
  'function setRoleAuthority(uint8 roleId, address signer, uint8 status) external',
  'function keeper() view returns (address)',
  'function setKeeper(address _keeper) external',
  'function ROLE_TREASURY_VAULT() view returns (uint8)',
  'function ROLE_ESCROW() view returns (uint8)',
  'function ROLE_CONTINUITY_SCE() view returns (uint8)',
];

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  return {
    network: get('--network'),
    rpc: get('--rpc'),
    dryRun: args.includes('--dry-run'),
  };
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function patchEnvFile(path, updates, header) {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = raw.length ? raw.split('\n') : [];
  const patched = new Set();

  const result = lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (key in updates) { patched.add(key); return `${key}=${updates[key]}`; }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!patched.has(key)) result.push(`${key}=${value}`);
  }

  const content = result.join('\n');
  writeFileSync(path, content, 'utf8');
}

function writeEnvFile(path, vars, header) {
  const lines = [];
  if (header) { for (const l of header) lines.push(`# ${l}`); lines.push(''); }
  for (const [k, v] of Object.entries(vars)) lines.push(`${k}=${v}`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

// ─── Deployment ───────────────────────────────────────────────────────────────

function loadDeployment(network) {
  const path = resolve(REPO_ROOT, 'deployments', `${network}.json`);
  if (!existsSync(path)) throw new Error(`Deployment file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function networkFromEnv(env) {
  const raw = (env.NEXT_PUBLIC_NETWORK ?? 'local').toLowerCase();
  return raw === 'local' ? 'localhost' : raw;
}

function needsKey(name, env) {
  const val = env[name];
  if (!val || val === '0x...') throw new Error(`${name} is not set in ${ROOT_ENV}`);
  return val.startsWith('0x') ? val : `0x${val}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cli = parseArgs();
  const rootEnv = parseEnvFile(ROOT_ENV);
  const frontendEnv = parseEnvFile(FRONTEND_ENV);

  const network = cli.network ?? networkFromEnv({ ...rootEnv, ...frontendEnv });
  const rpc = cli.rpc ?? frontendEnv.NEXT_PUBLIC_RPC_URL ?? rootEnv.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = Number(frontendEnv.NEXT_PUBLIC_CHAIN_ID ?? rootEnv.NEXT_PUBLIC_CHAIN_ID ?? 1337);
  const daoRegistryVersion = frontendEnv.NEXT_PUBLIC_DAO_SYSTEM_REGISTRY_VERSION ?? rootEnv.NEXT_PUBLIC_DAO_SYSTEM_REGISTRY_VERSION ?? 'v1.0.0-arc-testnet';

  console.log(`Network  : ${network}`);
  console.log(`RPC      : ${rpc}`);
  console.log(`Dry run  : ${cli.dryRun}`);
  console.log('');

  // Load contract addresses from deployment file
  const deployment = loadDeployment(network);
  const escrowAddress   = deployment.InvestmentEscrow;
  const treasuryAddress = deployment.Treasury;
  const vaultAddress    = deployment.Vault;
  if (!escrowAddress)   throw new Error('InvestmentEscrow address missing in deployment');
  if (!treasuryAddress) throw new Error('Treasury address missing in deployment');
  if (!vaultAddress)    throw new Error('Vault address missing in deployment');

  // Load private keys from root .env
  const deployerKey         = needsKey('DEPLOYER_PRIVATE_KEY', rootEnv);
  const treasurySignerKey   = needsKey('TREASURY_SIGNER_PRIVATE_KEY', rootEnv);
  const escrowSignerKey     = needsKey('ESCROW_SIGNER_PRIVATE_KEY', rootEnv);
  const continuitySignerKey = needsKey('CONTINUITY_SIGNER_PRIVATE_KEY', rootEnv);

  // Derive signer addresses
  const deployerWallet         = new Wallet(deployerKey);
  const treasurySignerWallet   = new Wallet(treasurySignerKey);
  const escrowSignerWallet     = new Wallet(escrowSignerKey);
  const continuitySignerWallet = new Wallet(continuitySignerKey);

  console.log(`Deployer (owner)    : ${deployerWallet.address}`);
  console.log(`Treasury signer     : ${treasurySignerWallet.address}`);
  console.log(`Escrow signer       : ${escrowSignerWallet.address}`);
  console.log(`Continuity signer   : ${continuitySignerWallet.address}`);
  console.log('');

  const roles = [
    { id: 0, label: 'ROLE_TREASURY_VAULT', wallet: treasurySignerWallet },
    { id: 1, label: 'ROLE_ESCROW',         wallet: escrowSignerWallet },
    { id: 2, label: 'ROLE_CONTINUITY_SCE', wallet: continuitySignerWallet },
  ];

  if (cli.dryRun) {
    console.log('Dry run — no transactions submitted, no files written.');
    for (const role of roles) {
      console.log(`  setRoleAuthority(${role.id}, ${role.wallet.address}, Active)  [${role.label}]`);
    }
    return;
  }

  // Connect owner wallet to chain
  const provider = new JsonRpcProvider(rpc);
  const ownerWallet = deployerWallet.connect(provider);
  const contract = new Contract(escrowAddress, ESCROW_ABI, ownerWallet);

  // ── Set each role authority (skip if already set to the same address) ────────
  for (const role of roles) {
    const signerAddress = role.wallet.address;

    let existing;
    try {
      existing = await contract.getRoleAuthority(role.id);
    } catch (err) {
      throw new Error(`getRoleAuthority(${role.id}) failed: ${err.message}`);
    }

    if (existing?.exists && existing.signer.toLowerCase() === signerAddress.toLowerCase() && Number(existing.status) === 0) {
      console.log(`  ${role.label} (${role.id}): already Active at ${signerAddress} — skipped`);
      continue;
    }

    console.log(`  ${role.label} (${role.id}): setRoleAuthority(${role.id}, ${signerAddress}, Active) ...`);
    try {
      const tx = await contract.setRoleAuthority(role.id, signerAddress, 0);
      const receipt = await tx.wait();
      console.log(`    ✓ tx ${receipt.hash}  (block ${receipt.blockNumber})`);
    } catch (err) {
      throw new Error(`setRoleAuthority(${role.id}) failed: ${err.message}`);
    }
  }

  console.log('');

  // ── Write resolved SCE key back to root .env so it is not silently lost ────
  try {
    const currentKeeper = await contract.keeper();
    if (currentKeeper.toLowerCase() === escrowSignerWallet.address.toLowerCase()) {
      console.log(`  InvestmentEscrow keeper: already escrow signer ${escrowSignerWallet.address} - skipped`);
    } else {
      console.log(`  InvestmentEscrow keeper: setKeeper(${escrowSignerWallet.address}) ...`);
      const tx = await contract.setKeeper(escrowSignerWallet.address);
      const receipt = await tx.wait();
      console.log(`    ok tx ${receipt.hash}  (block ${receipt.blockNumber})`);
    }
  } catch (err) {
    throw new Error(`setKeeper(${escrowSignerWallet.address}) failed: ${err.message}`);
  }

  console.log('');

  patchEnvFile(ROOT_ENV, {
    CONTINUITY_SIGNER_PRIVATE_KEY: continuitySignerKey,
  });
  console.log(`Written CONTINUITY_SIGNER_PRIVATE_KEY to .env`);

  // ── Write frontend/.env.local signer addresses ───────────────────────────────
  patchEnvFile(FRONTEND_ENV, {
    NEXT_PUBLIC_TREASURY_SIGNER_ADDRESS:   treasurySignerWallet.address,
    NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS:     escrowSignerWallet.address,
    NEXT_PUBLIC_CONTINUITY_SIGNER_ADDRESS: continuitySignerWallet.address,
  });
  console.log(`Written frontend/.env.local:`);
  console.log(`  NEXT_PUBLIC_TREASURY_SIGNER_ADDRESS=${treasurySignerWallet.address}`);
  console.log(`  NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS=${escrowSignerWallet.address}`);
  console.log(`  NEXT_PUBLIC_CONTINUITY_SIGNER_ADDRESS=${continuitySignerWallet.address}`);
  console.log('');

  // ── Write services/signer-treasury/.env ─────────────────────────────────────
  writeEnvFile(TREASURY_SVC_ENV, {
    TREASURY_SIGNER_PRIVATE_KEY:    treasurySignerKey,
    RPC_URL:                        rpc,
    CHAIN_ID:                       String(chainId),
    TREASURY_CONTRACT_ADDRESS:      treasuryAddress,
    INVESTMENT_ESCROW_ADDRESS:      escrowAddress,
    VAULT_CONTRACT_ADDRESS:         vaultAddress,
    DAO_SYSTEM_REGISTRY_VERSION:    daoRegistryVersion,
    PORT:                           '4001',
    CORS_ORIGIN:                    'http://localhost:3000',
  }, ['Auto-generated by scripts/init-role-authorities.mjs — do not commit']);
  console.log(`Written services/signer-treasury/.env`);

  // ── Write services/signer-escrow/.env ───────────────────────────────────────
  writeEnvFile(ESCROW_SVC_ENV, {
    ESCROW_SIGNER_PRIVATE_KEY:      escrowSignerKey,
    RPC_URL:                        rpc,
    CHAIN_ID:                       String(chainId),
    TREASURY_CONTRACT_ADDRESS:      treasuryAddress,
    INVESTMENT_ESCROW_ADDRESS:      escrowAddress,
    VAULT_CONTRACT_ADDRESS:         vaultAddress,
    DAO_SYSTEM_REGISTRY_VERSION:    daoRegistryVersion,
    PORT:                           '4002',
    CORS_ORIGIN:                    'http://localhost:3000',
  }, ['Auto-generated by scripts/init-role-authorities.mjs — do not commit']);
  console.log(`Written services/signer-escrow/.env`);

  console.log('');
  console.log('Role authorities initialised. Start the signer services to enable autonomous signing:');
  console.log('  cd services/signer-treasury && pnpm dev');
  console.log('  cd services/signer-escrow   && pnpm dev');
}

main().catch((err) => {
  console.error(`\nError: ${err.message ?? err}`);
  process.exit(1);
});
