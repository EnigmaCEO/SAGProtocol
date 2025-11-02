import { formatUnits } from 'ethers';

/**
 * Format USD amount from bigint (6 decimals)
 */
export function formatUSD(amount: bigint | string | number): string {
  if (typeof amount === 'string' || typeof amount === 'number') {
    return parseFloat(amount.toString()).toFixed(2);
  }
  return parseFloat(formatUnits(amount, 6)).toFixed(2);
}

/**
 * Format timestamp to readable date
 */
export function formatTs(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format address to short form
 */
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format percentage with 2 decimals
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}
