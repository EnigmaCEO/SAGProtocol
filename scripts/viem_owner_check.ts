import { createPublicClient, http } from 'viem';
import type { Abi } from 'viem';
import VaultOwnerOnlyABI from '../frontend/src/lib/abis/VaultOwnerOnly.json';

import { version } from 'viem/package.json';
console.log('viem version (script):', version);

const VAULT_ABI = VaultOwnerOnlyABI as unknown as Abi[];
const VAULT_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

const client = createPublicClient({
  chain: {
    id: 1337,
    name: 'Localhost 1337',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  },
  transport: http('http://127.0.0.1:8545'),
});

async function main() {
  const owner = await client.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'owner',
  });
  console.log("Vault owner (viem):", owner);
}

main().catch(console.error);
