import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RPC, TEST_PRIVATE_KEY as KEY, AMM_LIQ_MULTIPLIER as MULT } from './config';

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAddresses() {
  try {
    const jsPath = path.resolve(__dirname, '../frontend/src/lib/addresses.ts');
    if (fs.existsSync(jsPath)) {
      const text = fs.readFileSync(jsPath, 'utf8');
      let m = text.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*(\{[\s\S]*\});?/m);
      if (!m) m = text.match(/module\.exports\s*=\s*(\{[\s\S]*\});?/m);
      if (m && m[1]) {
        // eslint-disable-next-line no-eval
        return eval('(' + m[1] + ')');
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function main() {
  const ADDR_FILE = loadAddresses();
  if (!ADDR_FILE) throw new Error('frontend/src/lib/addresses.ts not found or unreadable');

  const AMM = ADDR_FILE.AmmSAGUSDC;
  const SAG = ADDR_FILE.SAGToken ?? ADDR_FILE.Sag ?? ADDR_FILE.SAG;
  const USDC = ADDR_FILE.MockUSDC ?? ADDR_FILE.USDC;
  const SAG_ORACLE = ADDR_FILE.SagOracle;

  if (!AMM || !SAG || !USDC) throw new Error('AmmSAGUSDC, SAGToken or MockUSDC missing in addresses.ts');

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(KEY, provider);
  const signerAddr = await wallet.getAddress();
  console.log('Using signer:', signerAddr);

  // Nonce manager for automined local nodes: explicit nonces + retry on nonce errors
  let nextNonce = await provider.getTransactionCount(signerAddr, 'latest');
  async function sendTx(fn: (overrides?: any) => Promise<any>) {
    try {
      const overrides = { nonce: nextNonce };
      nextNonce++;
      const tx = await fn(overrides);
      await tx.wait();
      return tx;
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('nonce') || (err?.code && String(err.code).toLowerCase().includes('nonce'))) {
        // refresh and retry once
        nextNonce = await provider.getTransactionCount(signerAddr, 'latest');
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

  // Generic small ABIs we will probe/use
  const abiToken = ['function balanceOf(address) view returns (uint256)', 'function mint(address,uint256)', 'function transfer(address,uint256)'];
  const abiPairCommon = [
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function getReserves() view returns (uint256,uint256,uint32)'
  ];
  const abiMint = ['function mint(address) returns (uint256)'];
  const abiSync = ['function sync()'];
  const abiDeposit = ['function deposit()'];
  const abiSwap = ['function swapExactTokensForTokens(uint256,address,address,address) returns (uint256)'];

  const pairTryABIs = [
    { name: 'uniswapV2Like', abi: [...abiPairCommon, ...abiMint] },
    { name: 'syncPair', abi: [...abiPairCommon, ...abiSync] },
    { name: 'depositPair', abi: [...abiPairCommon, ...abiDeposit] },
    { name: 'swapPair', abi: [...abiPairCommon, ...abiSwap] },
  ];

  const pair = new Contract(AMM, pairTryABIs[0].abi, wallet);
  const sagToken = new Contract(SAG, abiToken, wallet);
  const usdcToken = new Contract(USDC, abiToken, wallet);

  // decide desired liquidity amounts (MULT comes from config.ts)
  const desiredUsdc = parseUnits((100000 * MULT).toString(), 6); // add 100k USDC (adjust via scripts/config.ts)
  // compute sag amount using oracle if available
  let sagAmount = parseUnits((100000 * MULT).toString(), 18);

  try {
    if (SAG_ORACLE) {
      const oracle = new Contract(SAG_ORACLE, ['function getPrice() view returns (uint256)'], provider);
      const price8 = await oracle.getPrice();
      if (price8 && BigInt(price8.toString()) > 0n) {
        const neededUsd6 = BigInt(desiredUsdc.toString()); // USDC 6 decimals
        // Correct conversion: token wei = neededUsd6 * 1e20 / price8 (see debug script)
        const sagAmtBn = (neededUsd6 * 10n ** 20n + BigInt(price8.toString()) - 1n) / BigInt(price8.toString());
        sagAmount = sagAmtBn as any;
        console.log('Computed sagAmount from oracle:', formatUnits(sagAmount, 18));
      } else {
        console.warn('Sag oracle returned zero price; using fallback token sizes');
      }
    }
  } catch (e) {
    console.warn('Oracle probe failed, using fallback sizes:', e);
  }

  // ensure signer has tokens (mint if available)
  async function mintIfAvailable(token: Contract, to: string, amount: any, tokenName: string) {
    try {
      if (typeof token['mint'] === 'function') {
        console.log(`Minting ${formatUnits(amount, tokenName === 'USDC' ? 6 : 18)} ${tokenName} to signer`);
        const tx = await token.mint(to, amount);
        await tx.wait();
      } else {
        console.warn(`${tokenName} has no mint(); ensure signer has tokens`);
      }
    } catch (e) {
      console.warn(`Mint ${tokenName} failed:`, String((e as any).message || e));
    }
  }

  const sagBal = await sagToken.balanceOf(signerAddr);
  const usdcBal = await usdcToken.balanceOf(signerAddr);
  if (BigInt(sagBal.toString()) < BigInt(sagAmount.toString())) {
    await sendTx((ov) => (sagToken as any).mint(signerAddr, sagAmount, ov).catch(() => mintIfAvailable(sagToken, signerAddr, sagAmount, 'SAG')));
  }
  if (BigInt(usdcBal.toString()) < BigInt(desiredUsdc.toString())) {
    await sendTx((ov) => (usdcToken as any).mint(signerAddr, desiredUsdc, ov).catch(() => mintIfAvailable(usdcToken, signerAddr, desiredUsdc, 'USDC')));
  }

  // Transfer tokens into pair
  console.log('Transferring tokens into AMM contract...');
  await sendTx((ov) => (sagToken as any).transfer(AMM, sagAmount, ov));
  await sendTx((ov) => (usdcToken as any).transfer(AMM, desiredUsdc, ov));
  console.log('Transferred tokens to AMM contract address.');

  // Probe which method to call on pair
  let usedPath = 'none';
  try {
    // Try uniswapV2-style mint()
    try {
      const pairMint = new Contract(AMM, abiMint, wallet);
      if (typeof (pairMint as any).mint === 'function') {
        await sendTx((ov) => (pairMint as any).mint(signerAddr, ov));
        usedPath = 'mint() on pair (UniswapV2-like)';
        console.log('Called pair.mint -> liquidity added via mint()');
      }
    } catch (e) {
      // ignore
    }

    if (usedPath === 'none') {
      // try sync()
      try {
        const pairSync = new Contract(AMM, abiSync, wallet);
        if (typeof (pairSync as any).sync === 'function') {
          await sendTx((ov) => (pairSync as any).sync(ov));
          usedPath = 'sync() on pair';
          console.log('Called pair.sync -> liquidity balances updated');
        }
      } catch (e) { /* ignore */ }
    }

    if (usedPath === 'none') {
      // try deposit()
      try {
        const pairDeposit = new Contract(AMM, abiDeposit, wallet);
        if (typeof (pairDeposit as any).deposit === 'function') {
          await sendTx((ov) => (pairDeposit as any).deposit(ov));
          usedPath = 'deposit() on pair';
          console.log('Called pair.deposit -> liquidity added via deposit()');
        }
      } catch (e) { /* ignore */ }
    }

    if (usedPath === 'none') {
      // try swapExactTokensForTokens(amountIn, tokenIn, tokenOut, to)
      try {
        const pairSwap = new Contract(AMM, abiSwap, wallet);
        if (typeof (pairSwap as any).swapExactTokensForTokens === 'function') {
          // swap a small portion to bootstrap (not full liquidity add)
          const swapAmount = sagAmount / BigInt(10); // swap 10%
          // approve if needed
          try { await sendTx((ov) => (new Contract(SAG, ['function approve(address,uint256)'], wallet)).approve(AMM, swapAmount, ov)); } catch {}
          await sendTx((ov) => (pairSwap as any).swapExactTokensForTokens(swapAmount, SAG, USDC, signerAddr, ov));
          usedPath = 'swapExactTokensForTokens on pair (partial swap)';
          console.log('Called pair.swapExactTokensForTokens -> performed partial swap to create liquidity-like state');
        }
      } catch (e) { /* ignore */ }
    }

    if (usedPath === 'none') {
      console.warn('Could not find a known liquidity entry method on AMM pair. Pair may be router-based or custom. You may need to use a router.addLiquidity() flow or adapt to the AMM ABI.');
    } else {
      console.log('Liquidity addition path used:', usedPath);
    }

    // NEW: additional diagnostics - raw ERC20 balances at AMM & Treasury snapshot
    try {
      const sagTokenProbe = new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider);
      const usdcTokenProbe = new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
      const ammSag = await sagTokenProbe.balanceOf(AMM).catch(()=>null);
      const ammUsdc = await usdcTokenProbe.balanceOf(AMM).catch(()=>null);
      console.log('AMM balances after add -> SAG:', ammSag ? formatUnits(ammSag,18) : 'N/A', 'USDC:', ammUsdc ? formatUnits(ammUsdc,6) : 'N/A');
      // quick expectedOut check for a $10,000 collateralize to help decide further action
      const probeNeededUsd6 = 10_000n * 10n ** 6n; // 10,000 in USD6 units (correct scaling)
      try {
        const sagOracle = new Contract(SAG_ORACLE, ['function getPrice() view returns (uint256)'], provider);
        const price8 = await sagOracle.getPrice();
        const sagNeededFor10k = (probeNeededUsd6 * 10n ** 20n + BigInt(price8.toString()) - 1n) / BigInt(price8.toString());
        console.log('For $10,000 collateralize, oracle sagNeeded:', String(sagNeededFor10k), '≈', (Number(formatUnits(sagNeededFor10k,18))).toString());
        if (ammSag && ammUsdc) {
          const reserveSag = BigInt(ammSag.toString());
          const reserveUsdc = BigInt(ammUsdc.toString());
          const amountIn = sagNeededFor10k;
          const amountInWithFee = amountIn * 997n;
          const numerator = amountInWithFee * reserveUsdc;
          const denominator = reserveSag * 1000n + amountInWithFee;
          const expectedUsdcOut = numerator / denominator;
          console.log('AMM expected USDC out for that sagNeeded:', formatUnits(expectedUsdcOut,6), 'needed:', formatUnits(probeNeededUsd6,6));
        }
      } catch (probeErr) { /* ignore */ }

      // Treasury snapshot
      const treasuryAddr = ADDR_FILE?.Treasury ?? null;
      if (treasuryAddr) {
        const tSag = await sagTokenProbe.balanceOf(treasuryAddr).catch(()=>null);
        const tUsdc = await usdcTokenProbe.balanceOf(treasuryAddr).catch(()=>null);
        console.log('Treasury balances -> SAG:', tSag ? formatUnits(tSag,18) : 'N/A', 'USDC:', tUsdc ? formatUnits(tUsdc,6) : 'N/A');
      }
    } catch (diagErr) {
      console.warn('Post-add diagnostics failed:', String((diagErr as any).message || diagErr));
    }

    // final reserves/logging attempt (best-effort)
    try {
      const probePair = new Contract(AMM, ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)', 'function token1() view returns (address)'], provider);
      const [t0, t1Addr] = await Promise.all([probePair.token0().catch(()=>null), probePair.token1().catch(()=>null)]);
      const reserves = await probePair.getReserves().catch(()=>null);
      console.log('Post-add probe tokens:', t0, t1Addr);
      console.log('Post-add reserves:', reserves ? [reserves[0].toString(), reserves[1].toString()] : 'unavailable');
    } catch (e) {
      console.warn('Post-add reserve probe failed (pair does not support getReserves/token0/token1 ABI)', e);
    }
  } catch (e) {
    console.error('Liquidity add attempt failed:', e);
  }

  console.log('Done. If liquidity was not added, inspect AMM implementation and adapt script to use router.addLiquidity or the AMM factory.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
