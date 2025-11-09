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
  MOCK_DOT: pick(CONTRACT_ADDRESSES.MockDOT, CONTRACT_ADDRESSES.MockDot, CONTRACT_ADDRESSES.MOCK_DOT),
  TREASURY: pick(CONTRACT_ADDRESSES.Treasury, CONTRACT_ADDRESSES.TREASURY),

  // per-asset oracle aliases (some code expects these exact keys)
  DotOracle: pick(CONTRACT_ADDRESSES.DotOracle, CONTRACT_ADDRESSES.DotOracle, CONTRACT_ADDRESSES.DotOracleAddress),
  SagOracle: pick(CONTRACT_ADDRESSES.SagOracle, CONTRACT_ADDRESSES.SagOracle, CONTRACT_ADDRESSES.SAGOracle),
  GoldOracle: pick(CONTRACT_ADDRESSES.GoldOracle, CONTRACT_ADDRESSES.GoldOracle),

  // also export lowercase-ish fallbacks used elsewhere
  Dot_Oracle: pick(CONTRACT_ADDRESSES.DotOracle, CONTRACT_ADDRESSES.MockOracle),
  Sag_Oracle: pick(CONTRACT_ADDRESSES.SagOracle, CONTRACT_ADDRESSES.MockOracle),
  Gold_Oracle: pick(CONTRACT_ADDRESSES.GoldOracle, CONTRACT_ADDRESSES.MockOracle),

  // spread raw addresses so consumers can still access other keys
  ...CONTRACT_ADDRESSES,
};

// Minimal runtime check (helps debugging)
if (!CONTRACTS.VAULT) console.warn('CONTRACTS.VAULT not found. Check frontend/src/lib/addresses.ts');

export default CONTRACTS;
