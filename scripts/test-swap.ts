import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAddresses() {
  const jsPath = path.resolve(__dirname, '../frontend/src/lib/addresses.ts');
  if (!fs.existsSync(jsPath)) throw new Error('addresses.ts not found');
  const txt = fs.readFileSync(jsPath, 'utf8');
  const m = txt.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*(\{[\s\S]*\});?/m);
  if (!m) throw new Error('CONTRACT_ADDRESSES not found');
  // eslint-disable-next-line no-eval
  return eval('(' + m[1] + ')');
}

async function main() {
  const ADDR = loadAddresses();
  const RPC = 'http://127.0.0.1:8545';
  const provider = new JsonRpcProvider(RPC);
  // ESM/ethers portability: get account list from the provider and use the first account as the signer/address.
  const accounts = await provider.listAccounts();
  if (!accounts || accounts.length === 0) throw new Error('No accounts available from provider');
  // Prefer a local private key for an EOA-based runner so Contract.sendTransaction is supported.
  // Use PRIVATE_KEY from env when available; otherwise fall back to Hardhat default first private key.
  const DEFAULT_HARDHAT_KEY = '0x59c6995e998f97a5a0044966f0945388ea5e1f3f6c3a3f8f0e5e6f0a3a1d3e6c';
  const PK = process.env.PRIVATE_KEY ?? DEFAULT_HARDHAT_KEY;
  let wallet = new Wallet(PK, provider);
  let SENDER = await wallet.getAddress();
  let ethBal = await provider.getBalance(SENDER);
  // provider.getBalance may return a bigint (ethers v6) or a BigNumber (ethers v5). Handle both.
  const ethZero = (typeof ethBal === 'bigint') ? (ethBal === 0n) : (typeof (ethBal as any)?.isZero === 'function' ? (ethBal as any).isZero() : false);
  if (ethZero) {
    // Auto-fund the wallet from the local node funded account (provider.getSigner(0))
    console.warn(`Wallet ${SENDER} has 0 ETH; attempting to fund it from provider account[0] (10 ETH)`);
    const funder = provider.getSigner(0);
    const fundAmount = parseUnits('10', 18); // 10 ETH
    try {
      const txFund = await funder.sendTransaction({ to: SENDER, value: fundAmount });
      await txFund.wait();
      // refresh balance
      ethBal = await provider.getBalance(SENDER);
      console.log('Funding succeeded. Wallet balance now:', formatUnits(ethBal, 18));
      // continue using the Wallet as signer now that it has ETH
      var signer: any = wallet;
    } catch (fundErr) {
      console.warn('Auto-funding failed, falling back to provider.getSigner(0):', String((fundErr as any).message || fundErr));
      const rpcSigner = provider.getSigner(0);
      // normalize address from provider.listAccounts()
      const acctList = await provider.listAccounts();
      const raw0 = acctList && acctList.length > 0 ? acctList[0] : null;
      const acct0 = typeof raw0 === 'string' ? raw0 : (raw0?.address ?? String(raw0));
      SENDER = acct0;
      ethBal = await provider.getBalance(SENDER);
      console.log('Using provider signer (account[0]):', SENDER, 'ETH balance:', formatUnits(ethBal, 18));
      var signer: any = rpcSigner;
    }
  } else {
    console.log('Using wallet runner:', SENDER, 'ETH balance:', formatUnits(ethBal, 18));
    var signer: any = wallet;
  }

  const AMM = ADDR.AmmSAGUSDC;
  const SAG = ADDR.SAGToken;
  const USDC = ADDR.MockUSDC;

  // Use provider-backed contracts for read-only calls (balanceOf), signer-backed for transactions
  const sagRead = new Contract(SAG, ['function balanceOf(address) view returns (uint256)'], provider);
  const sagWrite = new Contract(SAG, ['function approve(address,uint256) returns (bool)'], signer);
  const usdcRead = new Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  const pair = new Contract(AMM, ['function swapExactTokensForTokens(uint256,address,address,address) returns (uint256)'], signer);

  const amountIn = parseUnits('100', 18); // 100 SAG
  console.log('Signer:', SENDER);
  console.log('Pre-swap balances -> SAG:', await formatUnits(await sagRead.balanceOf(SENDER), 18), 'USDC:', await formatUnits(await usdcRead.balanceOf(SENDER), 6));

  // approve pair to pull SAG
  const txA = await sagWrite.approve(AMM, amountIn);
  await txA.wait();
  console.log('Approved pair to pull', formatUnits(amountIn, 18), 'SAG');

  // attempt swap (may revert if pair expects different semantics)
  try {
    const tx = await pair.swapExactTokensForTokens(amountIn, SAG, USDC, SENDER, { gasLimit: 1_000_000 });
    const rec = await tx.wait();
    console.log('Swap tx mined:', tx.hash);
  } catch (err: any) {
    console.error('Swap failed:', err?.message ?? err);
  }

  console.log('Post-swap balances -> SAG:', await formatUnits(await sagRead.balanceOf(SENDER), 18), 'USDC:', await formatUnits(await usdcRead.balanceOf(SENDER), 6));
}

main().catch((e) => { console.error(e); process.exit(1); });
