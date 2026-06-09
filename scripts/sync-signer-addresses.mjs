/**
 * Reads the three role authority signer addresses from the deployed InvestmentEscrow
 * contract and writes them into frontend/.env.local.
 *
 * Usage (from repo root):
 *   node scripts/sync-signer-addresses.mjs
 *   node scripts/sync-signer-addresses.mjs --network arc
 *   node scripts/sync-signer-addresses.mjs --rpc http://127.0.0.1:8545 --network localhost
 *
 * The script resolves the InvestmentEscrow address from deployments/<network>.json,
 * then calls getRoleAuthority(0/1/2) and patches the three env vars in place.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Contract } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_FILE = resolve(REPO_ROOT, 'frontend', '.env.local');

const ROLE_AUTHORITY_ABI = [
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer, uint8 status, uint64 updatedAt, address updatedBy, bool exists))',
];

const ROLE_STATUS = ['Active', 'Frozen', 'Retired'];

// ─── Parse CLI args ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return { rpc: get('--rpc'), network: get('--network') };
}

// ─── Read env file ────────────────────────────────────────────────────────────

function readEnv(path) {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, 'utf8').split('\n');
  const map = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

// ─── Patch env file in-place ──────────────────────────────────────────────────

function patchEnvFile(path, updates) {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = raw.split('\n');
  const patched = new Set();

  const result = lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (key in updates) {
      patched.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append any keys that weren't already in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!patched.has(key)) {
      result.push(`${key}=${value}`);
    }
  }

  writeFileSync(path, result.join('\n'), 'utf8');
}

// ─── Load deployment ──────────────────────────────────────────────────────────

function loadDeployment(network) {
  const path = resolve(REPO_ROOT, 'deployments', `${network}.json`);
  if (!existsSync(path)) {
    throw new Error(`Deployment file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function networkFromEnv(env) {
  const raw = (env.NEXT_PUBLIC_NETWORK ?? 'local').toLowerCase();
  if (raw === 'local') return 'localhost';
  return raw;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cli = parseArgs();
  const env = readEnv(ENV_FILE);

  const network = cli.network ?? networkFromEnv(env);
  const rpc = cli.rpc ?? env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';

  console.log(`Network : ${network}`);
  console.log(`RPC     : ${rpc}`);
  console.log(`Env file: ${ENV_FILE}`);
  console.log('');

  const deployment = loadDeployment(network);
  const escrowAddress = deployment.InvestmentEscrow;
  if (!escrowAddress || !/^0x[a-fA-F0-9]{40}$/.test(escrowAddress)) {
    throw new Error(`InvestmentEscrow address missing or invalid in deployments/${network}.json`);
  }

  console.log(`InvestmentEscrow: ${escrowAddress}`);
  console.log('');

  const provider = new JsonRpcProvider(rpc);
  const contract = new Contract(escrowAddress, ROLE_AUTHORITY_ABI, provider);

  const roles = [
    { id: 0, label: 'ROLE_TREASURY_VAULT', envKey: 'NEXT_PUBLIC_TREASURY_SIGNER_ADDRESS' },
    { id: 1, label: 'ROLE_ESCROW',         envKey: 'NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS' },
    { id: 2, label: 'ROLE_CONTINUITY_SCE', envKey: 'NEXT_PUBLIC_CONTINUITY_SIGNER_ADDRESS' },
  ];

  const updates = {};

  for (const role of roles) {
    let raw;
    try {
      raw = await contract.getRoleAuthority(role.id);
    } catch (err) {
      console.warn(`  [WARN] getRoleAuthority(${role.id}) failed: ${err.message}`);
      continue;
    }

    if (!raw?.exists) {
      console.log(`  ${role.label} (${role.id}): not set on-chain — skipping`);
      continue;
    }

    const signer = String(raw.signer);
    const status = ROLE_STATUS[Number(raw.status)] ?? `unknown(${raw.status})`;
    console.log(`  ${role.label} (${role.id}): ${signer}  [${status}]`);

    if (!/^0x[a-fA-F0-9]{40}$/.test(signer)) {
      console.warn(`  [WARN] signer address for role ${role.id} is not a valid address — skipping`);
      continue;
    }

    updates[role.envKey] = signer;
  }

  if (Object.keys(updates).length === 0) {
    console.log('\nNo role authorities found on-chain. Nothing written.');
    console.log('Call setRoleAuthority on InvestmentEscrow first, or click "Initialize Role Authorities" in the Escrow UI.');
    process.exit(1);
  }

  console.log('');
  patchEnvFile(ENV_FILE, updates);
  console.log(`Written to ${ENV_FILE}:`);
  for (const [key, value] of Object.entries(updates)) {
    console.log(`  ${key}=${value}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
