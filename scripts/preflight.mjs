#!/usr/bin/env node
/**
 * SAGProtocol Environment Preflight
 * Run with: npm run preflight:local
 *
 * Checks node, contracts, selectors, roles, services, and database.
 * Exits with code 1 if any BLOCKER is found.
 * Writes a JSON report to reports/preflight-local.json.
 */

import { createRequire } from 'module';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Env file parser ───────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    const out = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      // Strip inline # comments (outside of quoted values)
      let val = m[2];
      const quoted = /^(["']).*\1$/.test(val);
      if (!quoted) val = val.replace(/\s+#.*$/, '');
      out[m[1]] = val.replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch { return {}; }
}

// ── Load env files ────────────────────────────────────────────────────────────

const serverEnv      = parseEnvFile(resolve(ROOT, 'server/.env'));
const signerTEnv     = parseEnvFile(resolve(ROOT, 'services/signer-treasury/.env'));
const signerEEnv     = parseEnvFile(resolve(ROOT, 'services/signer-escrow/.env'));

let manifest = {};
try { manifest = JSON.parse(readFileSync(resolve(ROOT, 'deployments/localhost.json'), 'utf8')); } catch {}

// ── Load ethers ───────────────────────────────────────────────────────────────

let ethers;
try { ({ ethers } = require('ethers')); }
catch { ({ ethers } = await import('ethers')); }

// ── Load pg (optional — DB checks skipped if unavailable) ────────────────────

let Pool = null;
const pgPaths = [
  resolve(ROOT, 'server/node_modules/pg'),
  resolve(ROOT, 'node_modules/pg'),
  'pg',
];
for (const p of pgPaths) {
  try { ({ Pool } = require(p)); break; } catch {}
}

// ── Required selectors ────────────────────────────────────────────────────────

const REQUIRED_SELECTORS = {
  InvestmentEscrow: [
    'finalizePreFundedBatch(uint256,uint256)',
    'depositReturnForBatch(uint256,uint256)',
    'anchorBatchAuthorityBinding(uint256,bytes32,bytes32,bytes32,address,address,bytes,bytes)',
    'getBatchWalletBinding(uint256)',
    'getBatchAuthorityAnchor(uint256)',
    'finalizeBatchSettlement(uint256,bytes32,bytes32)',
    'getBatchSettlement(uint256)',
    'attachAllocation(uint256,bytes32,bytes32,string)',
    'getAllocationAttachment(uint256)',
    'getBatchAccounting(uint256)',
    'escrowBatchPositions(uint256)',
    'getRoleAuthority(uint8)',
    'setRoleAuthority(uint8,address,uint8)',
    'keeper()',
    'usdc()',
  ],
  MockUSDC: [
    'mint(address,uint256)',
    'burn(address,uint256)',
    'transfer(address,uint256)',
    'transferFrom(address,address,uint256)',
    'balanceOf(address)',
    'approve(address,uint256)',
  ],
  Treasury: [
    'registerBankOriginLot(bytes32,uint256,uint64)',
    'createAndFundBatch(uint8,uint256[],uint64,uint64,bytes32)',
    'getTreasuryBatch(uint256)',
    'originLots(uint256)',
    'adminReportBatchSettled(uint256,uint256,uint256)',
    'rollIfDue()',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const checks = [];

function rec(severity, component, name, expected, observed, fix) {
  checks.push({ severity, component, name, expected, observed, fix });
}
const pass = (component, name, observed) => rec('PASS', component, name, observed, observed, '');
const blocker = (component, name, expected, observed, fix) => rec('BLOCKER', component, name, expected, observed, fix);
const warn = (component, name, expected, observed, fix) => rec('WARN', component, name, expected, observed, fix);

function selectorOf(sig) {
  return ethers.keccak256(ethers.toUtf8Bytes(sig)).slice(2, 10);
}
function hasSelector(code, sig) {
  return code.toLowerCase().includes(selectorOf(sig));
}

async function tryFetch(url) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Config ────────────────────────────────────────────────────────────────────

const rpcUrl      = serverEnv.BANKING_RPC_URL || serverEnv.ESCROW_RPC_URL || 'http://localhost:8545';
const chainId     = Number(serverEnv.BANKING_CHAIN_ID || serverEnv.ESCROW_CHAIN_ID || 1337);
const contracts   = {
  Treasury:         { envAddr: serverEnv.BANKING_TREASURY_ADDRESS,  manifestAddr: manifest.Treasury,         envVar: 'BANKING_TREASURY_ADDRESS',  required: true  },
  MockUSDC:         { envAddr: serverEnv.BANKING_MOCK_USDC_ADDRESS, manifestAddr: manifest.MockUSDC,         envVar: 'BANKING_MOCK_USDC_ADDRESS', required: true  },
  InvestmentEscrow: { envAddr: serverEnv.ESCROW_CONTRACT_ADDRESS,   manifestAddr: manifest.InvestmentEscrow, envVar: 'ESCROW_CONTRACT_ADDRESS',   required: true  },
  Vault:            { envAddr: serverEnv.VAULT_CONTRACT_ADDRESS,    manifestAddr: manifest.Vault,            envVar: 'VAULT_CONTRACT_ADDRESS',    required: false },
};
const signerTUrl  = (serverEnv.SIGNER_TREASURY_URL || '').replace(/\/$/, '');
const signerEUrl  = (serverEnv.SIGNER_ESCROW_URL   || '').replace(/\/$/, '');
const wfUrl       = (serverEnv.WALLET_FACTORY_URL  || '').replace(/\/$/, '');
const dbUrl       = serverEnv.DATABASE_URL;

// Operator address
let operatorAddress = null;
if (serverEnv.BANKING_TREASURY_PRIVATE_KEY) {
  try { operatorAddress = new ethers.Wallet(serverEnv.BANKING_TREASURY_PRIVATE_KEY).address.toLowerCase(); } catch {}
}

// Signer addresses (CLI can read keys directly from signer service .env files)
let signerTAddress = null, signerEAddress = null;
if (signerTEnv.TREASURY_SIGNER_PRIVATE_KEY) {
  try { signerTAddress = new ethers.Wallet(signerTEnv.TREASURY_SIGNER_PRIVATE_KEY).address.toLowerCase(); } catch {}
}
if (signerEEnv.ESCROW_SIGNER_PRIVATE_KEY) {
  try { signerEAddress = new ethers.Wallet(signerEEnv.ESCROW_SIGNER_PRIVATE_KEY).address.toLowerCase(); } catch {}
}

// ── Checks ────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(rpcUrl);
const epochInputs = {};
let actualChainId = null;

// NODE
try {
  const net = await provider.getNetwork();
  const blk = await provider.getBlockNumber();
  actualChainId = Number(net.chainId);
  pass('Node', 'rpc_reachable', `${rpcUrl} (block ${blk})`);
  if (actualChainId === chainId) {
    pass('Node', 'chain_id_match', `${actualChainId}`);
  } else {
    blocker('Node', 'chain_id_match',
      `chain ${chainId}`, `chain ${actualChainId}`,
      `Update BANKING_CHAIN_ID in server/.env to ${actualChainId}.`);
  }

  // Config consistency: signer services match chain
  const signerTChain = Number(signerTEnv.CHAIN_ID || 0);
  const signerEChain = Number(signerEEnv.CHAIN_ID || 0);
  if (signerTChain && signerTChain !== actualChainId) {
    blocker('Node', 'signer_treasury_chain_match',
      `chain ${actualChainId}`, `signer-treasury configured for chain ${signerTChain}`,
      'Update CHAIN_ID in services/signer-treasury/.env to match the current chain.');
  }
  if (signerEChain && signerEChain !== actualChainId) {
    blocker('Node', 'signer_escrow_chain_match',
      `chain ${actualChainId}`, `signer-escrow configured for chain ${signerEChain}`,
      'Update CHAIN_ID in services/signer-escrow/.env to match the current chain.');
  }
} catch {
  blocker('Node', 'rpc_reachable', rpcUrl, 'unreachable', 'Start Hardhat: npx hardhat node');
}

// CONTRACTS
for (const [label, { envAddr, manifestAddr, envVar, required }] of Object.entries(contracts)) {
  if (!envAddr) {
    if (required) {
      blocker(label, `${label}_address_set`, 'non-empty address', '(not set)', `Set ${envVar} in server/.env`);
    } else {
      warn(label, `${label}_address_set`, 'non-empty address', '(not set)', `Set ${envVar} in server/.env if a ${label} contract is deployed.`);
    }
    continue;
  }
  if (manifestAddr && manifestAddr.toLowerCase() !== envAddr.toLowerCase()) {
    blocker(label, `${label}_matches_manifest`,
      `manifest: ${manifestAddr}`, `env: ${envAddr}`,
      `Update ${envVar} in server/.env to ${manifestAddr} (from deployments/localhost.json).`);
  }
  const code = await provider.getCode(envAddr).catch(() => '0x');
  if (code === '0x' || code.length <= 2) {
    blocker(label, `${label}_code_deployed`,
      `bytecode at ${envAddr}`, '0x — no contract',
      `Run \`npm run deploy:local\`, then update ${envVar} in server/.env.`);
    continue;
  }
  const byteLen = Math.floor((code.length - 2) / 2);
  epochInputs[label] = `${envAddr.toLowerCase()}:${ethers.keccak256(ethers.toUtf8Bytes(code))}`;
  pass(label, `${label}_code_deployed`, `${envAddr} (${byteLen} bytes)`);

  for (const sig of (REQUIRED_SELECTORS[label] || [])) {
    const sel = selectorOf(sig);
    if (hasSelector(code, sig)) {
      pass(label, `${label}_sel_${sel}`, sig);
    } else {
      blocker(label, `${label}_sel_${sel}`,
        `selector 0x${sel} (${sig})`, 'not in deployed bytecode',
        `Run \`npm run deploy:local\` to redeploy ${label} with current source, then update ${envVar}.`);
    }
  }
}

// Signer service address consistency (CLI reads keys directly)
const signerTManifest = signerTEnv.TREASURY_CONTRACT_ADDRESS || '';
const signerEManifest = signerEEnv.INVESTMENT_ESCROW_ADDRESS  || '';
if (signerTManifest && contracts.Treasury.envAddr && signerTManifest.toLowerCase() !== contracts.Treasury.envAddr.toLowerCase()) {
  blocker('Services', 'signer_treasury_treasury_address',
    `server env: ${contracts.Treasury.envAddr}`, `signer-treasury env: ${signerTManifest}`,
    'Update TREASURY_CONTRACT_ADDRESS in services/signer-treasury/.env to match server/.env.');
}
if (signerEManifest && contracts.InvestmentEscrow.envAddr && signerEManifest.toLowerCase() !== contracts.InvestmentEscrow.envAddr.toLowerCase()) {
  blocker('Services', 'signer_escrow_escrow_address',
    `server env: ${contracts.InvestmentEscrow.envAddr}`, `signer-escrow env: ${signerEManifest}`,
    'Update INVESTMENT_ESCROW_ADDRESS in services/signer-escrow/.env to match server/.env.');
}

// ROLES (via on-chain read + key derivation)
if (contracts.InvestmentEscrow.envAddr) {
  const ESCROW_ABI = [
    'function getRoleAuthority(uint8) view returns (tuple(address signer,uint8 status,uint64 updatedAt,address updatedBy,bool exists))',
    'function owner() view returns (address)',
  ];
  const escrow = new ethers.Contract(contracts.InvestmentEscrow.envAddr, ESCROW_ABI, provider);

  // Owner
  if (operatorAddress) {
    const owner = await escrow.owner().catch(() => null);
    if (owner && owner.toLowerCase() !== operatorAddress) {
      blocker('Roles', 'escrow_owner',
        operatorAddress, owner.toLowerCase(),
        `BANKING_TREASURY_PRIVATE_KEY must be the InvestmentEscrow owner. Redeploy or transfer ownership.`);
    } else if (owner) {
      pass('Roles', 'escrow_owner', owner.toLowerCase());
    }
  }

  // ROLE_TREASURY_VAULT (0)
  if (signerTAddress) {
    const role = await escrow.getRoleAuthority(0).catch(() => null);
    if (!role?.exists) {
      blocker('Roles', 'role_treasury_vault_set',
        `ROLE_TREASURY_VAULT exists`, 'not set',
        `Run \`npm run init-roles\` or call setRoleAuthority(0, ${signerTAddress}, 0).`);
    } else if (role.signer.toLowerCase() !== signerTAddress) {
      blocker('Roles', 'role_treasury_vault_matches_key',
        `on-chain: ${role.signer}`, `signer-treasury key: ${signerTAddress}`,
        `Call setRoleAuthority(0, ${signerTAddress}, 0) on InvestmentEscrow.`);
    } else if (Number(role.status) !== 0) {
      blocker('Roles', 'role_treasury_vault_active',
        'status=Active(0)', `status=${role.status}`,
        `Call setRoleAuthority(0, ${signerTAddress}, 0) to activate.`);
    } else {
      pass('Roles', 'role_treasury_vault', signerTAddress);
    }
  }

  // ROLE_ESCROW (1)
  if (signerEAddress) {
    const role = await escrow.getRoleAuthority(1).catch(() => null);
    if (!role?.exists) {
      blocker('Roles', 'role_escrow_set',
        'ROLE_ESCROW exists', 'not set',
        `Run \`npm run init-roles\` or call setRoleAuthority(1, ${signerEAddress}, 0).`);
    } else if (role.signer.toLowerCase() !== signerEAddress) {
      blocker('Roles', 'role_escrow_matches_key',
        `on-chain: ${role.signer}`, `signer-escrow key: ${signerEAddress}`,
        `Call setRoleAuthority(1, ${signerEAddress}, 0) on InvestmentEscrow.`);
    } else if (Number(role.status) !== 0) {
      blocker('Roles', 'role_escrow_active',
        'status=Active(0)', `status=${role.status}`,
        `Call setRoleAuthority(1, ${signerEAddress}, 0) to activate.`);
    } else {
      pass('Roles', 'role_escrow', signerEAddress);
    }
  }
}

// SERVICES
for (const [name, url, envVar] of [
  ['signer-treasury', signerTUrl, 'SIGNER_TREASURY_URL'],
  ['signer-escrow',   signerEUrl, 'SIGNER_ESCROW_URL'],
  ['wallet-factory',  wfUrl,      'WALLET_FACTORY_URL'],
]) {
  const key = name.replace(/-/g, '_');
  if (!url) { warn('Services', `${key}_configured`, `${envVar} set`, 'not configured', `Set ${envVar} in server/.env.`); continue; }
  try {
    const h = await tryFetch(url);
    pass('Services', `${key}_healthy`, `${url} (role: ${h.role ?? '?'}, signer: ${h.signerAddress ?? 'n/a'})`);
  } catch {
    warn('Services', `${key}_healthy`, `${url}/health → 200`, 'not reachable', `Start ${name}. Phase 8/9 will fail without it.`);
  }
}

// DATABASE
const epochId = actualChainId && Object.keys(epochInputs).length > 0
  ? ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
      chainId: actualChainId,
      contracts: Object.fromEntries(Object.entries(epochInputs).sort()),
    })))
  : null;

