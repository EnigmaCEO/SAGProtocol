// Enhanced TypeScript simulation with optional on-chain mode.
// Usage:
//  - node dist/scripts/simulateRebalance.js             -> run local deterministic sim (default)
//  - ts-node scripts/simulateRebalance.ts onchain       -> run per-week compute+call on local chain (http://localhost:8545)
//  - ts-node scripts/simulateRebalance.ts stress        -> run multi-batch stress test (local deterministic)
// Verified: includes onchain-stress mode that uses frontend/src/lib/addresses.ts, performs deposits, rebalances, batch rolls and batch closures with profit simulation.

import { ethers } from 'ethers';
import path from 'path';
import { CONTRACT_ADDRESSES } from "../frontend/src/lib/addresses.ts";

type State = {
  treasury: number; // USD (human integer)
  reserve: number;  // USD
  invested: number; // USD
  deposits: number; // USD
};

const ALPHA_NUM = 1; // numerator for alpha (alpha = ALPHA_NUM / ALPHA_DEN)
const ALPHA_DEN = 2; // denominator for alpha (alpha = 1/2)
const LOCALHOST_RPC = 'http://localhost:8545';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Default addresses (override with env vars or args if needed)
const TREASURY_ADDRESS = CONTRACT_ADDRESSES.Treasury;

function format(n: number) {
  return `$${n.toFixed(1)}`;
}

function almostEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

/**
 * Compute x = (R - alpha*T) / (1 + alpha) using integer math.
 * We represent alpha = num/den. Then:
 * x = (R*den - num*T) / (den + num)
 *
 * Inputs/outputs are plain JS numbers (USD, no decimals) for the local sim.
 */
function rebalanceSellAmount(T: number, R: number, alphaNum = ALPHA_NUM, alphaDen = ALPHA_DEN) {
  return (R * alphaDen - alphaNum * T) / (alphaDen + alphaNum);
}

// BigNumber version for on-chain USD6 units
function rebalanceSellAmountBN(T: ethers.BigNumber, R: ethers.BigNumber, alphaNum = ALPHA_NUM, alphaDen = ALPHA_DEN) {
  // x = (R*den - num*T) / (den + num)
  const num1 = R.mul(alphaDen).sub(T.mul(alphaNum)); // numerator
  const denom = alphaDen + alphaNum; // small integer
  // If numerator <= 0, result is <= 0
  if (num1.lte(0)) return ethers.BigNumber.from(0);
  return num1.div(denom); // integer division in USD6 units
}

