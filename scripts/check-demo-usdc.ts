import { JsonRpcProvider, Contract } from 'ethers';
import { CONTRACT_ADDRESSES } from '../frontend/src/lib/addresses.ts';
import fs from 'fs';
import path from 'path';

const provider = new JsonRpcProvider("http://127.0.0.1:8545");
const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const usdcAddress = CONTRACT_ADDRESSES.MockUSDC;

async function main() {
  // Load ABI via fs to avoid requiring import assertions in ESM
  const abiPath = path.resolve(process.cwd(), 'frontend/src/lib/abis/MockUSDC.json');
  const USDC_ABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const usdc = new Contract(usdcAddress, USDC_ABI, provider);
  const balance = await usdc.balanceOf(demoAddress);
  console.log(`Demo wallet USDC balance: ${Number(balance) / 1e6} USDC`);
}

main();
