import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { getContract } from '../../lib/ethers';
import { getRuntimeAddress, setRuntimeAddress, isValidAddress, getDefaultAddress, loadGeneratedRuntimeAddresses } from '../../lib/runtime-addresses';
import { AppRole, listRoleAssignments, removeAddressRole, ROLES_UPDATED_EVENT, setAddressRole } from '../../lib/roles';
import { emitUiRefresh } from '../../lib/ui-refresh';
import { ArrowRightLeft, Clock, Settings, ShieldAlert, UserCog, Zap, Users } from 'lucide-react';
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
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { label: '2 weeks', seconds: 14 * 24 * 60 * 60 },
  { label: '1 month', seconds: 30 * 24 * 60 * 60 },
];
const VAULT_UNLOCK_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '90 days', seconds: 90 * 24 * 60 * 60 },
  { label: '180 days', seconds: 180 * 24 * 60 * 60 },
  { label: '1 year', seconds: 365 * 24 * 60 * 60 },
  { label: '2 years', seconds: 2 * 365 * 24 * 60 * 60 },
];

function formatChainTime(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  return new Date(seconds * 1000).toLocaleString();
}

function formatSecondsLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  if (seconds % (365 * 24 * 60 * 60) === 0) {
    const years = seconds / (365 * 24 * 60 * 60);
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  if (seconds % (30 * 24 * 60 * 60) === 0) {
    const months = seconds / (30 * 24 * 60 * 60);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  if (seconds % (7 * 24 * 60 * 60) === 0) {
    const weeks = seconds / (7 * 24 * 60 * 60);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (seconds % (24 * 60 * 60) === 0) {
    const days = seconds / (24 * 60 * 60);
    return `${days} day${days === 1 ? '' : 's'}`;
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
  | 'PAY_RECEIPT_PROFIT';

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
    actualRole,
    role: signerRole,
    isOperator: isOp,
    isOwner: signerIsOwner,
    isActualOwner,
  } = useRoleAccess();
  const address = connectedAddress ?? '';
  const ownerAddress = connectedOwnerAddress ?? '';
  const canApproveAsActualSigner = isActualOwner;
  const canExecuteAsActualSigner = actualRole === 'owner' || actualRole === 'operator';
  const [adminAddresses, setAdminAddresses] = useState<string[]>([]);
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

  const nextBatchRollDue = escrowLastRollTime ? escrowLastRollTime + batchCadenceSeconds : null;
  const ownerCouncil = dedupeAddresses(
    [
      ownerAddress,
      ...adminAddresses,
      ...roleAssignments.filter(item => item.role === 'owner').map(item => item.address),
    ].filter(
      (addr): addr is string => isValidAddress(addr) && addr.toLowerCase() !== ethers.ZeroAddress.toLowerCase()
    )
  );
  const requiredProposalApprovals = Math.max(1, ownerCouncil.length);
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

  function getWriteSigner() {
    if (!provider) throw new Error('Local RPC provider not ready');
    return new ethers.Wallet(TEST_PRIVATE_KEY, provider);
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
      setConfigStatus('Only owner addresses can approve proposals');
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
      setConfigStatus(`Proposal requires ${requiredProposalApprovals} owner approval(s)`);
      return;
    }

    setProposalExecId(proposal.id);
    try {
      let ok = false;
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
      }

      setGovernanceProposals(prev =>
        prev.map(p =>
          p.id === proposal.id
            ? {
                ...p,
                status: ok ? 'executed' : 'failed',
                executedAt: Date.now(),
                error: ok ? undefined : 'Execution failed. Check DAO status logs for details.',
              }
            : p
        )
      );
      setConfigStatus(ok ? `Executed proposal ${proposal.id}` : `Proposal ${proposal.id} failed`);
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
      const signer = getWriteSigner();
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
      const c = new ethers.Contract(treasuryAddress, ['function setVault(address _vault) external'], getWriteSigner());
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
      const c = new ethers.Contract(treasuryAddress, ['function setEscrow(address _escrow) external'], getWriteSigner());
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
      const c = new ethers.Contract(treasuryAddress, ['function setReserveAddress(address _reserve) external'], getWriteSigner());
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
      const c = new ethers.Contract(vaultAddress, ['function setTreasury(address _treasury) external'], getWriteSigner());
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
      const c = new ethers.Contract(vaultAddress, ['function setEscrow(address _escrow) external'], getWriteSigner());
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
      const c = new ethers.Contract(vaultAddress, ['function setLockDuration(uint64 _duration) external'], getWriteSigner());
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
      const c = new ethers.Contract(escrowAddress, ['function setVault(address _vault) external'], getWriteSigner());
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
      const c = new ethers.Contract(escrowAddress, ['function setKeeper(address _keeper) external'], getWriteSigner());
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
      const c = new ethers.Contract(reserveAddress, ['function setTreasury(address _treasury) external'], getWriteSigner());
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
    if (!canApproveAsActualSigner) {
      setConfigStatus('Only owner can transfer ownership');
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
      const signer = getWriteSigner();
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
      const signer = getWriteSigner();
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
      const signer = getWriteSigner();
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

  if (loading && !ownerAddress) {
    return <div className="text-center py-16">Loading DAO Data...</div>;
  }

  const ownerShort = formatAddressShort(ownerAddress || null);
  const signerShort = formatAddressShort(address || null);
  const recentProposals = governanceProposals.slice(0, 12);

  return (
    <div className="tab-screen">
      <PageHeader
        title="DAO Administration"
        description="Coordinate protocol governance, owner approvals, and unified local configuration from a single control surface."
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

      {isOp ? (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12 lg:col-span-5">
            <h3 className="section-title">Local Time + Batch Schedule</h3>
            <div className="text-xs text-slate-400 mb-3">Chain {localChainId ?? 'unknown'} - Block time {formatChainTime(localChainTime)}</div>
            <div className="flex flex-wrap gap-2 mb-4">
            <button className="chip-button" onClick={() => handleAdvanceLocalTime(24 * 60 * 60, '+1 day')} disabled={vaultPaused || !isLocalhostNetwork || configBusy || timeControlLoading}>+1 Day</button>
            <button className="chip-button" onClick={() => handleAdvanceLocalTime(7 * 24 * 60 * 60, '+1 week')} disabled={vaultPaused || !isLocalhostNetwork || configBusy || timeControlLoading}>+1 Week</button>
            <button className="chip-button" onClick={() => handleAdvanceLocalTime(30 * 24 * 60 * 60, '+1 month')} disabled={vaultPaused || !isLocalhostNetwork || configBusy || timeControlLoading}>+1 Month</button>
            <button className="chip-button" onClick={() => handleAdvanceLocalTime(365 * 24 * 60 * 60, '+1 year')} disabled={vaultPaused || !isLocalhostNetwork || configBusy || timeControlLoading}>+1 Year</button>
          </div>
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
            <p className="section-subtitle">Treasury write actions live here now. Queue the action, collect owner approvals below, then execute it from Governance Proposals.</p>

            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6 mt-4">
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

              <div className="flex flex-col gap-3 p-2">
                <label className="text-slate-300 font-medium">Operator Notes</label>
                <ul className="note-list">
                  <li>These controls were moved out of the Treasury tab so all write actions pass through DAO proposals.</li>
                  <li>Treasury: {formatAddressShort(treasuryAddress)}. Gold oracle: {formatAddressShort(goldOracleAddress)}.</li>
                  <li>{vaultPaused ? 'Protocol is paused. Treasury control actions are disabled until resume.' : 'Receipt profit payout is for closed escrow batches where profit is already booked in Treasury.'}</li>
                </ul>
                {treasuryControlStatus && (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">
                    {treasuryControlStatus}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2"><UserCog size={20} /> Governance Snapshot</h3>
            <div className="flex flex-wrap gap-2">
              <span className="data-chip" data-tone={vaultPaused ? 'danger' : 'success'}>
                {vaultPaused ? 'Protocol Paused' : 'Protocol Active'}
              </span>
              <span className="data-chip" data-tone={signerRole === 'owner' ? 'success' : signerRole === 'operator' ? 'warning' : 'neutral'}>
                Signer: {signerShort} ({signerRole})
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Current Owner</div>
              <div className="mt-2 kpi-value text-xl text-slate-100">{ownerShort}</div>
              <div className="mt-2 text-xs font-mono text-slate-400 break-all">{isValidAddress(ownerAddress) ? ownerAddress : 'Owner not resolved'}</div>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Owner Council</div>
              <div className="mt-2 kpi-value text-xl text-slate-100">{ownerCouncil.length}</div>
              <div className="mt-2 text-xs text-slate-400">Approvals required: {requiredProposalApprovals}</div>
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
                {vaultPaused ? 'Resume is the only DAO action available while the protocol is paused.' : 'This action now creates a proposal and requires owner approvals before execution.'}
              </div>
            </div>
          </div>
        ) : null}

        {signerIsOwner ? (
          <div className="sagitta-cell col-span-12 lg:col-span-8">
            <h3 className="flex items-center gap-2"><Zap size={20} /> Transfer Ownership</h3>
            <p className="text-sm text-slate-400 mt-2">Ownership transfer is queued as a proposal and executes only after owner approvals.</p>
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

        <div className="sagitta-cell col-span-12 lg:col-span-4">
          <h3 className="flex items-center gap-2"><Users size={20} /> Access Control</h3>
          <div className="mt-2 text-xs text-slate-400">Local role whitelist for test ops. Unlisted wallets default to viewer.</div>

          {signerIsOwner ? (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={roleAddressInput}
                onChange={e => setRoleAddressInput(e.target.value)}
                placeholder="0x... wallet address"
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                disabled={vaultPaused || !signerIsOwner || loading || configBusy}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={roleValueInput}
                  onChange={e => setRoleValueInput(e.target.value as AppRole)}
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                  disabled={vaultPaused || !signerIsOwner || loading || configBusy}
                >
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="owner">owner</option>
                </select>
                <button
                  type="button"
                  onClick={handleSaveRoleAssignment}
                  disabled={vaultPaused || !signerIsOwner || loading || configBusy}
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
                      disabled={vaultPaused || !signerIsOwner || loading || configBusy}
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
        <div className="mt-2 text-xs text-slate-400">DAO controls and config changes are queued first, then executed only after owner approval threshold is met.</div>

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

                  {((signerIsOwner && canApproveAsActualSigner) || showExecuteButton) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {signerIsOwner && canApproveAsActualSigner && (
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