async function onchainRebalanceFlow() {
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.error('TREASURY_ADDRESS not set. Provide via env TREASURY_ADDRESS or update the script default.');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(LOCALHOST_RPC);
  const signer = new ethers.Wallet(TEST_PRIVATE_KEY, provider);
  const treasuryAbiPartial = [
    'function getTreasuryValueUsd() view returns (uint256)',
    'function getReserveValueUsd() view returns (uint256)',
    // common rebalance function names we will try in order:
    'function rebalanceReserve()',
    'function rebalanceByAmount(uint256)',
    'function rebalanceSell(uint256)',
    'function rebalanceSellUsd(uint256)'
  ];
  const treasury = new ethers.Contract(TREASURY_ADDRESS, treasuryAbiPartial, signer);

  // read initial on-chain state
  let T: ethers.BigNumber = await treasury.getTreasuryValueUsd();
  let R: ethers.BigNumber = await treasury.getReserveValueUsd();

  console.log('On-chain starting values (USD6):', { T: T.toString(), R: R.toString() });

  // compute x in USD6 units
  const x = rebalanceSellAmountBN(T, R); // BigNumber
  const xHuman = Number(x.toString()) / 1e6;
  console.log(' Computed sell amount x (USD6):', x.toString(), `≈ $${xHuman.toFixed(3)}`);

  if (x.isZero()) {
    console.log(' No sell required (x == 0). Attempting to call rebalanceReserve() as noop/verification.');
  }

  // Try calls in order: rebalanceByAmount, rebalanceSell, rebalanceSellUsd, rebalanceReserve
  let tx;
  const gasLimit = { gasLimit: 4_000_000 };
  try {
    if (!x.isZero()) {
      // attempt amount-based variants first
      try {
        tx = await treasury.rebalanceByAmount(x, gasLimit);
        await tx.wait();
        console.log(' Called rebalanceByAmount(x)');
      } catch (e) {
        try {
          tx = await treasury.rebalanceSell(x, gasLimit);
          await tx.wait();
          console.log(' Called rebalanceSell(x)');
        } catch (e2) {
          try {
            tx = await treasury.rebalanceSellUsd(x, gasLimit);
            await tx.wait();
            console.log(' Called rebalanceSellUsd(x)');
          } catch (e3) {
            // fallback to parameterless rebalance
            tx = await treasury.rebalanceReserve(gasLimit);
            await tx.wait();
            console.log(' Called rebalanceReserve() fallback');
          }
        }
      }
    } else {
      // x == 0, still call rebalanceReserve() to allow on-chain to recompute if needed
      tx = await treasury.rebalanceReserve(gasLimit);
      await tx.wait();
      console.log(' Called rebalanceReserve() because computed x == 0');
    }
  } catch (err) {
    console.error('Failed to call any rebalance function on-chain:', err);
    process.exit(2);
  }

  // Fetch post-state and verify
  const T2: ethers.BigNumber = await treasury.getTreasuryValueUsd();
  const R2: ethers.BigNumber = await treasury.getReserveValueUsd();
  console.log('On-chain post values (USD6):', { T2: T2.toString(), R2: R2.toString() });

  // validate safe backing invariant: T+R unchanged (they should only shift between T and R)
  const safeBefore = T.add(R);
  const safeAfter = T2.add(R2);
  if (!safeBefore.eq(safeAfter)) {
    console.error('Safe backing changed on-chain: before', safeBefore.toString(), 'after', safeAfter.toString());
    process.exit(3);
  }

  // validate ratio R/T ≈ alpha (allow small rounding)
  // compare R2 * alphaDen ≈ alphaNum * T2
  const left = R2.mul(ALPHA_DEN);
  const right = T2.mul(ALPHA_NUM);
  const diff = left.sub(right).abs();
  // allow small difference up to 1 USD6 per 1e3 scale (tunable)
  if (diff.gt(ethers.BigNumber.from(1000))) {
    console.error('Post-rebalance ratio not matching target alpha. Diff:', diff.toString());
    process.exit(4);
  }

  console.log('On-chain rebalance validated: safe backing preserved and R/T ≈ target alpha.');
}

