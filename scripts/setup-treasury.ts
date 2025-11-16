import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// read frontend addresses file (expects exported CONTRACT_ADDRESSES = { ... })
function loadAddresses() {
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

async function main() {
  const addresses = loadAddresses();
  // Use a fixed localhost RPC and do NOT read env variables for keys/addresses.
  const RPC = 'http://127.0.0.1:8545';
  const provider = new JsonRpcProvider(RPC);
  // Use the first account exposed by the provider as signer (no env/secret usage)
  const accounts = await provider.listAccounts();
  if (!accounts || accounts.length === 0) throw new Error('No accounts available from provider (localhost node)');
  const first = accounts[0];
  let signer: any;
  if (typeof first === 'string') {
    // plain address string
    signer = provider.getSigner(first);
  } else if (first && typeof first === 'object') {
    // could be a signer-like object (JsonRpcSigner) or an object with .address
    if (typeof (first as any).getAddress === 'function') {
      signer = first; // already a signer
    } else if (typeof (first as any).address === 'string') {
      signer = provider.getSigner((first as any).address);
    } else {
      signer = provider.getSigner(0);
    }
  } else {
    signer = provider.getSigner(0);
  }

  // Determine signerAddress robustly:
  // prefer explicit account string we got from provider.listAccounts()
  let signerAddress: string;
  if (accounts && accounts.length > 0 && typeof accounts[0] === 'string') {
    signerAddress = accounts[0];
  } else if ((signer as any).address && typeof (signer as any).address === 'string') {
    signerAddress = (signer as any).address;
  } else if (typeof (signer as any).getAddress === 'function') {
    // fallback if getAddress exists
    signerAddress = await (signer as any).getAddress();
  } else {
    signerAddress = 'unknown';
  }

  const TREASURY = addresses.Treasury;
  const AMM = addresses.AmmSAGUSDC ?? addresses.AmmSAGUSDC ?? addresses.AmmSAGUSDC;
  const USDC = addresses.MockUSDC ?? addresses.MockUSDC;

  console.log('Using signer:', signerAddress);
  console.log('Resolved:', { TREASURY, AMM, USDC });

  if (!TREASURY) throw new Error('Treasury address missing in addresses.ts');
  if (!USDC) throw new Error('USDC address missing in addresses.ts');
  if (!AMM) throw new Error('AMM (AmmSAGUSDC) missing in addresses.ts');

  // Import the Treasury ABI JSON (adjust the path as needed)
  const treasuryAbiPath = path.resolve(__dirname, '../artifacts/contracts/Treasury.sol/Treasury.json');
  let TreasuryAbi: any;
  try {
    const raw = fs.readFileSync(treasuryAbiPath, 'utf8');
    TreasuryAbi = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to load Treasury ABI at ${treasuryAbiPath}: ${String((e as any).message || e)}`);
  }
  
    const treasury = new Contract(TREASURY, TreasuryAbi.abi, signer);
  const usdc = new Contract(USDC, ['function mint(address,uint256) public', 'function balanceOf(address) view returns (uint256)'], signer);

  // 1) set ammPair on Treasury
  try {
    const tx = await treasury.setAmmPair(AMM);
    await tx.wait();
    console.log('treasury.setAmmPair ->', AMM);
  } catch (e) {
    console.warn('setAmmPair failed (maybe already set):', String((e as any).message || e));
  }

  // 2) Ensure Treasury can obtain USDC by providing SAG and invoking adminCollateralize (no USDC minting)
  try {
    // Transfer SAG from signer to Treasury so Treasury can swap SAG -> USDC via the AMM
    const SAG_ADDR = addresses.SAGToken;
    if (!SAG_ADDR) {
      console.warn('SAG address missing in addresses.ts; skipping SAG transfer and adminCollateralize');
    } else {
      // minimal ERC20 ABI
      const erc20Abi = ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function mint(address,uint256)'];
      const sag = new Contract(SAG_ADDR, erc20Abi, signer);

      // desired amount to provide Treasury (adjustable)
      const desiredSag = parseUnits('1000000', 18);
      let signerSagBal = BigInt(0);
      try {
        const bal = await sag.balanceOf(signerAddress);
        signerSagBal = BigInt(bal.toString ? bal.toString() : String(bal));
      } catch (bErr) {
        console.warn('Could not read signer SAG balance:', String((bErr as any).message || bErr));
      }

      if (signerSagBal === 0n) {
        console.warn('Signer has no SAG balance; skipping transfer. If you want to transfer, mint or fund SAG to the signer.');
      } else {
        const transferAmount = signerSagBal < BigInt(desiredSag.toString()) ? signerSagBal : BigInt(desiredSag.toString());
        try {
          const tx = await sag.transfer(TREASURY, transferAmount);
          await tx.wait();
          console.log(`Transferred ${transferAmount.toString()} SAG to Treasury`);
        } catch (tErr: any) {
          // Provide more diagnostic info: include error.data if present
          const short = String((tErr?.message) || tErr);
          const data = tErr?.error?.data ?? tErr?.data ?? null;
          console.warn('SAG transfer to Treasury failed:', short, data ? `revert data: ${String(data).slice(0,200)}` : '');
        }
      }

      // Now attempt adminCollateralize to convert SAG -> USDC and record collateral
      try {
        // Pick a target USD6 amount to collateralize (e.g. $1,000). Adjust as needed.
        const collateralizeAmount = parseUnits('1000', 6); // 1000 USD scaled to 6 decimals
        const adminTx = await treasury.adminCollateralize(collateralizeAmount);
        await adminTx.wait();
        console.log('Called treasury.adminCollateralize ->', collateralizeAmount.toString());
      } catch (cErr) {
        console.warn('treasury.adminCollateralize failed:', String((cErr as any).message || cErr));
      }
    }
  } catch (e) {
    console.warn('SAG -> USDC setup failed:', String((e as any).message || e));
  }

  // 3) show balances after change
  try {
    const usdcBal = await usdc.balanceOf(TREASURY);
    console.log('Treasury USDC balance:', formatUnits(usdcBal, 6));
  } catch { /* ignore */ }

  console.log('Done. Re-run scripts/debug-collateralize.ts to verify collateralization.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
