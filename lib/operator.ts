import { getContract } from '../frontend/lib/ethers';

let cachedOperator: string | null = null;

export async function getOperator(): Promise<string | null> {
  if (cachedOperator) return cachedOperator;

  // Read operator from environment variable
  cachedOperator = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS || null;
  
  if (!cachedOperator) {
    console.warn('NEXT_PUBLIC_OPERATOR_ADDRESS not set');
  }
  
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
