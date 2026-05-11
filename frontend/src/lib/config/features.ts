import { DEV_CHAIN_IDS, TESTNET_CHAIN_IDS, type ChainKey, getChainByKeyOrDefault } from './chains';

export type ProtocolFeature =
  | 'admin'
  | 'deposits'
  | 'banking'
  | 'timeTravel'
  | 'runtimeAddressOverrides'
  | 'portfolioAutomation';

const FEATURE_MATRIX: Record<ChainKey, Partial<Record<ProtocolFeature, boolean>>> = {
  moonbase: {
    admin: true,
    deposits: true,
    banking: true,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: true,
  },
  localhost: {
    admin: true,
    deposits: true,
    banking: true,
    timeTravel: true,
    runtimeAddressOverrides: true,
    portfolioAutomation: true,
  },
  arc: {
    admin: true,
    deposits: false,
    banking: false,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: false,
  },
  'base-sepolia': {
    admin: true,
    deposits: false,
    banking: false,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: false,
  },
  'arbitrum-sepolia': {
    admin: true,
    deposits: false,
    banking: false,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: false,
  },
  'optimism-sepolia': {
    admin: true,
    deposits: false,
    banking: false,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: false,
  },
};

export const ADMIN_ENABLED_CHAIN_IDS = Object.entries(FEATURE_MATRIX)
  .filter(([, features]) => features.admin)
  .map(([key]) => getChainByKeyOrDefault(key).chainId);

export const DEPOSIT_ENABLED_CHAIN_IDS = Object.entries(FEATURE_MATRIX)
  .filter(([, features]) => features.deposits)
  .map(([key]) => getChainByKeyOrDefault(key).chainId);

export { DEV_CHAIN_IDS, TESTNET_CHAIN_IDS };

export function isFeatureEnabledForChain(feature: ProtocolFeature, chainKey: ChainKey | string | null | undefined): boolean {
  const chain = getChainByKeyOrDefault(chainKey);
  return FEATURE_MATRIX[chain.key]?.[feature] === true;
}

export function getFeaturesForChain(chainKey: ChainKey | string | null | undefined): Record<ProtocolFeature, boolean> {
  const chain = getChainByKeyOrDefault(chainKey);
  return {
    admin: false,
    deposits: false,
    banking: false,
    timeTravel: false,
    runtimeAddressOverrides: false,
    portfolioAutomation: false,
    ...FEATURE_MATRIX[chain.key],
  };
}
