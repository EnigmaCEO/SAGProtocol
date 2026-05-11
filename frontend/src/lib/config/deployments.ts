import { getActiveChain, getChainById, getChainByKeyOrDefault, type ChainKey } from './chains';
import { DEPLOYMENT_ARTIFACTS } from './deployment-artifacts';

export type ContractAddressKey =
  | 'ProtocolDAO'
  | 'Vault'
  | 'Treasury'
  | 'InvestmentEscrow'
  | 'ExecutionRouteRegistry'
  | 'ReserveController'
  | 'GoldOracle'
  | 'UsdcOracle'
  | 'MockUSDC'
  | 'MockGOLD'
  | 'ReceiptNFT'
  | 'AmmUSDCGOLD'
  | 'PortfolioRegistry'
  | 'SAGToken'
  | 'SagOracle'
  | 'AmmSAGUSDC';

export type DeploymentContracts = Partial<Record<ContractAddressKey, string | null>>;

export interface ProtocolDeployment {
  chainKey: ChainKey;
  chainId: number;
  network: string;
  contracts: DeploymentContracts;
}

function normalizeDeployment(chainKey: ChainKey, source: Record<string, any> = {}): ProtocolDeployment {
  const chain = getChainByKeyOrDefault(chainKey);
  const contracts: DeploymentContracts = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === 'chainKey' || key === 'network' || key === 'chainId') continue;
    contracts[key as ContractAddressKey] = typeof value === 'string' ? value : null;
  }

  return {
    chainKey,
    chainId: Number(source.chainId ?? chain.chainId),
    network: String(source.network ?? chain.key),
    contracts,
  };
}

const PROTOCOL_DAO_OVERRIDES: Partial<Record<ChainKey, string | undefined>> = {
  moonbase: process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_MOONBASE,
  localhost: process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_LOCALHOST,
  arc: process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_ARC,
  'base-sepolia': process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_BASE_SEPOLIA,
  'arbitrum-sepolia': process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_ARBITRUM_SEPOLIA,
  'optimism-sepolia': process.env.NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_OPTIMISM_SEPOLIA,
};

const DEPLOYMENT_ARTIFACT_BY_CHAIN = DEPLOYMENT_ARTIFACTS as Partial<Record<ChainKey, Record<string, any>>>;

function withProtocolDaoOverride(chainKey: ChainKey, artifact: Record<string, any> = {}) {
  const override = PROTOCOL_DAO_OVERRIDES[chainKey];
  return override ? { ...artifact, ProtocolDAO: override } : artifact;
}

export const DEPLOYMENT_REGISTRY: Partial<Record<ChainKey, ProtocolDeployment>> = {
  moonbase: normalizeDeployment('moonbase', withProtocolDaoOverride('moonbase', DEPLOYMENT_ARTIFACT_BY_CHAIN.moonbase)),
  localhost: normalizeDeployment('localhost', withProtocolDaoOverride('localhost', DEPLOYMENT_ARTIFACT_BY_CHAIN.localhost)),
  arc: normalizeDeployment('arc', withProtocolDaoOverride('arc', DEPLOYMENT_ARTIFACT_BY_CHAIN.arc)),
  'base-sepolia': normalizeDeployment('base-sepolia', withProtocolDaoOverride('base-sepolia', DEPLOYMENT_ARTIFACT_BY_CHAIN['base-sepolia'])),
  'arbitrum-sepolia': normalizeDeployment('arbitrum-sepolia', withProtocolDaoOverride('arbitrum-sepolia', DEPLOYMENT_ARTIFACT_BY_CHAIN['arbitrum-sepolia'])),
  'optimism-sepolia': normalizeDeployment('optimism-sepolia', withProtocolDaoOverride('optimism-sepolia', DEPLOYMENT_ARTIFACT_BY_CHAIN['optimism-sepolia'])),
};

export function getDeploymentByChainKey(chainKey: ChainKey | string | null | undefined): ProtocolDeployment {
  const chain = getChainByKeyOrDefault(chainKey);
  return DEPLOYMENT_REGISTRY[chain.key] ?? normalizeDeployment(chain.key);
}

export function getDeploymentByChainId(chainId: number | string | bigint | null | undefined): ProtocolDeployment {
  const chain = getChainById(chainId);
  return getDeploymentByChainKey(chain?.key);
}

export function getActiveDeployment(): ProtocolDeployment {
  return getDeploymentByChainKey(getActiveChain().key);
}

export function getDeploymentAddress(
  key: ContractAddressKey,
  chainKey: ChainKey | string | null | undefined = getActiveChain().key
): string | null {
  const deployment = getDeploymentByChainKey(chainKey);
  const value = deployment.contracts[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getDeploymentContracts(chainKey: ChainKey | string | null | undefined = getActiveChain().key): DeploymentContracts {
  return getDeploymentByChainKey(chainKey).contracts;
}

export function isAddressLike(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function hasConfiguredProtocolDao(chainKey: ChainKey | string | null | undefined): boolean {
  return isAddressLike(getDeploymentAddress('ProtocolDAO', chainKey));
}
