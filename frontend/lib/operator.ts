import { getContract } from '../src/lib/ethers';
import addresses from './addresses.json';

let cachedOperator: string | null = null;

export async function getOperator(): Promise<string | null> {
  if (cachedOperator) return cachedOperator;

  // Use the first hardhat account as operator (same as demo account)
  cachedOperator = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  
  return cachedOperator;
}

export function isOperatorAddress(address: string | undefined, operator: string | null): boolean {
  if (!address || !operator) return false;
  return address.toLowerCase() === operator.toLowerCase();
}

// Clear cache when needed (e.g., on network change)
export function clearOperatorCache() {
  cachedOperator = null;
}