if (!dbUrl) {
  warn('Database', 'db_configured', 'DATABASE_URL set', 'not configured', 'Set DATABASE_URL in server/.env.');
} else if (!Pool) {
  warn('Database', 'db_driver', 'pg driver available', 'not found — install pg in root or server', 'DB checks skipped.');
} else {
  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  try {
    await pool.query('SELECT 1');
    pass('Database', 'db_connected', dbUrl.replace(/:[^:@]+@/, ':***@'));

    // Tables
    const TABLES = [
      'term_positions','escrow_batch_lifecycle','escrow_batch_phase_evidence',
      'escrow_dev_leg_positions','circle_transfers','escrow_execution_orders',
      'protocol_sync_events','escrow_banking_reconciliation',
    ];
    const tr = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`, [TABLES]);
    const existing = new Set(tr.rows.map(r => r.tablename));
    for (const t of TABLES) {
      existing.has(t) ? pass('Database', `table_${t}`, t) : blocker('Database', `table_${t}`, `table ${t}`, 'missing', 'cd server && npm run migrate');
    }

    // Columns
    for (const [table, column, migration] of [
      ['escrow_dev_leg_positions', 'return_tx_hash',      '021'],
      ['escrow_batch_lifecycle',  'deployment_epoch_id', '022'],
    ]) {
      const cr = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, column]);
      cr.rows.length > 0
        ? pass('Database', `migration_${migration}`, `${table}.${column}`)
        : blocker('Database', `migration_${migration}`, `${table}.${column} (migration ${migration})`, 'column missing', 'cd server && npm run migrate');
    }

    // Stale batch wallets
    const active = await pool.query(
      `SELECT wallet_address FROM escrow_batch_lifecycle WHERE current_phase < 9 AND wallet_address IS NOT NULL LIMIT 50`
    );
    let stale = 0;
    for (const row of active.rows) {
      const code = await provider.getCode(row.wallet_address).catch(() => '0x');
      if (code === '0x' || code.length <= 2) stale++;
    }
    stale > 0
      ? blocker('Database', 'stale_active_batch_wallets',
          'all active batch wallets have on-chain code',
          `${stale}/${active.rows.length} wallet(s) point to dead contracts`,
          'Chain was reset. Run `npm run deploy:local`, restart services, then clear or recreate stale batches.')
      : pass('Database', 'stale_active_batch_wallets',
          active.rows.length > 0 ? `${active.rows.length} active batch wallet(s) verified` : 'no active batch wallets');

    // Epoch mismatch
    if (epochId) {
      const em = await pool.query(
        `SELECT COUNT(*) AS cnt FROM escrow_batch_lifecycle WHERE current_phase < 9 AND deployment_epoch_id IS NOT NULL AND deployment_epoch_id != $1`,
        [epochId]
      );
      const cnt = Number(em.rows[0]?.cnt ?? 0);
      cnt > 0
        ? blocker('Database', 'epoch_mismatch',
            `epoch ${epochId.slice(0, 12)}…`, `${cnt} active batch(es) from a different epoch`,
            'Batches were created against a different deployment. Redeploy or clear stale batch state.')
        : pass('Database', 'epoch_mismatch', 'all active batches match current epoch');
    }

    // BANK simulated custody
    const sc = await pool.query(
      `SELECT COUNT(*) AS cnt FROM escrow_batch_phase_evidence WHERE phase=9 AND evidence_json->>'custodySettlementStatus'='simulated_only' AND evidence_json->>'originType'='bank'`
    );
    const scCnt = Number(sc.rows[0]?.cnt ?? 0);
    scCnt > 0
      ? blocker('Database', 'bank_batch_simulated_custody',
          'no BANK-origin simulated_only Phase 9 evidence',
          `${scCnt} row(s) with simulated_only custody`,
          'Repair Phase 9 evidence for these BANK-origin batches.')
      : pass('Database', 'bank_batch_simulated_custody', 'no BANK-origin simulated custody evidence');

  } catch (err) {
    warn('Database', 'db_integrity_checks', 'all checks pass', `error: ${err.message}`, 'Investigate DB error.');
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

const blockers = checks.filter(c => c.severity === 'BLOCKER');
const warnings = checks.filter(c => c.severity === 'WARN');
const passes   = checks.filter(c => c.severity === 'PASS');

const RESET = '\x1b[0m', RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const col = s => s === 'BLOCKER' ? RED : s === 'WARN' ? YEL : GRN;
const sym = s => s === 'BLOCKER' ? '✗' : s === 'WARN' ? '⚠' : '✓';

console.log();
console.log(`${BOLD}SAGProtocol Environment Preflight${RESET}`);
console.log('═'.repeat(64));
console.log(`${DIM}Checked:${RESET} ${new Date().toISOString()}`);
console.log(`${DIM}RPC:    ${RESET} ${rpcUrl}`);
console.log(`${DIM}Chain:  ${RESET} ${actualChainId ?? 'unknown'}`);
console.log(`${DIM}Epoch:  ${RESET} ${epochId ? epochId.slice(0, 16) + '…' : 'not computed'}`);
console.log();

let lastComp = null;
for (const c of checks) {
  if (c.component !== lastComp) {
    console.log(`${BOLD}[${c.component}]${RESET}`);
    lastComp = c.component;
  }
  const prefix = `  ${col(c.severity)}${sym(c.severity)}${RESET} ${c.name.padEnd(52)}`;
  if (c.severity === 'PASS') {
    console.log(`${prefix}${DIM}${c.observed}${RESET}`);
  } else {
    console.log(`${prefix}${col(c.severity)}${c.observed}${RESET}`);
    console.log(`    ${DIM}Expected: ${c.expected}${RESET}`);
    console.log(`    ${YEL}Fix: ${c.fix}${RESET}`);
  }
}

console.log();
console.log('═'.repeat(64));

if (blockers.length === 0 && warnings.length === 0) {
  console.log(`${GRN}${BOLD}✓ READY — ${passes.length} checks passed, no issues found.${RESET}`);
} else {
  const parts = [];
  if (blockers.length) parts.push(`${RED}${BOLD}${blockers.length} BLOCKER(S)${RESET}`);
  if (warnings.length) parts.push(`${YEL}${warnings.length} WARNING(S)${RESET}`);
  console.log(`RESULT: ${parts.join(', ')}`);
  if (blockers.length > 0) {
    console.log(`${RED}${BOLD}Status: UNSAFE — server will block protocol execution${RESET}`);
    console.log();
    console.log(`${BOLD}Fixes required (in order):${RESET}`);
    blockers.forEach((b, i) => console.log(`  ${i + 1}. ${RED}[${b.component}] ${b.name}${RESET}: ${b.fix}`));
  }
}

console.log('═'.repeat(64));
console.log();

// Write JSON report
const report = { epochId, checkedAt: new Date().toISOString(), chainId: actualChainId, rpcUrl, checks, blockers, warnings, passes, ready: blockers.length === 0 };
const reportsDir = resolve(ROOT, 'reports');
if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
writeFileSync(resolve(reportsDir, 'preflight-local.json'), JSON.stringify(report, null, 2));
console.log(`${DIM}Report written to reports/preflight-local.json${RESET}`);

process.exit(blockers.length > 0 ? 1 : 0);