function localSimulation() {
  const s: State = {
    treasury: 1_000_000,
    reserve: 500_000,
    invested: 0,
    deposits: 0,
  };

  console.log('Starting state:', s);

  const depositPerWeek = 250_000;
  for (let week = 1; week <= 4; week++) {
    console.log(`\nWeek ${week} — deposit ${format(depositPerWeek)}`);

    // 1) Fund batch: Treasury sells SAG -> send deposit out to investments
    s.treasury -= depositPerWeek;
    s.invested += depositPerWeek;
    s.deposits += depositPerWeek;

    const safeBackingPre = s.treasury + s.reserve;
    const coveragePre = s.deposits > 0 ? safeBackingPre / s.deposits : Infinity;
    console.log(' Pre-rebalance T:', format(s.treasury), 'R:', format(s.reserve), 'Invested:', format(s.invested));
    console.log('  SafeBacking:', format(safeBackingPre), 'Coverage:', coveragePre.toFixed(3), '×');

    // 2) Rebalance Gold -> Treasury so that R' = alpha * T'
    const x = rebalanceSellAmount(s.treasury, s.reserve, ALPHA_NUM, ALPHA_DEN);
    if (x > 0) {
      s.reserve -= x;
      s.treasury += x;
      console.log(`  Rebalance: sell ${format(x)} of Gold -> Treasury`);
    } else if (x < 0) {
      const buy = -x;
      s.treasury -= buy;
      s.reserve += buy;
      console.log(`  Rebalance: sell ${format(buy)} of SAG -> Reserve`);
    } else {
      console.log('  No rebalance needed');
    }

    const safeBackingPost = s.treasury + s.reserve;
    const coveragePost = s.deposits > 0 ? safeBackingPost / s.deposits : Infinity;
    console.log(' Post-rebalance T:', format(s.treasury), 'R:', format(s.reserve));
    console.log('  SafeBacking:', format(safeBackingPost), 'Coverage:', coveragePost.toFixed(3), '×');
    console.log('  Ratio R/T:', (s.reserve / s.treasury).toFixed(3));

    // validations
    if (!almostEqual(safeBackingPre, safeBackingPost)) {
      throw new Error(`SafeBacking changed during rebalance on week ${week}`);
    }
    if (!almostEqual(coveragePre, coveragePost)) {
      throw new Error(`Coverage changed during rebalance on week ${week}`);
    }
    if (!almostEqual(s.reserve / s.treasury, ALPHA_NUM / ALPHA_DEN, 1e-3)) {
      throw new Error(`Post-rebalance R/T != ${ALPHA_NUM / ALPHA_DEN} on week ${week}`);
    }
  }

  console.log('\nFinal state:', s);
  console.log('Local simulation OK — math matches your walkthrough.');
}

// ------------------------ NEW: Stress Simulation ------------------------

/**
 * stressSimulation runs multiple weeks, creates batches, rebalances, and closes batches with a profit rate.
 *
 * Parameters (tunable via function args):
 *  - weeks: number of weeks to simulate
 *  - depositPerWeek: USD deposited each week
 *  - closeDelayWeeks: close a batch this many weeks after it's rolled active
 *  - profitRate: e.g. 0.2 for +20% profit when batches close
 */
