/**
 * simulate-settlement.mjs
 *
 * Dev-only script that simulates the return of deployed capital for a batch
 * on a local Hardhat chain, then finalizes settlement so Phase 9 can advance.
 *
 * Each deployment leg is assigned a random P&L between -5% and +15%.
 * The aggregate return is deposited into InvestmentEscrow and
 * finalizeBatchSettlement() is called automatically.
 *
 * Usage:
 *   node scripts/simulate-settlement.mjs --sourceBatchId=1
 *   node scripts/simulate-settlement.mjs --sourceBatchId=1 --dry-run
 *
 * Prerequisites:
 *   - Hardhat node running
 *   - services/signer-escrow/.env present (provides ESCROW_SIGNER_PRIVATE_KEY)
 *   - InvestmentEscrow deployed (INVESTMENT_ESCROW_ADDRESS in signer-escrow .env)
 *   - Phase 8 must be complete for the batch (legs deployed)
 *   - DB running (reads Phase 8 evidence for leg breakdown)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } from 'ethers';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    for (const a of args) {
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
      const i = args.indexOf(flag);
      if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
    }
    return null;
  };
  return {
    sourceBatchId: get('--sourceBatchId') ?? get('--batch-id'),
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
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/\s*#.*$/, '');
  }
  return out;
}

const rootEnv    = parseEnvFile(resolve(REPO_ROOT, '.env'));
const escrowSvcEnv = parseEnvFile(resolve(REPO_ROOT, 'services', 'signer-escrow', '.env'));
const serverEnv  = parseEnvFile(resolve(REPO_ROOT, 'server', '.env'));

const env = { ...rootEnv, ...escrowSvcEnv, ...process.env };

// ─── Contract config ───────────────────────────────────────────────────────────

const RPC_URL      = env.RPC_URL ?? env.ESCROW_RPC_URL ?? 'http://127.0.0.1:8545';
const ESCROW_ADDR  = env.INVESTMENT_ESCROW_ADDRESS ?? env.ESCROW_CONTRACT_ADDRESS;
const PRIVATE_KEY  = env.ESCROW_SIGNER_PRIVATE_KEY ?? env.DEPLOYER_PRIVATE_KEY;
const DB_URL       = serverEnv.DATABASE_URL ?? env.DATABASE_URL;

if (!ESCROW_ADDR)  { console.error('INVESTMENT_ESCROW_ADDRESS not set in services/signer-escrow/.env'); process.exit(1); }
if (!PRIVATE_KEY)  { console.error('ESCROW_SIGNER_PRIVATE_KEY not set in services/signer-escrow/.env'); process.exit(1); }

const ESCROW_ABI = [
  'function getBatchAccounting(uint256 batchId) view returns (tuple(uint256 principalAuthorizedUsd6,uint256 principalFundedUsd6,uint256 principalCommittedUsd6,uint256 principalReturnedUsd6,uint256 feesUsd6,int256 realizedPnlUsd6,int256 unrealizedPnlUsd6,uint256 lastMarkedAt,bool frozen))',
  'function getBatchPositionIds(uint256 batchId) view returns (uint256[])',
  'function positions(uint256 positionId) view returns (tuple(uint256 id,uint256 batchId,uint256 routeId,string assetSymbol,uint256 commitmentUsd6,uint256 quantityE18,uint256 carryingValueUsd6,uint256 proceedsUsd6,uint256 feeUsd6,bytes32 externalRefHash,bytes32 lastMarkHash,bytes32 closeRefHash,uint64 openedAt,uint64 markedAt,uint64 closedAt,uint8 status))',
  'function closePosition(uint256 positionId, uint256 proceedsUsd6, bytes32 closeRefHash, uint256 feeUsd6) external',
  'function depositReturnForBatch(uint256 batchId, uint256 finalNavPerShare) external',
  'function finalizeBatchSettlement(uint256 batchId, bytes32 settlementReportHash, bytes32 complianceDigestHash) external',
  'function getBatchSettlement(uint256 batchId) view returns (tuple(uint256 finalValueUsd6,uint256 protocolFeeUsd6,uint256 userProfitUsd6,uint256 finalNavPerShare,bytes32 settlementReportHash,bytes32 complianceDigestHash,uint256 finalizedAt,bool finalized))',
  'function keeper() view returns (address)',
  'function usdc() view returns (address)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
];

// ─── P&L simulation helpers ───────────────────────────────────────────────────

function randomPnlFraction() {
  // Uniform random between -0.05 and +0.15
  return -0.05 + Math.random() * 0.20;
}

function applyPnl(amountUsd6, pnlFraction) {
  // Returns raw uint256 with P&L applied
  const factor = 1 + pnlFraction;
  return BigInt(Math.round(Number(amountUsd6) * factor));
}

function fmtUsd(raw) {
  return `$${parseFloat(formatUnits(raw, 6)).toFixed(2)}`;
}

function fmtPnl(pnl) {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${(pnl * 100).toFixed(2)}%`;
}

// ─── DB: read Phase 8 legs ────────────────────────────────────────────────────

async function readPhase8Legs(sourceBatchId) {
  if (!DB_URL) return null;
  let pool;
  try {
    pool = new Pool({ connectionString: DB_URL });
    const res = await pool.query(`
      SELECT e.evidence_json
      FROM escrow_batch_lifecycle l
      JOIN escrow_batch_phase_evidence e
        ON e.escrow_batch_id = l.escrow_batch_id AND e.phase = 8
      WHERE l.source_batch_id = $1
      LIMIT 1
    `, [String(sourceBatchId)]);
    if (res.rows.length === 0) return null;
    const ev = res.rows[0].evidence_json;
    return Array.isArray(ev?.legs) ? ev.legs : null;
  } catch {
    return null;
  } finally {
    await pool?.end().catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { sourceBatchId: sourceBatchIdArg, dryRun } = parseArgs();
  if (!sourceBatchIdArg) {
    console.error('Usage: node scripts/simulate-settlement.mjs --sourceBatchId=<id>');
    process.exit(1);
  }

  const sourceBatchId = BigInt(sourceBatchIdArg);
  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const escrow = new Contract(ESCROW_ADDR, ESCROW_ABI, signer);

  console.log(`\n── Simulate Settlement ───────────────────────────────`);
  console.log(`   Batch ID     : ${sourceBatchId}`);
  console.log(`   Escrow       : ${ESCROW_ADDR}`);
  console.log(`   Keeper       : ${signer.address}`);
  console.log(`   Dry run      : ${dryRun}`);
  console.log(`   RPC          : ${RPC_URL}`);
  console.log(`─────────────────────────────────────────────────────\n`);

  // Check settlement not already finalized
  const settlement = await escrow.getBatchSettlement(sourceBatchId);
  if (settlement.finalized) {
    console.log(`✓ Batch ${sourceBatchId} settlement is already finalized.`);
    console.log(`  finalValueUsd6    = ${fmtUsd(settlement.finalValueUsd6)}`);
    console.log(`  finalizedAt       = ${new Date(Number(settlement.finalizedAt) * 1000).toISOString()}`);
    return;
  }

  // Read batch accounting
  const accounting = await escrow.getBatchAccounting(sourceBatchId);
  const principalFunded = accounting.principalFundedUsd6;
  console.log(`Principal funded : ${fmtUsd(principalFunded)}`);

  // Read open positions for this batch
  let positionIds = [];
  try {
    positionIds = await escrow.getBatchPositionIds(sourceBatchId);
  } catch {
    // function may not exist on older ABI — default to empty
  }
  const openPositionIds = [];
  for (const pid of positionIds) {
    const pos = await escrow.positions(pid);
    if (Number(pos.status) === 0) openPositionIds.push({ id: pid, commitmentUsd6: pos.commitmentUsd6, assetSymbol: pos.assetSymbol });
  }
  console.log(`Open positions   : ${openPositionIds.length}\n`);

  // Try to get per-leg breakdown from DB Phase 8 evidence
  const phase8Legs = await readPhase8Legs(sourceBatchIdArg);

  // ── Simulate per-leg P&L ──────────────────────────────────────────────────

  let totalReturnUsd6 = 0n;

  if (openPositionIds.length > 0) {
    // Batch has on-chain positions — close each with simulated P&L
    console.log(`Closing ${openPositionIds.length} on-chain position(s):`);
    for (const pos of openPositionIds) {
      const pnl = randomPnlFraction();
      const proceeds = applyPnl(pos.commitmentUsd6, pnl);
      totalReturnUsd6 += proceeds;
      console.log(`  Position ${pos.id} (${pos.assetSymbol}): ${fmtUsd(pos.commitmentUsd6)} → ${fmtUsd(proceeds)} (${fmtPnl(pnl)})`);
      if (!dryRun) {
        const tx = await escrow.closePosition(pos.id, proceeds, '0x' + '0'.repeat(64), 0n);
        await tx.wait();
        console.log(`    ✓ closePosition tx: ${tx.hash}`);
      }
    }
  } else if (phase8Legs && phase8Legs.filter(l => l.status === 'executed').length > 0) {
    const executedLegs = phase8Legs.filter(l => l.status === 'executed');
    const rawTotal = executedLegs.reduce((sum, l) => sum + BigInt(String(l.amountUsd6 ?? '0')), 0n);

    if (rawTotal === 0n) {
      console.error('\n[INTEGRITY FAILURE] All leg amountUsd6 values are 0.');
      console.error(`  principalFundedUsd6 = ${fmtUsd(principalFunded)} (non-zero)`);
      console.error(`  deployedPrincipal   = $0.00 (on-chain escrowBatchPositions[${sourceBatchId}])`);
      console.error('');
      console.error('  This is a principal_mismatch: the Treasury → Escrow handoff recorded');
      console.error('  deployedPrincipal=0 on-chain while the batch is funded.');
      console.error('');
      console.error('  Resolution: Phase 1 must now block with principal_mismatch.');
      console.error('  Fix the Treasury.depositToEscrow() call so deployedPrincipal is written');
      console.error('  on-chain, then re-run the lifecycle from Phase 1.');
      process.exit(1);
    }

    console.log(`Simulating returns for ${executedLegs.length} deployment leg(s):`);
    for (const leg of executedLegs) {
      const deployed = BigInt(String(leg.amountUsd6 ?? '0'));
      const pnl = randomPnlFraction();
      const returned = applyPnl(deployed, pnl);
      totalReturnUsd6 += returned;
      const symbol = String(leg.legId ?? '').split('-').slice(2).join('-') || 'LEG';
      console.log(`  ${symbol.padEnd(12)} ${String(leg.destination ?? '').slice(0, 10)}…  deployed=${fmtUsd(deployed)}  returned=${fmtUsd(returned)}  P&L=${fmtPnl(pnl)}`);
    }
  } else {
    // Fallback: use principalFunded with a single random P&L
    const pnl = randomPnlFraction();
    totalReturnUsd6 = applyPnl(principalFunded, pnl);
    console.log(`No leg data — simulating batch-level return: ${fmtUsd(principalFunded)} → ${fmtUsd(totalReturnUsd6)} (${fmtPnl(pnl)})`);
  }

  const finalNavPerShare = principalFunded === 0n
    ? BigInt(1e18)
    : (totalReturnUsd6 * BigInt(1e18)) / principalFunded;

  const pnlBps = principalFunded === 0n ? 0 : Number((totalReturnUsd6 - principalFunded) * 10000n / principalFunded);
  console.log(`\nTotal return     : ${fmtUsd(totalReturnUsd6)}`);
  console.log(`Final NAV/share  : ${formatUnits(finalNavPerShare, 18)} (${pnlBps >= 0 ? '+' : ''}${(pnlBps / 100).toFixed(2)}%)`);

  if (dryRun) {
    console.log(`\n[DRY RUN] — no transactions submitted.`);
    return;
  }

  if (openPositionIds.length === 0) {
    // No internal positions — use depositReturnForBatch (mints USDC + finalizes in one call)
    console.log(`\nCalling depositReturnForBatch(${sourceBatchId}, ${finalNavPerShare})…`);
    const tx = await escrow.depositReturnForBatch(sourceBatchId, finalNavPerShare);
    const receipt = await tx.wait();
    console.log(`✓ tx: ${receipt.hash}`);
  } else {
    // All positions now closed — call finalizeBatchSettlement directly
    // Ensure escrow has the USDC (already deposited via closePosition → _collectReturnFunds)
    console.log(`\nCalling finalizeBatchSettlement(${sourceBatchId})…`);
    const tx = await escrow.finalizeBatchSettlement(sourceBatchId, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64));
    const receipt = await tx.wait();
    console.log(`✓ tx: ${receipt.hash}`);
  }

  // Confirm
  const final = await escrow.getBatchSettlement(sourceBatchId);
  console.log(`\n── Settlement Result ─────────────────────────────────`);
  console.log(`   finalized        : ${final.finalized}`);
  console.log(`   finalValueUsd6   : ${fmtUsd(final.finalValueUsd6)}`);
  console.log(`   userProfitUsd6   : ${fmtUsd(final.userProfitUsd6)}`);
  console.log(`   protocolFeeUsd6  : ${fmtUsd(final.protocolFeeUsd6)}`);
  console.log(`   finalizedAt      : ${new Date(Number(final.finalizedAt) * 1000).toISOString()}`);
  console.log(`─────────────────────────────────────────────────────`);
  console.log(`\nPhase 9 checklist will unblock on next refresh.\n`);
}

main().catch((err) => {
  console.error('\n[simulate-settlement] Error:', err.message ?? err);
  process.exit(1);
});
