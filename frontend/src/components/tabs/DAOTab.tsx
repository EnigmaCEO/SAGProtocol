import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { getContract } from '../../lib/ethers';
import { getRuntimeAddress, setRuntimeAddress, isValidAddress, getDefaultAddress, loadGeneratedRuntimeAddresses } from '../../lib/runtime-addresses';
import { AppRole, listRoleAssignments, removeAddressRole, ROLES_UPDATED_EVENT, setAddressRole } from '../../lib/roles';
import { emitUiRefresh } from '../../lib/ui-refresh';
import {
  SwapIcon as ArrowRightLeft,
  ClockIcon as Clock,
  SettingsIcon as Settings,
  ShieldAlertIcon as ShieldAlert,
  UserCogIcon as UserCog,
  ZapIcon as Zap,
  UsersIcon as Users,
} from '../icons/SagittaIcons';
import useRoleAccess from '../../hooks/useRoleAccess';
import PageHeader from '../ui/PageHeader';
import { RPC_URL, IS_LOCAL_CHAIN } from '../../lib/network';

const LOCALHOST_RPC = RPC_URL;
const LOCAL_CHAIN_IDS = new Set([1337, 31337]);
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DAO_PROPOSALS_KEY = 'sagitta.daoProposals.v1';
const BATCH_CADENCE_KEY = 'sagitta.batchCadenceSeconds';
const DEFAULT_BATCH_CADENCE_SECONDS = 7 * 24 * 60 * 60;
const BATCH_CADENCE_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '5 minutes', seconds: 5 * 60 },
  { label: '1 hour',    seconds: 60 * 60 },
  { label: '1 day',     seconds: 24 * 60 * 60 },
  { label: '1 week',    seconds: 7 * 24 * 60 * 60 },
  { label: '2 weeks',   seconds: 14 * 24 * 60 * 60 },
  { label: '1 month',   seconds: 30 * 24 * 60 * 60 },
  { label: '1 year',    seconds: 365 * 24 * 60 * 60 },
];
const VAULT_UNLOCK_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '5 minutes', seconds: 5 * 60 },
  { label: '1 hour',    seconds: 60 * 60 },
  { label: '1 day',     seconds: 24 * 60 * 60 },
  { label: '1 week',    seconds: 7 * 24 * 60 * 60 },
  { label: '1 month',   seconds: 30 * 24 * 60 * 60 },
  { label: '1 year',    seconds: 365 * 24 * 60 * 60 },
];

function formatChainTime(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  return new Date(seconds * 1000).toLocaleString();
}

function formatSecondsLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  if (seconds % (365 * 24 * 60 * 60) === 0) {
    const n = seconds / (365 * 24 * 60 * 60);
    return `${n} year${n === 1 ? '' : 's'}`;
  }
  if (seconds % (30 * 24 * 60 * 60) === 0) {
    const n = seconds / (30 * 24 * 60 * 60);
    return `${n} month${n === 1 ? '' : 's'}`;
  }
  if (seconds % (7 * 24 * 60 * 60) === 0) {
    const n = seconds / (7 * 24 * 60 * 60);
    return `${n} week${n === 1 ? '' : 's'}`;
  }
  if (seconds % (24 * 60 * 60) === 0) {
    const n = seconds / (24 * 60 * 60);
    return `${n} day${n === 1 ? '' : 's'}`;
  }
  if (seconds % (60 * 60) === 0) {
    const n = seconds / (60 * 60);
    return `${n} hour${n === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    const n = seconds / 60;
    return `${n} minute${n === 1 ? '' : 's'}`;
  }
  return `${seconds}s`;
}

function formatAddressShort(addr: string | null): string {
  if (!addr || !isValidAddress(addr)) return 'N/A';
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

function formatUsd(value: number | bigint | string, decimals = 6): string {
  const numeric =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'string'
        ? Number(value)
        : value;
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return '$' + (safe / 10 ** decimals).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseUsdInputToUsd6(value: string): bigint | null {
  const normalized = value.replace(/[$,\s]/g, '').trim();
  if (!normalized) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) return null;
  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const paddedFraction = (fractionalPart + '000000').slice(0, 6);
  return (BigInt(wholePart) * BigInt(1_000_000)) + BigInt(paddedFraction);
}

function formatUsd6Input(value: bigint): string {
  if (value <= 0) return '';
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000)).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function toBytes32Ref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return ethers.ZeroHash;
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  return ethers.id(trimmed);
}

function formatError(error: any): string {
  const reason =
    error?.reason ||
    error?.shortMessage ||
    error?.error?.message ||
    error?.message ||
    String(error);
  const normalized = String(reason).replace(/\s+/g, ' ').trim();
  if (normalized.toLowerCase().includes('could not decode result data')) {
    return 'Read succeeded at transport level, but contract ABI/function does not match expected interface';
  }
  return normalized;
}

function formatProposalTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function dedupeAddresses(addresses: string[]): string[] {
  const map = new Map<string, string>();
  for (const addr of addresses) {
    if (!isValidAddress(addr)) continue;
    const key = addr.toLowerCase();
    if (!map.has(key)) map.set(key, addr);
  }
  return Array.from(map.values());
}

type LinkStepResult = {
  step: string;
  ok: boolean;
  txHash?: string;
  error?: string;
};

type ReadDiagnostics = {
  treasury: string | null;
  vault: string | null;
  escrow: string | null;
  reserve: string | null;
};

type ProposalAction =
  | 'APPLY_ALL_LINKS'
  | 'SET_VAULT_LOCK_DURATION'
  | 'SAVE_BATCH_CADENCE'
  | 'TOGGLE_VAULT_PAUSE'
  | 'TRANSFER_OWNERSHIP'
  | 'SET_GOLD_PRICE'
  | 'REBALANCE_TREASURY'
  | 'PAY_RECEIPT_PROFIT'
  | 'ADD_PORTFOLIO_ASSET'
  | 'UPDATE_PORTFOLIO_ASSET'
  | 'REMOVE_PORTFOLIO_ASSET';

type PortfolioAsset = {
  symbol: string;
  name: string;
  token: string;
  oracle: string;
  riskClass: number;
  role: number;
  minimumInvestmentUsd6: bigint;
  addedAt: number;
};

type PortfolioAssetHistory = {
  assetSymbol: string;
  batchId: string;
  sourceType: string;
  routeType: string;
  routeId?: string;
  adapterId?: string;
  deployedAt?: string;
  returnedAt?: string;
  principalAllocatedUsd: number;
  returnedAmountUsd?: number;
  realizedPnlUsd: number;
  realizedPnlPct: number;
  status: string;
};

type ExecutionRoute = {
  routeId: number;
  assetSymbol: string;
  routeType: number;
  counterpartyRefHash: string;
  jurisdictionRefHash: string;
  custodyRefHash: string;
  documentsComplete: boolean;
  sagittaFundApproved: boolean;
  ndaSigned: boolean;
  pnlEndpoint: string;
  manualMarksRequired: boolean;
  active: boolean;
};

const RISK_CLASS_LABELS = [
  'Wealth Management',   // 0
  'Stablecoin',          // 1
  'DeFi Bluechip',       // 2
  'Fund of Funds',       // 3
  'Large Cap',           // 4
  'Private Credit Fund', // 5
  'Real World Asset',    // 6
  'External Protocol',   // 7
];
const ASSET_ROLE_LABELS = [
  'Core',       // 0
  'Liquidity',  // 1
  'Satellite',  // 2
  'Defensive',  // 3
  'Speculative',// 4
  'Yield Fund', // 5
  'External',   // 6
];

const PORTFOLIO_REGISTRY_ABI = [
  'function addAsset(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6) external',
  'function removeAsset(string symbol) external',
  'function updateAsset(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6) external',
  'function getAllAssets() external view returns (tuple(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6, uint256 addedAt)[])',
  'function isInPortfolio(string symbol) external view returns (bool)',
  'function assetCount() external view returns (uint256)',
  'function owner() external view returns (address)',
];

const EXECUTION_ROUTE_REGISTRY_ABI = [
  'function addRoute(string assetSymbol, uint8 routeType, bytes32 counterpartyRefHash, bytes32 jurisdictionRefHash, bytes32 custodyRefHash, bool documentsComplete, bool sagittaFundApproved, bool ndaSigned, string pnlEndpoint, bool manualMarksRequired, bool active) external returns (uint256)',
  'function updateRoute(uint256 routeId, string assetSymbol, uint8 routeType, bytes32 counterpartyRefHash, bytes32 jurisdictionRefHash, bytes32 custodyRefHash, bool documentsComplete, bool sagittaFundApproved, bool ndaSigned, string pnlEndpoint, bool manualMarksRequired, bool active) external',
  'function removeRoute(uint256 routeId) external',
  'function getAllRoutes() external view returns (tuple(uint256 routeId, string assetSymbol, uint8 routeType, bytes32 counterpartyRefHash, bytes32 jurisdictionRefHash, bytes32 custodyRefHash, bool documentsComplete, bool sagittaFundApproved, bool ndaSigned, string pnlEndpoint, bool manualMarksRequired, bool active)[])',
  'function isRouteBatchEligible(uint256 routeId) external view returns (bool)',
];
const EXECUTION_ROUTE_TYPE_LABELS = ['Onchain', 'Custodian', 'Managed Portfolio', 'External'];

type DaoProposal = {
  id: string;
  action: ProposalAction;
  title: string;
  summary: string;
  createdAt: number;
  createdBy: string;
  approvals: string[];
  status: 'pending' | 'executed' | 'failed';
  executedAt?: number;
  error?: string;
  payload?: Record<string, any>;
};

export default function DAOTab() {
  const {
    address: connectedAddress,
    ownerAddress: connectedOwnerAddress,
    councilMembers: onChainCouncil,
    actualRole,
    role: signerRole,
    isOperator: isOp,
    isOwner: signerIsOwner,
    isActualOwner,
  } = useRoleAccess();
  const address = connectedAddress ?? '';
  const ownerAddress = connectedOwnerAddress ?? '';
  const canExecuteAsActualSigner = actualRole === 'owner' || actualRole === 'operator';
  const [adminAddresses, setAdminAddresses] = useState<string[]>([]);
  const [councilMemberInput, setCouncilMemberInput] = useState('');
  const [councilStatus, setCouncilStatus] = useState<string | null>(null);
  const [councilBusy, setCouncilBusy] = useState(false);
  const [vaultPaused, setVaultPaused] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  const [treasuryAddress, setTreasuryAddress] = useState<string>(() => getRuntimeAddress('Treasury'));
  const [vaultAddress, setVaultAddress] = useState<string>(() => getRuntimeAddress('Vault'));
  const [escrowAddress, setEscrowAddress] = useState<string>(() => getRuntimeAddress('InvestmentEscrow'));
  const [reserveAddress, setReserveAddress] = useState<string>(() => getRuntimeAddress('ReserveController'));
  const [goldOracleAddress, setGoldOracleAddress] = useState<string>(() => getRuntimeAddress('GoldOracle'));

  const [treasuryAddressInput, setTreasuryAddressInput] = useState<string>(treasuryAddress);
  const [vaultAddressInput, setVaultAddressInput] = useState<string>(vaultAddress);
  const [escrowAddressInput, setEscrowAddressInput] = useState<string>(escrowAddress);
  const [reserveAddressInput, setReserveAddressInput] = useState<string>(reserveAddress);
  const [goldOracleAddressInput, setGoldOracleAddressInput] = useState<string>(goldOracleAddress);

  const [treasuryVaultInput, setTreasuryVaultInput] = useState<string>(vaultAddress);
  const [treasuryEscrowInput, setTreasuryEscrowInput] = useState<string>(escrowAddress);
  const [treasuryReserveInput, setTreasuryReserveInput] = useState<string>(reserveAddress);
  const [vaultTreasuryInput, setVaultTreasuryInput] = useState<string>(treasuryAddress);
  const [vaultEscrowInput, setVaultEscrowInput] = useState<string>(escrowAddress);
  const [escrowVaultInput, setEscrowVaultInput] = useState<string>(vaultAddress);
  const [escrowKeeperInput, setEscrowKeeperInput] = useState<string>(treasuryAddress);
  const [reserveTreasuryInput, setReserveTreasuryInput] = useState<string>(treasuryAddress);

  const [treasuryOnChainVault, setTreasuryOnChainVault] = useState<string | null>(null);
  const [treasuryOnChainEscrow, setTreasuryOnChainEscrow] = useState<string | null>(null);
  const [treasuryOnChainReserve, setTreasuryOnChainReserve] = useState<string | null>(null);
  const [vaultOnChainTreasury, setVaultOnChainTreasury] = useState<string | null>(null);
  const [vaultOnChainEscrow, setVaultOnChainEscrow] = useState<string | null>(null);
  const [escrowOnChainVault, setEscrowOnChainVault] = useState<string | null>(null);
  const [escrowOnChainKeeper, setEscrowOnChainKeeper] = useState<string | null>(null);
  const [reserveOnChainTreasury, setReserveOnChainTreasury] = useState<string | null>(null);

  const [lockDurationSeconds, setLockDurationSeconds] = useState<number>(365 * 24 * 60 * 60);
  const [lockDurationOnChainSeconds, setLockDurationOnChainSeconds] = useState<number | null>(null);

  const [isLocalhostNetwork, setIsLocalhostNetwork] = useState(false);
  const [localChainId, setLocalChainId] = useState<number | null>(null);
  const [localChainTime, setLocalChainTime] = useState<number | null>(null);
  const [timeControlLoading, setTimeControlLoading] = useState(false);
  const [batchCadenceSeconds, setBatchCadenceSeconds] = useState<number>(DEFAULT_BATCH_CADENCE_SECONDS);
  const [escrowLastRollTime, setEscrowLastRollTime] = useState<number | null>(null);

  const [treasuryStatus, setTreasuryStatus] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<string | null>(null);
  const [escrowStatus, setEscrowStatus] = useState<string | null>(null);
  const [reserveStatus, setReserveStatus] = useState<string | null>(null);
  const [timeStatus, setTimeStatus] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [linkRunContext, setLinkRunContext] = useState<string | null>(null);
  const [linkStepResults, setLinkStepResults] = useState<LinkStepResult[]>([]);
  const [readDiagnostics, setReadDiagnostics] = useState<ReadDiagnostics>({
    treasury: null,
    vault: null,
    escrow: null,
    reserve: null,
  });
  const [governanceProposals, setGovernanceProposals] = useState<DaoProposal[]>([]);
  const [proposalExecId, setProposalExecId] = useState<string | null>(null);
  const [roleAssignments, setRoleAssignments] = useState<Array<{ address: string; role: AppRole }>>([]);
  const [roleAddressInput, setRoleAddressInput] = useState('');
  const [roleValueInput, setRoleValueInput] = useState<AppRole>('viewer');
  const [roleStatus, setRoleStatus] = useState<string | null>(null);
  const [treasuryGoldPriceInput, setTreasuryGoldPriceInput] = useState('4000');
  const [profitReceiptIdInput, setProfitReceiptIdInput] = useState('');
  const [profitAmountUsdInput, setProfitAmountUsdInput] = useState('');
  const [treasuryControlStatus, setTreasuryControlStatus] = useState<string | null>(null);

  // Portfolio Registry state
  const [portfolioRegistryAddress, setPortfolioRegistryAddress] = useState<string>(() => getRuntimeAddress('PortfolioRegistry'));
  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioAsset[]>([]);
  const [portfolioAssetHistory, setPortfolioAssetHistory] = useState<PortfolioAssetHistory[]>([]);

  const aggregatedPortfolioHistory = useMemo(() => {
    const map = new Map<string, {
      assetSymbol: string;
      batchCount: number;
      sources: Set<string>;
      routeTypes: Set<string>;
      principalTotal: number;
      returnedTotal: number;
      pnlTotal: number;
    }>();
    for (const row of portfolioAssetHistory) {
      const key = row.assetSymbol;
      if (!map.has(key)) {
        map.set(key, { assetSymbol: key, batchCount: 0, sources: new Set(), routeTypes: new Set(), principalTotal: 0, returnedTotal: 0, pnlTotal: 0 });
      }
      const agg = map.get(key)!;
      agg.batchCount += 1;
      if (row.sourceType) agg.sources.add(row.sourceType);
      if (row.routeType) agg.routeTypes.add(row.routeType);
      agg.principalTotal += row.principalAllocatedUsd;
      agg.returnedTotal += row.returnedAmountUsd ?? 0;
      agg.pnlTotal += row.realizedPnlUsd;
    }
    return Array.from(map.values()).map(agg => ({
      ...agg,
      yieldPct: agg.principalTotal > 0 ? (agg.pnlTotal / agg.principalTotal) * 100 : 0,
      sourceLabel: agg.sources.size > 1 ? 'Multiple' : [...agg.sources][0] ?? '—',
      routeLabel: [...agg.routeTypes].join(', ') || '—',
    }));
  }, [portfolioAssetHistory]);

  const [portfolioStatus, setPortfolioStatus] = useState<string | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [newAssetToken, setNewAssetToken] = useState('');
  const [newAssetSymbol, setNewAssetSymbol] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetOracle, setNewAssetOracle] = useState('');
  const [newAssetRiskClass, setNewAssetRiskClass] = useState(0);
  const [newAssetRole, setNewAssetRole] = useState(0);
  const [newAssetMinimumAmount, setNewAssetMinimumAmount] = useState('');
  const [editingPortfolioAssetSymbol, setEditingPortfolioAssetSymbol] = useState<string | null>(null);

  const [routeRegistryAddress, setRouteRegistryAddress] = useState<string>(() => getRuntimeAddress('ExecutionRouteRegistry'));
  const [executionRoutes, setExecutionRoutes] = useState<ExecutionRoute[]>([]);
  const [routeRegistryLoading, setRouteRegistryLoading] = useState(false);
  const [routeRegistryStatus, setRouteRegistryStatus] = useState<string | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [routeAssetSymbolInput, setRouteAssetSymbolInput] = useState('');
  const [routeTypeInput, setRouteTypeInput] = useState(0);
  const [routeCounterpartyInput, setRouteCounterpartyInput] = useState('');
  const [routeJurisdictionInput, setRouteJurisdictionInput] = useState('');
  const [routeCustodyInput, setRouteCustodyInput] = useState('');
  const [routeDocumentsCompleteInput, setRouteDocumentsCompleteInput] = useState(false);
  const [routeSagittaFundApprovedInput, setRouteSagittaFundApprovedInput] = useState(false);
  const [routeNdaSignedInput, setRouteNdaSignedInput] = useState(false);
  const [routePnlEndpointInput, setRoutePnlEndpointInput] = useState('');
  const [routeManualMarksInput, setRouteManualMarksInput] = useState(true);
  const [routeActiveInput, setRouteActiveInput] = useState(true);

  // Keep address states in sync whenever loadGeneratedRuntimeAddresses() or setRuntimeAddress() fires.
  useEffect(() => {
    const sync = () => {
      setTreasuryAddress(getRuntimeAddress('Treasury'));
      setVaultAddress(getRuntimeAddress('Vault'));
      setEscrowAddress(getRuntimeAddress('InvestmentEscrow'));
      setRouteRegistryAddress(getRuntimeAddress('ExecutionRouteRegistry'));
      setReserveAddress(getRuntimeAddress('ReserveController'));
      setGoldOracleAddress(getRuntimeAddress('GoldOracle'));
      setPortfolioRegistryAddress(getRuntimeAddress('PortfolioRegistry'));
    };
    window.addEventListener('sagitta:addresses-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sagitta:addresses-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const nextBatchRollDue = escrowLastRollTime ? escrowLastRollTime + batchCadenceSeconds : null;

  // DAO Council: read from ProtocolDAO on-chain — same for every participant.
  const daoCouncil = dedupeAddresses(
    onChainCouncil.filter((addr): addr is string =>
      isValidAddress(addr) && addr.toLowerCase() !== ethers.ZeroAddress.toLowerCase()
    )
  );

  const signerIsCouncilMember =
    isValidAddress(address) && daoCouncil.some(a => a.toLowerCase() === address.toLowerCase());

  // Approval authority switches to the DAO council as soon as any member exists.
  // Before that, the contract owner is the single-sig fallback approver.
  const canApproveAsActualSigner =
    daoCouncil.length === 0 ? isActualOwner : signerIsCouncilMember;

  // Proposals require approval from all DAO council members. If no council is configured,
  // the contract owner alone is sufficient.
  const requiredProposalApprovals = Math.max(1, daoCouncil.length);
  const pendingProposalCount = governanceProposals.filter(p => p.status === 'pending').length;
  const isResumeProposal = (proposal?: Pick<DaoProposal, 'action' | 'payload'> | null): boolean =>
    proposal?.action === 'TOGGLE_VAULT_PAUSE' && proposal?.payload?.targetPaused === false;

  useEffect(() => {
    const rp = new ethers.JsonRpcProvider(LOCALHOST_RPC);
    setProvider(rp);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(DAO_PROPOSALS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setGovernanceProposals(
        parsed
          .filter((item: any) => item && typeof item.id === 'string' && typeof item.action === 'string')
          .map((item: any) => ({
            id: String(item.id),
            action: String(item.action) as ProposalAction,
            title: String(item.title ?? 'Untitled proposal'),
            summary: String(item.summary ?? ''),
            createdAt: Number(item.createdAt ?? Date.now()),
            createdBy: String(item.createdBy ?? ethers.ZeroAddress),
            approvals: Array.isArray(item.approvals) ? dedupeAddresses(item.approvals.filter((v: any) => typeof v === 'string')) : [],
            status: item.status === 'executed' || item.status === 'failed' ? item.status : 'pending',
            executedAt: item.executedAt ? Number(item.executedAt) : undefined,
            error: item.error ? String(item.error) : undefined,
            payload: item.payload && typeof item.payload === 'object' ? item.payload : undefined,
          }))
      );
    } catch {
      // ignore malformed cached proposals
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DAO_PROPOSALS_KEY, JSON.stringify(governanceProposals));
  }, [governanceProposals]);

  useEffect(() => {
    const refreshRoles = () => setRoleAssignments(listRoleAssignments());
    refreshRoles();
    if (typeof window === 'undefined') return;
    window.addEventListener(ROLES_UPDATED_EVENT, refreshRoles as EventListener);
    window.addEventListener('storage', refreshRoles);
    return () => {
      window.removeEventListener(ROLES_UPDATED_EVENT, refreshRoles as EventListener);
      window.removeEventListener('storage', refreshRoles);
    };
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const vault = await getContract('vault') as any;
        if (!vault) return;
        const [owner, paused] = await Promise.all([
          vault.owner().catch(() => ethers.ZeroAddress),
          vault.paused().catch(() => false),
        ]);
        setVaultPaused(paused);
        if (isValidAddress(owner)) {
          setAdminAddresses([owner]);
        }
      } catch (error) {
        console.error('Failed to load DAO data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(BATCH_CADENCE_KEY);
    if (!saved) return;
    const parsed = Number(saved);
    if (Number.isFinite(parsed) && parsed > 0) setBatchCadenceSeconds(parsed);
  }, []);

  useEffect(() => setTreasuryAddressInput(treasuryAddress), [treasuryAddress]);
  useEffect(() => setVaultAddressInput(vaultAddress), [vaultAddress]);
  useEffect(() => setEscrowAddressInput(escrowAddress), [escrowAddress]);
  useEffect(() => setReserveAddressInput(reserveAddress), [reserveAddress]);
  useEffect(() => setGoldOracleAddressInput(goldOracleAddress), [goldOracleAddress]);

  useEffect(() => {
    if (!provider) return;
    refreshConfigState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, treasuryAddress, vaultAddress, escrowAddress, reserveAddress]);

  useEffect(() => {
    if (!provider) return;
    refreshPortfolioState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, portfolioRegistryAddress]);

  useEffect(() => {
    refreshPortfolioAssetHistory();
  }, []);

  useEffect(() => {
    if (!provider) return;
    refreshRouteRegistryState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, routeRegistryAddress]);

  async function refreshChainClock(rpcProvider: ethers.JsonRpcProvider) {
    try {
      const network = await rpcProvider.getNetwork();
      const chainIdNum = Number(network.chainId);
      const rpcLooksLocal = LOCALHOST_RPC.includes('localhost') || LOCALHOST_RPC.includes('127.0.0.1');
      const localNetwork = rpcLooksLocal && LOCAL_CHAIN_IDS.has(chainIdNum);
      setIsLocalhostNetwork(localNetwork);
      setLocalChainId(chainIdNum);
      if (!localNetwork) {
        setLocalChainTime(null);
        return;
      }
      const latestBlock = await rpcProvider.getBlock('latest');
      setLocalChainTime(latestBlock ? Number(latestBlock.timestamp) : null);
    } catch {
      setIsLocalhostNetwork(false);
      setLocalChainId(null);
      setLocalChainTime(null);
    }
  }

  async function getWriteSigner() {
    if (IS_LOCAL_CHAIN) {
      if (!provider) throw new Error('Local RPC provider not ready');
      return new ethers.Wallet(TEST_PRIVATE_KEY, provider);
    }
    const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
    if (!eth) throw new Error('No wallet connected');
    return new ethers.BrowserProvider(eth).getSigner();
  }

  async function hasContractCode(address: string): Promise<boolean> {
    if (!provider || !isValidAddress(address)) return false;
    try {
      const code = await provider.getCode(address);
      return !!code && code !== '0x';
    } catch {
      return false;
    }
  }

  async function refreshConfigState(overrides?: {
    treasuryAddress?: string;
    vaultAddress?: string;
    escrowAddress?: string;
    reserveAddress?: string;
  }) {
    if (!provider) return;
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const treasuryAddr = overrides?.treasuryAddress ?? treasuryAddress;
    const vaultAddr = overrides?.vaultAddress ?? vaultAddress;
    const escrowAddr = overrides?.escrowAddress ?? escrowAddress;
    const reserveAddr = overrides?.reserveAddress ?? reserveAddress;
    const diagnostics: ReadDiagnostics = {
      treasury: null,
      vault: null,
      escrow: null,
      reserve: null,
    };
    await refreshChainClock(provider);

    if (isValidAddress(treasuryAddr)) {
      const hasCode = await hasContractCode(treasuryAddr);
      if (!hasCode) {
        setTreasuryOnChainVault(null);
        setTreasuryOnChainEscrow(null);
        setTreasuryOnChainReserve(null);
        diagnostics.treasury = `No contract bytecode at Treasury (${treasuryAddr})`;
      } else {
      try {
        const treasuryRead = new ethers.Contract(
          treasuryAddr,
          ['function vault() view returns (address)', 'function escrow() view returns (address)', 'function reserveAddress() view returns (address)'],
          provider
        );
        const [v, e, r] = await Promise.all([
          treasuryRead.vault(),
          treasuryRead.escrow(),
          treasuryRead.reserveAddress(),
        ]);
        const linkedVault = typeof v === 'string' && v !== ZERO_ADDRESS ? v : null;
        const linkedEscrow = typeof e === 'string' && e !== ZERO_ADDRESS ? e : null;
        const linkedReserve = typeof r === 'string' && r !== ZERO_ADDRESS ? r : null;
        setTreasuryOnChainVault(linkedVault);
        setTreasuryOnChainEscrow(linkedEscrow);
        setTreasuryOnChainReserve(linkedReserve);
        if (linkedVault) setTreasuryVaultInput(linkedVault);
        if (linkedEscrow) setTreasuryEscrowInput(linkedEscrow);
        if (linkedReserve) setTreasuryReserveInput(linkedReserve);
      } catch (error: any) {
        setTreasuryOnChainVault(null);
        setTreasuryOnChainEscrow(null);
        setTreasuryOnChainReserve(null);
        diagnostics.treasury = formatError(error);
      }
      }
    } else {
      setTreasuryOnChainVault(null);
      setTreasuryOnChainEscrow(null);
      setTreasuryOnChainReserve(null);
      diagnostics.treasury = 'Invalid Treasury address';
    }

    if (isValidAddress(vaultAddr)) {
      const hasCode = await hasContractCode(vaultAddr);
      if (!hasCode) {
        setVaultOnChainTreasury(null);
        setVaultOnChainEscrow(null);
        diagnostics.vault = `No contract bytecode at Vault (${vaultAddr})`;
      } else {
      try {
        const vaultRead = new ethers.Contract(
          vaultAddr,
          ['function treasury() view returns (address)', 'function escrow() view returns (address)', 'function lockDuration() view returns (uint64)'],
          provider
        );
        const [t, e, lockRaw] = await Promise.all([
          vaultRead.treasury(),
          vaultRead.escrow(),
          vaultRead.lockDuration(),
        ]);
        const linkedTreasury = typeof t === 'string' && t !== ZERO_ADDRESS ? t : null;
        const linkedEscrow = typeof e === 'string' && e !== ZERO_ADDRESS ? e : null;
        setVaultOnChainTreasury(linkedTreasury);
        setVaultOnChainEscrow(linkedEscrow);
        if (linkedTreasury) setVaultTreasuryInput(linkedTreasury);
        if (linkedEscrow) setVaultEscrowInput(linkedEscrow);
        const lockNum = Number(lockRaw ?? 0);
        if (Number.isFinite(lockNum) && lockNum > 0) {
          setLockDurationOnChainSeconds(lockNum);
          setLockDurationSeconds(lockNum);
        }
      } catch (error: any) {
        setVaultOnChainTreasury(null);
        setVaultOnChainEscrow(null);
        diagnostics.vault = formatError(error);
      }
      }
    } else {
      setVaultOnChainTreasury(null);
      setVaultOnChainEscrow(null);
      diagnostics.vault = 'Invalid Vault address';
    }

    if (isValidAddress(escrowAddr)) {
      const hasCode = await hasContractCode(escrowAddr);
      if (!hasCode) {
        setEscrowOnChainVault(null);
        setEscrowOnChainKeeper(null);
        setEscrowLastRollTime(null);
        diagnostics.escrow = `No contract bytecode at Escrow (${escrowAddr})`;
      } else {
      try {
        const escrowRead = new ethers.Contract(
          escrowAddr,
          ['function vault() view returns (address)', 'function keeper() view returns (address)', 'function lastBatchRollTime() view returns (uint256)'],
          provider
        );
        const [v, k, lastRollRaw] = await Promise.all([
          escrowRead.vault(),
          escrowRead.keeper(),
          escrowRead.lastBatchRollTime(),
        ]);
        const linkedVault = typeof v === 'string' && v !== ZERO_ADDRESS ? v : null;
        const linkedKeeper = typeof k === 'string' && k !== ZERO_ADDRESS ? k : null;
        setEscrowOnChainVault(linkedVault);
        setEscrowOnChainKeeper(linkedKeeper);
        if (linkedVault) setEscrowVaultInput(linkedVault);
        if (linkedKeeper) setEscrowKeeperInput(linkedKeeper);
        const lastRollSec = Number(lastRollRaw ?? 0);
        setEscrowLastRollTime(Number.isFinite(lastRollSec) && lastRollSec > 0 ? lastRollSec : null);
      } catch (error: any) {
        setEscrowOnChainVault(null);
        setEscrowOnChainKeeper(null);
        setEscrowLastRollTime(null);
        diagnostics.escrow = formatError(error);
      }
      }
    } else {
      setEscrowOnChainVault(null);
      setEscrowOnChainKeeper(null);
      setEscrowLastRollTime(null);
      diagnostics.escrow = 'Invalid Escrow address';
    }

    if (isValidAddress(reserveAddr)) {
      const hasCode = await hasContractCode(reserveAddr);
      if (!hasCode) {
        setReserveOnChainTreasury(null);
        diagnostics.reserve = `No contract bytecode at Reserve (${reserveAddr})`;
      } else {
      try {
        const reserveRead = new ethers.Contract(reserveAddr, ['function treasury() view returns (address)'], provider);
        const linked = await reserveRead.treasury();
        const linkedTreasury = typeof linked === 'string' && linked !== ZERO_ADDRESS ? linked : null;
        setReserveOnChainTreasury(linkedTreasury);
        if (linkedTreasury) setReserveTreasuryInput(linkedTreasury);
      } catch (error: any) {
        setReserveOnChainTreasury(null);
        diagnostics.reserve = formatError(error);
      }
      }
    } else {
      setReserveOnChainTreasury(null);
      diagnostics.reserve = 'Invalid Reserve address';
    }

    setReadDiagnostics(diagnostics);
  }

  function setAddressRuntime(
    key: 'Treasury' | 'Vault' | 'InvestmentEscrow' | 'ReserveController' | 'GoldOracle',
    input: string,
    onSuccess: (value: string) => void,
    setStatus: (msg: string) => void
  ) {
    const next = input.trim();
    if (!setRuntimeAddress(key, next)) {
      setStatus(`Invalid ${key} address`);
      return false;
    }
    onSuccess(next);
    setStatus(`Using ${key} ${next}`);
    return true;
  }

  function handleUseTreasuryAddress() {
    setAddressRuntime('Treasury', treasuryAddressInput, setTreasuryAddress, setTreasuryStatus);
  }
  function handleUseVaultAddress() {
    setAddressRuntime('Vault', vaultAddressInput, setVaultAddress, setVaultStatus);
  }
  function handleUseEscrowAddress() {
    setAddressRuntime('InvestmentEscrow', escrowAddressInput, setEscrowAddress, setEscrowStatus);
  }
  function handleUseReserveAddress() {
    setAddressRuntime('ReserveController', reserveAddressInput, setReserveAddress, setReserveStatus);
  }
  function handleUseGoldOracleAddress() {
    const ok = setAddressRuntime('GoldOracle', goldOracleAddressInput, setGoldOracleAddress, setTreasuryStatus);
    if (ok) setReserveStatus(`Using GoldOracle ${goldOracleAddressInput.trim()}`);
  }

  function handleLoadGeneratedAddresses() {
    if (vaultPaused) {
      setConfigStatus('Protocol is paused. Local config actions are disabled until resume.');
      return;
    }
    const nextTreasury = getDefaultAddress('Treasury');
    const nextVault = getDefaultAddress('Vault');
    const nextEscrow = getDefaultAddress('InvestmentEscrow');
    const nextReserve = getDefaultAddress('ReserveController');
    const nextGoldOracle = getDefaultAddress('GoldOracle');

    loadGeneratedRuntimeAddresses();

    setTreasuryAddress(nextTreasury);
    setVaultAddress(nextVault);
    setEscrowAddress(nextEscrow);
    setReserveAddress(nextReserve);
    setGoldOracleAddress(nextGoldOracle);

    setTreasuryAddressInput(nextTreasury);
    setVaultAddressInput(nextVault);
    setEscrowAddressInput(nextEscrow);
    setReserveAddressInput(nextReserve);
    setGoldOracleAddressInput(nextGoldOracle);
    setEscrowKeeperInput(nextTreasury);

    setConfigStatus('Loaded generated addresses from addresses.ts and updated runtime address book');
    refreshConfigState({
      treasuryAddress: nextTreasury,
      vaultAddress: nextVault,
      escrowAddress: nextEscrow,
      reserveAddress: nextReserve,
    }).catch(() => {
      // diagnostics UI will surface read errors if any
    });
  }

  function handleSaveAddressBook() {
    if (vaultPaused) {
      setConfigStatus('Protocol is paused. Local config actions are disabled until resume.');
      return;
    }
    const nextTreasury = treasuryAddressInput.trim();
    const nextVault = vaultAddressInput.trim();
    const nextEscrow = escrowAddressInput.trim();
    const nextReserve = reserveAddressInput.trim();
    const nextGoldOracle = goldOracleAddressInput.trim();
    const nextKeeper = escrowKeeperInput.trim();

    if (!isValidAddress(nextTreasury)) {
      setConfigStatus('Invalid Treasury address');
      return;
    }
    if (!isValidAddress(nextVault)) {
      setConfigStatus('Invalid Vault address');
      return;
    }
    if (!isValidAddress(nextEscrow)) {
      setConfigStatus('Invalid Escrow address');
      return;
    }
    if (!isValidAddress(nextReserve)) {
      setConfigStatus('Invalid Reserve address');
      return;
    }
    if (!isValidAddress(nextGoldOracle)) {
      setConfigStatus('Invalid GoldOracle address');
      return;
    }
    if (!isValidAddress(nextKeeper)) {
      setConfigStatus('Invalid Escrow keeper address');
      return;
    }

    setRuntimeAddress('Treasury', nextTreasury);
    setRuntimeAddress('Vault', nextVault);
    setRuntimeAddress('InvestmentEscrow', nextEscrow);
    setRuntimeAddress('ReserveController', nextReserve);
    setRuntimeAddress('GoldOracle', nextGoldOracle);

    setTreasuryAddress(nextTreasury);
    setVaultAddress(nextVault);
    setEscrowAddress(nextEscrow);
    setReserveAddress(nextReserve);
    setGoldOracleAddress(nextGoldOracle);

    setTreasuryVaultInput(nextVault);
    setTreasuryEscrowInput(nextEscrow);
    setTreasuryReserveInput(nextReserve);
    setVaultTreasuryInput(nextTreasury);
    setVaultEscrowInput(nextEscrow);
    setEscrowVaultInput(nextVault);
    setReserveTreasuryInput(nextTreasury);
    setEscrowKeeperInput(nextKeeper);

    setConfigStatus('Address book updated');
  }

  function queueProposal(
    action: ProposalAction,
    title: string,
    summary: string,
    payload?: Record<string, any>
  ) {
    const proposer = isValidAddress(address) ? address : ethers.ZeroAddress;
    const initialApprovals = canApproveAsActualSigner && isValidAddress(proposer) ? [proposer] : [];
    const proposal: DaoProposal = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      title,
      summary,
      createdAt: Date.now(),
      createdBy: proposer,
      approvals: dedupeAddresses(initialApprovals),
      status: 'pending',
      payload,
    };
    setGovernanceProposals(prev => [proposal, ...prev].slice(0, 80));
    return proposal;
  }

  function handleApproveProposal(proposalId: string) {
    if (!canApproveAsActualSigner || !isValidAddress(address)) {
      setConfigStatus(daoCouncil.length === 0 ? 'Only the contract owner can approve proposals' : 'Only DAO council members can approve proposals');
      return;
    }
    const proposal = governanceProposals.find(item => item.id === proposalId);
    if (vaultPaused && !isResumeProposal(proposal)) {
      setConfigStatus('Protocol is paused. Only resume proposals can be approved while paused.');
      return;
    }
    setGovernanceProposals(prev =>
      prev.map(p => {
        if (p.id !== proposalId || p.status !== 'pending') return p;
        const approvals = dedupeAddresses([...(p.approvals || []), address]);
        return { ...p, approvals };
      })
    );
    setConfigStatus(`Proposal ${proposalId} approved by ${formatAddressShort(address)}`);
  }

  async function executeProposal(proposal: DaoProposal) {
    if (proposal.status !== 'pending') return;
    if (vaultPaused && !isResumeProposal(proposal)) {
      setConfigStatus('Protocol is paused. Only resume proposals can execute while paused.');
      return;
    }
    if ((proposal.approvals || []).length < requiredProposalApprovals) {
      setConfigStatus(
        daoCouncil.length === 0
          ? `Proposal requires ${requiredProposalApprovals} owner approval(s)`
          : `Proposal requires ${requiredProposalApprovals} council approval(s)`
      );
      return;
    }

    setProposalExecId(proposal.id);
    try {
      let ok = false;
      let failureReason = 'Execution failed. Check DAO status logs for details.';
      try {
        if (proposal.action === 'APPLY_ALL_LINKS') {
          ok = await handleApplyAllLinks(true, proposal.payload);
        } else if (proposal.action === 'SET_VAULT_LOCK_DURATION') {
          ok = await handleSetVaultLockDuration(true, proposal.payload);
        } else if (proposal.action === 'SAVE_BATCH_CADENCE') {
          ok = handleSaveBatchCadence(true, proposal.payload);
        } else if (proposal.action === 'TOGGLE_VAULT_PAUSE') {
          ok = await handlePauseToggle(true, proposal.payload);
        } else if (proposal.action === 'TRANSFER_OWNERSHIP') {
          ok = await handleTransferOwnership(true, proposal.payload);
        } else if (proposal.action === 'SET_GOLD_PRICE') {
          ok = await handleSetGoldPrice(true, proposal.payload);
        } else if (proposal.action === 'REBALANCE_TREASURY') {
          ok = await handleTreasuryRebalance(true);
        } else if (proposal.action === 'PAY_RECEIPT_PROFIT') {
          ok = await handlePayReceiptProfit(true, proposal.payload);
        } else if (proposal.action === 'ADD_PORTFOLIO_ASSET') {
          ok = await handleAddPortfolioAsset(true, proposal.payload);
        } else if (proposal.action === 'UPDATE_PORTFOLIO_ASSET') {
          ok = await handleUpdatePortfolioAsset(true, proposal.payload);
        } else if (proposal.action === 'REMOVE_PORTFOLIO_ASSET') {
          ok = await handleRemovePortfolioAsset(true, proposal.payload);
        }
      } catch (error: any) {
        failureReason = formatError(error);
        ok = false;
      }

      setGovernanceProposals(prev =>
        prev.map(p =>
          p.id === proposal.id
            ? {
                ...p,
                status: ok ? 'executed' : 'failed',
                executedAt: Date.now(),
                error: ok ? undefined : failureReason,
              }
            : p
        )
      );
      setConfigStatus(ok ? `Executed proposal ${proposal.id}` : `Proposal ${proposal.id} failed: ${failureReason}`);
    } finally {
      setProposalExecId(null);
    }
  }

  async function handleApplyAllLinks(
    bypassProposal = false,
    payload?: {
      treasuryAddress?: string;
      vaultAddress?: string;
      escrowAddress?: string;
      reserveAddress?: string;
      keeperAddress?: string;
    }
  ): Promise<boolean> {
    if (vaultPaused) {
      setConfigStatus('Protocol is paused. Only resume action is available.');
      return false;
    }
    let nextTreasury = payload?.treasuryAddress?.trim() ?? treasuryAddressInput.trim();
    let nextVault = payload?.vaultAddress?.trim() ?? vaultAddressInput.trim();
    let nextEscrow = payload?.escrowAddress?.trim() ?? escrowAddressInput.trim();
    let nextReserve = payload?.reserveAddress?.trim() ?? reserveAddressInput.trim();
    let nextKeeper = payload?.keeperAddress?.trim() ?? escrowKeeperInput.trim();

    if (!isValidAddress(nextTreasury) || !isValidAddress(nextVault) || !isValidAddress(nextEscrow) || !isValidAddress(nextReserve) || !isValidAddress(nextKeeper)) {
      setConfigStatus('One or more addresses are invalid');
      return false;
    }

    if (!bypassProposal) {
      const proposal = queueProposal(
        'APPLY_ALL_LINKS',
        'Apply Protocol Links',
        `Link Treasury/Vault/Escrow/Reserve using ${formatAddressShort(nextTreasury)} as core treasury.`,
        {
          treasuryAddress: nextTreasury,
          vaultAddress: nextVault,
          escrowAddress: nextEscrow,
          reserveAddress: nextReserve,
          keeperAddress: nextKeeper,
        }
      );
      setConfigStatus(
        `Proposal queued (${proposal.id}). ${proposal.approvals.length}/${requiredProposalApprovals} approval(s).`
      );
      return true;
    }

    setConfigBusy(true);
    setLinkStepResults([]);
    setReadDiagnostics({ treasury: null, vault: null, escrow: null, reserve: null });
    setConfigStatus('Applying runtime addresses and linking contracts...');
    try {
      handleSaveAddressBook();
      const signer = await getWriteSigner();
      const signerAddress = await signer.getAddress();
      const network = await signer.provider?.getNetwork();
      setLinkRunContext(`Signer ${formatAddressShort(signerAddress)} on chain ${network ? Number(network.chainId) : 'unknown'}`);
      const results: LinkStepResult[] = [];
      let nextNonce = await signer.provider?.getTransactionCount(signerAddress, 'pending');
      if (!Number.isFinite(nextNonce)) {
        throw new Error('Unable to resolve signer nonce');
      }

      const preflightTargets: Array<{ label: string; address: string }> = [
        { label: 'Treasury', address: nextTreasury },
        { label: 'Vault', address: nextVault },
        { label: 'Escrow', address: nextEscrow },
        { label: 'Reserve', address: nextReserve },
      ];
      for (const target of preflightTargets) {
        const code = await signer.provider?.getCode(target.address);
        if (!code || code === '0x') {
          results.push({
            step: `Preflight ${target.label}`,
            ok: false,
            error: `No contract bytecode at ${target.address}`,
          });
        }
      }
      if (results.some(r => !r.ok)) {
        const allNoCode = results.every(r => !r.ok && (r.error || '').includes('No contract bytecode'));
        if (allNoCode) {
          const generatedTreasury = getDefaultAddress('Treasury');
          const generatedVault = getDefaultAddress('Vault');
          const generatedEscrow = getDefaultAddress('InvestmentEscrow');
          const generatedReserve = getDefaultAddress('ReserveController');

          const generatedTargets: Array<{ label: string; address: string }> = [
            { label: 'Treasury', address: generatedTreasury },
            { label: 'Vault', address: generatedVault },
            { label: 'Escrow', address: generatedEscrow },
            { label: 'Reserve', address: generatedReserve },
          ];
          const generatedHasCode: boolean[] = [];
          for (const target of generatedTargets) {
            const code = await signer.provider?.getCode(target.address);
            generatedHasCode.push(!!code && code !== '0x');
          }

          const canUseGenerated = generatedHasCode.every(Boolean);
          const generatedDiffers =
            generatedTreasury.toLowerCase() !== nextTreasury.toLowerCase() ||
            generatedVault.toLowerCase() !== nextVault.toLowerCase() ||
            generatedEscrow.toLowerCase() !== nextEscrow.toLowerCase() ||
            generatedReserve.toLowerCase() !== nextReserve.toLowerCase();

          if (canUseGenerated && generatedDiffers) {
            loadGeneratedRuntimeAddresses();

            nextTreasury = generatedTreasury;
            nextVault = generatedVault;
            nextEscrow = generatedEscrow;
            nextReserve = generatedReserve;
            nextKeeper = generatedTreasury;

            setTreasuryAddress(nextTreasury);
            setVaultAddress(nextVault);
            setEscrowAddress(nextEscrow);
            setReserveAddress(nextReserve);

            setTreasuryAddressInput(nextTreasury);
            setVaultAddressInput(nextVault);
            setEscrowAddressInput(nextEscrow);
            setReserveAddressInput(nextReserve);
            setEscrowKeeperInput(nextKeeper);

            setTreasuryVaultInput(nextVault);
            setTreasuryEscrowInput(nextEscrow);
            setTreasuryReserveInput(nextReserve);
            setVaultTreasuryInput(nextTreasury);
            setVaultEscrowInput(nextEscrow);
            setEscrowVaultInput(nextVault);
            setReserveTreasuryInput(nextTreasury);

            setLinkStepResults([
              ...results,
              {
                step: 'Address book reset',
                ok: true,
                error: 'Loaded generated deployed localhost addresses from addresses.ts',
              },
            ]);
            setConfigStatus(
              'Current address book had no deployed contracts. Loaded generated deployed addresses; click "Propose Apply + Link" again.'
            );
            await refreshConfigState({
              treasuryAddress: nextTreasury,
              vaultAddress: nextVault,
              escrowAddress: nextEscrow,
              reserveAddress: nextReserve,
            });
            return false;
          }
        }
        setLinkStepResults(results);
        setConfigStatus(
          allNoCode
            ? 'Preflight failed: no deployed contracts found on this chain. Run `npx hardhat run scripts/deploy.ts --network localhost`, then reload and click Refresh On-Chain.'
            : 'Preflight failed: one or more addresses are not deployed contracts'
        );
        await refreshConfigState({
          treasuryAddress: nextTreasury,
          vaultAddress: nextVault,
          escrowAddress: nextEscrow,
          reserveAddress: nextReserve,
        });
        return false;
      }

      const runStep = async (step: string, fn: (nonce: number) => Promise<any>) => {
        try {
          const nonceToUse = Number(nextNonce);
          const tx = await fn(nonceToUse);
          nextNonce = nonceToUse + 1;
          await tx.wait();
          results.push({ step, ok: true, txHash: tx?.hash ? String(tx.hash) : undefined });
        } catch (e: any) {
          const errMsg = formatError(e);
          if (/nonce/i.test(errMsg)) {
            try {
              const refreshed = await signer.provider?.getTransactionCount(signerAddress, 'pending');
              if (Number.isFinite(refreshed)) nextNonce = Number(refreshed);
            } catch {
              // keep previous nonce if refresh fails
            }
          }
          results.push({ step, ok: false, error: errMsg });
        }
      };

      const treasuryWrite = new ethers.Contract(
        nextTreasury,
        ['function setVault(address _vault) external', 'function setEscrow(address _escrow) external', 'function setReserveAddress(address _reserve) external'],
        signer
      );
      const vaultWrite = new ethers.Contract(
        nextVault,
        ['function setTreasury(address _treasury) external', 'function setEscrow(address _escrow) external'],
        signer
      );
      const escrowWrite = new ethers.Contract(
        nextEscrow,
        ['function setVault(address _vault) external', 'function setKeeper(address _keeper) external'],
        signer
      );
      const reserveWrite = new ethers.Contract(
        nextReserve,
        ['function setTreasury(address _treasury) external'],
        signer
      );

      await runStep('Treasury -> Vault', (nonce) => treasuryWrite.setVault(nextVault, { nonce }));
      await runStep('Treasury -> Escrow', (nonce) => treasuryWrite.setEscrow(nextEscrow, { nonce }));
      await runStep('Treasury -> Reserve', (nonce) => treasuryWrite.setReserveAddress(nextReserve, { nonce }));
      await runStep('Vault -> Treasury', (nonce) => vaultWrite.setTreasury(nextTreasury, { nonce }));
      await runStep('Vault -> Escrow', (nonce) => vaultWrite.setEscrow(nextEscrow, { nonce }));
      await runStep('Escrow -> Vault', (nonce) => escrowWrite.setVault(nextVault, { nonce }));
      await runStep('Escrow Keeper', (nonce) => escrowWrite.setKeeper(nextKeeper, { nonce }));
      await runStep('Reserve -> Treasury', (nonce) => reserveWrite.setTreasury(nextTreasury, { nonce }));

      setLinkStepResults(results);
      await refreshConfigState({
        treasuryAddress: nextTreasury,
        vaultAddress: nextVault,
        escrowAddress: nextEscrow,
        reserveAddress: nextReserve,
      });
      const failed = results.filter(r => !r.ok);
      if (failed.length === 0) {
        setConfigStatus('All contract links updated');
        return true;
      } else {
        const failedSummary = failed.map(f => `${f.step}`).join(', ');
        setConfigStatus(`Linked with ${failed.length} issue(s): ${failedSummary}`);
        return false;
      }
    } catch (e: any) {
      setConfigStatus(`Apply failed: ${formatError(e)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetTreasuryVaultLink() {
    if (!isValidAddress(treasuryAddress) || !isValidAddress(treasuryVaultInput.trim())) {
      setTreasuryStatus('Invalid Treasury or Vault address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextVault = treasuryVaultInput.trim();
      const c = new ethers.Contract(treasuryAddress, ['function setVault(address _vault) external'], await getWriteSigner());
      const tx = await c.setVault(nextVault);
      await tx.wait();
      setRuntimeAddress('Vault', nextVault);
      setVaultAddress(nextVault);
      setTreasuryStatus('Treasury -> Vault linked');
      await refreshConfigState();
    } catch (e: any) {
      setTreasuryStatus(`Vault link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetTreasuryEscrowLink() {
    if (!isValidAddress(treasuryAddress) || !isValidAddress(treasuryEscrowInput.trim())) {
      setTreasuryStatus('Invalid Treasury or Escrow address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextEscrow = treasuryEscrowInput.trim();
      const c = new ethers.Contract(treasuryAddress, ['function setEscrow(address _escrow) external'], await getWriteSigner());
      const tx = await c.setEscrow(nextEscrow);
      await tx.wait();
      setRuntimeAddress('InvestmentEscrow', nextEscrow);
      setEscrowAddress(nextEscrow);
      setTreasuryStatus('Treasury -> Escrow linked');
      await refreshConfigState();
    } catch (e: any) {
      setTreasuryStatus(`Escrow link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetTreasuryReserveLink() {
    if (!isValidAddress(treasuryAddress) || !isValidAddress(treasuryReserveInput.trim())) {
      setTreasuryStatus('Invalid Treasury or Reserve address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextReserve = treasuryReserveInput.trim();
      const c = new ethers.Contract(treasuryAddress, ['function setReserveAddress(address _reserve) external'], await getWriteSigner());
      const tx = await c.setReserveAddress(nextReserve);
      await tx.wait();
      setRuntimeAddress('ReserveController', nextReserve);
      setReserveAddress(nextReserve);
      setTreasuryStatus('Treasury -> Reserve linked');
      await refreshConfigState();
    } catch (e: any) {
      setTreasuryStatus(`Reserve link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetVaultTreasuryLink() {
    if (!isValidAddress(vaultAddress) || !isValidAddress(vaultTreasuryInput.trim())) {
      setVaultStatus('Invalid Vault or Treasury address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextTreasury = vaultTreasuryInput.trim();
      const c = new ethers.Contract(vaultAddress, ['function setTreasury(address _treasury) external'], await getWriteSigner());
      const tx = await c.setTreasury(nextTreasury);
      await tx.wait();
      setRuntimeAddress('Treasury', nextTreasury);
      setTreasuryAddress(nextTreasury);
      setVaultStatus('Vault -> Treasury linked');
      await refreshConfigState();
    } catch (e: any) {
      setVaultStatus(`Treasury link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetVaultEscrowLink() {
    if (!isValidAddress(vaultAddress) || !isValidAddress(vaultEscrowInput.trim())) {
      setVaultStatus('Invalid Vault or Escrow address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextEscrow = vaultEscrowInput.trim();
      const c = new ethers.Contract(vaultAddress, ['function setEscrow(address _escrow) external'], await getWriteSigner());
      const tx = await c.setEscrow(nextEscrow);
      await tx.wait();
      setRuntimeAddress('InvestmentEscrow', nextEscrow);
      setEscrowAddress(nextEscrow);
      setVaultStatus('Vault -> Escrow linked');
      await refreshConfigState();
    } catch (e: any) {
      setVaultStatus(`Escrow link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetVaultLockDuration(
    bypassProposal = false,
    payload?: { lockDurationSeconds?: number }
  ): Promise<boolean> {
    if (vaultPaused) {
      setVaultStatus('Protocol is paused. Lock-duration changes are disabled.');
      return false;
    }
    const nextDuration = Number(payload?.lockDurationSeconds ?? lockDurationSeconds);
    if (!isValidAddress(vaultAddress)) {
      setVaultStatus('Invalid Vault address');
      return false;
    }
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
      setVaultStatus('Invalid lock duration');
      return false;
    }
    if (!bypassProposal) {
      const proposal = queueProposal(
        'SET_VAULT_LOCK_DURATION',
        'Set Vault Unlock Duration',
        `Set Vault default lock duration to ${formatSecondsLabel(nextDuration)}.`,
        { lockDurationSeconds: nextDuration }
      );
      setVaultStatus(`Proposal queued (${proposal.id})`);
      return true;
    }
    try {
      setConfigBusy(true);
      const c = new ethers.Contract(vaultAddress, ['function setLockDuration(uint64 _duration) external'], await getWriteSigner());
      const tx = await c.setLockDuration(BigInt(nextDuration));
      await tx.wait();
      setLockDurationSeconds(nextDuration);
      setLockDurationOnChainSeconds(nextDuration);
      setVaultStatus(`Lock duration updated to ${formatSecondsLabel(nextDuration)}`);
      await refreshConfigState();
      return true;
    } catch (e: any) {
      setVaultStatus(`Lock update failed: ${String(e?.message || e)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetEscrowVaultLink() {
    if (!isValidAddress(escrowAddress) || !isValidAddress(escrowVaultInput.trim())) {
      setEscrowStatus('Invalid Escrow or Vault address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextVault = escrowVaultInput.trim();
      const c = new ethers.Contract(escrowAddress, ['function setVault(address _vault) external'], await getWriteSigner());
      const tx = await c.setVault(nextVault);
      await tx.wait();
      setRuntimeAddress('Vault', nextVault);
      setVaultAddress(nextVault);
      setEscrowStatus('Escrow -> Vault linked');
      await refreshConfigState();
    } catch (e: any) {
      setEscrowStatus(`Vault link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetEscrowKeeper() {
    if (!isValidAddress(escrowAddress) || !isValidAddress(escrowKeeperInput.trim())) {
      setEscrowStatus('Invalid Escrow or Keeper address');
      return;
    }
    try {
      setConfigBusy(true);
      const c = new ethers.Contract(escrowAddress, ['function setKeeper(address _keeper) external'], await getWriteSigner());
      const tx = await c.setKeeper(escrowKeeperInput.trim());
      await tx.wait();
      setEscrowStatus('Escrow keeper updated');
      await refreshConfigState();
    } catch (e: any) {
      setEscrowStatus(`Keeper update failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleSetReserveTreasuryLink() {
    if (!isValidAddress(reserveAddress) || !isValidAddress(reserveTreasuryInput.trim())) {
      setReserveStatus('Invalid ReserveController or Treasury address');
      return;
    }
    try {
      setConfigBusy(true);
      const nextTreasury = reserveTreasuryInput.trim();
      const c = new ethers.Contract(reserveAddress, ['function setTreasury(address _treasury) external'], await getWriteSigner());
      const tx = await c.setTreasury(nextTreasury);
      await tx.wait();
      setRuntimeAddress('Treasury', nextTreasury);
      setTreasuryAddress(nextTreasury);
      setReserveStatus('Reserve -> Treasury linked');
      await refreshConfigState();
    } catch (e: any) {
      setReserveStatus(`Treasury link failed: ${String(e?.message || e)}`);
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleAdvanceLocalTime(seconds: number, label: string) {
    if (vaultPaused) {
      setTimeStatus('Protocol is paused. Local time controls are disabled.');
      return;
    }
    if (!provider) return;
    try {
      setTimeControlLoading(true);
      setTimeStatus(null);
      const network = await provider.getNetwork();
      const chainIdNum = Number(network.chainId);
      const rpcLooksLocal = LOCALHOST_RPC.includes('localhost') || LOCALHOST_RPC.includes('127.0.0.1');
      if (!rpcLooksLocal || !LOCAL_CHAIN_IDS.has(chainIdNum)) {
        setTimeStatus(`Skipped ${label}: active network is not localhost`);
        return;
      }
      await provider.send('evm_increaseTime', [seconds]);
      await provider.send('evm_mine', []);
      await refreshConfigState();
      setTimeStatus(`Time advanced by ${label}`);
    } catch (e: any) {
      setTimeStatus(`Error advancing time (${label}): ${String(e?.message || e)}`);
    } finally {
      setTimeControlLoading(false);
    }
  }

  function handleSaveBatchCadence(
    bypassProposal = false,
    payload?: { batchCadenceSeconds?: number }
  ): boolean {
    if (vaultPaused) {
      setTimeStatus('Protocol is paused. Batch timing changes are disabled.');
      return false;
    }
    const nextCadence = Number(payload?.batchCadenceSeconds ?? batchCadenceSeconds);
    if (!Number.isFinite(nextCadence) || nextCadence <= 0) {
      setTimeStatus('Invalid batch cadence');
      return false;
    }
    if (!bypassProposal) {
      const proposal = queueProposal(
        'SAVE_BATCH_CADENCE',
        'Update Batch Timing',
        `Set batch cadence to ${formatSecondsLabel(nextCadence)}.`,
        { batchCadenceSeconds: nextCadence }
      );
      setTimeStatus(`Proposal queued (${proposal.id})`);
      return true;
    }
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(BATCH_CADENCE_KEY, String(nextCadence));
      }
      setBatchCadenceSeconds(nextCadence);
      setTimeStatus(`Batch cadence updated to ${formatSecondsLabel(nextCadence)}`);
      return true;
    } catch (e: any) {
      setTimeStatus(`Error saving cadence: ${String(e?.message || e)}`);
      return false;
    }
  }

  const handlePauseToggle = async (
    bypassProposal = false,
    payload?: { targetPaused?: boolean }
  ): Promise<boolean> => {
    const targetPaused = typeof payload?.targetPaused === 'boolean' ? payload.targetPaused : !vaultPaused;
    if (!bypassProposal) {
      const proposal = queueProposal(
        'TOGGLE_VAULT_PAUSE',
        targetPaused ? 'Pause Vault Operations' : 'Resume Vault Operations',
        targetPaused ? 'Pause new vault operations until owners resume protocol.' : 'Resume vault operations after pause.',
        { targetPaused }
      );
      setConfigStatus(`Proposal queued (${proposal.id})`);
      return true;
    }
    setLoading(true);
    try {
      const vault = await getContract('vault') as any;
      const tx = targetPaused ? await vault.pause() : await vault.unpause();
      await tx.wait();
      setVaultPaused(targetPaused);
      emitUiRefresh(targetPaused ? 'dao:pause' : 'dao:resume');
      setConfigStatus(targetPaused ? 'Vault operations paused' : 'Vault operations resumed');
      return true;
    } catch (error: any) {
      setConfigStatus(error?.reason || error?.message || 'Failed to toggle pause');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleTransferOwnership = async (
    bypassProposal = false,
    payload?: { newOwner?: string }
  ): Promise<boolean> => {
    if (!isActualOwner) {
      setConfigStatus('Only the contract owner can transfer ownership');
      return false;
    }
    if (vaultPaused) {
      setConfigStatus('Protocol is paused. Ownership transfer is disabled until resume.');
      return false;
    }
    const targetOwner = (payload?.newOwner ?? newOwner).trim();
    if (!targetOwner || !ethers.isAddress(targetOwner)) {
      setConfigStatus('Invalid owner address');
      return false;
    }
    if (!bypassProposal) {
      const proposal = queueProposal(
        'TRANSFER_OWNERSHIP',
        'Transfer Protocol Ownership',
        `Transfer ownership to ${formatAddressShort(targetOwner)}.`,
        { newOwner: targetOwner }
      );
      setConfigStatus(`Proposal queued (${proposal.id})`);
      return true;
    }
    setLoading(true);
    try {
      const vault = await getContract('vault') as any;
      const tx = await vault.transferOwnership(targetOwner);
      await tx.wait();
      setAdminAddresses([targetOwner]);
      setNewOwner('');
      setConfigStatus(`Ownership transferred to ${formatAddressShort(targetOwner)}`);
      return true;
    } catch (error: any) {
      setConfigStatus(error?.reason || error?.message || 'Failed to transfer ownership');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSetGoldPrice = async (
    bypassProposal = false,
    payload?: { goldPriceUsd?: number | string }
  ): Promise<boolean> => {
    if (vaultPaused) {
      setTreasuryControlStatus('Protocol is paused. Treasury control proposals are disabled.');
      return false;
    }
    const rawValue = String(payload?.goldPriceUsd ?? treasuryGoldPriceInput).trim();
    const nextPriceUsd = Number(rawValue);

    if (!Number.isFinite(nextPriceUsd) || nextPriceUsd <= 0) {
      setTreasuryControlStatus('Invalid gold price input');
      return false;
    }
    if (!isValidAddress(goldOracleAddress)) {
      setTreasuryControlStatus('Invalid GoldOracle address');
      return false;
    }

    if (!bypassProposal) {
      if (!isOp) {
        setTreasuryControlStatus('Only operators can propose treasury write actions');
        return false;
      }
      const proposal = queueProposal(
        'SET_GOLD_PRICE',
        'Update Gold Oracle Price',
        `Set the Treasury/Reserve gold oracle to $${nextPriceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        { goldPriceUsd: nextPriceUsd }
      );
      setTreasuryControlStatus(`Proposal queued (${proposal.id})`);
      return true;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const oracleWrite = new ethers.Contract(
        goldOracleAddress,
        ['function setPrice(uint256 price) external', 'function setGoldPrice(uint256 price) external'],
        signer
      );
      const price8 = BigInt(Math.round(nextPriceUsd * 1e8));
      let tx;
      try {
        tx = await oracleWrite.setPrice(price8);
      } catch {
        tx = await oracleWrite.setGoldPrice(price8);
      }
      await tx.wait();
      setTreasuryGoldPriceInput('');
      setTreasuryControlStatus(`Gold oracle price set to $${nextPriceUsd.toLocaleString()} (tx=${tx.hash})`);
      await refreshConfigState();
      return true;
    } catch (error: any) {
      setTreasuryControlStatus(`Gold price proposal execution failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const handleTreasuryRebalance = async (bypassProposal = false): Promise<boolean> => {
    if (vaultPaused) {
      setTreasuryControlStatus('Protocol is paused. Treasury control proposals are disabled.');
      return false;
    }
    if (!isValidAddress(treasuryAddress)) {
      setTreasuryControlStatus('Invalid Treasury address');
      return false;
    }

    if (!bypassProposal) {
      if (!isOp) {
        setTreasuryControlStatus('Only operators can propose treasury write actions');
        return false;
      }
      const proposal = queueProposal(
        'REBALANCE_TREASURY',
        'Rebalance Treasury Reserve',
        'Execute Treasury.rebalanceReserve() using the current reserve and pricing state.'
      );
      setTreasuryControlStatus(`Proposal queued (${proposal.id})`);
      return true;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const treasuryWrite = new ethers.Contract(
        treasuryAddress,
        ['function rebalanceReserve() external'],
        signer
      );
      const tx = await treasuryWrite.rebalanceReserve();
      await tx.wait();
      setTreasuryControlStatus(`Treasury rebalance executed (tx=${tx.hash})`);
      await refreshConfigState();
      return true;
    } catch (error: any) {
      setTreasuryControlStatus(`Treasury rebalance failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const handlePayReceiptProfit = async (
    bypassProposal = false,
    payload?: { receiptId?: number | string; amountUsd?: string }
  ): Promise<boolean> => {
    if (vaultPaused) {
      setTreasuryControlStatus('Protocol is paused. Treasury control proposals are disabled.');
      return false;
    }
    const receiptId = Number(payload?.receiptId ?? profitReceiptIdInput);
    const manualAmount = String(payload?.amountUsd ?? profitAmountUsdInput ?? '').trim();

    if (!Number.isInteger(receiptId) || receiptId < 0) {
      setTreasuryControlStatus('Invalid receipt id');
      return false;
    }
    if (!isValidAddress(treasuryAddress)) {
      setTreasuryControlStatus('Invalid Treasury address');
      return false;
    }
    if (manualAmount) {
      const usd6 = parseUsdInputToUsd6(manualAmount);
      if (usd6 === null || usd6 <= BigInt(0)) {
        setTreasuryControlStatus('Invalid manual USD amount');
        return false;
      }
    }

    if (!bypassProposal) {
      if (!isOp) {
        setTreasuryControlStatus('Only operators can propose treasury write actions');
        return false;
      }
      const proposal = queueProposal(
        'PAY_RECEIPT_PROFIT',
        manualAmount ? 'Manual Receipt Profit Payout' : 'Pay Exact Receipt Profit',
        manualAmount
          ? `Pay receipt #${receiptId} a manual Treasury profit override of ${manualAmount} USD.`
          : `Pay the exact unpaid Treasury profit for receipt #${receiptId}.`,
        {
          receiptId,
          amountUsd: manualAmount || undefined,
        }
      );
      setTreasuryControlStatus(`Proposal queued (${proposal.id})`);
      return true;
    }

    if (!provider) {
      setTreasuryControlStatus('Local RPC provider not ready');
      return false;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const treasuryRead = new ethers.Contract(
        treasuryAddress,
        ['function previewReceiptProfitUsd(uint256 receiptId) external view returns (uint256 batchId,uint256 dueUsd,uint256 alreadyPaidUsd,uint256 unpaidUsd,address recipient)'],
        provider
      );
      const treasuryWrite = new ethers.Contract(
        treasuryAddress,
        [
          'function payReceiptProfit(uint256 receiptId) external',
          'function payProfitToReceiptOwner(uint256 receiptId, uint256 amountUsd) external',
        ],
        signer
      );

      const preview = await treasuryRead.previewReceiptProfitUsd(BigInt(receiptId));
      const batchId = BigInt(preview?.batchId ?? preview?.[0] ?? 0);
      const dueUsd = BigInt(preview?.dueUsd ?? preview?.[1] ?? 0);
      const alreadyPaidUsd = BigInt(preview?.alreadyPaidUsd ?? preview?.[2] ?? 0);
      const unpaidUsd = BigInt(preview?.unpaidUsd ?? preview?.[3] ?? 0);
      const recipient = String(preview?.recipient ?? preview?.[4] ?? '');

      if (manualAmount) {
        const usd6 = parseUsdInputToUsd6(manualAmount);
        if (usd6 === null || usd6 <= BigInt(0)) {
          setTreasuryControlStatus('Invalid manual USD amount');
          return false;
        }
        const tx = await treasuryWrite.payProfitToReceiptOwner(BigInt(receiptId), usd6);
        await tx.wait();
        setProfitReceiptIdInput('');
        setProfitAmountUsdInput('');
        setTreasuryControlStatus(
          `Manual profit paid to receipt #${receiptId}: ${formatUsd(usd6, 6)} recipient=${recipient || 'n/a'} (tx=${tx.hash})`
        );
        return true;
      }

      if (unpaidUsd <= BigInt(0)) {
        setTreasuryControlStatus(
          `No unpaid profit for receipt #${receiptId} (batch=${batchId.toString()}, due=${formatUsd(dueUsd, 6)}, paid=${formatUsd(alreadyPaidUsd, 6)})`
        );
        return false;
      }

      const tx = await treasuryWrite.payReceiptProfit(BigInt(receiptId));
      await tx.wait();
      setProfitReceiptIdInput('');
      setProfitAmountUsdInput('');
      setTreasuryControlStatus(
        `Exact profit paid to receipt #${receiptId}: ${formatUsd(unpaidUsd, 6)} recipient=${recipient || 'n/a'} batch=${batchId.toString()} (tx=${tx.hash})`
      );
      return true;
    } catch (error: any) {
      setTreasuryControlStatus(`Receipt profit payout failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const refreshPortfolioState = async () => {
    if (!provider || !isValidAddress(portfolioRegistryAddress)) {
      setPortfolioAssets([]);
      return;
    }
    setPortfolioLoading(true);
    try {
      const registry = new ethers.Contract(portfolioRegistryAddress, PORTFOLIO_REGISTRY_ABI, provider);
      const raw = await registry.getAllAssets();
      setPortfolioAssets(
        raw.map((a: any) => ({
          symbol:    String(a.symbol ?? a[0] ?? ''),
          name:      String(a.name   ?? a[1] ?? ''),
          token:     String(a.token  ?? a[2] ?? ''),
          oracle:    String(a.oracle ?? a[3] ?? ''),
          riskClass: Number(a.riskClass ?? a[4] ?? 0),
          role:      Number(a.role      ?? a[5] ?? 0),
          minimumInvestmentUsd6: BigInt(a.minimumInvestmentUsd6 ?? a[6] ?? 0),
          addedAt:   Number(a.addedAt   ?? a[7] ?? 0),
        }))
      );
    } catch {
      setPortfolioAssets([]);
    } finally {
      setPortfolioLoading(false);
    }
  };

  const refreshPortfolioAssetHistory = async () => {
    try {
      const response = await fetch('/api/banking/escrow/asset-history');
      const payload = await response.json().catch(() => null);
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      setPortfolioAssetHistory(rows);
    } catch {
      setPortfolioAssetHistory([]);
    }
  };

  const handleAddPortfolioAsset = async (
    bypassProposal = false,
    payload?: {
      symbol?: string;
      name?: string;
      token?: string;
      oracle?: string;
      riskClass?: number;
      role?: number;
      minimumInvestmentUsd6?: string | number;
    }
  ): Promise<boolean> => {
    const symbol    = (payload?.symbol ?? newAssetSymbol).trim();
    const name      = (payload?.name   ?? newAssetName).trim();
    const token     = (payload?.token  ?? newAssetToken).trim();
    const oracle    = (payload?.oracle ?? newAssetOracle).trim();
    const riskClass = payload?.riskClass ?? newAssetRiskClass;
    const role      = payload?.role      ?? newAssetRole;
    const minimumInvestmentUsd6 =
      payload?.minimumInvestmentUsd6 !== undefined
        ? BigInt(String(payload.minimumInvestmentUsd6))
        : (parseUsdInputToUsd6(newAssetMinimumAmount) ?? BigInt(0));

    if (!symbol) {
      setPortfolioStatus('Symbol is required');
      return false;
    }
    // token is optional — external/off-chain assets may have no ERC-20 contract
    if (token && !isValidAddress(token)) {
      setPortfolioStatus('Token address must be a valid 0x address or left blank');
      return false;
    }
    if (!isValidAddress(portfolioRegistryAddress)) {
      setPortfolioStatus('PortfolioRegistry address not set');
      return false;
    }
    if (payload?.minimumInvestmentUsd6 === undefined && newAssetMinimumAmount.trim() && parseUsdInputToUsd6(newAssetMinimumAmount) === null) {
      setPortfolioStatus('Minimum amount must be a valid USD amount');
      return false;
    }

    const tokenAddr = isValidAddress(token) ? token : ethers.ZeroAddress;
    const oracleAddr = isValidAddress(oracle) ? oracle : ethers.ZeroAddress;

    if (!bypassProposal) {
      if (!isOp) {
        setPortfolioStatus('Only operators can propose portfolio changes');
        return false;
      }
      const proposal = queueProposal(
        'ADD_PORTFOLIO_ASSET',
        `Add ${symbol} to Portfolio`,
        `Add asset ${symbol} (${name || 'unnamed'}) to the accepted allocation portfolio as ${ASSET_ROLE_LABELS[role]} / ${RISK_CLASS_LABELS[riskClass]} with a minimum amount of ${minimumInvestmentUsd6 > 0 ? formatUsd(minimumInvestmentUsd6) : 'none'}.`,
        {
          symbol,
          name,
          token: tokenAddr,
          oracle: oracleAddr,
          riskClass,
          role,
          minimumInvestmentUsd6: minimumInvestmentUsd6.toString(),
        }
      );
      setPortfolioStatus(`Proposal queued (${proposal.id})`);
      return true;
    }

    if (!provider) {
      setPortfolioStatus('Local RPC provider not ready');
      return false;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const registry = new ethers.Contract(portfolioRegistryAddress, PORTFOLIO_REGISTRY_ABI, signer);
      const tx = await registry.addAsset(symbol, name, tokenAddr, oracleAddr, riskClass, role, minimumInvestmentUsd6);
      await tx.wait();
      resetPortfolioAssetForm();
      setPortfolioStatus(`Asset ${symbol} added to portfolio (tx=${tx.hash})`);
      await refreshPortfolioState();
      return true;
    } catch (error: any) {
      setPortfolioStatus(`Add asset failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  function resetPortfolioAssetForm(): void {
    setNewAssetToken('');
    setNewAssetSymbol('');
    setNewAssetName('');
    setNewAssetOracle('');
    setNewAssetRiskClass(0);
    setNewAssetRole(0);
    setNewAssetMinimumAmount('');
    setEditingPortfolioAssetSymbol(null);
  }

  function beginPortfolioAssetEdit(asset: PortfolioAsset): void {
    setEditingPortfolioAssetSymbol(asset.symbol);
    setNewAssetSymbol(asset.symbol);
    setNewAssetName(asset.name);
    setNewAssetToken(isValidAddress(asset.token) && asset.token !== ethers.ZeroAddress ? asset.token : '');
    setNewAssetOracle(isValidAddress(asset.oracle) && asset.oracle !== ethers.ZeroAddress ? asset.oracle : '');
    setNewAssetRiskClass(asset.riskClass);
    setNewAssetRole(asset.role);
    setNewAssetMinimumAmount(formatUsd6Input(asset.minimumInvestmentUsd6));
    setPortfolioStatus(`Editing asset ${asset.symbol}.`);
  }

  const handleUpdatePortfolioAsset = async (
    bypassProposal = false,
    payload?: {
      symbol?: string;
      name?: string;
      token?: string;
      oracle?: string;
      riskClass?: number;
      role?: number;
      minimumInvestmentUsd6?: string | number;
    }
  ): Promise<boolean> => {
    const symbol = (payload?.symbol ?? editingPortfolioAssetSymbol ?? newAssetSymbol).trim();
    const name = (payload?.name ?? newAssetName).trim();
    const token = (payload?.token ?? newAssetToken).trim();
    const oracle = (payload?.oracle ?? newAssetOracle).trim();
    const riskClass = payload?.riskClass ?? newAssetRiskClass;
    const role = payload?.role ?? newAssetRole;
    const minimumInvestmentUsd6 =
      payload?.minimumInvestmentUsd6 !== undefined
        ? BigInt(String(payload.minimumInvestmentUsd6))
        : (parseUsdInputToUsd6(newAssetMinimumAmount) ?? BigInt(0));
    const fail = (message: string): false => {
      setPortfolioStatus(message);
      if (bypassProposal) throw new Error(message);
      return false;
    };

    if (!symbol) {
      return fail('Select an asset to edit');
    }
    if (token && !isValidAddress(token)) {
      return fail('Token address must be a valid 0x address or left blank');
    }
    if (oracle && !isValidAddress(oracle)) {
      return fail('Oracle address must be a valid 0x address or left blank');
    }
    if (!isValidAddress(portfolioRegistryAddress)) {
      return fail('PortfolioRegistry address not set');
    }
    if (payload?.minimumInvestmentUsd6 === undefined && newAssetMinimumAmount.trim() && parseUsdInputToUsd6(newAssetMinimumAmount) === null) {
      return fail('Minimum amount must be a valid USD amount');
    }

    const tokenAddr = isValidAddress(token) ? token : ethers.ZeroAddress;
    const oracleAddr = isValidAddress(oracle) ? oracle : ethers.ZeroAddress;

    if (!bypassProposal) {
      if (!isOp) {
        setPortfolioStatus('Only operators can propose portfolio changes');
        return false;
      }
      const proposal = queueProposal(
        'UPDATE_PORTFOLIO_ASSET',
        `Update ${symbol} in Portfolio`,
        `Update asset ${symbol} to ${ASSET_ROLE_LABELS[role]} / ${RISK_CLASS_LABELS[riskClass]} with a minimum amount of ${minimumInvestmentUsd6 > 0 ? formatUsd(minimumInvestmentUsd6) : 'none'}.`,
        {
          symbol,
          name,
          token: tokenAddr,
          oracle: oracleAddr,
          riskClass,
          role,
          minimumInvestmentUsd6: minimumInvestmentUsd6.toString(),
        }
      );
      setPortfolioStatus(`Edit proposal queued (${proposal.id})`);
      return true;
    }

    if (!provider) {
      return fail('Local RPC provider not ready');
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const registry = new ethers.Contract(portfolioRegistryAddress, PORTFOLIO_REGISTRY_ABI, signer);
      const tx = await registry.updateAsset(symbol, name, tokenAddr, oracleAddr, riskClass, role, minimumInvestmentUsd6);
      await tx.wait();
      resetPortfolioAssetForm();
      setPortfolioStatus(`Asset ${symbol} updated in portfolio (tx=${tx.hash})`);
      await refreshPortfolioState();
      return true;
    } catch (error: any) {
      const message = `Update asset failed: ${formatError(error)}`;
      setPortfolioStatus(message);
      if (bypassProposal) throw new Error(message);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const handleRemovePortfolioAsset = async (
    bypassProposal = false,
    payload?: { token?: string; symbol?: string }
  ): Promise<boolean> => {
    const symbol = (payload?.symbol ?? '').trim();

    if (!symbol) {
      setPortfolioStatus('Symbol is required to remove an asset');
      return false;
    }
    if (!isValidAddress(portfolioRegistryAddress)) {
      setPortfolioStatus('PortfolioRegistry address not set');
      return false;
    }

    if (!bypassProposal) {
      if (!isOp) {
        setPortfolioStatus('Only operators can propose portfolio changes');
        return false;
      }
      const proposal = queueProposal(
        'REMOVE_PORTFOLIO_ASSET',
        `Remove ${symbol} from Portfolio`,
        `Remove asset ${symbol} from the accepted allocation portfolio.`,
        { symbol }
      );
      setPortfolioStatus(`Proposal queued (${proposal.id})`);
      return true;
    }

    if (!provider) {
      setPortfolioStatus('Local RPC provider not ready');
      return false;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const registry = new ethers.Contract(portfolioRegistryAddress, PORTFOLIO_REGISTRY_ABI, signer);
      const tx = await registry.removeAsset(symbol);
      await tx.wait();
      setPortfolioStatus(`Asset ${symbol} removed from portfolio (tx=${tx.hash})`);
      await refreshPortfolioState();
      return true;
    } catch (error: any) {
      setPortfolioStatus(`Remove asset failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const resetRouteRegistryForm = (): void => {
    setEditingRouteId(null);
    setRouteAssetSymbolInput('');
    setRouteTypeInput(0);
    setRouteCounterpartyInput('');
    setRouteJurisdictionInput('');
    setRouteCustodyInput('');
    setRouteDocumentsCompleteInput(false);
    setRouteSagittaFundApprovedInput(false);
    setRouteNdaSignedInput(false);
    setRoutePnlEndpointInput('');
    setRouteManualMarksInput(true);
    setRouteActiveInput(true);
  };

  const beginRouteEdit = (route: ExecutionRoute): void => {
    setEditingRouteId(route.routeId);
    setRouteAssetSymbolInput(route.assetSymbol);
    setRouteTypeInput(route.routeType);
    setRouteCounterpartyInput(route.counterpartyRefHash === ethers.ZeroHash ? '' : route.counterpartyRefHash);
    setRouteJurisdictionInput(route.jurisdictionRefHash === ethers.ZeroHash ? '' : route.jurisdictionRefHash);
    setRouteCustodyInput(route.custodyRefHash === ethers.ZeroHash ? '' : route.custodyRefHash);
    setRouteDocumentsCompleteInput(route.documentsComplete);
    setRouteSagittaFundApprovedInput(route.sagittaFundApproved);
    setRouteNdaSignedInput(route.ndaSigned);
    setRoutePnlEndpointInput(route.pnlEndpoint);
    setRouteManualMarksInput(route.manualMarksRequired);
    setRouteActiveInput(route.active);
    setRouteRegistryStatus(`Editing route #${route.routeId}.`);
  };

  const beginExternalComplianceDraft = (asset: PortfolioAsset): void => {
    resetRouteRegistryForm();
    setRouteAssetSymbolInput(asset.symbol);
    setRouteTypeInput(3);
    setRouteRegistryStatus(`Drafting external compliance route for ${asset.symbol}.`);
  };

  const refreshRouteRegistryState = async (): Promise<void> => {
    if (!provider || !isValidAddress(routeRegistryAddress)) {
      setExecutionRoutes([]);
      return;
    }
    setRouteRegistryLoading(true);
    try {
      const registry = new ethers.Contract(routeRegistryAddress, EXECUTION_ROUTE_REGISTRY_ABI, provider);
      const raw = await registry.getAllRoutes();
      setExecutionRoutes(
        raw.map((route: any) => ({
          routeId: Number(route.routeId ?? route[0] ?? 0),
          assetSymbol: String(route.assetSymbol ?? route[1] ?? ''),
          routeType: Number(route.routeType ?? route[2] ?? 0),
          counterpartyRefHash: String(route.counterpartyRefHash ?? route[3] ?? ethers.ZeroHash),
          jurisdictionRefHash: String(route.jurisdictionRefHash ?? route[4] ?? ethers.ZeroHash),
          custodyRefHash: String(route.custodyRefHash ?? route[5] ?? ethers.ZeroHash),
          documentsComplete: Boolean(route.documentsComplete ?? route[6] ?? false),
          sagittaFundApproved: Boolean(route.sagittaFundApproved ?? route[7] ?? false),
          ndaSigned: Boolean(route.ndaSigned ?? route[8] ?? false),
          pnlEndpoint: String(route.pnlEndpoint ?? route[9] ?? ''),
          manualMarksRequired: Boolean(route.manualMarksRequired ?? route[10] ?? false),
          active: Boolean(route.active ?? route[11] ?? false),
        }))
      );
    } catch (error: any) {
      setExecutionRoutes([]);
      setRouteRegistryStatus(`Failed to load execution routes: ${formatError(error)}`);
    } finally {
      setRouteRegistryLoading(false);
    }
  };

  const handleSaveExecutionRoute = async (): Promise<boolean> => {
    if (!isOp) {
      setRouteRegistryStatus('Only operators can edit execution routes');
      return false;
    }
    if (!provider) {
      setRouteRegistryStatus('Local RPC provider not ready');
      return false;
    }
    if (!isValidAddress(routeRegistryAddress)) {
      setRouteRegistryStatus('ExecutionRouteRegistry address not set');
      return false;
    }
    if (!routeAssetSymbolInput.trim()) {
      setRouteRegistryStatus('Asset symbol is required');
      return false;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const registry = new ethers.Contract(routeRegistryAddress, EXECUTION_ROUTE_REGISTRY_ABI, signer);
      const args = [
        routeAssetSymbolInput.trim(),
        routeTypeInput,
        toBytes32Ref(routeCounterpartyInput),
        toBytes32Ref(routeJurisdictionInput),
        toBytes32Ref(routeCustodyInput),
        routeDocumentsCompleteInput,
        routeSagittaFundApprovedInput,
        routeNdaSignedInput,
        routePnlEndpointInput.trim(),
        routeManualMarksInput,
        routeActiveInput,
      ] as const;

      const tx = editingRouteId
        ? await registry.updateRoute(editingRouteId, ...args)
        : await registry.addRoute(...args);
      await tx.wait();

      setRouteRegistryStatus(`${editingRouteId ? 'Updated' : 'Added'} execution route${editingRouteId ? ` #${editingRouteId}` : ''} (tx=${tx.hash})`);
      resetRouteRegistryForm();
      await refreshRouteRegistryState();
      return true;
    } catch (error: any) {
      setRouteRegistryStatus(`Route write failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  const handleRemoveExecutionRoute = async (routeId: number): Promise<boolean> => {
    if (!isOp) {
      setRouteRegistryStatus('Only operators can remove execution routes');
      return false;
    }
    if (!provider) {
      setRouteRegistryStatus('Local RPC provider not ready');
      return false;
    }
    if (!isValidAddress(routeRegistryAddress)) {
      setRouteRegistryStatus('ExecutionRouteRegistry address not set');
      return false;
    }

    setConfigBusy(true);
    try {
      const signer = await getWriteSigner();
      const registry = new ethers.Contract(routeRegistryAddress, EXECUTION_ROUTE_REGISTRY_ABI, signer);
      const tx = await registry.removeRoute(routeId);
      await tx.wait();
      if (editingRouteId === routeId) resetRouteRegistryForm();
      setRouteRegistryStatus(`Removed execution route #${routeId} (tx=${tx.hash})`);
      await refreshRouteRegistryState();
      return true;
    } catch (error: any) {
      setRouteRegistryStatus(`Route removal failed: ${formatError(error)}`);
      return false;
    } finally {
      setConfigBusy(false);
    }
  };

  function handleSaveRoleAssignment() {
    if (vaultPaused) {
      setRoleStatus('Protocol is paused. Role management is disabled until resume.');
      return;
    }
    if (!signerIsOwner) {
      setRoleStatus('Only owner can manage role whitelist');
      return;
    }
    const nextAddress = roleAddressInput.trim();
    if (!isValidAddress(nextAddress)) {
      setRoleStatus('Invalid wallet address for role assignment');
      return;
    }
    if (!setAddressRole(nextAddress, roleValueInput)) {
      setRoleStatus('Failed to save role assignment');
      return;
    }
    setRoleStatus(`Assigned ${roleValueInput} role to ${formatAddressShort(nextAddress)}`);
    setRoleAddressInput('');
    setRoleAssignments(listRoleAssignments());
  }

  function handleDeleteRoleAssignment(targetAddress: string) {
    if (vaultPaused) {
      setRoleStatus('Protocol is paused. Role management is disabled until resume.');
      return;
    }
    if (!signerIsOwner) {
      setRoleStatus('Only owner can manage role whitelist');
      return;
    }
    const normalizedTarget = ethers.getAddress(targetAddress);
    if (isValidAddress(ownerAddress) && normalizedTarget.toLowerCase() === ownerAddress.toLowerCase()) {
      setRoleStatus('Cannot remove role for current on-chain owner');
      return;
    }
    if (!removeAddressRole(normalizedTarget)) {
      setRoleStatus('Role assignment not found');
      return;
    }
    setRoleStatus(`Removed role assignment for ${formatAddressShort(normalizedTarget)}`);
    setRoleAssignments(listRoleAssignments());
  }

  async function handleAddCouncilMember() {
    const target = councilMemberInput.trim();
    if (!isValidAddress(target)) { setCouncilStatus('Invalid address'); return; }
    if (!signerIsOwner) { setCouncilStatus('Only the contract owner can manage the council'); return; }
    setCouncilBusy(true);
    setCouncilStatus(null);
    try {
      const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
      if (!eth) { setCouncilStatus('No wallet connected'); return; }
      const signer = await new ethers.BrowserProvider(eth).getSigner();
      const dao = new ethers.Contract(
        getRuntimeAddress('ProtocolDAO'),
        ['function addCouncilMember(address member) external'],
        signer
      );
      const tx = await dao.addCouncilMember(target);
      setCouncilStatus(`Adding ${formatAddressShort(target)}… tx ${tx.hash.slice(0, 10)}`);
      await tx.wait();
      setCouncilStatus(`${formatAddressShort(target)} added to council ✓`);
      setCouncilMemberInput('');
      // Trigger a re-fetch of council via the syncOwner path
      window.dispatchEvent(new CustomEvent('sagitta:roles-updated'));
    } catch (e: any) {
      setCouncilStatus(`Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setCouncilBusy(false);
    }
  }

  async function handleRemoveCouncilMember(member: string) {
    if (!signerIsOwner) { setCouncilStatus('Only the contract owner can manage the council'); return; }
    setCouncilBusy(true);
    setCouncilStatus(null);
    try {
      const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
      if (!eth) { setCouncilStatus('No wallet connected'); return; }
      const signer = await new ethers.BrowserProvider(eth).getSigner();
      const dao = new ethers.Contract(
        getRuntimeAddress('ProtocolDAO'),
        ['function removeCouncilMember(address member) external'],
        signer
      );
      const tx = await dao.removeCouncilMember(member);
      setCouncilStatus(`Removing ${formatAddressShort(member)}… tx ${tx.hash.slice(0, 10)}`);
      await tx.wait();
      setCouncilStatus(`${formatAddressShort(member)} removed from council ✓`);
      window.dispatchEvent(new CustomEvent('sagitta:roles-updated'));
    } catch (e: any) {
      setCouncilStatus(`Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setCouncilBusy(false);
    }
  }

  if (loading && !ownerAddress) {
    return <div className="text-center py-16">Loading DAO Data...</div>;
  }

  const ownerShort = formatAddressShort(ownerAddress || null);
  const signerShort = formatAddressShort(address || null);
  const recentProposals = governanceProposals.slice(0, 12);
  const externalPortfolioAssets = portfolioAssets.filter(
    (asset) => asset.role === 6 || !isValidAddress(asset.token) || asset.token === ethers.ZeroAddress
  );
  const complianceEditorActive = routeTypeInput === 3 && !!routeAssetSymbolInput.trim();
  const routeIsBatchEligible = (route?: ExecutionRoute | null): boolean => {
    if (!route?.active) return false;
    if (route.routeType !== 3) return true;
    return route.documentsComplete
      && route.sagittaFundApproved
      && route.ndaSigned
      && route.pnlEndpoint.trim().length > 0;
  };

  return (
    <div className="tab-screen">
      <PageHeader
        title="DAO Administration"
        description="Coordinate protocol governance, council approvals, and unified local configuration from a single control surface."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {new Date().toLocaleTimeString()}</span>
            <span className="data-chip" data-tone={vaultPaused ? 'danger' : 'success'}>
              {vaultPaused ? 'Protocol Paused' : 'Protocol Active'}
            </span>
            <span className="data-chip" data-tone={signerRole === 'owner' ? 'success' : signerRole === 'operator' ? 'warning' : 'neutral'}>
              Signer: {signerShort} ({signerRole})
            </span>
            <span className="data-chip">Pending proposals: {pendingProposalCount}</span>
          </>
        }
      />

      {/* ── Governance Snapshot ──────────────────────────────────────────── */}
      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 lg:col-span-8">
          <h3 className="flex items-center gap-2"><UserCog size={20} /> Governance Snapshot</h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Contract Owner</div>
              <div className="mt-2 kpi-value text-xl text-slate-100">{ownerShort}</div>
              <div className="mt-2 text-xs font-mono text-slate-400 break-all">{isValidAddress(ownerAddress) ? ownerAddress : 'Owner not resolved'}</div>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">DAO Council</div>
              <div className="mt-2 kpi-value text-xl text-slate-100">{daoCouncil.length}</div>
              <div className="mt-2 text-xs text-slate-400">{daoCouncil.length === 0 ? 'No council — contract owner approves' : `Council approvals required: ${requiredProposalApprovals}`}</div>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Open Proposals</div>
              <div className="mt-2 kpi-value text-xl text-amber-300">{pendingProposalCount}</div>
              <div className="mt-2 text-xs text-slate-400">All DAO config/control actions are proposal-gated.</div>
            </div>
          </div>
        </div>
        {isOp ? (
          <div className="sagitta-cell col-span-12 lg:col-span-4">
            <h3 className="flex items-center gap-2"><ShieldAlert size={20} /> Emergency Controls</h3>
            <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 space-y-3">
              <div className="text-sm text-slate-300">
                {vaultPaused ? 'Vault is paused. Resume operations through an approved proposal.' : 'Pause vault operations through an approved proposal if emergency action is needed.'}
              </div>
              <button
                onClick={() => handlePauseToggle()}
                disabled={!isOp || loading || configBusy}
                className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                  vaultPaused
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-rose-600 text-white hover:bg-rose-500'
                }`}
              >
                {vaultPaused ? 'Propose Resume' : 'Propose Pause'}
              </button>
              <div className="text-xs text-slate-400">
                {vaultPaused ? 'Resume is the only DAO action available while the protocol is paused.' : `This action now creates a proposal and requires ${daoCouncil.length === 0 ? 'owner' : 'council'} approvals before execution.`}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {isOp ? (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12 lg:col-span-5">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="section-title !mb-0">Local Time + Batch Schedule</h3>
              {isLocalhostNetwork
                ? <span className="data-chip" data-tone="success" style={{ fontSize: '0.65rem' }}>LOCALHOST</span>
                : <span className="data-chip" data-tone="warning" style={{ fontSize: '0.65rem' }}>TESTNET — time controls disabled</span>
              }
            </div>
            <div className="text-xs text-slate-400 mb-3">Chain {localChainId ?? 'unknown'} - Block time {formatChainTime(localChainTime)}</div>
            {isLocalhostNetwork ? (
              <div className="flex flex-wrap gap-2 mb-4">
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(5 * 60, '+5 min')} disabled={vaultPaused || configBusy || timeControlLoading}>+5 Min</button>
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(60 * 60, '+1 hour')} disabled={vaultPaused || configBusy || timeControlLoading}>+1 Hour</button>
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(24 * 60 * 60, '+1 day')} disabled={vaultPaused || configBusy || timeControlLoading}>+1 Day</button>
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(7 * 24 * 60 * 60, '+1 week')} disabled={vaultPaused || configBusy || timeControlLoading}>+1 Week</button>
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(30 * 24 * 60 * 60, '+1 month')} disabled={vaultPaused || configBusy || timeControlLoading}>+1 Month</button>
                <button className="chip-button" onClick={() => handleAdvanceLocalTime(365 * 24 * 60 * 60, '+1 year')} disabled={vaultPaused || configBusy || timeControlLoading}>+1 Year</button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-xs text-slate-500 mb-4">
                Time controls are only available on a local Hardhat node.
              </div>
            )}
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Batch Timing</label>
            <select className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={String(batchCadenceSeconds)} onChange={e => setBatchCadenceSeconds(Number(e.target.value))} disabled={vaultPaused || configBusy}>
              {BATCH_CADENCE_OPTIONS.map(opt => (
                <option key={opt.seconds} value={opt.seconds}>{opt.label}</option>
              ))}
            </select>
            <button className="action-button action-button--primary w-full" onClick={() => handleSaveBatchCadence()} disabled={vaultPaused || configBusy}>Propose Batch Timing</button>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Vault Unlock Duration</label>
                <select className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={String(lockDurationSeconds)} onChange={e => setLockDurationSeconds(Number(e.target.value))} disabled={vaultPaused || configBusy}>
                  {VAULT_UNLOCK_OPTIONS.map(opt => (
                    <option key={opt.seconds} value={opt.seconds}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <button className="action-button action-button--primary w-full md:w-auto" onClick={() => handleSetVaultLockDuration()} disabled={vaultPaused || configBusy}>Propose Unlock Duration</button>
            </div>
              <div className="text-xs text-slate-400">Last batch roll: {formatChainTime(escrowLastRollTime)} - Next due: {formatChainTime(nextBatchRollDue)}</div>
              {timeStatus && <div className="text-xs text-slate-300">{timeStatus}</div>}
            </div>
          </div>

          <div className="sagitta-cell col-span-12 lg:col-span-7">
            <h3 className="section-title">Protocol Address Matrix</h3>
            <div className="text-xs text-slate-400 mb-3">Set canonical contract addresses once, then apply all protocol links in one flow.</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Treasury</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={treasuryAddressInput} onChange={e => setTreasuryAddressInput(e.target.value)} placeholder="Treasury address" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Vault</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={vaultAddressInput} onChange={e => setVaultAddressInput(e.target.value)} placeholder="Vault address" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Escrow</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={escrowAddressInput} onChange={e => setEscrowAddressInput(e.target.value)} placeholder="Escrow address" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Reserve</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={reserveAddressInput} onChange={e => setReserveAddressInput(e.target.value)} placeholder="Reserve address" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">GoldOracle</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={goldOracleAddressInput} onChange={e => setGoldOracleAddressInput(e.target.value)} placeholder="GoldOracle address" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Escrow Keeper</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={escrowKeeperInput} onChange={e => setEscrowKeeperInput(e.target.value)} placeholder="Keeper address" disabled={vaultPaused || configBusy} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <button className="action-button action-button--ghost w-full" onClick={handleLoadGeneratedAddresses} disabled={vaultPaused || configBusy}>Load Generated</button>
              <button className="action-button action-button--ghost w-full" onClick={handleSaveAddressBook} disabled={vaultPaused || configBusy}>Save Address Book</button>
              <button className="action-button action-button--primary w-full" onClick={() => handleApplyAllLinks()} disabled={vaultPaused || configBusy}>Propose Apply + Link</button>
              <button className="action-button action-button--ghost w-full" onClick={() => refreshConfigState()} disabled={configBusy}>Refresh On-Chain</button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-400 space-y-1">
              <div>Treasury -&gt; Vault: {formatAddressShort(treasuryOnChainVault)} | Escrow: {formatAddressShort(treasuryOnChainEscrow)} | Reserve: {formatAddressShort(treasuryOnChainReserve)}</div>
              <div>Vault -&gt; Treasury: {formatAddressShort(vaultOnChainTreasury)} | Escrow: {formatAddressShort(vaultOnChainEscrow)} | Lock: {lockDurationOnChainSeconds ? formatSecondsLabel(lockDurationOnChainSeconds) : 'N/A'}</div>
              <div>Escrow -&gt; Vault: {formatAddressShort(escrowOnChainVault)} | Keeper: {formatAddressShort(escrowOnChainKeeper)} | Reserve -&gt; Treasury: {formatAddressShort(reserveOnChainTreasury)}</div>
            </div>

            {[configStatus, treasuryStatus, vaultStatus, escrowStatus, reserveStatus].filter(Boolean).map((msg, idx) => (
              <div key={idx} className="mt-2 text-xs text-slate-300">{msg}</div>
            ))}

            {linkRunContext && (
              <div className="mt-2 text-xs text-slate-400">{linkRunContext}</div>
            )}

            {linkStepResults.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 space-y-2">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Link Execution Details</div>
                {linkStepResults.map((step, idx) => (
                  <div key={`${step.step}-${idx}`} className={`text-xs ${step.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {step.ok ? '[OK]' : '[ERR]'} {step.step}
                    {step.txHash ? ` tx=${step.txHash}` : ''}
                    {step.error ? ` - ${step.error}` : ''}
                  </div>
                ))}
              </div>
            )}

            {(readDiagnostics.treasury || readDiagnostics.vault || readDiagnostics.escrow || readDiagnostics.reserve) && (
              <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-900/10 p-3 space-y-1">
                <div className="text-xs uppercase tracking-[0.16em] text-amber-300">Read Diagnostics (N/A Reasons)</div>
                {readDiagnostics.treasury && <div className="text-xs text-amber-200">Treasury read: {readDiagnostics.treasury}</div>}
                {readDiagnostics.vault && <div className="text-xs text-amber-200">Vault read: {readDiagnostics.vault}</div>}
                {readDiagnostics.escrow && <div className="text-xs text-amber-200">Escrow read: {readDiagnostics.escrow}</div>}
                {readDiagnostics.reserve && <div className="text-xs text-amber-200">Reserve read: {readDiagnostics.reserve}</div>}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12">
            <h3 className="section-title">DAO Controls Hidden</h3>
            <div className="panel-note">
              DAO proposal, address-book, and time controls are visible only to operator or owner wallets. Viewer wallets stay read-only in this tab.
            </div>
          </div>
        </section>
      )}

      {isOp ? (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12">
            <h3 className="section-title">
              <Settings size={18} /> Treasury Control Proposals
            </h3>
            <p className="section-subtitle">
              Treasury write actions live here now. Queue the action, collect {daoCouncil.length === 0 ? 'owner' : 'council'} approvals below, then execute it from Governance Proposals.
            </p>

            <div className="grid sm:grid-cols-2 gap-6 mt-4">
              <div className="flex flex-col gap-4 p-2">
                <div className="space-y-2">
                  <label className="text-slate-300 font-medium">Gold Price (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                    value={treasuryGoldPriceInput}
                    onChange={e => setTreasuryGoldPriceInput(e.target.value)}
                    placeholder="4000"
                    disabled={vaultPaused || !isOp || loading || configBusy || !!proposalExecId}
                  />
                </div>
                <button
                  className="action-button action-button--warning"
                  onClick={() => handleSetGoldPrice()}
                  disabled={vaultPaused || !isOp || !treasuryGoldPriceInput.trim() || loading || configBusy || !!proposalExecId}
                >
                  Propose Gold Price
                </button>
                <button
                  className="action-button action-button--primary"
                  onClick={() => handleTreasuryRebalance()}
                  disabled={vaultPaused || !isOp || loading || configBusy || !!proposalExecId}
                >
                  <ArrowRightLeft size={18} />
                  <span>Propose Rebalance</span>
                </button>
              </div>

              <div className="flex flex-col gap-3 p-2">
                <label className="text-slate-300 font-medium">Receipt Profit Payout</label>
                <input
                  type="number"
                  min="0"
                className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                value={profitReceiptIdInput}
                onChange={e => setProfitReceiptIdInput(e.target.value)}
                placeholder="receipt id"
                disabled={vaultPaused || !isOp || loading || configBusy || !!proposalExecId}
              />
              <input
                type="text"
                className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                value={profitAmountUsdInput}
                onChange={e => setProfitAmountUsdInput(e.target.value)}
                placeholder="optional manual USD override"
                disabled={vaultPaused || !isOp || loading || configBusy || !!proposalExecId}
              />
              <button
                className="action-button action-button--success"
                onClick={() => handlePayReceiptProfit()}
                disabled={vaultPaused || !isOp || !profitReceiptIdInput.trim() || loading || configBusy || !!proposalExecId}
              >
                Propose Profit Payout
              </button>
                <div className="text-xs text-slate-400">
                  Leave amount blank to pay exact unpaid batch profit. Fill amount only for a manual Treasury override.
                </div>
              </div>

            </div>
            {treasuryControlStatus && (
              <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">{treasuryControlStatus}</div>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12">
          <h3 className="section-title flex items-center gap-2">
            <ArrowRightLeft size={18} /> Portfolio Registry
          </h3>
            <p className="section-subtitle">
              Define the accepted allocation portfolio. Owners propose adding, editing, or removing assets; allocation weights are applied per-batch by the AAA (Autonomous Allocation Agent).
            </p>

            {/* Registry address */}
            <div className="mt-4 flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 space-y-1">
                <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Portfolio Registry Address</label>
                <input
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                  value={portfolioRegistryAddress}
                  onChange={e => {
                    if (!isOp) return;
                    setPortfolioRegistryAddress(e.target.value);
                    setRuntimeAddress('PortfolioRegistry', e.target.value);
                  }}
                  placeholder="0x..."
                  readOnly={!isOp}
                  disabled={configBusy}
                />
              </div>
              <button
                className="action-button action-button--ghost"
                onClick={refreshPortfolioState}
                disabled={portfolioLoading || configBusy}
              >
                {portfolioLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {isOp ? (
              <div className="mt-6 grid sm:grid-cols-2 gap-6">
                {/* Add asset form */}
                <div className="flex flex-col gap-3 p-2 sm:col-span-2">
                <label className="text-slate-300 font-medium">
                  {editingPortfolioAssetSymbol ? `Propose Edit Asset: ${editingPortfolioAssetSymbol}` : 'Propose Add Asset'}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Symbol <span className="text-rose-400">*</span></label>
                    <input
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                      value={newAssetSymbol}
                      onChange={e => setNewAssetSymbol(e.target.value)}
                      placeholder="e.g. SPC"
                      readOnly={!!editingPortfolioAssetSymbol}
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Name</label>
                    <input
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                      value={newAssetName}
                      onChange={e => setNewAssetName(e.target.value)}
                      placeholder="e.g. Sagitta SPC"
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">
                      Token Address <span className="normal-case text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                      value={newAssetToken}
                      onChange={e => setNewAssetToken(e.target.value)}
                      placeholder="0x... — leave blank for external assets"
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">
                      Oracle Address <span className="normal-case text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                      value={newAssetOracle}
                      onChange={e => setNewAssetOracle(e.target.value)}
                      placeholder="0x... — leave blank if not yet wired"
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">
                      Min. Amount <span className="normal-case text-slate-500">(USD, optional)</span>
                    </label>
                    <input
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                      value={newAssetMinimumAmount}
                      onChange={e => setNewAssetMinimumAmount(e.target.value)}
                      placeholder="e.g. 25000"
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Risk Class</label>
                    <select
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                      value={newAssetRiskClass}
                      onChange={e => setNewAssetRiskClass(Number(e.target.value))}
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    >
                      {RISK_CLASS_LABELS.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Role</label>
                    <select
                      className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                      value={newAssetRole}
                      onChange={e => setNewAssetRole(Number(e.target.value))}
                      disabled={vaultPaused || !isOp || configBusy || !!proposalExecId}
                    >
                      {ASSET_ROLE_LABELS.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-3">
                  <button
                    className="action-button action-button--primary"
                    onClick={() => editingPortfolioAssetSymbol ? handleUpdatePortfolioAsset() : handleAddPortfolioAsset()}
                    disabled={vaultPaused || !isOp || !newAssetSymbol.trim() || configBusy || !!proposalExecId}
                  >
                    {editingPortfolioAssetSymbol ? 'Propose Edit Asset' : 'Propose Add Asset'}
                  </button>
                  {editingPortfolioAssetSymbol && (
                    <button
                      className="action-button action-button--ghost"
                      onClick={() => resetPortfolioAssetForm()}
                      disabled={configBusy || !!proposalExecId}
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
                </div>
              {portfolioStatus && (
                <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">{portfolioStatus}</div>
              )}
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
                Viewer access is read-only here. Operators and owners can edit the registry and queue portfolio proposals.
              </div>
            )}

            {/* Asset table */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400 mb-3">
                Active Portfolio Assets ({portfolioAssets.length})
              </div>
              {portfolioAssets.length === 0 ? (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
                  {portfolioLoading ? 'Loading portfolio...' : isValidAddress(portfolioRegistryAddress) ? 'No assets in portfolio yet.' : 'Set PortfolioRegistry address above to view assets.'}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                  <table className="w-full text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-700/50 bg-slate-900/50">
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Symbol</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Name</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Risk Class</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Role</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Min. Amount</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Token</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Oracle</th>
                        {isOp && <th className="px-3 py-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioAssets.map((asset, idx) => (
                        <tr key={`${asset.token}-${idx}`} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                          <td className="px-3 py-2 font-semibold text-slate-100">{asset.symbol}</td>
                          <td className="px-3 py-2">{asset.name}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full px-2 py-0.5 bg-slate-700/60 text-slate-300">
                              {RISK_CLASS_LABELS[asset.riskClass] ?? asset.riskClass}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                              asset.role === 0 ? 'bg-sky-700/40 text-sky-200' :
                              asset.role === 1 ? 'bg-emerald-700/40 text-emerald-200' :
                              asset.role === 2 ? 'bg-violet-700/40 text-violet-200' :
                              asset.role === 3 ? 'bg-amber-700/40 text-amber-200' :
                              'bg-rose-700/40 text-rose-200'
                            }`}>
                              {ASSET_ROLE_LABELS[asset.role] ?? asset.role}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {asset.minimumInvestmentUsd6 > 0 ? formatUsd(asset.minimumInvestmentUsd6) : <span className="text-slate-500">none</span>}
                          </td>
                          <td className="px-3 py-2 font-mono">{formatAddressShort(asset.token)}</td>
                          <td className="px-3 py-2 font-mono">{isValidAddress(asset.oracle) && asset.oracle !== ethers.ZeroAddress ? formatAddressShort(asset.oracle) : <span className="text-slate-500">none</span>}</td>
                          {isOp && (
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="px-2 py-1 rounded bg-sky-900/50 hover:bg-sky-800/70 text-sky-200 text-[10px] font-semibold border border-sky-700/40 disabled:opacity-40"
                                  onClick={() => beginPortfolioAssetEdit(asset)}
                                  disabled={vaultPaused || configBusy || !!proposalExecId}
                                >
                                  Edit
                                </button>
                                <button
                                  className="px-2 py-1 rounded bg-rose-900/50 hover:bg-rose-800/70 text-rose-200 text-[10px] font-semibold border border-rose-700/40 disabled:opacity-40"
                                  onClick={() => handleRemovePortfolioAsset(false, { symbol: asset.symbol })}
                                  disabled={vaultPaused || configBusy || !!proposalExecId}
                                >
                                  Propose Remove
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  Portfolio Asset History ({aggregatedPortfolioHistory.length})
                </div>
                <button
                  className="action-button action-button--ghost"
                  onClick={refreshPortfolioAssetHistory}
                  disabled={configBusy}
                >
                  Refresh History
                </button>
              </div>
              {aggregatedPortfolioHistory.length === 0 ? (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
                  No settled asset history yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                  <table className="w-full text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-700/50 bg-slate-900/50">
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Asset</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Batches</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Source</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Route</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Principal</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Returned</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">PnL</th>
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Yield</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedPortfolioHistory.map((row) => {
                        const asset = portfolioAssets.find((item) => item.symbol.toLowerCase() === row.assetSymbol.toLowerCase());
                        const positive = row.pnlTotal >= 0;
                        return (
                          <tr key={row.assetSymbol} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-slate-100">{row.assetSymbol}</div>
                              <div className="text-[11px] text-slate-400">{asset?.name || row.assetSymbol}</div>
                            </td>
                            <td className="px-3 py-2 text-slate-400">{row.batchCount}</td>
                            <td className="px-3 py-2">{row.sourceLabel}</td>
                            <td className="px-3 py-2">{row.routeLabel}</td>
                            <td className="px-3 py-2">${row.principalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-3 py-2">${row.returnedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className={`px-3 py-2 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                              ${row.pnlTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className={`px-3 py-2 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {row.yieldPct.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

      {/* ── Transfer / Council / Roles ──────────────────────────────────── */}
      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12">
          <h3 className="section-title flex items-center gap-2">
            <ShieldAlert size={18} /> External Asset Compliance
          </h3>
          <p className="section-subtitle">
            Review external assets already admitted to the portfolio and manage the compliance checks that determine whether they can receive the next batch.
          </p>

          {complianceEditorActive && isOp && (
            <div className="mt-5 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Compliance Editor</div>
                  <div className="mt-1 text-sm text-slate-200">
                    {editingRouteId ? `Route #${editingRouteId}` : 'New external route'} for {routeAssetSymbolInput}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Asset Symbol</label>
                    <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={routeAssetSymbolInput} readOnly />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.12em] text-slate-400">P&amp;L Endpoint</label>
                    <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs" value={routePnlEndpointInput} onChange={e => setRoutePnlEndpointInput(e.target.value)} placeholder="https://api.counterparty.com/pnl" disabled={vaultPaused || configBusy} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={routeDocumentsCompleteInput} onChange={e => setRouteDocumentsCompleteInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                    Documents complete
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={routeSagittaFundApprovedInput} onChange={e => setRouteSagittaFundApprovedInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                    Sagitta fund approved
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={routeNdaSignedInput} onChange={e => setRouteNdaSignedInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                    NDA signed
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={routeActiveInput} onChange={e => setRouteActiveInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                    Route active
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={routeManualMarksInput} onChange={e => setRouteManualMarksInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                    Manual marks
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button className="action-button action-button--primary" onClick={handleSaveExecutionRoute} disabled={vaultPaused || configBusy || !routeAssetSymbolInput.trim()}>
                    {editingRouteId ? `Save Compliance for Route #${editingRouteId}` : `Create Route for ${routeAssetSymbolInput}`}
                  </button>
                  <button className="action-button action-button--ghost" onClick={resetRouteRegistryForm} disabled={configBusy}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {routeRegistryStatus && (
            <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">{routeRegistryStatus}</div>
          )}

          <div className="mt-6">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400 mb-3">
              External Portfolio Assets ({externalPortfolioAssets.length})
            </div>
            {externalPortfolioAssets.length === 0 ? (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
                Add external assets to the portfolio registry to manage compliance here.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                <table className="w-full text-xs text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-slate-900/50">
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Asset</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Route</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Documents</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Fund</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">NDA</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">P&amp;L</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Active</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Eligible</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Endpoint</th>
                      {isOp && <th className="px-3 py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {externalPortfolioAssets.map((asset) => {
                      const matchingRoutes = executionRoutes.filter(
                        (route) => route.routeType === 3 && route.assetSymbol.toLowerCase() === asset.symbol.toLowerCase()
                      );
                      const route = matchingRoutes[0] ?? null;
                      const eligible = routeIsBatchEligible(route);
                      const routeLabel = route ? `#${route.routeId}${matchingRoutes.length > 1 ? ` (+${matchingRoutes.length - 1})` : ''}` : 'Missing';
                      const renderBadge = (ok: boolean, okLabel: string, badLabel: string) => (
                        <span className={`rounded-full px-2 py-0.5 ${ok ? 'bg-emerald-700/40 text-emerald-200' : 'bg-rose-700/40 text-rose-200'}`}>
                          {ok ? okLabel : badLabel}
                        </span>
                      );

                      return (
                        <tr key={asset.symbol} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-100">{asset.symbol}</div>
                            <div className="text-[11px] text-slate-400">{asset.name}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-300">{routeLabel}</td>
                          <td className="px-3 py-2">{renderBadge(!!route?.documentsComplete, 'Ready', 'Missing')}</td>
                          <td className="px-3 py-2">{renderBadge(!!route?.sagittaFundApproved, 'Ready', 'Missing')}</td>
                          <td className="px-3 py-2">{renderBadge(!!route?.ndaSigned, 'Ready', 'Missing')}</td>
                          <td className="px-3 py-2">{renderBadge(!!route?.pnlEndpoint?.trim(), 'Ready', 'Missing')}</td>
                          <td className="px-3 py-2">{renderBadge(!!route?.active, 'Active', 'Inactive')}</td>
                          <td className="px-3 py-2">{renderBadge(eligible, 'Allowed', 'Blocked')}</td>
                          <td className="px-3 py-2 font-mono text-slate-400 break-all">{route?.pnlEndpoint?.trim() || 'none'}</td>
                          {isOp && (
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                {route ? (
                                  <button
                                    className="px-2 py-1 rounded bg-sky-900/50 hover:bg-sky-800/70 text-sky-200 text-[10px] font-semibold border border-sky-700/40 disabled:opacity-40"
                                    onClick={() => beginRouteEdit(route)}
                                    disabled={vaultPaused || configBusy}
                                  >
                                    Edit Compliance
                                  </button>
                                ) : (
                                  <button
                                    className="px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/70 text-amber-200 text-[10px] font-semibold border border-amber-700/40 disabled:opacity-40"
                                    onClick={() => beginExternalComplianceDraft(asset)}
                                    disabled={vaultPaused || configBusy}
                                  >
                                    Create Route
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12">
          <h3 className="section-title flex items-center gap-2">
            <ShieldAlert size={18} /> Execution Route Registry
          </h3>
          <p className="section-subtitle">
            Manage execution venues, custody references, and route metadata used by Escrow mandates.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Execution Route Registry Address</label>
              <input
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                value={routeRegistryAddress}
                onChange={e => {
                  if (!isOp) return;
                  setRouteRegistryAddress(e.target.value);
                  setRuntimeAddress('ExecutionRouteRegistry', e.target.value);
                }}
                placeholder="0x..."
                readOnly={!isOp}
                disabled={configBusy}
              />
            </div>
            <button className="action-button action-button--ghost" onClick={refreshRouteRegistryState} disabled={routeRegistryLoading || configBusy}>
              {routeRegistryLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {isOp ? (
            <div className="mt-6 grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Asset Symbol</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={routeAssetSymbolInput} onChange={e => setRouteAssetSymbolInput(e.target.value)} placeholder="e.g. SPC" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Route Type</label>
                <select className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100" value={routeTypeInput} onChange={e => setRouteTypeInput(Number(e.target.value))} disabled={vaultPaused || configBusy}>
                  {EXECUTION_ROUTE_TYPE_LABELS.map((label, i) => (
                    <option key={label} value={i}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Counterparty Ref</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs" value={routeCounterpartyInput} onChange={e => setRouteCounterpartyInput(e.target.value)} placeholder="free text or 0x... hash" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Jurisdiction Ref</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs" value={routeJurisdictionInput} onChange={e => setRouteJurisdictionInput(e.target.value)} placeholder="free text or 0x... hash" disabled={vaultPaused || configBusy} />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Custody Ref</label>
                <input className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs" value={routeCustodyInput} onChange={e => setRouteCustodyInput(e.target.value)} placeholder="free text or 0x... hash" disabled={vaultPaused || configBusy} />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={routeManualMarksInput} onChange={e => setRouteManualMarksInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                  Manual marks required
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={routeActiveInput} onChange={e => setRouteActiveInput(e.target.checked)} disabled={vaultPaused || configBusy} />
                  Active
                </label>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-3">
                <button className="action-button action-button--primary" onClick={handleSaveExecutionRoute} disabled={vaultPaused || configBusy || !routeAssetSymbolInput.trim()}>
                  {editingRouteId ? `Save Route #${editingRouteId}` : 'Add Route'}
                </button>
                {editingRouteId !== null && (
                  <button className="action-button action-button--ghost" onClick={resetRouteRegistryForm} disabled={configBusy}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
              Viewer access is read-only here. Operators and owners can edit execution routes.
            </div>
          )}

          {routeRegistryStatus && (
            <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">{routeRegistryStatus}</div>
          )}

          <div className="mt-6">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400 mb-3">
              Execution Routes ({executionRoutes.length})
            </div>
            {executionRoutes.length === 0 ? (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
                {routeRegistryLoading ? 'Loading execution routes...' : isValidAddress(routeRegistryAddress) ? 'No routes registered yet.' : 'Set ExecutionRouteRegistry address above to view routes.'}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                <table className="w-full text-xs text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-slate-900/50">
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">ID</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Asset</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Type</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Counterparty</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Jurisdiction</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Custody</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Flags</th>
                      {isOp && <th className="px-3 py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {executionRoutes.map((route) => (
                      <tr key={route.routeId} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-mono text-slate-100">#{route.routeId}</td>
                        <td className="px-3 py-2 font-semibold text-slate-100">{route.assetSymbol}</td>
                        <td className="px-3 py-2">{EXECUTION_ROUTE_TYPE_LABELS[route.routeType] ?? route.routeType}</td>
                        <td className="px-3 py-2 font-mono text-slate-400">{route.counterpartyRefHash === ethers.ZeroHash ? 'none' : `${route.counterpartyRefHash.slice(0, 10)}...${route.counterpartyRefHash.slice(-6)}`}</td>
                        <td className="px-3 py-2 font-mono text-slate-400">{route.jurisdictionRefHash === ethers.ZeroHash ? 'none' : `${route.jurisdictionRefHash.slice(0, 10)}...${route.jurisdictionRefHash.slice(-6)}`}</td>
                        <td className="px-3 py-2 font-mono text-slate-400">{route.custodyRefHash === ethers.ZeroHash ? 'none' : `${route.custodyRefHash.slice(0, 10)}...${route.custodyRefHash.slice(-6)}`}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full px-2 py-0.5 bg-slate-700/60 text-slate-200">{route.manualMarksRequired ? 'Manual marks' : 'Route-managed marks'}</span>
                            <span className={`rounded-full px-2 py-0.5 ${route.active ? 'bg-emerald-700/40 text-emerald-200' : 'bg-rose-700/40 text-rose-200'}`}>{route.active ? 'Active' : 'Inactive'}</span>
                          </div>
                        </td>
                        {isOp && (
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button className="px-2 py-1 rounded bg-sky-900/50 hover:bg-sky-800/70 text-sky-200 text-[10px] font-semibold border border-sky-700/40 disabled:opacity-40" onClick={() => beginRouteEdit(route)} disabled={vaultPaused || configBusy}>
                                Edit
                              </button>
                              <button className="px-2 py-1 rounded bg-rose-900/50 hover:bg-rose-800/70 text-rose-200 text-[10px] font-semibold border border-rose-700/40 disabled:opacity-40" onClick={() => handleRemoveExecutionRoute(route.routeId)} disabled={vaultPaused || configBusy}>
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-5">
        {signerIsOwner ? (
          <div className="sagitta-cell col-span-12 lg:col-span-8">
            <h3 className="flex items-center gap-2"><Zap size={20} /> Transfer Ownership</h3>
            <p className="text-sm text-slate-400 mt-2">
              Ownership transfer is queued as a proposal and executes only after {daoCouncil.length === 0 ? 'owner' : 'council'} approvals.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newOwner}
                onChange={e => setNewOwner(e.target.value)}
                placeholder="0x... new owner address"
                className="flex-1 bg-slate-900/70 border border-slate-700 rounded-md px-4 py-2.5 text-sm focus:ring-2 focus:ring-sky-500/50 focus:outline-none transition-all"
                disabled={vaultPaused || !signerIsOwner || loading || configBusy}
              />
              <button
                onClick={() => handleTransferOwnership()}
                disabled={vaultPaused || !signerIsOwner || !newOwner || loading || configBusy}
                className="rounded-md px-5 py-2.5 text-sm font-semibold transition-all duration-300 bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Propose Transfer
              </button>
            </div>
            <div className="mt-3 text-xs text-slate-400">
              Current owner: <span className="font-mono text-slate-300">{isValidAddress(ownerAddress) ? ownerAddress : 'N/A'}</span>
            </div>
          </div>
        ) : null}

        {/* ── DAO Council (on-chain) ───────────────────────────────────────── */}
        <div className="sagitta-cell col-span-12 lg:col-span-4">
          <h3 className="flex items-center gap-2"><Users size={20} /> DAO Council</h3>
          <div className="mt-1 text-xs text-slate-400">
            On-chain — every participant sees the same list. Members can create and approve governance proposals.
          </div>

          {signerIsOwner && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={councilMemberInput}
                  onChange={e => setCouncilMemberInput(e.target.value)}
                  placeholder="0x... wallet address"
                  className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-sm"
                  disabled={councilBusy}
                />
                <button
                  type="button"
                  onClick={handleAddCouncilMember}
                  disabled={councilBusy || !councilMemberInput}
                  className="px-3 py-2 rounded bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {councilStatus && <div className="text-xs text-slate-300">{councilStatus}</div>}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {daoCouncil.length === 0 ? (
              <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-sm text-slate-400">
                No council members — contract owner approves proposals solo.
              </div>
            ) : (
              daoCouncil.map((member) => (
                <div key={member} className="grid grid-cols-[1fr_auto] gap-2 items-center rounded-lg border border-violet-700/30 bg-violet-900/10 p-3">
                  <span className="font-mono text-xs truncate text-slate-300">{member}</span>
                  {signerIsOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCouncilMember(member)}
                      disabled={councilBusy}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── UI Role Whitelist (localStorage) ────────────────────────────── */}
        <div className="sagitta-cell col-span-12 lg:col-span-4">
          <h3 className="flex items-center gap-2"><Users size={20} /> UI Access Roles</h3>
          <div className="mt-1 text-xs text-slate-400">
            Local-only whitelist. Controls which wallets can see operator/owner UI panels. Unlisted wallets default to viewer.
          </div>

          {signerIsOwner ? (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={roleAddressInput}
                onChange={e => setRoleAddressInput(e.target.value)}
                placeholder="0x... wallet address"
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-sm"
                disabled={vaultPaused || loading || configBusy}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={roleValueInput}
                  onChange={e => setRoleValueInput(e.target.value as AppRole)}
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-sm"
                  disabled={vaultPaused || loading || configBusy}
                >
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="owner">owner</option>
                </select>
                <button
                  type="button"
                  onClick={handleSaveRoleAssignment}
                  disabled={vaultPaused || loading || configBusy}
                  className="w-full px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  Save Role
                </button>
              </div>
              {roleStatus && <div className="text-xs text-slate-300">{roleStatus}</div>}
            </div>
          ) : (
            <div className="mt-3 panel-note">Role assignment controls are visible only to owner wallets.</div>
          )}

          <div className="mt-4 space-y-2">
            {roleAssignments.length === 0 ? (
              <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-sm text-slate-400">No explicit assignments. All non-owner wallets are viewers.</div>
            ) : (
              roleAssignments.map((item, idx) => (
                <div key={`${item.address}-${idx}`} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-lg border border-slate-700/50 bg-slate-900/35 p-3">
                  <span className="font-mono text-xs truncate text-slate-300">{item.address}</span>
                  <span className={`text-[10px] uppercase tracking-[0.16em] rounded-full px-2 py-1 border ${
                    item.role === 'owner'
                      ? 'bg-sky-600/20 border-sky-500/40 text-sky-200'
                      : item.role === 'operator'
                        ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-200'
                        : 'bg-slate-700/40 border-slate-500/40 text-slate-200'
                  }`}>
                    {item.role}
                  </span>
                  {signerIsOwner ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteRoleAssignment(item.address)}
                      disabled={vaultPaused || loading || configBusy}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="sagitta-cell">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3>Governance Proposals</h3>
          <div className="flex flex-wrap gap-2">
            <span className="data-chip" data-tone="warning">Pending: {pendingProposalCount}</span>
            <span className="data-chip">Required approvals: {requiredProposalApprovals}</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">DAO controls and config changes are queued first, then executed only after the active approval threshold is met.</div>

        <div className="mt-4 space-y-3">
          {recentProposals.length === 0 ? (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 text-sm text-slate-400">
              No proposals yet. Trigger any DAO control/config action to create one.
            </div>
          ) : (
            recentProposals.map(proposal => {
              const isPending = proposal.status === 'pending';
              const isExecuted = proposal.status === 'executed';
              const isFailed = proposal.status === 'failed';
              const approvedBySigner = (proposal.approvals || []).some(a => a.toLowerCase() === address.toLowerCase());
              const canExecute = isPending && (proposal.approvals || []).length >= requiredProposalApprovals;
              const proposalAllowedWhilePaused = !vaultPaused || isResumeProposal(proposal);
              const showExecuteButton =
                proposal.action === 'TRANSFER_OWNERSHIP'
                  ? signerIsOwner && canApproveAsActualSigner && proposalAllowedWhilePaused
                  : isOp && canExecuteAsActualSigner && proposalAllowedWhilePaused;
              return (
                <div key={proposal.id} className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{proposal.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{proposal.summary}</div>
                    </div>
                    <span className="data-chip" data-tone={isExecuted ? 'success' : isFailed ? 'danger' : 'warning'}>
                      {isExecuted ? 'Executed' : isFailed ? 'Failed' : 'Pending'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-400">
                    <div>Proposal ID: <span className="font-mono text-slate-300">{proposal.id}</span></div>
                    <div>Created: <span className="text-slate-300">{formatProposalTimestamp(proposal.createdAt)}</span></div>
                    <div>By: <span className="font-mono text-slate-300">{formatAddressShort(proposal.createdBy)}</span></div>
                  </div>

                  <div className="mt-3 text-xs text-slate-300">
                    Approvals {proposal.approvals.length}/{requiredProposalApprovals}
                    {proposal.approvals.length > 0 && (
                      <span className="text-slate-400"> {' - '} {proposal.approvals.map(a => formatAddressShort(a)).join(', ')}</span>
                    )}
                  </div>

                  {proposal.error && (
                    <div className="mt-2 text-xs text-rose-300">{proposal.error}</div>
                  )}

                  {(canApproveAsActualSigner || showExecuteButton) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canApproveAsActualSigner && (
                        <button
                          className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold disabled:opacity-50"
                          onClick={() => handleApproveProposal(proposal.id)}
                          disabled={!isPending || approvedBySigner || !proposalAllowedWhilePaused || !canApproveAsActualSigner || configBusy || loading || !!proposalExecId}
                        >
                          {approvedBySigner ? 'Approved' : 'Approve'}
                        </button>
                      )}
                      {showExecuteButton && (
                        <button
                          className="px-3 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold disabled:opacity-50"
                          onClick={() => executeProposal(proposal)}
                          disabled={!canExecute || !proposalAllowedWhilePaused || configBusy || loading || !!proposalExecId}
                        >
                          {proposalExecId === proposal.id ? 'Executing...' : 'Execute'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