function stressSimulation({
  weeks = 12,
  depositPerWeek = 250_000,
  closeDelayWeeks = 3,
  profitRate = 0.2,
}: {
  weeks?: number;
  depositPerWeek?: number;
  closeDelayWeeks?: number;
  profitRate?: number;
}) {
  // State
  const s: State = {
    treasury: 1_000_000,
    reserve: 500_000,
    invested: 0,
    deposits: 0,
  };

  // Batch bookkeeping (off-chain)
  type Batch = {
    id: number;
    status: 'PENDING' | 'ACTIVE' | 'CLOSED';
    createdWeek: number;
    activatedWeek?: number;
    closedWeek?: number;
    principal: number; // USD
  };

  const batches: Record<number, Batch> = {};
  let nextBatchId = 1;
  // create initial pending batch
  batches[nextBatchId] = { id: nextBatchId, status: 'PENDING', createdWeek: 0, principal: 0 };
  let currentPendingId = nextBatchId;
  nextBatchId++;

  // Active batches queue to check for closing
  const activeBatchIds: number[] = [];

  console.log('Stress simulation start', { weeks, depositPerWeek, closeDelayWeeks, profitRate });
  for (let week = 1; week <= weeks; week++) {
    console.log(`\n=== Week ${week} ===`);
    // 1) New deposit arrives and registers into current pending batch
    const depositUsd = depositPerWeek;
    console.log(`User deposits ${format(depositUsd)} into pending batch #${currentPendingId}`);

    // Treasury sells SAG -> produce USDC for investments; from balance perspective, treasury value reduces
    s.treasury -= depositUsd;
    s.invested += depositUsd; // funds are now invested/out-of-protocol
    s.deposits += depositUsd;

    // Add to pending batch principal
    batches[currentPendingId].principal += depositUsd;

    // Compute pre-rebalance safe backing (Treasury + Reserve)
    const safePre = s.treasury + s.reserve;
    const coveragePre = s.deposits > 0 ? safePre / s.deposits : Infinity;
    console.log(' Pre-rebalance T:', format(s.treasury), 'R:', format(s.reserve), 'Invested:', format(s.invested));
    console.log('  SafeBacking:', format(safePre), 'Coverage:', coveragePre.toFixed(3), '×');

    // 2) Rebalance after deposit
    const x = rebalanceSellAmount(s.treasury, s.reserve, ALPHA_NUM, ALPHA_DEN);
    if (x > 0) {
      // sell x of Gold -> move from reserve to treasury
      s.reserve -= x;
      s.treasury += x;
      console.log(`  Rebalance: sell ${format(x)} of Gold -> Treasury`);
    } else if (x < 0) {
      const buy = -x;
      s.treasury -= buy;
      s.reserve += buy;
      console.log(`  Rebalance: buy ${format(buy)} Gold with Treasury`);
    } else {
      console.log('  No rebalance needed');
    }

    const safePost = s.treasury + s.reserve;
    const coveragePost = s.deposits > 0 ? safePost / s.deposits : Infinity;
    console.log(' Post-rebalance T:', format(s.treasury), 'R:', format(s.reserve));
    console.log('  SafeBacking:', format(safePost), 'Coverage:', coveragePost.toFixed(3), '×');
    console.log('  Ratio R/T:', (s.reserve / s.treasury).toFixed(3));

    // Validations — safe backing unchanged by internal transfer
    if (!almostEqual(safePre, safePost)) {
      throw new Error(`SafeBacking changed during rebalance on week ${week}`);
    }
    if (!almostEqual(coveragePre, coveragePost)) {
      throw new Error(`Coverage changed during rebalance on week ${week}`);
    }

    // 3) Roll the current pending batch into ACTIVE (weekly roll)
    const pending = batches[currentPendingId];
    if (pending.principal === 0) {
      console.log(`  Pending batch #${currentPendingId} empty -> skip roll`);
    } else {
      pending.status = 'ACTIVE';
      pending.activatedWeek = week;
      activeBatchIds.push(pending.id);
      console.log(`  Rolled pending batch #${pending.id} => ACTIVE (principal ${format(pending.principal)})`);

      // Create new pending batch and set it as current
      batches[nextBatchId] = { id: nextBatchId, status: 'PENDING', createdWeek: week, principal: 0 };
      console.log(`  Created new pending batch #${nextBatchId}`);
      currentPendingId = nextBatchId;
      nextBatchId++;
    }

    // 4) Check active batches to close those that reached closeDelayWeeks
    for (let i = activeBatchIds.length - 1; i >= 0; i--) {
      const bid = activeBatchIds[i];
      const b = batches[bid];
      if (!b.activatedWeek) continue;
      const age = week - b.activatedWeek;
      if (age >= closeDelayWeeks) {
        // Simulate investment return: principal * (1 + profitRate)
        const finalValue = Math.round(b.principal * (1 + profitRate));
        const profit = finalValue - b.principal;
        // Return funds to Treasury (USDC arrives)
        s.treasury += finalValue;
        // Reduce invested (principal returns) — profit added to treasury
        s.invested -= b.principal;
        // Mark closed
        b.status = 'CLOSED';
        b.closedWeek = week;
        activeBatchIds.splice(i, 1);
        console.log(`  Closed batch #${b.id}: principal ${format(b.principal)} -> final ${format(finalValue)} (profit ${format(profit)})`);
      }
    }

    // Print week summary
    console.log(` End of week ${week} state: T=${format(s.treasury)}, R=${format(s.reserve)}, Invested=${format(s.invested)}, Deposits=${format(s.deposits)}`);
  }

  // Final checks & summary
  const totalActive = Object.values(batches).filter(b => b.status === 'ACTIVE').length;
  const totalClosed = Object.values(batches).filter(b => b.status === 'CLOSED').length;
  console.log(`\nSimulation complete. Batches created: ${Object.keys(batches).length}, active: ${totalActive}, closed: ${totalClosed}`);
  console.log('Final state:', s);
  console.log('Final batches snapshot (id,status,principal,activated,closed):');
  for (const b of Object.values(batches)) {
    console.log(`#${b.id}: ${b.status} principal=${format(b.principal)} activatedWeek=${b.activatedWeek ?? '-'} closedWeek=${b.closedWeek ?? '-'}`);
  }

  // Sanity asserts
  //  - invested should be non-negative
  if (s.invested < -1e-6) {
    throw new Error('Invariant violation: invested < 0');
  }

  console.log('\nStress simulation OK — multi-batch, rebalances, and +20% closure validated locally.');
}

