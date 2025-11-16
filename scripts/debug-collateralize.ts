import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } from 'ethers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RPC, TEST_PRIVATE_KEY as KEY, DEFAULT_DEPOSIT_AMOUNT, MINT_TEST_FUNDS, MINT_AMOUNT_USD } from './config.ts';

// ESM __dirname support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helpers to resolve addresses: env first, then frontend addresses file if present
function loadFrontendAddresses() {
  try {
    // prefer addresses.js (compiled frontend artifact)
    const jsPath = path.resolve(__dirname, '../frontend/src/lib/addresses.ts');
    if (fs.existsSync(jsPath)) {
      const text = fs.readFileSync(jsPath, 'utf8');
      // support "export const CONTRACT_ADDRESSES = { ... }" or "module.exports = { ... }"
      let m = text.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*(\{[\s\S]*\});?/m);
      if (!m) m = text.match(/module\.exports\s*=\s*(\{[\s\S]*\});?/m);
      if (m && m[1]) {
        try {
          // eslint-disable-next-line no-eval
          return eval('(' + m[1] + ')');
        } catch (e) {
          // fall through to try ts file
        }
      }
    }
  } catch (e) {
    // ignore and return null
  }
  return null;
}

const ADDR_FILE = loadFrontendAddresses();

// Resolve address utility - DO NOT use process.env for addresses; only consult ADDR_FILE
function addr(name: string) {
  if (!ADDR_FILE) return null;
  // support both shapes:
  // 1) file exports the object directly: { Vault: "0x...", ... }
  // 2) file exports { CONTRACT_ADDRESSES: { Vault: "0x...", ... } }
  if ((ADDR_FILE as any)[name]) return (ADDR_FILE as any)[name];
  if ((ADDR_FILE as any).CONTRACT_ADDRESSES && (ADDR_FILE as any).CONTRACT_ADDRESSES[name]) {
    return (ADDR_FILE as any).CONTRACT_ADDRESSES[name];
  }
  // Not found in addresses file
  return null;
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(KEY, provider);
  console.log('Using account:', await wallet.getAddress());

  // Nonce manager: fetch latest nonce and use explicit nonces for txs to avoid "nonce too low" in automine setups
  let nextNonce = await provider.getTransactionCount(await wallet.getAddress(), 'latest');
  async function sendTx(fn: (overrides?: any) => Promise<any>) {
    // attempt once with current nonce, if we hit a nonce error refresh and retry once
    try {
      const overrides = { nonce: nextNonce };
      nextNonce++;
      const tx = await fn(overrides);
      await tx.wait();
      return tx;
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('nonce') || (err?.code && String(err.code).toLowerCase().includes('nonce'))) {
        // refresh and retry one time
        nextNonce = await provider.getTransactionCount(await wallet.getAddress(), 'latest');
        try {
          const overrides = { nonce: nextNonce };
          nextNonce++;
          const tx = await fn(overrides);
          await tx.wait();
          return tx;
        } catch (err2) {
          throw err2;
        }
      }
      throw err;
    }
  }

  // resolve addresses (ONLY from addresses file)
  const VAULT = addr('Vault') ?? addr('VAULT');
  const TREASURY = addr('Treasury') ?? addr('TREASURY');
  const MOCK_DOT = addr('MockDOT') ?? addr('Mock_DOT') ?? addr('mDOT') ?? addr('MDOT');
  const SAG = addr('SAGToken') ?? addr('SAG');
  const USDC = addr('MockUSDC') ?? addr('USDC') ?? addr('UsdcToken');
  const ESCROW = addr('InvestmentEscrow') ?? addr('Escrow') ?? addr('INVESTMENT_ESCROW');

  console.log('Resolved addresses:', { VAULT, TREASURY, MOCK_DOT, SAG, USDC, ESCROW });

  // Guard: fail fast with actionable message (addresses must be present in frontend/src/lib/addresses.ts/js)
  if (!VAULT || !TREASURY || !MOCK_DOT) {
    console.error('\nMissing addresses in frontend/src/lib/addresses.(ts|js). The debug script only reads that file.');
    console.error('Please ensure the file exports CONTRACT_ADDRESSES or the keys directly, e.g.:');
    console.error('  // frontend/src/lib/addresses.ts');
    console.error('  export const CONTRACT_ADDRESSES = {');
    console.error('    Vault: "0x...",');
    console.error('    Treasury: "0x...",');
    console.error('    MockDOT: "0x...",');
    console.error('    Sag: "0x...",');
    console.error('    Usdc: "0x...",');
    console.error('    InvestmentEscrow: "0x...",');
    console.error('  } as const;');
    process.exit(1);
  }

  // load ABIs
  const VaultAbi = loadAbi('Vault');
  const TreasuryAbi = loadAbi('Treasury');
  const MockDotAbi = loadAbi('MockDOT'); // ensure file present
  const MockOracleAbi = loadAbi('MockOracle');

  const vault = new Contract(VAULT, VaultAbi, wallet);
  const treasury = new Contract(TREASURY, TreasuryAbi, wallet);
  const mDot = new Contract(MOCK_DOT, MockDotAbi, wallet);

  // subscribe to Treasury events (if ABI includes them)
  function safeOn(c: Contract, eventName: string, handler: (...args: any[]) => void) {
    try {
      if (c.interface.getEvent(eventName)) {
        c.on(eventName, handler);
        console.log(`Subscribed to Treasury.${eventName}`);
      }
    } catch (e) {
      console.log(`Treasury ABI missing event ${eventName}, skipping subscribe`);
    }
  }

  safeOn(treasury, 'CollateralizeAttempt', (...args) => console.log('[EVENT] CollateralizeAttempt', ...args));
  // CollateralizeInsufficientSAG event removed from Treasury; rely on CollateralizeAttempt / SwapResult / CollateralizeSucceeded
  safeOn(treasury, 'CollateralizeSucceeded', (...args) => console.log('[EVENT] CollateralizeSucceeded', ...args));
  safeOn(treasury, 'Collateralized', (...args) => console.log('[EVENT] Collateralized', ...args));
  safeOn(treasury, 'BatchFunded', (...args) => console.log('[EVENT] BatchFunded', ...args));
  safeOn(treasury, 'BatchResult', (...args) => console.log('[EVENT] BatchResult', ...args));

  // helper to print balances/state
  async function printState(prefix = '') {
    try {
      const usdcBal = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY) : 'N/A';
      const sagBal = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY) : 'N/A';
      const totalCollateral = await treasury.totalCollateralUsd().catch(() => 'N/A');
      console.log(`${prefix}Treasury USDC balance: ${USDC ? formatUnits(usdcBal, 6) : usdcBal}`);
      console.log(`${prefix}Treasury SAG balance: ${SAG ? formatUnits(sagBal, 18) : sagBal}`);
      console.log(`${prefix}Treasury.totalCollateralUsd: ${typeof totalCollateral === 'bigint' ? Number(formatUnits(totalCollateral,6)) : totalCollateral}`);
    } catch (e) {
      console.warn('printState error', e);
    }
  }

  console.log('Initial on-chain state:');
  await printState('  ');

  // --- TEST: optionally mint large test liquidity to Treasury / AMM / Reserve ---
  // Enable by toggling MINT_TEST_FUNDS in scripts/config.ts (no process.env)
  if (MINT_TEST_FUNDS) {
    try {
      const MUSD = BigInt(Number(MINT_AMOUNT_USD)); // e.g. 10_000_000
      const amountUsd6 = MUSD * 10n ** 6n;
      console.log(`TEST FUNDING: minting ~$${MUSD.toString()} (USD6=${amountUsd6.toString()}) to Treasury/AMM/reserve (best-effort)`);

      // helper contracts
      const usdcContract = USDC ? new Contract(USDC, ['function mint(address,uint256) public', 'function balanceOf(address) view returns (uint256)'], wallet) : null;
      const sagContract = SAG ? new Contract(SAG, ['function mint(address,uint256) public', 'function balanceOf(address) view returns (uint256)'], wallet) : null;
      const goldAddr = ADDR_FILE?.MockGOLD ?? addr('MockGOLD');
      const goldContract = goldAddr ? new Contract(goldAddr, ['function mint(address,uint256) public', 'function balanceOf(address) view returns (uint256)'], wallet) : null;

      // split amounts (half to Treasury, half to AMM)
      const usdcToTreasury = amountUsd6 / 2n;
      const usdcToAmm = amountUsd6 - usdcToTreasury;

      // mint USDC
      if (usdcContract && typeof usdcContract.mint === 'function') {
        try {
          console.log('Minting USDC to Treasury:', usdcToTreasury.toString());
          await sendTx((ov) => (usdcContract as any).mint(TREASURY, usdcToTreasury, ov));
          if (ADDR_FILE?.AmmSAGUSDC) {
            console.log('Minting USDC to AMM:', usdcToAmm.toString());
            await sendTx((ov) => (usdcContract as any).mint(ADDR_FILE.AmmSAGUSDC, usdcToAmm, ov));
          }
        } catch (e) {
          console.warn('USDC mint failed or not available:', String((e as any).message || e));
        }
      } else {
        console.warn('MockUSDC mint() not available; skip minting USDC');
      }

      // compute SAG amount using oracle (1e20 conversion)
      let sagNeededTotal = 0n;
      try {
        let sagPrice8: bigint | null = null;
        try {
          const sagOracleAddr = await treasury.sagOracle().catch(()=>null);
          if (sagOracleAddr) {
            sagPrice8 = BigInt(await (new Contract(sagOracleAddr, ['function getPrice() view returns (uint256)'], provider)).getPrice());
          }
        } catch {}
        if (sagPrice8 && sagPrice8 > 0n) {
          sagNeededTotal = (amountUsd6 * 10n ** 20n + sagPrice8 - 1n) / sagPrice8; // ceil
          console.log('Computed total SAG wei to mint for USD target:', sagNeededTotal.toString());
        } else {
          // fallback: mint a large SAG quantity (e.g. MUSD * 1e18)
          sagNeededTotal = MUSD * 10n ** 18n;
          console.warn('sagOracle missing; falling back to minting SAG = MUSD * 1e18 wei:', sagNeededTotal.toString());
        }
      } catch (e) {
        console.warn('Failed to compute sagNeeded; fallback to large mint:', String((e as any).message || e));
        sagNeededTotal = MUSD * 10n ** 18n;
      }

      // split SAG to Treasury and AMM
      const sagToTreasury = sagNeededTotal / 2n;
      const sagToAmm = sagNeededTotal - sagToTreasury;

      // mint SAG
      if (sagContract && typeof sagContract.mint === 'function') {
        try {
          console.log('Minting SAG to Treasury:', sagToTreasury.toString());
          await sendTx((ov) => (sagContract as any).mint(TREASURY, sagToTreasury, ov));
          if (ADDR_FILE?.AmmSAGUSDC) {
            console.log('Minting SAG to AMM:', sagToAmm.toString());
            await sendTx((ov) => (sagContract as any).mint(ADDR_FILE.AmmSAGUSDC, sagToAmm, ov));
          }
        } catch (e) {
          console.warn('SAG mint failed or not available:', String((e as any).message || e));
        }
      } else {
        console.warn('SAG mint() not available; skip minting SAG');
      }

      // mint GOLD to reserve controller if available
      const reserveCtrl = ADDR_FILE?.ReserveController ?? addr('ReserveController');
      if (goldContract && typeof goldContract.mint === 'function' && reserveCtrl) {
        try {
          // compute gold amount similar to sag: use gold oracle if available, else mint USD-equivalent token amount (18d)
          let goldAmt = MUSD * 10n ** 18n; // fallback
          try {
            const goldOracleAddr = ADDR_FILE?.GoldOracle ?? addr('GoldOracle');
            if (goldOracleAddr) {
              const price8 = BigInt(await (new Contract(goldOracleAddr, ['function getPrice() view returns (uint256)'], provider)).getPrice());
              if (price8 > 0n) {
                goldAmt = (amountUsd6 * 10n ** 20n + price8 - 1n) / price8;
              }
            }
          } catch {}
          console.log('Minting GOLD to ReserveController:', goldAmt.toString());
          await sendTx((ov) => (goldContract as any).mint(reserveCtrl, goldAmt, ov));
        } catch (e) {
          console.warn('GOLD mint failed or not available:', String((e as any).message || e));
        }
      } else {
        console.warn('MockGOLD mint() not available or ReserveController missing; skip GOLD mint');
      }

      // post-mint snapshot
      try {
        await printState('  after mint: ');
        if (ADDR_FILE?.AmmSAGUSDC) {
          const sagAtAmm = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(ADDR_FILE.AmmSAGUSDC) : null;
          const usdcAtAmm = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(ADDR_FILE.AmmSAGUSDC) : null;
          console.log('AMM balances after mint -> SAG:', sagAtAmm ? formatUnits(sagAtAmm,18) : 'N/A', 'USDC:', usdcAtAmm ? formatUnits(usdcAtAmm,6) : 'N/A');
        }
      } catch {}
    } catch (e) {
      console.warn('Test funding step failed (non-fatal):', String((e as any).message || e));
    }
  }

  // ensure user has mDOT: mint if contract supports mint
  const depositor = await wallet.getAddress();
  const decimals = Number((await mDot.decimals?.().catch(() => 6)) ?? 6);
  const depositTokens = DEFAULT_DEPOSIT_AMOUNT;
  console.log(`Preparing to deposit ${depositTokens} tokens (decimals ${decimals}) from ${depositor}`);

  // mint if available
  if (typeof mDot['mint'] === 'function') {
    try {
      const tx = await sendTx((ov) => mDot.mint(depositor, parseUnits(depositTokens, decimals), ov));
      console.log('Mint tx sent:', tx.hash);
      console.log('Minted mDOT to depositor');
    } catch (e) {
      console.warn('Mint failed or not available:', (e as any).message ?? e);
    }
  } else {
    console.log('mint() not available on mDOT contract, assuming test account already funded');
  }

  // approve vault
  try {
    const approveTx = await sendTx((ov) => mDot.approve(VAULT, parseUnits(depositTokens, decimals), ov));
    console.log('Approved Vault to spend mDOT', approveTx.hash);
  } catch (e) {
    console.error('Approve failed:', e);
    return;
  }

  // perform deposit
  try {
    console.log('Calling Vault.deposit(...)');
    const tx = await sendTx((ov) => vault.deposit(MOCK_DOT, parseUnits(depositTokens, decimals), ov));
    console.log('Deposit tx mined:', tx.hash);
    const receipt = await tx.wait();
    console.log('Deposit mined:', receipt.transactionHash);

    // --- NEW: post-deposit wiring + collateralize attempt ---
    try {
      // helper formatters
      const fmtUsd6 = (bn: any) => {
        try { return `$${Number(formatUnits(bn, 6)).toLocaleString(undefined, {maximumFractionDigits:6})}`; } catch { return String(bn); }
      };
      const fmtToken = (bn: any, d = 18) => {
        try { return `${Number(formatUnits(bn, d)).toLocaleString(undefined, {maximumFractionDigits:6})}`; } catch { return String(bn); }
      };

      let rcBefore = BigInt(0);
      try { rcBefore = await vault.receiptCount(depositor).catch(() => BigInt(0)); } catch {}
      // new receipt index should be prevCount (old count) if deposit appended, but try both robustly
      let newIdx = Number(rcBefore === 0n ? rcBefore : rcBefore - 1n);
      try { const cnt = await vault.receiptCount(depositor); newIdx = Number(cnt) - 1; } catch {}

      let depositReceipt: any = null;
      try { depositReceipt = await vault.getReceipt(newIdx).catch(() => null); } catch {}
      if (!depositReceipt) {
        try { depositReceipt = await vault.receipts(depositor, newIdx).catch(() => null); } catch {}
      }

      console.log('--- Receipt probe ---');
      if (depositReceipt) {
        // try to print canonical fields from both getReceipt and receipts shapes
        const principal = depositReceipt.principal ?? depositReceipt.amount ?? depositReceipt.amountUsd6 ? depositReceipt.amount ?? depositReceipt.principal : null;
        const amountUsd6 = depositReceipt.entryValueUsd ?? depositReceipt.amountUsd6 ?? null;
        const shares = depositReceipt.shares ?? null;
        console.log('receipt index:', newIdx);
        if (principal !== null) console.log('  principal:', fmtToken(principal, depositReceipt.principal ? 6 : 18));
        if (amountUsd6 !== null) console.log('  amountUsd6:', fmtUsd6(amountUsd6));
        if (shares !== null) console.log('  shares:', String(shares));
      } else {
        console.warn('Could not read deposit receipt at index', newIdx);
      }

      // 2) Wire Vault <-> Treasury and AMM if needed (best-effort)
      try {
        // Read vault.treasury() and warn if unset.
        try {
          const currentTreasury = await vault.treasury().catch(() => null);
          if (!currentTreasury || currentTreasury === '0x0000000000000000000000000000000000000000') {
            console.warn('Vault.treasury() is not set — Vault will not call Treasury.collateralize automatically. Set treasury in Vault at deploy/owner time.');
          } else {
            console.log('vault.treasury:', currentTreasury);
          }
        } catch (e) {
          console.warn('Could not read vault.treasury(); proceeding without setting it:', String((e as any).message || e));
        }

        // set ammPair on Treasury
        try {
          const tx = await treasury.setAmmPair(ADDR_FILE?.AmmSAGUSDC);
          await tx.wait();
          console.log('treasury.setAmmPair ->', ADDR_FILE?.AmmSAGUSDC);
        } catch (e) {
          console.warn('treasury.setAmmPair failed (maybe already set or owner mismatch):', String((e as any).message || e));
        }
      } catch (e) {
        console.warn('Wiring Vault/Treasury/AMM step had issues:', e);
      }

      // 3) Ensure Treasury has SAG to swap (do NOT transfer signer SAG into Treasury)
      try {
        const sagAddr = ADDR_FILE?.SAGToken ?? SAG;
        if (sagAddr) {
          // ERC20 helper
          const erc = new Contract(sagAddr, ['function balanceOf(address) view returns (uint256)'], provider);

          // Read Treasury's SAG balance (Treasury should use its own SAG for swaps)
          const treasurySagBalRaw = await erc.balanceOf(TREASURY).catch(() => null);
          const treasurySagBal = treasurySagBalRaw ? BigInt(treasurySagBalRaw.toString()) : 0n;
          console.log('Treasury SAG balance (pre-swap):', treasurySagBal ? fmtToken(treasurySagBal, 18) : '0');

          // Compute oracle-based sagNeeded for this deposit if we know amountUsd6Bn
          let sagNeeded: bigint | null = null;
          try {
            if (typeof amountUsd6Bn !== 'undefined' && amountUsd6Bn && amountUsd6Bn > 0n) {
              const sagOracleAddr = await treasury.sagOracle().catch(() => null);
              if (sagOracleAddr) {
                const price8 = await (new Contract(sagOracleAddr, ['function getPrice() view returns (uint256)'], provider)).getPrice();
                if (price8 && BigInt(price8.toString()) > 0n) {
                  // ceil(neededUsd6 * 1e18 / price8)
                  sagNeeded = (BigInt(amountUsd6Bn.toString()) * 10n ** 18n + BigInt(price8.toString()) - 1n) / BigInt(price8.toString());
                  console.log('Oracle-based SAG needed to cover deposit:', fmtToken(sagNeeded, 18));
                } else {
                  console.warn('sagOracle returned zero price; cannot compute sagNeeded.');
                }
              } else {
                console.warn('Treasury.sagOracle() not set; cannot compute sagNeeded.');
              }
            } else {
              console.log('amountUsd6Bn not yet determined; will compute sagNeeded later before attempting adminCollateralize.');
            }
          } catch (probeErr) {
            console.warn('Failed to compute sagNeeded from oracle:', String((probeErr as any).message || probeErr));
            sagNeeded = null;
          }

          // Decision: do NOT attempt to move signer SAG to Treasury.
          // Instead, assert Treasury has required SAG and log instructions if it doesn't.
          if (sagNeeded !== null) {
            if (treasurySagBal >= sagNeeded) {
              console.log('Treasury has sufficient SAG to perform swap.');
            } else {
              console.warn('Treasury lacks sufficient SAG to perform the swap:', {
                treasurySag: fmtToken(treasurySagBal, 18),
                sagNeeded: fmtToken(sagNeeded, 18),
              });
              console.warn('Actionable: fund Treasury with SAG or ensure ammPair/reserves can supply the swap. Skipping signer->Treasury transfer (by design).');
            }
          } else {
            console.log('No sagNeeded computed; will rely on Treasury existing balances when attempting adminCollateralize.');
          }
        } else {
          console.warn('SAG address unknown; skipping SAG availability checks.');
        }
      } catch (e) {
        console.warn('SAG funding/availability check failed:', e);
      }

      // 4) Attempt collateralizeForReceipt using canonical on-chain receipt.amountUsd6
      try {
        let amountUsd6Bn: bigint | null = null;
        if (depositReceipt && depositReceipt.entryValueUsd !== undefined) {
          // getReceipt returns entryValueUsd as uint (USD6)
          amountUsd6Bn = BigInt(depositReceipt.entryValueUsd ?? depositReceipt.amountUsd6 ?? 0);
        } else if (depositReceipt && depositReceipt.amountUsd6 !== undefined) {
          amountUsd6Bn = BigInt(depositReceipt.amountUsd6);
        } else {
          // fallback: probe vault.receipts(depositor, newIdx)
          try {
            const r2 = await vault.receipts(depositor, newIdx);
            if (r2 && r2.amountUsd6) amountUsd6Bn = BigInt(r2.amountUsd6.toString());
          } catch {}
        }

        if (amountUsd6Bn && amountUsd6Bn > 0n) {
          // snapshot Treasury state before collateralize
          const preUsdc = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(() => null) : null;
          const preSag = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(() => null) : null;
          const preTotal = await treasury.totalCollateralUsd().catch(() => null);
          const ammPairAddr = await treasury.ammPair().catch(() => null);
          let sagPrice8 = null;
          try { sagPrice8 = await treasury.sagOracle().then((a: string) => (new Contract(a, ['function getPrice() view returns (uint256)'], provider)).getPrice()); } catch { sagPrice8 = null; }
          console.log('--- Pre-collateralize snapshot ---');
          console.log('  amountUsd6 to collateralize:', fmtUsd6(amountUsd6Bn));
          console.log('  Treasury USDC:', preUsdc ? fmtUsd6(preUsdc) : 'N/A', 'SAG:', preSag ? fmtToken(preSag,18) : 'N/A');
          console.log('  totalCollateralUsd (before):', preTotal ? fmtUsd6(preTotal) : 'N/A');
          console.log('  ammPair:', ammPairAddr || 'none', 'sagPrice8:', sagPrice8 ? sagPrice8.toString() : 'unknown');

          // AMM liquidity probe: compute expected USDC out for swapping SAG -> USDC
          let ammLooksHealthy = true;
          // helper to read raw token balances at AMM and compute expectedOut (UniswapV2 style)
          async function probeAmmLiquidity(pairAddr: string | null, sagAddr: string | null, usdcAddr: string | null, sagAmountEstimate: bigint | null) {
            try {
              // raw ERC20 balances on AMM contract (works even if pair ABI is custom)
              const rawSagBal = sagAddr ? await (new Contract(sagAddr, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(pairAddr).catch(() => null) : null;
              const rawUsdcBal = usdcAddr ? await (new Contract(usdcAddr, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(pairAddr).catch(() => null) : null;
              console.log('AMM raw ERC20 balances -> SAG:', rawSagBal ? fmtToken(rawSagBal, 18) : 'N/A', 'USDC:', rawUsdcBal ? fmtUsd6(rawUsdcBal) : 'N/A');
              if (!rawSagBal || !rawUsdcBal || !sagAmountEstimate) return null;
              const reserveSag = BigInt(rawSagBal.toString());
              const reserveUsdc = BigInt(rawUsdcBal.toString());
              // UniswapV2-style expectedOut calculation (fee 0.3%)
              const amountIn = sagAmountEstimate;
              const amountInWithFee = amountIn * 997n;
              const numerator = amountInWithFee * reserveUsdc;
              const denominator = reserveSag * 1000n + amountInWithFee;
              const expectedUsdcOut = numerator / denominator;
              return { reserveSag, reserveUsdc, expectedUsdcOut };
            } catch (pe) {
              console.warn('probeAmmLiquidity failed:', String((pe as any).message || pe));
              return null;
            }
          }

          try {
            const pairAddr = ammPairAddr || (ADDR_FILE?.AmmSAGUSDC ?? AMM);
            if (!pairAddr) {
              console.warn('No ammPair configured to estimate swap output.');
              ammLooksHealthy = false;
            } else {
              const pair = new Contract(pairAddr, [
                'function token0() view returns (address)',
                'function token1() view returns (address)',
                'function getReserves() view returns (uint112,uint112,uint32)'
              ], provider);
              const [t0, t1] = await Promise.all([pair.token0().catch(()=>null), pair.token1().catch(()=>null)]);
              const reserves = await pair.getReserves().catch(()=>null);
              if (!t0 || !t1 || !reserves) {
                console.warn('AMM pair does not expose token0/token1/getReserves in expected shape; skipping AMM liquidity checks.');
              } else {
                const [r0, r1] = [BigInt(reserves[0].toString()), BigInt(reserves[1].toString())];
                // map reserves to sag/usdc
                const sagAddr = SAG;
                let reserveSag = 0n, reserveUsdc = 0n;
                if (t0.toLowerCase() === (sagAddr || '').toLowerCase()) {
                  reserveSag = r0; reserveUsdc = r1;
                } else if (t1.toLowerCase() === (sagAddr || '').toLowerCase()) {
                  reserveSag = r1; reserveUsdc = r0;
                } else {
                  console.warn('AMM pair tokens do not include SAG token; pair tokens:', t0, t1);
                }

                console.log('AMM reserves (raw):', { reserveSag: reserveSag.toString(), reserveUsdc: reserveUsdc.toString() });

                // compute sagAmount that Treasury would use (oracle-based estimate)
                if (!sagPrice8) {
                  console.warn('Cannot compute sagAmount: sagPrice8 unknown');
                } else {
                  const needed = BigInt(amountUsd6Bn.toString()); // USDC 6-decimals
                  // Correct conversion: needed (USD *1e6) -> token wei:
                  // tokens = (needed/1e6) / (price8/1e8) = needed * 1e2 / price8
                  // token wei = tokens * 1e18 => needed * 1e20 / price8
                  const sagAmountEstimate = (needed * (10n ** 20n) + BigInt(sagPrice8) - 1n) / BigInt(sagPrice8); // ceil
                  console.log('Estimated SAG required (oracle):', fmtToken(sagAmountEstimate,18));

                  // UniswapV2-style expectedOut calculation
                  if (reserveSag > 0n && reserveUsdc > 0n) {
                    const r = await probeAmmLiquidity(pairAddr, SAG, USDC, sagAmountEstimate);
                    if (r && r.expectedUsdcOut) {
                      console.log('AMM expected USDC out for sagAmountEstimate (via raw balances):', fmtUsd6(r.expectedUsdcOut));
                      if (r.expectedUsdcOut < needed) {
                        console.warn('AMM liquidity insufficient: expectedOut < needed. expected:', fmtUsd6(r.expectedUsdcOut), 'needed:', fmtUsd6(needed));
                        ammLooksHealthy = false;
                      } else {
                        console.log('AMM appears to have liquidity for this swap (expectedOut >= needed).');
                      }
                    } else {
                      console.warn('Could not compute expectedOut via probeAmmLiquidity; falling back to reserve estimate.');
                      const amountIn = sagAmountEstimate;
                      const amountInWithFee = amountIn * 997n;
                      const numerator = amountInWithFee * reserveUsdc;
                      const denominator = reserveSag * 1000n + amountInWithFee;
                      const expectedUsdcOut = numerator / denominator;
                      console.log('Fallback expectedOut:', fmtUsd6(expectedUsdcOut));
                      if (expectedUsdcOut < needed) { ammLooksHealthy = false; }
                    }
                  } else {
                    console.warn('AMM reserves zero or not mapped to SAG/USDC correctly; cannot assess liquidity.');
                    ammLooksHealthy = false;
                  }

                  // log sag allowance from Treasury owner (wallet) to pair
                  try {
                    const sagToken = new Contract(sagAddr, ['function allowance(address,address) view returns (uint256)'], provider);
                    const allowance = await sagToken.allowance(await wallet.getAddress(), pairAddr).catch(()=>null);
                    console.log('Signer SAG allowance to AMM pair:', allowance ? fmtToken(allowance,18) : 'N/A');
                  } catch {}
                }
              }
            }
          } catch (ammErr) {
            console.warn('AMM probe failed:', String((ammErr as any).message || ammErr));
            ammLooksHealthy = false;
          }

          // Only proceed with collateralizeForReceipt if AMM has sufficient expected output or Treasury already had enough USDC
          const treasuryHadEnough = (preUsdc && BigInt(preUsdc.toString()) >= BigInt(amountUsd6Bn.toString()));
          if (!treasuryHadEnough && !ammLooksHealthy) {
            console.warn('AMM liquidity insufficient and Treasury has no USDC. Attempting test fallback: fund Treasury with MockUSDC (mint) so collateralizeForReceipt can record collateral.');
            // Best-effort: if MockUSDC supports mint(address,uint256) (test token), mint required USDC to TREASURY
            try {
              if (USDC && typeof USDC === 'string') {
                const usdcContract = new Contract(USDC, ['function mint(address,uint256) public', 'function balanceOf(address) view returns (uint256)'], wallet);
                if (typeof usdcContract.mint === 'function') {
                  console.log('Minting USDC to Treasury as test fallback:', fmtUsd6(amountUsd6Bn));
                  const txMint = await sendTx((ov) => (usdcContract as any).mint(TREASURY, amountUsd6Bn, ov));
                  console.log('Minted USDC to Treasury (tx):', txMint.hash);
                  // refresh balances before calling collateralizeForReceipt
                  const postUsdcBal = await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY);
                  console.log('Treasury USDC after mint:', fmtUsd6(postUsdcBal));
                  // now call collateralizeForReceipt (owner must match; wallet should be deployer/owner in tests)
                  try {
                    // use deposit id we discovered earlier (newIdx) so collateral is recorded idempotently
                    const txAdmin = await sendTx((ov) => treasury.collateralizeForReceipt(newIdx, amountUsd6Bn, ov));
                    console.log('Treasury.collateralizeForReceipt tx mined:', txAdmin.hash);
                  } catch (admErr2) {
                    console.warn('collateralizeForReceipt failed even after mint fallback:', String((admErr2 as any).message || admErr2));
                  }
                } else {
                  console.warn('MockUSDC does not expose mint(); cannot auto-fund Treasury in this environment.');
                }
              } else {
                console.warn('USDC address unknown; cannot auto-fund Treasury.');
              }
            } catch (mintErr) {
              console.warn('Auto-fund fallback failed:', String((mintErr as any).message || mintErr));
            }
          } else {
            try {
              // call idempotent collateralizeForReceipt so books are updated only once
              const txAdmin = await sendTx((ov) => treasury.collateralizeForReceipt(newIdx, amountUsd6Bn, ov));
              const rec = await provider.getTransactionReceipt(txAdmin.hash);
              console.log('Treasury.collateralizeForReceipt tx mined:', txAdmin.hash);
              console.log('--- Decoded Treasury logs from adminCollateralize ---');
              for (const l of rec?.logs || []) {
                if ((l.address || '').toLowerCase() !== (TREASURY || '').toLowerCase()) continue;
                try {
                  const parsed = treasury.interface.parseLog(l);
                  console.log('Event:', parsed?.name, parsed?.args);
                } catch {}
              }
              // snapshot after
              const postUsdc = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(() => null) : null;
              const postSag = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(() => null) : null;
              const postTotal = await treasury.totalCollateralUsd().catch(() => null);
              console.log('--- Post-collateralize snapshot ---');
              console.log('  Treasury USDC:', postUsdc ? fmtUsd6(postUsdc) : 'N/A', 'SAG:', postSag ? fmtToken(postSag,18) : 'N/A');
              console.log('  totalCollateralUsd (after):', postTotal ? fmtUsd6(postTotal) : 'N/A');
            } catch (admErr) {
              // Enhanced revert logging: probe and print treasury/amm/oracle snapshots to help debug
              console.warn('adminCollateralize reverted or failed:', String((admErr as any).message || admErr));
              try {
                const sagBalT = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(()=>null) : null;
                const usdcBalT = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(TREASURY).catch(()=>null) : null;
                console.log('Treasury snapshot on revert -> USDC:', usdcBalT ? fmtUsd6(usdcBalT) : 'N/A', 'SAG:', sagBalT ? fmtToken(sagBalT,18) : 'N/A');
                // AMM raw balances
                const pairAddr2 = ammPairAddr || (ADDR_FILE?.AmmSAGUSDC ?? AMM);
                if (pairAddr2) {
                  const ammSagRaw = SAG ? await (new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(pairAddr2).catch(()=>null) : null;
                  const ammUsdcRaw = USDC ? await (new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(pairAddr2).catch(()=>null) : null;
                  console.log('AMM raw balances on revert -> SAG:', ammSagRaw ? fmtToken(ammSagRaw,18) : 'N/A', 'USDC:', ammUsdcRaw ? fmtUsd6(ammUsdcRaw) : 'N/A');
                }
                // oracle price
                try {
                  const sagOracleAddr = await treasury.sagOracle().catch(()=>null);
                  if (sagOracleAddr) {
                    const price = await (new Contract(sagOracleAddr, ['function getPrice() view returns (uint256)'], provider)).getPrice();
                    console.log('sagOracle price8:', price?.toString?.());
                  }
                } catch {}
              } catch (probeErr) {
                console.warn('Additional revert probes failed:', String((probeErr as any).message || probeErr));
              }
            }
          }
        } else {
          console.warn('Could not determine amountUsd6 from receipt; skipping collateralizeForReceipt');
        }
      } catch (e) {
        console.warn('Collateralize attempt failed:', e);
      }
    } catch (postErr) {
      console.warn('Post-deposit orchestration failed:', postErr);
    }
  } catch (e: any) {
    console.error('Deposit reverted or failed:', e?.message ?? e);
  }

  // wait a few seconds to collect events
  console.log('Waiting for events (5s)...');
  await new Promise((res) => setTimeout(res, 5000));

  console.log('Post-deposit state:');
  await printState('  ');

  // show recent logs (if node exposes eth_getLogs) — attempt to fetch Collateralize events from block window
  try {
    const latest = await provider.getBlockNumber();
    const from = Math.max(0, latest - 50);
    const filter = {
      address: TREASURY,
      fromBlock: from,
      toBlock: latest,
    };
    const logs = await provider.getLogs(filter);
    console.log(`Recent logs on Treasury (blocks ${from}-${latest}): ${logs.length}`);
    for (const l of logs) {
      console.log('  log', l.topics.map(t => t).join(', '), l.data.substring(0, 140));
    }
  } catch (e) {
    console.warn('Failed to query logs:', e);
  }

  console.log('Debug script finished. If CollateralizeAttempt/Collateralized events did not appear, check:');
  console.log('- Treasury has ammPair configured and/or SAG/USDC balances');
  console.log('- Treasury ABI loaded in frontend matches deployed contract (events present)');
  process.exit(0);
}

main().catch((err) => {
  console.error('Script error', err);
  process.exit(1);
});
function loadAbi(contractName: string): any {
  // Try to load ABI from common locations
  const abiPaths = [
    path.resolve(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`),
    path.resolve(__dirname, `../artifacts/${contractName}.json`),
    path.resolve(__dirname, `../frontend/src/lib/abi/${contractName}.json`),
  ];
  for (const abiPath of abiPaths) {
    if (fs.existsSync(abiPath)) {
      const json = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      // Support both full artifact and ABI-only files
      if (json.abi) return json.abi;
      if (Array.isArray(json)) return json;
    }
  }
  throw new Error(`ABI for contract "${contractName}" not found in expected locations.`);
}

