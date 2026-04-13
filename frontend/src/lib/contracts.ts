// Normalize and re-export contract addresses for the frontend UI

import { CONTRACT_ADDRESSES } from './addresses';

// helper to pick first non-empty
function pick(...vals: (string | undefined)[]) {
  for (const v of vals) {
    if (typeof v === 'string' && v.startsWith('0x') && v.length === 42) return v;
  }
  return undefined;
}

export const CONTRACTS = {
  // canonical names used across the frontend
  VAULT: pick(CONTRACT_ADDRESSES.Vault, CONTRACT_ADDRESSES.VAULT),
  MOCK_USDC: pick(CONTRACT_ADDRESSES.MockUSDC),
  TREASURY: pick(CONTRACT_ADDRESSES.Treasury, CONTRACT_ADDRESSES.TREASURY),

  // per-asset oracle aliases
  GoldOracle: pick(CONTRACT_ADDRESSES.GoldOracle),
  Gold_Oracle: pick(CONTRACT_ADDRESSES.GoldOracle, CONTRACT_ADDRESSES.MockOracle),

  // spread raw addresses so consumers can still access other keys
  ...CONTRACT_ADDRESSES,
};

// Minimal runtime check (helps debugging)
if (!CONTRACTS.VAULT) console.warn('CONTRACTS.VAULT not found. Check frontend/src/lib/addresses.ts');

export default CONTRACTS;