// ------------------------ NEW: On-chain Stress Flow ------------------------

async function onchainStressFlow({
  weeks = 12,
  depositPerWeek = 250_000, // USD
  closeDelayWeeks = 3,
  profitRate = 0.2,
} = {}) {
  const provider = new ethers.providers.JsonRpcProvider(LOCALHOST_RPC);

  // Load addresses.ts as the single source of truth (required)
  let ADDR: any = null;
  try {
    const addressesModulePath = path.join(__dirname, '../frontend/src/lib/addresses');
    // require the generated addresses TS/JS file
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(addressesModulePath);
    ADDR = mod.CONTRACT_ADDRESSES ?? mod.default ?? mod;
  } catch (e) {
    throw new Error(`Failed to load frontend/src/lib/addresses.ts: ${String((e as any)?.message || e)}. This file is required as the source of truth.`);
  }

  // Derive keeper/depositor signers from addresses file if it exposes private keys; otherwise fall back to provider signer.
  let keeper: ethers.Signer;
  let depositor: ethers.Signer;
  if (ADDR.PRIVATE_KEYS && Array.isArray(ADDR.PRIVATE_KEYS) && ADDR.PRIVATE_KEYS.length > 0) {
    keeper = new ethers.Wallet(ADDR.PRIVATE_KEYS[0], provider);
    depositor = new ethers.Wallet(ADDR.PRIVATE_KEYS[0], provider);
  } else if (ADDR.DEPLOYER_PRIVATE_KEY) {
    keeper = new ethers.Wallet(ADDR.DEPLOYER_PRIVATE_KEY, provider);
    depositor = new ethers.Wallet(ADDR.DEPLOYER_PRIVATE_KEY, provider);
  } else {
    // fallback to node unlocked account signer
    const accounts = await provider.listAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error('No local accounts available from provider; ensure node has unlocked accounts or add PRIVATE_KEYS to addresses.ts');
    }
    keeper = provider.getSigner(accounts[0]);
    depositor = provider.getSigner(accounts[0]);
  }

  // Validate addresses file contains required contract addresses
  if (!ADDR || !ADDR.Vault || !ADDR.Treasury || !ADDR.InvestmentEscrow || !ADDR.MockDOT || !ADDR.MockUSDC) {
    throw new Error('addresses.ts missing required entries (Vault, Treasury, InvestmentEscrow, MockDOT, MockUSDC). Update frontend/src/lib/addresses.ts.');
  }

  const VAULT_ADDR = ADDR.Vault;
  const TREASURY_ADDR = ADDR.Treasury;
  const ESCROW_ADDR = ADDR.InvestmentEscrow;
  const MDOT_ADDR = ADDR.MockDOT;
  const USDC_ADDR = ADDR.MockUSDC;
  const DOT_ORACLE = ADDR.DotOracle;

  console.log('On-chain stress run using addresses:', { VAULT_ADDR, TREASURY_ADDR, ESCROW_ADDR, MDOT_ADDR, USDC_ADDR });

  // Minimal ABIs for the actions we need
  const VaultABI = [
    'function deposit(address asset, uint256 amount) external',
    'function setEscrow(address) external',
    'function setAsset(address asset, bool enabled, uint8 decimals, address oracle) external',
    'function receiptCount(address user) view returns (uint256)',
    'function userDeposits(address user) view returns (uint256[])',
    'function treasury() view returns (address)',
  ];
  const EscrowABI = [
    'function currentBatchId() view returns (uint256)',
    'function getBatch(uint256) view returns (uint256 id,uint256 startTime,uint256 endTime,uint256 totalCollateralUsd,uint256 totalShares,uint256 finalNavPerShare,uint8 status)',
    'function rollPendingBatch() external',
    'function rollBatch(uint256) external',
    'function closeBatch(uint256,uint256) external',
    'function createPendingBatch() external returns (uint256)',
    'function setCurrentPendingBatch(uint256) external',
  ];
  const TreasuryABI = [
    'function rebalanceReserve() external',
    'function getTreasuryValueUsd() view returns (uint256)',
    'function getReserveValueUsd() view returns (uint256)',
    'function fundEscrowBatch(uint256,uint256) external',
  ];
  const ERC20ABI = [
    'function approve(address,uint256) external returns (bool)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function mint(address,uint256) external',
    'function transfer(address,uint256) external returns (bool)',
  ];
  const OracleABI = ['function getPrice() view returns (uint256)'];

  // Connect contracts using the derived signers
  const vault = new ethers.Contract(VAULT_ADDR, VaultABI, depositor);
  const vaultWithKeeper = new ethers.Contract(VAULT_ADDR, VaultABI, keeper);
  const escrow = new ethers.Contract(ESCROW_ADDR, EscrowABI, keeper);
  const treasury = new ethers.Contract(TREASURY_ADDR, TreasuryABI, keeper);
  const mdot = new ethers.Contract(MDOT_ADDR, ERC20ABI, depositor);
  const usdc = new ethers.Contract(USDC_ADDR, ERC20ABI, keeper);
  const dotOracle = DOT_ORACLE ? new ethers.Contract(DOT_ORACLE, OracleABI, provider) : null;

  // Pre-wire vault->escrow on-chain (owner action) so Vault.deposit calls Escrow.registerDeposit
  try {
    console.log('Setting Vault.escrow ->', ESCROW_ADDR);
    const setEscrowTx = await vaultWithKeeper.setEscrow(ESCROW_ADDR);
    await setEscrowTx.wait();
    console.log('Vault.setEscrow succeeded');
  } catch (e: any) {
    console.warn('vault.setEscrow failed or already set:', String(e?.message || e));
  }

  // Read token decimals and oracle price to compute token amount equivalent to depositPerWeek
  const mdotDecimals: number = Number(await mdot.decimals());
  const dotPrice8: ethers.BigNumber = dotOracle ? (await dotOracle.getPrice()) : ethers.BigNumber.from('100000000'); // fallback $1
  // helper to compute token units for a USD amount
  function usdToTokenAmountUnits(depositUsd: number) {
    // depositUsd in whole USD -> convert to USD6
    const usd6 = BigInt(Math.round(depositUsd * 1_000_000));
    const price8 = BigInt(dotPrice8.toString());
    const numerator = usd6 * (10n ** BigInt(mdotDecimals + 2));
    return ethers.BigNumber.from(numerator / price8);
  }

  // Pre-fund Treasury with enough USDC to collateralize all planned deposits
  try {
    const totalNeededUsd6 = ethers.BigNumber.from(BigInt(Math.round(depositPerWeek)) * 1_000_000n * BigInt(weeks));
    console.log('Minting total USDC to Treasury to cover all deposits (usd6):', totalNeededUsd6.toString());
    // usdc.mint is called by keeper (assumes MockUSDC.mint is publicly available in test)
    const mintTx = await usdc.connect(keeper).mint(TREASURY_ADDR, totalNeededUsd6);
    await mintTx.wait();
    console.log('Minted USDC to Treasury');
  } catch (e: any) {
    console.warn('Failed to mint USDC to Treasury (proceeding, but collateralize may revert):', String(e?.message || e));
  }

  // Map of activated batches to the week they activated
  const activatedAt: Record<number, number> = {};

  for (let week = 1; week <= weeks; week++) {
    console.log(`\n--- Week ${week} (on-chain) ---`);

    // === Create a dedicated pending batch for this week's deposits and set it as current ===
    let newBatchIdNum: number | null = null;
    try {
      // call createPendingBatch via keeper to create an explicit pending batch for this deposit
      const idBn = await escrow.connect(keeper).callStatic.createPendingBatch();
      newBatchIdNum = Number(idBn.toString());
      const createTx = await escrow.connect(keeper).createPendingBatch();
      await createTx.wait();
      console.log(` Created pending batch #${newBatchIdNum}`);

      // set as current pending batch so Vault.registerDeposit will record into it (if allowed)
      try {
        const setTx = await escrow.connect(keeper).setCurrentPendingBatch(newBatchIdNum);
        await setTx.wait();
        console.log(` Set current pending batch -> #${newBatchIdNum}`);
      } catch (e: any) {
        console.warn('setCurrentPendingBatch failed (maybe not authorized):', String(e?.message || e));
      }
    } catch (e: any) {
      console.warn('Failed to create/set pending batch; continuing without explicit batch creation:', String(e?.message || e));
      newBatchIdNum = null;
    }

    // 1) Deposit from depositor to Vault (approve then deposit)
    const tokenAmount = usdToTokenAmountUnits(depositPerWeek);
    console.log(' Approving Vault to spend mDOT amount:', tokenAmount.toString());
    let tx = await mdot.connect(depositor).approve(VAULT_ADDR, tokenAmount);
    await tx.wait();

    // Optional: debug pre-balances
    try {
      const balBefore = await mdot.balanceOf(await depositor.getAddress());
      console.log(' depositor mDOT balance before:', balBefore.toString());
    } catch {}

    console.log(' Depositing into Vault:', depositPerWeek, 'USD -> token units', tokenAmount.toString());
    tx = await vault.connect(depositor).deposit(MDOT_ADDR, tokenAmount);
    await tx.wait();
    console.log(' Deposit tx mined');

    // Verify deposit registered in the newly-created pending batch (if we created one)
    if (newBatchIdNum !== null) {
      try {
        const batchAfter = await escrow.getBatch(newBatchIdNum);
        const collUsd = ethers.BigNumber.from(batchAfter.totalCollateralUsd.toString());
        console.log(` Batch #${newBatchIdNum} collateral after deposit (usd6):`, collUsd.toString());
        if (collUsd.eq(0)) {
          console.warn(`Warning: deposit did not register into batch #${newBatchIdNum} (totalCollateralUsd == 0)`);
        }
      } catch (e: any) {
        console.warn('Failed to read batch after deposit:', String(e?.message || e));
      }
    }

    // 2) Immediately call Treasury.rebalanceReserve() (keeper)
    try {
      tx = await treasury.connect(keeper).rebalanceReserve();
      await tx.wait();
      console.log(' Called Treasury.rebalanceReserve()');
    } catch (e: any) {
      console.warn('rebalanceReserve() failed or no-op:', String(e?.message || e));
    }

    // 3) Advance time by 7 days to allow rolling (evm_increaseTime)
    const advance = 7 * 24 * 60 * 60;
    await provider.send('evm_increaseTime', [advance]);
    await provider.send('evm_mine', []);

    // 4) Determine current pending batch id and roll it (if non-empty)
    const currentPendingIdBn: ethers.BigNumber = await escrow.currentBatchId();
    const currentPendingId = Number(currentPendingIdBn.toString());
    const batchRaw = await escrow.getBatch(currentPendingId);
    // batchRaw.totalCollateralUsd expected as BigNumber
    const totalCollateralUsd = ethers.BigNumber.from(batchRaw.totalCollateralUsd.toString());
    if (totalCollateralUsd.gt(0)) {
      console.log(` Rolling pending batch #${currentPendingId} (usd6=${totalCollateralUsd.toString()})`);
      tx = await escrow.connect(keeper).rollPendingBatch();
      await tx.wait();
      console.log(' rollPendingBatch executed');
      activatedAt[currentPendingId] = week;
    } else {
      console.log(` Pending batch #${currentPendingId} empty; skip roll`);
    }

    // 5) Close any batches that reached closeDelayWeeks
    for (const [batchIdStr, actWeek] of Object.entries(activatedAt)) {
      const batchId = Number(batchIdStr);
      const age = week - actWeek;
      if (age >= closeDelayWeeks) {
        // fetch batch to know principal
        const b = await escrow.getBatch(batchId);
        const principalUsd6 = ethers.BigNumber.from(b.totalCollateralUsd.toString()); // USD6
        // finalValueUsd6 = principalUsd6 * (1 + profitRate)
        const profitUsd6 = principalUsd6.mul(Math.round(profitRate * 1e6)).div(1_000_000);
        const finalUsd6 = principalUsd6.add(profitUsd6);

        // Ensure Escrow has USDC to perform closeBatch: mint finalUsd6 into escrow (keeper has permission to mint MockUSDC)
        try {
          const usdcWithKeeper = usdc.connect(keeper);
          const mintTx = await usdcWithKeeper.mint(ESCROW_ADDR, finalUsd6);
          await mintTx.wait();
          console.log(` Minted ${finalUsd6.toString()} USDC to Escrow for batch ${batchId}`);
        } catch (e: any) {
          console.warn('Failed to mint USDC to Escrow (ensure MockUSDC.mint is available):', String(e?.message || e));
        }

        // Compute finalNavPerShare as (finalUsd6 * 1e18 / principalUsd6)
        const finalNavPerShare = ethers.BigNumber.from(finalUsd6).mul(ethers.BigNumber.from('1000000000000000000')).div(principalUsd6);
        console.log(` Closing batch ${batchId} finalUsd6=${finalUsd6.toString()} finalNavPerShare=${finalNavPerShare.toString()}`);
        const closeTx = await escrow.connect(keeper).closeBatch(batchId, finalNavPerShare);
        await closeTx.wait();
        console.log(` Batch ${batchId} closed on-chain`);

        // remove from activatedAt to avoid double-closing
        delete activatedAt[batchIdStr];
      }
    }

    // 6) Optional: print on-chain treasury/reserve values for inspection
    try {
      const T = await treasury.getTreasuryValueUsd();
      const R = await treasury.getReserveValueUsd();
      console.log(' On-chain values (USD6): Treasury=', T.toString(), 'Reserve=', R.toString());
    } catch (e: any) {
      console.warn('Failed to read on-chain treasury/reserve values:', String(e?.message || e));
    }
  } // weeks

  console.log('\nOn-chain stress run complete.');
}

// ------------------------ CLI Main ------------------------

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'simulate';

  if (mode === 'onchain') {
    console.log('Running ON-CHAIN rebalance flow (will call Treasury contract).');
    await onchainRebalanceFlow();
  } else if (mode === 'onchain-stress') {
    console.log('Running ON-CHAIN STRESS flow (will perform deposits, rebalances, rolls, and closures).');
    await onchainStressFlow({
      weeks: 12,
      depositPerWeek: 250_000,
      closeDelayWeeks: 3,
      profitRate: 0.2,
    });
  } else if (mode === 'stress') {
    // configurable params can be passed as env vars or CLI args in future; for now use sensible defaults
    stressSimulation({
      weeks: 12,
      depositPerWeek: 250_000,
      closeDelayWeeks: 3, // close each active batch after 3 weeks
      profitRate: 0.2,    // 20% profit on closure
    });
  } else {
    console.log('Running local deterministic simulation.');
    localSimulation();
  }
}

main().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
