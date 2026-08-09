/**
 * Demo: create 20 bank-origin term deposits across 10 demo institutions.
 *
 * Usage:
 *   node scripts/demo-20-batches.js [--dry-run] [--server http://localhost:4000]
 *
 * Environment:
 *   ADMIN_API_TOKEN   — required if the server has admin token protection
 *   BANKING_SERVER    — override server base URL
 *
 * The script calls POST /banking/escrow/admin/dev/demo-20-batches,
 * then calls POST /banking/escrow/reconcile-settlements with dryRun=true
 * to show what would be reconciled.
 */

const SERVER_BASE = process.env.BANKING_SERVER
  ?? process.argv.find(a => a.startsWith('--server='))?.split('=')[1]
  ?? 'http://localhost:4000';

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? '';
const DRY_RUN    = process.argv.includes('--dry-run');

async function post(path, body = {}) {
  const url = `${SERVER_BASE}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!resp.ok) {
    console.error(`[ERROR] ${resp.status} ${url}:`, json);
    return null;
  }
  return json;
}

function fmtUsd(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

(async () => {
  console.log('=== Sagitta 20-Batch Demo Harness ===');
  console.log(`Server: ${SERVER_BASE}`);
  console.log(`Admin token: ${ADMIN_TOKEN ? '(set)' : '(not set)'}`);
  console.log('');

  console.log('Step 1: Creating 20 demo term deposits across 10 institutions...');
  const createResult = await post('/banking/escrow/admin/dev/demo-20-batches');
  if (!createResult) { process.exit(1); }

  console.log(`  Created: ${createResult.created}  Failed: ${createResult.failed}`);
  console.log('');
  console.log('  ┌──────────────────────────────────┬────────────┬──────┬────────────────────┬──────────────────────────────┐');
  console.log('  │ Institution                       │ Amount     │ Term │ Scenario           │ Term Deposit ID              │');
  console.log('  ├──────────────────────────────────┼────────────┼──────┼────────────────────┼──────────────────────────────┤');
  for (const r of createResult.results ?? []) {
    const inst   = (r.institutionId ?? '').padEnd(33).slice(0, 33);
    const amt    = fmtUsd(r.amountUsd).padStart(10);
    const term   = `${r.termMonths}M`.padEnd(4);
    const scen   = (r.scenario ?? '').padEnd(18).slice(0, 18);
    const id     = (r.termDepositId ?? '').slice(0, 28);
    const status = r.status !== 'created' ? ` ⚠ ${r.status}` : '';
    console.log(`  │ ${inst} │ ${amt} │ ${term} │ ${scen} │ ${id}${status}`);
  }
  console.log('  └──────────────────────────────────┴────────────┴──────┴────────────────────┴──────────────────────────────┘');
  console.log('');

  console.log('Step 2: Dry-run reconciliation scan (no writes)...');
  const reconResult = await post('/banking/escrow/reconcile-settlements', { dryRun: true });
  if (!reconResult) {
    console.log('  (Reconciliation endpoint not available or returned an error.)');
  } else {
    console.log(`  Batches scanned:  ${reconResult.batchesProcessed ?? 0}`);
    console.log(`  Deposits found:   ${reconResult.depositsFound ?? 0}`);
    console.log(`  Would post:       ${reconResult.posted ?? 0}`);
    console.log(`  Would skip:       ${reconResult.skipped ?? 0}`);
    console.log(`  Would fail:       ${reconResult.failed ?? 0}`);
    console.log(`  Already complete: ${reconResult.alreadyComplete ?? 0}`);
    if ((reconResult.results ?? []).length > 0) {
      console.log('');
      console.log('  Per-deposit results:');
      for (const r of reconResult.results) {
        console.log(`    ${r.escrowBatchId?.slice(0, 8)}… / ${r.termPositionId?.slice(0, 12)}… → ${r.status}${r.errorCode ? ` [${r.errorCode}]` : ''}`);
      }
    }
  }

  console.log('');
  console.log('Done.');
  if (!DRY_RUN) {
    console.log('');
    console.log('To run live reconciliation (writes to Fineract):');
    console.log(`  curl -X POST ${SERVER_BASE}/banking/escrow/reconcile-settlements \\`);
    console.log(`       -H "content-type: application/json" \\`);
    console.log(`       -H "x-admin-token: <token>" \\`);
    console.log(`       -d \'{"dryRun":false}\'`);
  }
})();
