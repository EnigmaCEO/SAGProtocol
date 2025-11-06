import { CONTRACT_ADDRESSES } from './addresses';

export const CONTRACTS = {
  VAULT: CONTRACT_ADDRESSES.Vault,
  MOCK_DOT: (((CONTRACT_ADDRESSES as any).MockDOT ?? (CONTRACT_ADDRESSES as any).SAGToken) as `0x${string}`),
  TREASURY: CONTRACT_ADDRESSES.Treasury as `0x${string}`,
  MOCK_ORACLE: CONTRACT_ADDRESSES.MockOracle as `0x${string}`,
  // Add other contract addresses as they are deployed
} as const;

export type ContractAddresses = typeof CONTRACTS;
