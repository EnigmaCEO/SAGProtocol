import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  } catch {}
  return null;
}

async function main() {
  const ADDR_FILE = loadAddresses();
  if (!ADDR_FILE) throw new Error('addresses.ts not found');
  const AMM = ADDR_FILE.AmmSAGUSDC;
  if (!AMM) throw new Error('AmmSAGUSDC missing in addresses');

  const RPC = 'http://127.0.0.1:8545';
  const provider = new JsonRpcProvider(RPC);
  const wallet = Wallet.createRandom();
  console.log('Probe AMM:', AMM);

  const probes = [
    { name: 'token0', abi: ['function token0() view returns (address)'] },
    { name: 'token1', abi: ['function token1() view returns (address)'] },
    { name: 'getReserves', abi: ['function getReserves() view returns (uint112,uint112,uint32)'] },
    { name: 'mint', abi: ['function mint(address) returns (uint256)'] },
    { name: 'sync', abi: ['function sync()'] },
    { name: 'deposit', abi: ['function deposit()'] },
    { name: 'swapExactTokensForTokens', abi: ['function swapExactTokensForTokens(uint256,address,address,address) returns (uint256)'] },
    { name: 'addLiquidity', abi: ['function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)'] },
  ];

  for (const p of probes) {
    const c = new Contract(AMM, p.abi, provider);
    try {
      // call view functions with callStatic when possible, otherwise attempt estimating gas for non-view
      if (p.name === 'token0' || p.name === 'token1' || p.name === 'getReserves') {
        const res = await (c as any)[p.name]();
        console.log(`${p.name}: OK ->`, res);
      } else {
        // try estimateGas to detect presence (won't execute)
        try {
          await provider.estimateGas({ to: AMM, data: c.interface.encodeFunctionData(p.name, [/* dummy */]) });
          console.log(`${p.name}: looks callable (estimateGas succeeded)`);
        } catch (e) {
          console.log(`${p.name}: not callable (estimateGas failed / missing)`);
        }
      }
    } catch (e) {
      console.log(`${p.name}: not present or call failed:`, String((e as any).message || e).split('\n')[0]);
    }
  }

  console.log('Probe complete. Use results to adapt add-amm-liquidity.ts to your AMM implementation.');
}

main().catch((e) => { console.error(e); process.exit(1); });
