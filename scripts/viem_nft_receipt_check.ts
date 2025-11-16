import { createPublicClient, http } from 'viem';
import type { Abi } from 'viem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ESM __dirname support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Load ABI JSON at runtime (avoid import assertions that some Node runtimes don't accept)
const abiPath = path.resolve(__dirname, '../frontend/src/lib/abis/Vault.json');
if (!fs.existsSync(abiPath)) throw new Error(`Vault ABI not found at ${abiPath}`);
const VaultABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Load generated frontend addresses.ts by parsing the exported object literal
const addrPath = path.resolve(__dirname, '../frontend/src/lib/addresses.ts');
let CONTRACT_ADDRESSES: any = {};
if (fs.existsSync(addrPath)) {
  const txt = fs.readFileSync(addrPath, 'utf8');
  const m = txt.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*(\{[\s\S]*\})/m);
  if (m && m[1]) {
    // eslint-disable-next-line no-eval
    CONTRACT_ADDRESSES = eval('(' + m[1] + ')');
  } else {
    throw new Error(`CONTRACT_ADDRESSES not found or unparsable in ${addrPath}`);
  }
} else {
  throw new Error(`addresses.ts not found at ${addrPath}`);
}

function getArgOrEnv(index: number, envName: string, defaultValue: string): string {
  return process.argv[index] || process.env[envName] || defaultValue;
}

const VAULT_ABI = VaultABI as any[];
const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
const USER_ADDRESS = getArgOrEnv(2, 'USER_ADDRESS', '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
const RPC_URL = getArgOrEnv(3, 'RPC_URL', 'http://127.0.0.1:8545');

const LOCALHOST_CHAIN = {
  id: CONTRACT_ADDRESSES.chainId,
  name: CONTRACT_ADDRESSES.network,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const publicClient = createPublicClient({
  chain: LOCALHOST_CHAIN,
  transport: http(RPC_URL),
});

async function main() {
  // Query deposit IDs for the user
  // Make sure the function name matches your contract ABI!
  const depositIds = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'userDepositsOf', // <-- Change this if your function is named differently
    args: [USER_ADDRESS],
  }) as bigint[];

  if (depositIds.length === 0) {
    console.error('No deposit receipts found for user:', USER_ADDRESS);
    process.exit(1);
  }

  console.log(`Deposit receipt NFT(s) for user ${USER_ADDRESS}:`, depositIds.map(id => id.toString()));

  // Optionally: Check deposit info for the latest deposit
  const lastDepositId = depositIds[depositIds.length - 1];
  const depositInfo = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'depositInfo',
    args: [lastDepositId],
  });
  console.log('Latest deposit info:', depositInfo);

  // If you have a ReceiptNFT contract, you can also check ownership here
  // Example (uncomment and adjust if needed):
  /*
  import ReceiptNFTABI from '../frontend/src/lib/abis/ReceiptNFT.json';
  const RECEIPT_NFT_ABI = ReceiptNFTABI as Abi[];
  const RECEIPT_NFT_ADDRESS = CONTRACT_ADDRESSES.ReceiptNFT;
  const owner = await publicClient.readContract({
    address: RECEIPT_NFT_ADDRESS,
    abi: RECEIPT_NFT_ABI,
    functionName: 'ownerOf',
    args: [lastDepositId],
  });
  console.log(`Owner of NFT receipt #${lastDepositId}:`, owner);
  */

  console.log('NFT receipt check complete.');
}

main().catch(console.error);
