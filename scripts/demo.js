import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const isWin = process.platform === 'win32';
const sh = isWin ? 'cmd' : 'sh';
const shFlag = isWin ? '/c' : '-c';

function run(cmd, label) {
  const prefix = label ? `[${label}] ` : '';
  const proc = spawn(sh, [shFlag, cmd], { stdio: 'inherit', shell: false });
  proc.on('error', err => console.error(`${prefix}failed to start:`, err.message));
  return proc;
}

function runAndWait(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(sh, [shFlag, cmd], { stdio: 'inherit', shell: false });
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`exited ${code}`))));
    proc.on('error', reject);
  });
}

console.log('[NODE] starting hardhat node...');
run('npx hardhat node', 'NODE');

console.log('[DEPLOY] waiting for node to be ready...');
await sleep(4000);

console.log('[DEPLOY] deploying contracts...');
await runAndWait('npx hardhat run scripts/deploy.ts --network localhost');
console.log('[DEPLOY] done');

console.log('[SVC] starting signer + wallet services...');
run('npm --prefix services/signer-treasury run dev', 'T-SIGN');
run('npm --prefix services/signer-escrow run dev', 'E-SIGN');
run('npm --prefix services/wallet-factory run dev', 'W-FACT');

await sleep(2000);

console.log('[WEB] starting frontend...');
run('pnpm --dir frontend dev', 'WEB');
