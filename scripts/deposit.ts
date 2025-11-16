// ...existing code...

// NEW: helper to ensure AMM pair has sufficient SAG + USDC liquidity for collateralize
async function seedAmmLiquidity({
  pair,
  usdc,
  sag,
  sagOracle,
  deployer,
  usdAmount // integer USD amount (no decimals), e.g. 1000 => $1,000
}: {
  pair: any;
  usdc: any;
  sag: any;
  sagOracle: any;
  deployer: any;
  usdAmount: bigint;
}) {
  if (!pair) {
    console.log('seedAmmLiquidity: no pair provided, skipping');
    return;
  }
  const pairAddr = pair.target ?? pair.address;
  console.log(`Seeding AMM ${pairAddr} for USD ${usdAmount.toString()}`);

  // compute USDC base (6 decimals)
  const usdcNeeded = usdAmount * 10n ** 6n;

  // compute SAG wei needed using oracle (price8 = price * 1e8)
  const sagPrice8Raw = await sagOracle.getPrice();
  const sagPrice8 = BigInt(sagPrice8Raw.toString());
  if (sagPrice8 === 0n) throw new Error('sag oracle price is zero');

  // tokenWei = ceil(usd6 * 1e20 / price8)
  const sagWeiNeeded = (usdcNeeded * 10n ** 20n + sagPrice8 - 1n) / sagPrice8;

  console.log(' -> mint/transfer USDC to pair:', usdcNeeded.toString());
  // mint if possible, otherwise transfer from deployer
  if (typeof usdc.mint === 'function') {
    try { await (await usdc.mint(pairAddr, usdcNeeded)).wait(); console.log('   minted USDC to AMM'); } catch (e) { console.warn('   usdc.mint failed:', e); }
  } else {
    try { await (await usdc.transfer(pairAddr, usdcNeeded)).wait(); console.log('   transferred USDC to AMM'); } catch (e) { console.warn('   usdc.transfer failed:', e); }
  }

  console.log(' -> mint/transfer SAG to pair:', sagWeiNeeded.toString());
  if (typeof sag.mint === 'function') {
    try { await (await sag.mint(pairAddr, sagWeiNeeded)).wait(); console.log('   minted SAG to AMM'); } catch (e) { console.warn('   sag.mint failed:', e); }
  } else {
    try { await (await sag.transfer(pairAddr, sagWeiNeeded)).wait(); console.log('   transferred SAG to AMM'); } catch (e) { console.warn('   sag.transfer failed:', e); }
  }

  // ensure pair updates reserves: call sync() if available, else call mint(deployer) if available
  try {
    if (typeof pair.sync === 'function') {
      console.log('Calling pair.sync() to update reserves');
      await (await pair.sync()).wait();
    } else if (typeof pair.mint === 'function') {
      console.log('Calling pair.mint(deployer) to update reserves');
      await (await pair.mint(deployer.address)).wait();
    } else {
      console.log('AMM pair has no sync/mint; ensure pair implementation updates reserves on token transfers');
    }
  } catch (e) {
    console.warn('Pair reserve update failed (non-fatal):', e);
  }

  // log balances for verification
  try {
    const usdcBal = await usdc.balanceOf(pairAddr);
    const sagBal = await sag.balanceOf(pairAddr);
    console.log(`AMM seeded: USDC=${usdcBal.toString()} SAG=${sagBal.toString()}`);
  } catch { /* ignore */ }
}

// ...existing code...

// Insert before running deposit/collateralize (example location in flow):
// compute a conservative seed amount (e.g. 2× the deposit USD)
const depositUsdToCover = BigInt(1000); // replace with actual USD amount for your deposit run
const seedUsd = depositUsdToCover * 2n;
try {
  await seedAmmLiquidity({
    pair: ammSAGUSDC,            // existing variable from script
    usdc,
    sag,
    sagOracle: oracleSag,
    deployer,
    usdAmount: seedUsd
  });
} catch (e) {
  console.warn('AMM seeding failed (non-fatal):', e);
}

// ...existing code continues that performs deposit or collateralize ...
