import { useEffect, useRef, useState } from 'react';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';

import MetricCard from '../ui/MetricCard';
import { ClockIcon as Clock, RefreshIcon as RefreshCw } from '../icons/SagittaIcons';
import PageHeader from '../ui/PageHeader';

import TREASURY_ABI from '../../lib/abis/Treasury.json';
import GOLD_ORACLE_ABI from '../../lib/abis/MockOracle.json'; // use MockOracle ABI for GOLD (or replace with GoldOracle.json if you add it)
import {
  executeDistribution,
  generateDistributionManifestPreview,
  getActiveDistributionRule,
  getDistributionExecution,
  getDistributionManifest,
} from '../../lib/banking/api';
import type {
  DistributionExecution,
  DistributionExecutionLine,
  DistributionManifestAccountRow,
  DistributionManifestInstitutionRow,
  DistributionManifestPayload,
  DistributionManifestRecord,
  DistributionRule,
} from '../../lib/banking/types';
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';
import { useProtocolChain } from '../../context/ProtocolChainContext';
import { readBatchAuthorityAnchorFromChain } from './escrowAuthorityBinding';

const normalizeAbi = (x: any): any => Array.isArray(x) ? x : x?.abi ?? x?.default?.abi ?? x?.default ?? [];
const TREASURY_ABI_NORM: any = normalizeAbi(TREASURY_ABI);
const GOLD_ORACLE_ABI_NORM: any = normalizeAbi(GOLD_ORACLE_ABI);

const BATCH_CADENCE_KEY = 'sagitta:treasury-batch-cadence-seconds';
// Local test private key (Hardhat/Anvil default account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TREASURY_BATCH_STATUS: Record<number, string> = {
  0: 'Pending',
  1: 'Funded',
  2: 'Authorized',
  3: 'Settled',
  4: 'Cancelled',
};
const TREASURY_ORIGIN_TYPE: Record<number, string> = {
  0: 'NONE',
  1: 'VAULT',
  2: 'BANK',
};
const ORIGIN_TYPE_VAULT = 1;
const ORIGIN_LOT_STATUS: Record<number, string> = {
  0: 'None',
  1: 'Available',
  2: 'Allocated',
  3: 'Settled',
  4: 'Cancelled',
};
function bankingUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `/api/banking${normalizedPath}`;
}

const TREASURY_ENGINE_EVENTS = [
  'CollateralizeAttempt',
  'CollateralizeSucceeded',
  'Collateralized',
  'BatchFunded',
  'BatchResult',
  'ReceiptProfitPaid',
] as const;
type TreasuryEngineEvent = typeof TREASURY_ENGINE_EVENTS[number];

function formatUsd(val: number | string, decimals = 6) {
  if (val === null || val === undefined || val === '') return '$0.00';
  const n = typeof val === 'string' ? Number(val) : val;
  const safe = Number.isFinite(n) ? n : 0;
  return '$' + (safe / 10 ** decimals).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRatio(num: number, denom: number) {
  if (!denom || !isFinite(num / denom) || denom === 0) return '–';
  return (num / denom).toFixed(2) + ' : 1.0';
}

function computeCoverageRatio(backingUsd6: number, depositsUsd6: number): number | null {
  if (!Number.isFinite(backingUsd6) || !Number.isFinite(depositsUsd6) || depositsUsd6 <= 0) {
    return null;
  }
  return backingUsd6 / depositsUsd6;
}

function formatCoverageRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'N/A';
  if (ratio >= 1_000_000_000) return `${(ratio / 1_000_000_000).toFixed(2)}B×`;
  if (ratio >= 1_000_000) return `${(ratio / 1_000_000).toFixed(2)}M×`;
  if (ratio >= 10_000) return `${Math.round(ratio).toLocaleString()}×`;
  return `${ratio.toFixed(2)}×`;
}

function formatAddressShort(addr: string | null) {
  if (!addr || addr === 'Not set') return 'Not set';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

function formatHashShort(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length < 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function formatUtcDateTime(date: Date) {
  return `${formatUtcDate(date)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} UTC`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'n/a' : formatUtcDateTime(date);
}

function formatDateOnly(value?: string | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'n/a' : formatUtcDate(date);
}

function formatUsdAmount(value: number | string | null | undefined): string {
  const numeric = typeof value === 'string' ? Number(value) : value ?? 0;
  const safe = Number.isFinite(numeric) ? Number(numeric) : 0;
  return safe.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function humanizeValue(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function canInspectDistributionPreview(phase: string): boolean {
  return phase === 'settlement_received' || phase === 'distribution_pending' || phase === 'complete';
}

function formatChainTime(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  return formatUtcDateTime(new Date(seconds * 1000));
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

type DistributionPreviewState = {
  loading: boolean;
  generating: boolean;
  error: string | null;
  manifest: DistributionManifestRecord | null;
  rule: DistributionRule | null;
  jsonOpen: boolean;
};

const EMPTY_DISTRIBUTION_PREVIEW_STATE: DistributionPreviewState = {
  loading: false,
  generating: false,
  error: null,
  manifest: null,
  rule: null,
  jsonOpen: false,
};

type DistributionExecutionState = {
  loading: boolean;
  executing: boolean;
  error: string | null;
  errorCode: string | null;
  execution: DistributionExecution | null;
  lines: DistributionExecutionLine[];
  confirming: boolean;
  idempotentMessage: string | null;
  receiptOpen: boolean;
};

const EMPTY_DISTRIBUTION_EXECUTION_STATE: DistributionExecutionState = {
  loading: false,
  executing: false,
  error: null,
  errorCode: null,
  execution: null,
  lines: [],
  confirming: false,
  idempotentMessage: null,
  receiptOpen: false,
};

const LINE_TYPE_LABELS: Record<string, string> = {
  circle_payout: 'Treasury / Settlement Rail Payout',
  treasury_coverage: 'Treasury Coverage Used',
  institution_settlement_clearing_credit: 'Fineract Settlement Clearing Credit',
  customer_maturity_credit: 'FD Maturity Close / Transfer',
  bank_fee_credit: 'Bank Fee Allocation',
  treasury_fee_retained: 'Treasury Fee Retained',
  evidence_writeback: 'Evidence Writeback',
};

const EXECUTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Execution Pending',
  executing: 'Executing Distribution',
  failed_before_payout: 'Failed Before Payout',
  payout_pending: 'Treasury Payout Pending',
  payout_failed: 'Treasury Payout Failed',
  payout_completed: 'Treasury Payout Complete',
  completed: 'Distribution Complete',
  failed: 'Distribution Failed',
  partially_completed: 'Distribution Partially Completed',
};

export default function TreasuryTab() {
  const { selectedChain } = useProtocolChain();
  const [renderedAtLabel, setRenderedAtLabel] = useState('Syncing...');
  const [treasuryAddress, setTreasuryAddress] = useState<string>(() => getRuntimeAddress('Treasury'));
  const [goldOracleAddress, setGoldOracleAddress] = useState<string>(() => getRuntimeAddress('GoldOracle'));
  const [treasuryAddressInput, setTreasuryAddressInput] = useState<string>(treasuryAddress);
  const [goldOracleAddressInput, setGoldOracleAddressInput] = useState<string>(goldOracleAddress);
  const [vaultLinkInput, setVaultLinkInput] = useState<string>(() => getRuntimeAddress('Vault'));
  const [escrowLinkInput, setEscrowLinkInput] = useState<string>(() => getRuntimeAddress('InvestmentEscrow'));
  const [reserveLinkInput, setReserveLinkInput] = useState<string>(() => getRuntimeAddress('ReserveController'));
  const [linkedReserveAddress, setLinkedReserveAddress] = useState<string | null>(null);

  const [goldPrice, setGoldPrice] = useState<number>(0);
  const [treasuryUsd, setTreasuryUsd] = useState<number>(0);
  const [reserveUsd, setReserveUsd] = useState<number>(0);
  const [targetReserveUsd, setTargetReserveUsd] = useState<number>(0);
  const [coverageRatio, setCoverageRatio] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // NEW: asset-level metrics
  const [usdcBalance, setUsdcBalance] = useState<number>(0);   // USDC raw (6 decimals)
  const [collateralizedUsd, setCollateralizedUsd] = useState<number>(0); // USD6 recorded collateralized amount;
  // Escrow info
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [escrowUsdcBalance, setEscrowUsdcBalance] = useState<number>(0);


  // Providers and contracts
  const [provider, setProvider] = useState<JsonRpcProvider>();
  const [treasury, setTreasury] = useState<Contract>();
  const [goldOracle, setGoldOracle] = useState<Contract>();
  const [signer, setSigner] = useState<any>(); // Wallet signer for write txs
  const seenLogKeysRef = useRef<Set<string>>(new Set());

  // NEW: show configured vault address and helper formatting
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);

  // BANK Liquidity panel state
  // On-chain anchor status cache keyed by `${chainKey}:${sourceBatchId}`.
  // Populated by chain reads, never from localStorage.
  const [anchorCache, setAnchorCache] = useState<Record<string, { status: 'anchored' | 'pending' | 'unknown'; anchoredAt?: string }>>({});

  const [bankLots, setBankLots] = useState<Array<{
    id: string;
    treasuryOriginLotId: string;
    principalUsd: number;
    liabilityUnlockAt?: string;
    maturityDate: string;
    treasuryBatchId?: string;
    protocolStatus?: string;
    durationClass?: string;
    policyProfileId?: string;
    policyVersion?: number;
    originInstitutionId?: string;
    strategyClass?: string;
    escrowExecutionOrderId?: string;
    entryDate?: string;
    expirationDate?: string;
    treasuryBatchExpectedReturnAt?: string;
    treasuryBatchSettlementDeadlineAt?: string;
    treasuryLotTxHash?: string;
    treasuryBatchTxHash?: string;
    circleTransferTxHash?: string;
    treasurySettlementStatus?: string;
    returnedAmountUsd?: number;
    escrowBatchId?: string;
    escrowCurrentPhase?: number;
  }>>([]);
  const [bankLotsLoading, setBankLotsLoading] = useState(false);
  const [bankLotsError, setBankLotsError] = useState<string | null>(null);
  const [distributionPreviews, setDistributionPreviews] = useState<Record<string, DistributionPreviewState>>({});
  const [distributionExecutions, setDistributionExecutions] = useState<Record<string, DistributionExecutionState>>({});
  const [returningToBankBatchId, setReturningToBankBatchId] = useState<string | null>(null);
  const [returnToBankError, setReturnToBankError] = useState<{ batchId: string; message: string } | null>(null);
  const [bankBatchLoading, setBankBatchLoading] = useState(false);
  const [bankBatchStatus, setBankBatchStatus] = useState<string | null>(null);
  const [bankBatchTone, setBankBatchTone] = useState<'success' | 'warning' | 'danger'>('success');
  const [vaultLots, setVaultLots] = useState<Array<{
    id: number;
    receiptId: string;
    amountUsd6: number;
    fundedAt: number;
    liabilityUnlockAt: number;
    status: number;
    batchId: number;
  }>>([]);
  const [vaultLotsLoading, setVaultLotsLoading] = useState(false);
  const [vaultLotsError, setVaultLotsError] = useState<string | null>(null);
  const [settledVaultBatchIds, setSettledVaultBatchIds] = useState<Set<string>>(new Set());

  function txExplorerUrl(hash?: string | null): string | null {
    if (!hash || !selectedChain.explorerUrl) return null;
    return `${selectedChain.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
  }

  function renderTxHash(hash?: string | null) {
    const href = txExplorerUrl(hash);
    if (!href) return <span>{formatHashShort(hash)}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-amber-200 hover:text-amber-100 underline decoration-amber-400/40 underline-offset-2"
        title={hash || undefined}
      >
        {formatHashShort(hash)}
      </a>
    );
  }

  function patchDistributionPreview(
    escrowBatchId: string,
    next:
      | Partial<DistributionPreviewState>
      | ((current: DistributionPreviewState) => DistributionPreviewState)
  ) {
    setDistributionPreviews((current) => {
      const existing = current[escrowBatchId] ?? EMPTY_DISTRIBUTION_PREVIEW_STATE;
      const resolved = typeof next === 'function'
        ? next(existing)
        : { ...existing, ...next };
      return {
        ...current,
        [escrowBatchId]: resolved,
      };
    });
  }

  async function loadDistributionPreview(escrowBatchId: string) {
    patchDistributionPreview(escrowBatchId, { loading: true, error: null });
    try {
      const [rule, manifest] = await Promise.all([
        getActiveDistributionRule().catch(() => null),
        getDistributionManifest(escrowBatchId),
      ]);
      patchDistributionPreview(escrowBatchId, (current) => ({
        ...current,
        loading: false,
        error: null,
        manifest,
        rule,
      }));
    } catch (e: any) {
      patchDistributionPreview(escrowBatchId, {
        loading: false,
        error: String(e?.message || e),
      });
    }
  }

  async function handleGenerateDistributionPreview(escrowBatchId: string) {
    patchDistributionPreview(escrowBatchId, { generating: true, error: null });
    try {
      const [rule, manifest] = await Promise.all([
        getActiveDistributionRule().catch(() => null),
        generateDistributionManifestPreview(escrowBatchId),
      ]);
      patchDistributionPreview(escrowBatchId, (current) => ({
        ...current,
        generating: false,
        error: null,
        manifest,
        rule,
      }));
    } catch (e: any) {
      patchDistributionPreview(escrowBatchId, {
        generating: false,
        error: String(e?.message || e),
      });
    }
  }
  function patchDistributionExecution(
    escrowBatchId: string,
    next:
      | Partial<DistributionExecutionState>
      | ((current: DistributionExecutionState) => DistributionExecutionState)
  ) {
    setDistributionExecutions((current) => {
      const existing = current[escrowBatchId] ?? EMPTY_DISTRIBUTION_EXECUTION_STATE;
      const resolved = typeof next === 'function'
        ? next(existing)
        : { ...existing, ...next };
      return { ...current, [escrowBatchId]: resolved };
    });
  }

  async function loadDistributionExecution(escrowBatchId: string) {
    patchDistributionExecution(escrowBatchId, { loading: true, error: null });
    try {
      const result = await getDistributionExecution(escrowBatchId);
      patchDistributionExecution(escrowBatchId, {
        loading: false,
        execution: result?.execution ?? null,
        lines: result?.lines ?? [],
      });
    } catch (e: any) {
      patchDistributionExecution(escrowBatchId, {
        loading: false,
        error: String(e?.message || e),
      });
    }
  }

  async function handleExecuteDistribution(escrowBatchId: string) {
    patchDistributionExecution(escrowBatchId, {
      executing: true,
      confirming: false,
      error: null,
      errorCode: null,
      idempotentMessage: null,
    });
    try {
      const result = await executeDistribution(escrowBatchId);
      patchDistributionExecution(escrowBatchId, {
        executing: false,
        execution: result.execution,
        lines: result.lines,
        idempotentMessage: result.idempotent
          ? 'Distribution already completed. Existing execution receipt returned.'
          : null,
      });
      fetchBankLots();
    } catch (e: any) {
      const status = e?.status ?? 0;
      const code = e?.code ?? null;
      const payload = e?.payload ?? null;
      let errorMsg = String(e?.message || e);
      if (status === 409) {
        errorMsg = payload?.error ?? 'Distribution precondition failed or batch is blocked.';
      } else if (status === 503) {
        errorMsg = 'Fineract ledger sync unavailable. Distribution was not executed and no settlement rail movement occurred.';
      } else if (status === 500) {
        errorMsg = payload?.error ?? 'Unexpected error during distribution execution.';
      }
      patchDistributionExecution(escrowBatchId, {
        executing: false,
        error: errorMsg,
        errorCode: code,
      });
    }
  }

  const [vaultBatchLoading, setVaultBatchLoading] = useState(false);
  const [vaultBatchStatus, setVaultBatchStatus] = useState<string | null>(null);
  const [vaultBatchTone, setVaultBatchTone] = useState<'success' | 'warning' | 'danger'>('success');
  const [batchCadenceSeconds] = useState<number>(() => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(BATCH_CADENCE_KEY) : null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 24 * 60 * 60;
  });
  const [linkConfigLoading, setLinkConfigLoading] = useState(false);
  const [linkConfigStatus, setLinkConfigStatus] = useState<string | null>(null);

  // Execution Authorization panel state
  const [authBatchIdInput, setAuthBatchIdInput] = useState('');
  const [authBatchInfo, setAuthBatchInfo] = useState<{
    batchId: number;
    originType: number;
    principalAllocated: number;
    lotCount: number;
    status: number;
    expectedReturnAt: number;
  } | null>(null);
  const [authBatchFetchError, setAuthBatchFetchError] = useState<string | null>(null);
  const [authBatchLoading, setAuthBatchLoading] = useState(false);
  const [authRouteId, setAuthRouteId] = useState('');
  const [authMaxAllocation, setAuthMaxAllocation] = useState('');
  const [authExpectedCloseTime, setAuthExpectedCloseTime] = useState('');
  const [authSettlementUnit, setAuthSettlementUnit] = useState('USDC');
  const [authLoading, setAuthLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authStatusTone, setAuthStatusTone] = useState<'success' | 'danger' | 'warning'>('success');

  // Lot table UX
  const [lotSource, setLotSource] = useState<'BANK' | 'VAULT'>('BANK');
  const [bankLotFilter, setBankLotFilter] = useState<'all' | 'ready' | 'in_escrow' | 'settlement_received' | 'distribution_pending' | 'complete' | 'exceptions'>('all');
  const [vaultLotFilter, setVaultLotFilter] = useState<'all' | 'eligible' | 'batched' | 'settled'>('all');
  const [lotSearch, setLotSearch] = useState('');
  const [lotSortCol, setLotSortCol] = useState<'lot' | 'principal' | 'maturity' | 'entry'>('entry');
  const [lotSortDir, setLotSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());
  const [lotPage, setLotPage] = useState(1);
  const [wiringOpen, setWiringOpen] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const LOT_PAGE_SIZE = 25;

  // Keep address states in sync whenever loadGeneratedRuntimeAddresses() or setRuntimeAddress() fires.
  useEffect(() => {
    const sync = () => {
      setTreasuryAddress(getRuntimeAddress('Treasury'));
      setGoldOracleAddress(getRuntimeAddress('GoldOracle'));
      setVaultLinkInput(getRuntimeAddress('Vault'));
      setEscrowLinkInput(getRuntimeAddress('InvestmentEscrow'));
      setReserveLinkInput(getRuntimeAddress('ReserveController'));
    };
    window.addEventListener('sagitta:addresses-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sagitta:addresses-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, [selectedChain.key]);

  useEffect(() => {
    setRenderedAtLabel(formatUtcDateTime(new Date()));
  }, []);

  // On mount: setup provider and contracts
  useEffect(() => {
    if (!isValidAddress(treasuryAddress) || !isValidAddress(goldOracleAddress)) {
      setTreasury(undefined);
      setGoldOracle(undefined);
      return;
    }
    const rp = new JsonRpcProvider(selectedChain.rpcUrl);
    // create local contract instances immediately for initial fetch
    const localTreasury = new Contract(treasuryAddress, TREASURY_ABI_NORM, rp);
    const localGoldOracle = new Contract(goldOracleAddress, GOLD_ORACLE_ABI_NORM, rp);
    const w = new Wallet(TEST_PRIVATE_KEY, rp);

    // set stateful references for later interactions (refresh, controls)
    setProvider(rp);
    setTreasury(localTreasury);
    setGoldOracle(localGoldOracle);
    setSigner(w);

    // read and surface linked protocol addresses
    (async () => {
      try {
        const [v, e, r] = await Promise.all([
          localTreasury.vault().catch(() => null),
          localTreasury.escrow().catch(() => null),
          localTreasury.reserveAddress().catch(() => null),
        ]);
        setVaultAddress(v && v !== '0x0000000000000000000000000000000000000000' ? v : null);
        if (v && v !== '0x0000000000000000000000000000000000000000') {
          setVaultLinkInput(v);
        }
        if (!v || v === '0x0000000000000000000000000000000000000000') {
          setLog(l => [`[init] Treasury.vault is not set - collateralize() will revert`, ...l]);
        }
        setEscrowAddress(e && e !== '0x0000000000000000000000000000000000000000' ? e : null);
        if (e && e !== '0x0000000000000000000000000000000000000000') {
          setEscrowLinkInput(e);
        }
        setLinkedReserveAddress(r && r !== '0x0000000000000000000000000000000000000000' ? r : null);
        if (r && r !== '0x0000000000000000000000000000000000000000') {
          setReserveLinkInput(r);
        }
      } catch { /* ignore */ }
    })();

    // initial load: fetch totals + treasury/oracle values so UI is populated on first render
    (async () => {
      setLoading(true);
      try {
        const [goldPriceRaw, treasuryUsdRaw, reserveUsdRaw, targetReserveUsdRaw] = await Promise.all([
          localGoldOracle.getPrice(),
          localTreasury.getTreasuryValueUsd(),
          localTreasury.getReserveValueUsd(),
          localTreasury.getTargetReserveUsd(),
        ]);
        const goldUsd = Number(goldPriceRaw) / 1e8;

        setGoldPrice(goldUsd);
        setTreasuryUsd(Number(treasuryUsdRaw));
        setReserveUsd(Number(reserveUsdRaw));
        setTargetReserveUsd(Number(targetReserveUsdRaw));

        // NEW: fetch token balances and collateralized total
        let latestCollateralizedUsd = 0;
        try {
          const usdcAddr = await localTreasury.usdc();
          const ercBalanceAbi = ['function balanceOf(address) view returns (uint256)'];
          const usdcToken = new Contract(usdcAddr, ercBalanceAbi, rp);
          const usdcBalRaw = await usdcToken.balanceOf(treasuryAddress);
          setUsdcBalance(Number(usdcBalRaw));
          try {
            const collUsd = await localTreasury.totalCollateralUsd();
            latestCollateralizedUsd = Number(collUsd) || 0;
            setCollateralizedUsd(latestCollateralizedUsd);
          } catch {
            latestCollateralizedUsd = 0;
            setCollateralizedUsd(0);
          }
          // fetch escrow USDC balance if escrow set
          try {
            const escrowAddrLocal = await localTreasury.escrow().catch(()=>null);
            if (escrowAddrLocal && escrowAddrLocal !== '0x0000000000000000000000000000000000000000') {
              setEscrowAddress(escrowAddrLocal);
              const escrowUsdcBal = await usdcToken.balanceOf(escrowAddrLocal).catch(()=>0);
              setEscrowUsdcBalance(Number(escrowUsdcBal));
            } else {
              setEscrowUsdcBalance(0);
            }
          } catch { setEscrowUsdcBalance(0); }
        } catch {
          setUsdcBalance(0);
          setCollateralizedUsd(0);
          latestCollateralizedUsd = 0;
        }
        setCoverageRatio(
          computeCoverageRatio(
            Number(treasuryUsdRaw) + Number(reserveUsdRaw),
            latestCollateralizedUsd
          )
        );

      } catch (e) {
        console.error(e);
        setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching initial state: ${e}`, ...l]);
      } finally {
        setLoading(false);
      }
    })();
  }, [treasuryAddress, goldOracleAddress, selectedChain.rpcUrl]);

  useEffect(() => {
    fetchBankLots();
  }, []);

  // Read anchor status for each BANK lot directly from the InvestmentEscrow contract.
  // localStorage is NOT used as source of truth for anchor status.
  useEffect(() => {
    const effectiveEscrow = (escrowAddress && isValidAddress(escrowAddress))
      ? escrowAddress
      : (isValidAddress(escrowLinkInput) ? escrowLinkInput : null);
    const lotsWithBatch = bankLots.filter(lot => lot.treasuryBatchId);
    if (lotsWithBatch.length === 0 || !effectiveEscrow) return;

    let cancelled = false;

    Promise.all(
      lotsWithBatch.map(async (lot) => {
        const key = `${selectedChain.key}:${lot.treasuryBatchId}`;
        try {
          const result = await readBatchAuthorityAnchorFromChain({
            escrowAddress: effectiveEscrow,
            sourceBatchId: String(lot.treasuryBatchId),
            rpcUrl: selectedChain.rpcUrl,
          });
          if (cancelled) return;
          setAnchorCache(prev => ({
            ...prev,
            [key]: {
              status: result?.exists ? 'anchored' : 'pending',
              anchoredAt: result?.anchoredAt,
            },
          }));
        } catch {
          if (!cancelled) {
            setAnchorCache(prev => ({
              ...prev,
              [key]: { status: 'unknown' },
            }));
          }
        }
      })
    );

    return () => { cancelled = true; };
  }, [bankLots, escrowAddress, escrowLinkInput, selectedChain.key, selectedChain.rpcUrl]);

  useEffect(() => {
    if (treasury) fetchVaultLots();
  }, [treasury]);

  useEffect(() => {
    setTreasuryAddressInput(treasuryAddress);
  }, [treasuryAddress]);

  useEffect(() => {
    setGoldOracleAddressInput(goldOracleAddress);
  }, [goldOracleAddress]);

  // Helper: format USD6 BigNumber or numeric into $ string
  function fmtUsd6FromAny(x: any) {
    try {
      const s = x?.toString?.() ?? String(x ?? '0');
      return '$' + (Number(s) / 1e6).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return '$0.00';
    }
  }

  function makeEventKey(eventName: TreasuryEngineEvent, eventLike: any, fallbackSeed: number) {
    const tx =
      eventLike?.transactionHash ??
      eventLike?.txHash ??
      eventLike?.log?.transactionHash ??
      '';
    const idx =
      eventLike?.index ??
      eventLike?.logIndex ??
      eventLike?.log?.index ??
      0;
    if (!tx) return `${eventName}:fallback:${fallbackSeed}`;
    return `${eventName}:${tx}:${idx}`;
  }

  function eventArgsArray(argsLike: any): any[] {
    if (Array.isArray(argsLike)) return argsLike;
    const len = Number(argsLike?.length ?? 0);
    if (!Number.isFinite(len) || len <= 0) return [];
    const arr: any[] = [];
    for (let i = 0; i < len; i++) arr.push(argsLike[i]);
    return arr;
  }

  function formatEngineEvent(eventName: TreasuryEngineEvent, args: any[]) {
    if (eventName === 'CollateralizeAttempt') {
      const [requestedUsd, usdcBefore] = args;
      return `[CollateralizeAttempt] request=${fmtUsd6FromAny(requestedUsd)} usdcBefore=${fmtUsd6FromAny(usdcBefore)}`;
    }
    if (eventName === 'CollateralizeSucceeded') {
      const [requestedUsd, usdcAfter] = args;
      return `[CollateralizeSucceeded] request=${fmtUsd6FromAny(requestedUsd)} usdcAfter=${fmtUsd6FromAny(usdcAfter)}`;
    }
    if (eventName === 'Collateralized') {
      const [amountUsd] = args;
      return `[Collateralized] ${fmtUsd6FromAny(amountUsd)} recorded`;
    }
    if (eventName === 'BatchFunded') {
      const [batchId, amountUsd] = args;
      return `[BatchFunded] batch=${batchId?.toString?.() ?? String(batchId)} amount=${fmtUsd6FromAny(amountUsd)} (funds moved to Escrow)`;
    }
    if (eventName === 'ReceiptProfitPaid') {
      const [receiptId, recipient, amountUsd] = args;
      return `[ReceiptProfitPaid] receipt=${receiptId?.toString?.() ?? String(receiptId)} recipient=${String(recipient)} amount=${fmtUsd6FromAny(amountUsd)}`;
    }
    const [batchId, principalUsd, userProfitUsd, feeUsd] = args;
    return `[BatchResult] batch=${batchId?.toString?.() ?? String(batchId)} principal=${fmtUsd6FromAny(principalUsd)} userProfit=${fmtUsd6FromAny(userProfitUsd)} fee=${fmtUsd6FromAny(feeUsd)}`;
  }

  function pushEngineLog(entry: string, key?: string) {
    if (key) {
      if (seenLogKeysRef.current.has(key)) return;
      seenLogKeysRef.current.add(key);
    }
    setLog(prev => [entry, ...prev].slice(0, 300));
  }

  // Backfill recent on-chain events so logs survive tab remounts/reloads.
  useEffect(() => {
    if (!provider || !treasury) return;
    let cancelled = false;

    (async () => {
      try {
        const latest = await provider.getBlockNumber();
        // Moonbase Alpha (and many testnets) cap eth_getLogs at 1024 blocks per request.
        const fromBlock = Math.max(0, latest - 1000);

        const historical: Array<{ key: string; block: number; index: number; msg: string }> = [];
        for (const eventName of TREASURY_ENGINE_EVENTS) {
          const filterFactory = (treasury.filters as any)?.[eventName];
          if (typeof filterFactory !== 'function') continue;
          const filter = filterFactory();
          const events = await treasury.queryFilter(filter, fromBlock, latest);
          for (const ev of events as any[]) {
            const key = makeEventKey(eventName, ev, historical.length);
            const args = eventArgsArray(ev?.args);
            const msg = formatEngineEvent(eventName, args);
            historical.push({
              key,
              block: Number(ev?.blockNumber ?? 0),
              index: Number(ev?.index ?? ev?.logIndex ?? 0),
              msg,
            });
          }
        }

        historical.sort((a, b) => (b.block === a.block ? b.index - a.index : b.block - a.block));
        if (cancelled) return;

        const insert: string[] = [];
        for (const row of historical) {
          if (seenLogKeysRef.current.has(row.key)) continue;
          seenLogKeysRef.current.add(row.key);
          insert.push(row.msg);
        }
        if (insert.length > 0) {
          setLog(prev => [...insert, ...prev].slice(0, 300));
        }
      } catch (e: any) {
        if (!cancelled) {
          setLog(prev => [`[events] backfill failed: ${String(e?.message || e)}`, ...prev].slice(0, 300));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, treasury]);

  // subscribe to new blocks and refresh Treasury state immediately
  useEffect(() => {
    if (!provider) return;
    const onBlock = async (_blockNumber: number) => {
      try { await refreshTreasuryState(); } catch (_) {}
    };
    provider.on('block', onBlock);
    return () => { provider.off('block', onBlock); };
  }, [provider, treasury, goldOracle]);

  // Subscribe to treasury events for Engine Log
  useEffect(() => {
    if (!provider || !treasury) return;

    // Ensure ABI exposes event fragments before subscribing (prevents "unknown fragment" runtime error)
    let supportsEvents = true;
    try {
      // will throw if event fragment not present
      treasury.interface.getEvent('CollateralizeAttempt');
    } catch {
      supportsEvents = false;
    }
    if (!supportsEvents) {
      setLog(l => [`[events] Treasury ABI missing event fragments, skipping subscriptions`, ...l]);
      return;
    }

    const onAttempt = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('CollateralizeAttempt', params);
      pushEngineLog(message, makeEventKey('CollateralizeAttempt', event, Date.now()));
    };
    const onSucceeded = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('CollateralizeSucceeded', params);
      pushEngineLog(message, makeEventKey('CollateralizeSucceeded', event, Date.now()));
    };
    const onCollateralized = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('Collateralized', params);
      pushEngineLog(message, makeEventKey('Collateralized', event, Date.now()));
    };
    const onBatchFunded = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('BatchFunded', params);
      pushEngineLog(message, makeEventKey('BatchFunded', event, Date.now()));
      // refresh balances so Escrow USDC shows up immediately
      try { refreshTreasuryState(); } catch {}
    };
    const onBatchResult = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('BatchResult', params);
      pushEngineLog(message, makeEventKey('BatchResult', event, Date.now()));
    };
    const onReceiptProfitPaid = (...params: any[]) => {
      const event = params[params.length - 1];
      const message = formatEngineEvent('ReceiptProfitPaid', params);
      pushEngineLog(message, makeEventKey('ReceiptProfitPaid', event, Date.now()));
    };

    // safe to attach since ABI has fragments
    treasury.on('CollateralizeAttempt', onAttempt);
    treasury.on('CollateralizeSucceeded', onSucceeded);
    treasury.on('Collateralized', onCollateralized);
    treasury.on('BatchFunded', onBatchFunded);
    treasury.on('BatchResult', onBatchResult);
    treasury.on('ReceiptProfitPaid', onReceiptProfitPaid);

    return () => {
      // remove listeners only if ABI supports events
      try {
        treasury.off('CollateralizeAttempt', onAttempt);
        treasury.off('CollateralizeSucceeded', onSucceeded);
        treasury.off('Collateralized', onCollateralized);
        treasury.off('BatchFunded', onBatchFunded);
        treasury.off('BatchResult', onBatchResult);
        treasury.off('ReceiptProfitPaid', onReceiptProfitPaid);
      } catch {
        // ignore cleanup errors
      }
    };
  }, [provider, treasury]);

  // Fetch all metrics
  async function refreshTreasuryState() {
    if (!treasury || !goldOracle) return;
    setLoading(true);
    try {
      const [goldPriceRaw, treasuryUsdRaw, reserveUsdRaw, targetReserveUsdRaw] = await Promise.all([
        goldOracle.getPrice(),
        treasury.getTreasuryValueUsd(),
        treasury.getReserveValueUsd(),
        treasury.getTargetReserveUsd(),
      ]);

      // convert oracle 8-decimal -> human USD numbers
      const goldUsd = Number(goldPriceRaw) / 1e8;

      setGoldPrice(goldUsd);
      setTreasuryUsd(Number(treasuryUsdRaw)); // already in USD6
      setReserveUsd(Number(reserveUsdRaw)); // USD6
      setTargetReserveUsd(Number(targetReserveUsdRaw)); // USD6

      // NEW: update asset balances and collateralized amount
      let latestCollateralizedUsd = collateralizedUsd;
      try {
        const usdcAddr = await treasury.usdc();
        const ercBalanceAbi = ['function balanceOf(address) view returns (uint256)'];
        const usdcToken = new Contract(usdcAddr, ercBalanceAbi, provider);
        const [usdcBalRaw, collUsdRaw] = await Promise.all([
          usdcToken.balanceOf(treasuryAddress),
          treasury.totalCollateralUsd()
        ]);
        setUsdcBalance(Number(usdcBalRaw));
        latestCollateralizedUsd = Number(collUsdRaw) || 0;
        setCollateralizedUsd(latestCollateralizedUsd);

        try {
          const [vaultAddrLocal, escrowAddrLocal, reserveAddrLocal] = await Promise.all([
            treasury.vault().catch(() => null),
            treasury.escrow().catch(() => null),
            treasury.reserveAddress().catch(() => null),
          ]);

          if (vaultAddrLocal && vaultAddrLocal !== '0x0000000000000000000000000000000000000000') {
            setVaultAddress(vaultAddrLocal);
            setVaultLinkInput(vaultAddrLocal);
          } else {
            setVaultAddress(null);
          }

          if (reserveAddrLocal && reserveAddrLocal !== '0x0000000000000000000000000000000000000000') {
            setLinkedReserveAddress(reserveAddrLocal);
            setReserveLinkInput(reserveAddrLocal);
          } else {
            setLinkedReserveAddress(null);
          }

          if (escrowAddrLocal && escrowAddrLocal !== '0x0000000000000000000000000000000000000000') {
            setEscrowAddress(escrowAddrLocal);
            setEscrowLinkInput(escrowAddrLocal);
            const escrowUsdcRaw = await usdcToken.balanceOf(escrowAddrLocal).catch(()=>0);
            setEscrowUsdcBalance(Number(escrowUsdcRaw));
          } else {
            setEscrowAddress(null);
            setEscrowUsdcBalance(0);
          }
        } catch { setEscrowUsdcBalance(0); }
      } catch {
        // ignore and keep previous values
      }
      setCoverageRatio(
        computeCoverageRatio(
          Number(treasuryUsdRaw) + Number(reserveUsdRaw),
          latestCollateralizedUsd
        )
      );
      setRenderedAtLabel(formatUtcDateTime(new Date()));

    } catch (e) {
      console.error(e);
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching state: ${e}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBankLots() {
    setBankLotsLoading(true);
    setBankLotsError(null);
    try {
      const lifecycleQs = new URLSearchParams({ chainKey: selectedChain.key });
      if (isValidAddress(treasuryAddress)) lifecycleQs.set('treasuryAddress', treasuryAddress.toLowerCase());
      if (isValidAddress(escrowAddress)) lifecycleQs.set('escrowAddress', escrowAddress.toLowerCase());

      const [stateRes, lifecycleRes] = await Promise.all([
        fetch(bankingUrl('/state')),
        fetch(`/api/banking/escrow/lifecycle/list?${lifecycleQs.toString()}`),
      ]);
      if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
      const data = await stateRes.json();
      const lifecycleData = lifecycleRes.ok ? await lifecycleRes.json() : [];
      const lifecycleItems = Array.isArray(lifecycleData) ? lifecycleData : [];
      const lifecycleBySourceBatch = new Map(
        lifecycleItems
          .map((item: any) => item?.lifecycle ?? item)
          .filter((row: any) => row?.source_batch_id)
          .map((row: any) => [String(row.source_batch_id), row])
      );
      const treasuryLots = (data.treasuryLots ?? data.state?.treasuryLots ?? []) as Array<any>;
      const positions = (data.termPositions ?? data.state?.termPositions ?? []) as Array<any>;
      const escrowOrders = (data.escrowExecutionOrders ?? data.state?.escrowExecutionOrders ?? []) as Array<any>;
      const orderByBatch = new Map(
        escrowOrders.map((order: any) => [String(order.batchId), order])
      );
      const sourceLots = treasuryLots.length > 0
        ? treasuryLots.map((lot: any) => {
            const order = lot.treasuryBatchId ? orderByBatch.get(String(lot.treasuryBatchId)) : null;
            const lifecycle = lot.treasuryBatchId ? lifecycleBySourceBatch.get(String(lot.treasuryBatchId)) : null;
            return ({
            id: lot.termPositionId ?? lot.id,
            treasuryOriginLotId: lot.treasuryOriginLotId,
            principalUsd: lot.principalUsd ?? 0,
            maturityDate: lot.maturityDate ?? lot.expirationDate,
            liabilityUnlockAt: lot.liabilityUnlockAt,
            treasuryBatchId: lot.treasuryBatchId,
            protocolStatus: lot.protocolStatus ?? lot.status,
            durationClass: lot.durationClass,
            policyProfileId: lot.policyProfileId,
            policyVersion: lot.policyVersion,
            originInstitutionId: lot.originInstitutionId,
            strategyClass: lot.strategyClass,
            escrowExecutionOrderId: lot.escrowExecutionOrderId,
            entryDate: lot.entryDate ?? lot.createdAt,
            expirationDate: lot.expirationDate ?? lot.maturityDate,
            treasuryBatchExpectedReturnAt: lot.treasuryBatchExpectedReturnAt,
            treasuryBatchSettlementDeadlineAt: lot.treasuryBatchSettlementDeadlineAt,
            treasuryLotTxHash: lot.treasuryLotTxHash ?? lot.metadata?.treasuryLotTxHash,
            treasuryBatchTxHash: lot.treasuryBatchTxHash ?? lot.metadata?.treasuryBatchTxHash,
            circleTransferTxHash: lot.circleTransferTxHash ?? lot.metadata?.circleTransferTxHash,
            treasurySettlementStatus: lot.treasurySettlementStatus ?? lot.metadata?.treasurySettlementStatus,
            returnedAmountUsd: Number(lot.returnedAmountUsd ?? 0) || undefined,
            escrowBatchId: lifecycle?.escrow_batch_id ?? undefined,
            escrowCurrentPhase: typeof lifecycle?.current_phase === 'number' ? lifecycle.current_phase : undefined,
          });
          })
        : positions
          .filter((p: any) => p.treasuryOriginLotId && p.status !== 'not_funded')
          .map((p: any) => {
            const order = p.treasuryBatchId ? orderByBatch.get(String(p.treasuryBatchId)) : null;
            const lifecycle = p.treasuryBatchId ? lifecycleBySourceBatch.get(String(p.treasuryBatchId)) : null;
            return ({
            id: p.id,
            treasuryOriginLotId: p.treasuryOriginLotId,
            principalUsd: p.principalUsd ?? 0,
            maturityDate: p.maturityDate,
            liabilityUnlockAt: p.liabilityUnlockAt,
            treasuryBatchId: p.treasuryBatchId,
            protocolStatus: p.protocolStatus ?? p.protocolSyncStatus,
            durationClass: p.durationClass,
            policyProfileId: p.policyProfileId,
            policyVersion: p.policyVersion,
            originInstitutionId: p.originInstitutionId,
            strategyClass: p.strategyClass,
            escrowExecutionOrderId: p.escrowExecutionOrderId,
            entryDate: p.entryDate ?? p.openedAt ?? p.createdAt,
            expirationDate: p.expirationDate ?? p.maturityDate,
            treasuryBatchExpectedReturnAt: p.treasuryBatchExpectedReturnAt,
            treasuryBatchSettlementDeadlineAt: p.treasuryBatchSettlementDeadlineAt,
            treasuryLotTxHash: p.treasuryLotTxHash ?? p.metadata?.treasuryLotTxHash,
            treasuryBatchTxHash: p.treasuryBatchTxHash ?? p.metadata?.treasuryBatchTxHash,
            circleTransferTxHash: p.circleTransferTxHash ?? p.metadata?.circleTransferTxHash,
            treasurySettlementStatus: p.treasurySettlementStatus ?? p.metadata?.treasurySettlementStatus,
            returnedAmountUsd: Number(p.returnedAmountUsd ?? 0) || undefined,
            escrowBatchId: lifecycle?.escrow_batch_id ?? undefined,
            escrowCurrentPhase: typeof lifecycle?.current_phase === 'number' ? lifecycle.current_phase : undefined,
          });
          });
      setBankLots(sourceLots.filter((lot: any) => lot.treasuryOriginLotId));
    } catch (e: any) {
      setBankLotsError(String(e?.message || e));
    } finally {
      setBankLotsLoading(false);
    }
  }

  async function handleReturnToTreasury(batchId: string) {
    setReturningToBankBatchId(batchId);
    setReturnToBankError(null);
    try {
      // Reads Phase 9 escrow lifecycle evidence for this batch and marks it wire_ready.
      // No prior advance-settlement call needed — the lifecycle evidence IS the source of truth.
      const res = await fetch(bankingUrl(`/escrow/execution-orders/${encodeURIComponent(batchId)}/settle-from-lifecycle`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? body?.message ?? `HTTP ${res.status}`);
      await fetchBankLots();
    } catch (e: any) {
      setReturnToBankError({ batchId, message: String(e?.message || e) });
    } finally {
      setReturningToBankBatchId(null);
    }
  }

  function decodeReceiptId(originRefId: any): string {
    const raw = originRefId?.toString?.() ?? String(originRefId ?? '');
    if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw || 'n/a';
    try {
      return BigInt(raw).toString();
    } catch {
      return raw;
    }
  }

  function getVaultBatchWindow(lots = vaultLots): { expectedReturnAt: number; settlementDeadlineAt: number; eligibleLots: typeof vaultLots } {
    const now = Math.floor(Date.now() / 1000);
    const expectedReturnAt = now + batchCadenceSeconds;
    const settlementDeadlineAt = expectedReturnAt + 7 * 24 * 60 * 60;
    const eligibleLots = lots.filter(lot =>
      lot.status === 1 &&
      lot.batchId === 0 &&
      lot.liabilityUnlockAt >= settlementDeadlineAt
    );
    return { expectedReturnAt, settlementDeadlineAt, eligibleLots };
  }

  async function fetchVaultLots() {
    if (!treasury) return;
    setVaultLotsLoading(true);
    setVaultLotsError(null);
    try {
      const [idsRaw, ordersRes] = await Promise.allSettled([
        (treasury as any).getOriginLotsByType(ORIGIN_TYPE_VAULT),
        fetch(bankingUrl('/escrow/execution-orders')),
      ]);

      // Collect settled batch IDs from escrow execution orders (for simulated Treasury mode
      // where on-chain lot.status stays Allocated even after settlement)
      if (ordersRes.status === 'fulfilled' && ordersRes.value.ok) {
        const ordersData = await ordersRes.value.json().catch(() => ({}));
        const orders: any[] = ordersData.data ?? ordersData ?? [];
        const settled = new Set<string>(
          orders
            .filter((o: any) => o.sourceType === 'VAULT' && o.settlementStatus === 'settled')
            .map((o: any) => String(o.batchId ?? ''))
            .filter(Boolean)
        );
        setSettledVaultBatchIds(settled);
      }

      if (idsRaw.status === 'rejected') throw idsRaw.reason;
      const ids = Array.from(idsRaw.value ?? []).map((id: any) => Number(id));
      const lotsRaw = await Promise.all(ids.map(id => (treasury as any).originLots(id)));
      setVaultLots(lotsRaw.map((lot: any, idx) => ({
        id: Number(lot.id ?? lot[0] ?? ids[idx] ?? 0),
        receiptId: decodeReceiptId(lot.originRefId ?? lot[2]),
        amountUsd6: Number(lot.amount ?? lot[3] ?? 0),
        fundedAt: Number(lot.fundedAt ?? lot[4] ?? 0),
        liabilityUnlockAt: Number(lot.liabilityUnlockAt ?? lot[5] ?? 0),
        status: Number(lot.status ?? lot[6] ?? 0),
        batchId: Number(lot.batchId ?? lot[7] ?? 0),
      })));
    } catch (e: any) {
      setVaultLotsError(String(e?.reason || e?.message || e));
    } finally {
      setVaultLotsLoading(false);
    }
  }

  async function handleCreateVaultBatch() {
    const { expectedReturnAt, settlementDeadlineAt, eligibleLots } = getVaultBatchWindow();
    if (eligibleLots.length === 0) {
      setVaultBatchTone('warning');
      setVaultBatchStatus(`No VAULT-origin lots can cover settlement by ${formatChainTime(settlementDeadlineAt)}.`);
      return;
    }

    setVaultBatchLoading(true);
    setVaultBatchStatus(null);
    try {
      const res = await fetch(bankingUrl('/treasury/vault-batches'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainKey: selectedChain.key,
          chainId: selectedChain.chainId,
          expectedReturnAt: new Date(expectedReturnAt * 1000).toISOString(),
          settlementDeadlineAt: new Date(settlementDeadlineAt * 1000).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.treasuryBatchId) {
        setVaultBatchTone('success');
        setVaultBatchStatus(`Batch #${data.treasuryBatchId} handed to Escrow with ${data.includedVaultLotIds?.length ?? 0} lot(s).`);
        pushEngineLog(`[TreasuryHandoff:Vault] batch=${data.treasuryBatchId} lots=${(data.includedVaultLotIds ?? []).join(',')}`);
      } else {
        setVaultBatchTone('warning');
        setVaultBatchStatus(data.skippedReason || 'No eligible VAULT lots are ready for batching.');
      }
      await Promise.allSettled([fetchVaultLots(), refreshTreasuryState()]);
    } catch (e: any) {
      setVaultBatchTone('danger');
      setVaultBatchStatus(String(e?.message || e));
    } finally {
      setVaultBatchLoading(false);
    }
  }

  async function handleCreateBankBatch() {
    setBankBatchLoading(true);
    setBankBatchStatus(null);
    try {
      const res = await fetch(bankingUrl('/treasury/batches'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainKey: selectedChain.key, chainId: selectedChain.chainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.treasuryBatchId) {
        setBankBatchTone('success');
        setBankBatchStatus(`Batch #${data.treasuryBatchId} handed to Escrow with ${data.includedTermDepositIds?.length ?? 0} compatible lot(s).`);
        pushEngineLog(`[TreasuryHandoff] batch=${data.treasuryBatchId} lots=${(data.includedTermDepositIds ?? []).join(',')}`);
      } else {
        setBankBatchTone('warning');
        setBankBatchStatus(data.skippedReason || 'No eligible BANK lots are ready for batching.');
      }
      await fetchBankLots();
    } catch (e: any) {
      setBankBatchTone('danger');
      setBankBatchStatus(String(e?.message || e));
    } finally {
      setBankBatchLoading(false);
    }
  }

  async function handleFetchBatch() {
    const batchId = parseInt(authBatchIdInput.trim(), 10);
    if (!treasury || isNaN(batchId) || batchId <= 0) {
      setAuthBatchFetchError('Enter a valid batch ID and ensure Treasury is connected.');
      return;
    }
    setAuthBatchLoading(true);
    setAuthBatchFetchError(null);
    setAuthBatchInfo(null);
    try {
      const batch = await treasury.getTreasuryBatch(batchId);
      setAuthBatchInfo({
        batchId: Number(batch.batchId),
        originType: Number(batch.originType),
        principalAllocated: Number(batch.principalAllocated),
        lotCount: Array.isArray(batch.lotIds) ? batch.lotIds.length : 0,
        status: Number(batch.status),
        expectedReturnAt: Number(batch.expectedReturnAt),
      });
    } catch (e: any) {
      setAuthBatchFetchError(`Batch not found: ${String(e?.reason || e?.message || e)}`);
    } finally {
      setAuthBatchLoading(false);
    }
  }

  async function handleAuthorizeExecution() {
    if (!signer || !authBatchInfo) return;
    const routeId = parseInt(authRouteId.trim(), 10);
    const maxAllocUsd = parseFloat(authMaxAllocation.trim());
    const closeTime = parseInt(authExpectedCloseTime.trim(), 10);
    const unit = authSettlementUnit.trim();
    if (isNaN(routeId) || routeId <= 0) { setAuthStatus('Route ID is required.'); setAuthStatusTone('danger'); return; }
    if (isNaN(maxAllocUsd) || maxAllocUsd <= 0) { setAuthStatus('Max allocation is required.'); setAuthStatusTone('danger'); return; }
    if (isNaN(closeTime) || closeTime <= 0) { setAuthStatus('Expected close time (unix) is required.'); setAuthStatusTone('danger'); return; }
    if (!unit) { setAuthStatus('Settlement unit is required.'); setAuthStatusTone('danger'); return; }

    const maxAllocUsd6 = Math.round(maxAllocUsd * 1_000_000);
    const settlementUnitBytes32 = '0x' + Buffer.from(unit.slice(0, 32).padEnd(32, '\0')).toString('hex');

    setAuthLoading(true);
    setAuthStatus(null);
    try {
      const treasuryWrite = new Contract(treasuryAddress, TREASURY_ABI_NORM, signer);
      const tx = await treasuryWrite.authorizeEscrowBatch(
        authBatchInfo.batchId,
        closeTime,
        settlementUnitBytes32,
        [{ routeId, maxAllocationUsd6: maxAllocUsd6 }],
      );
      await tx.wait();
      setAuthStatus(`Batch #${authBatchInfo.batchId} authorized. Tx: ${tx.hash}`);
      setAuthStatusTone('success');
      setAuthBatchInfo(prev => prev ? { ...prev, status: 2 } : prev);
      pushEngineLog(`[AuthorizeEscrowBatch] batch=${authBatchInfo.batchId} route=${routeId} maxAlloc=${fmtUsd6FromAny(maxAllocUsd6)}`);
    } catch (e: any) {
      setAuthStatus(`Authorization failed: ${String(e?.reason || e?.message || e)}`);
      setAuthStatusTone('danger');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSaveBatchCadence() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(BATCH_CADENCE_KEY, String(batchCadenceSeconds));
      }
      setLog(l => [`[${new Date().toLocaleTimeString()}] Batch cadence updated to ${formatSecondsLabel(batchCadenceSeconds)} (dashboard schedule)`, ...l]);
    } catch (e) {
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error saving batch cadence: ${e}`, ...l]);
    }
  }

  function handleUseTreasuryAddress() {
    const next = treasuryAddressInput.trim();
    if (!setRuntimeAddress('Treasury', next)) {
      setLinkConfigStatus('Invalid Treasury address');
      return;
    }
    setTreasuryAddress(next);
    setLinkConfigStatus(`Using Treasury ${next}`);
  }

  function handleUseGoldOracleAddress() {
    const next = goldOracleAddressInput.trim();
    if (!setRuntimeAddress('GoldOracle', next)) {
      setLinkConfigStatus('Invalid GoldOracle address');
      return;
    }
    setGoldOracleAddress(next);
    setLinkConfigStatus(`Using GoldOracle ${next}`);
  }

  async function handleSetTreasuryVaultLink() {
    if (!signer || !isValidAddress(treasuryAddress) || !isValidAddress(vaultLinkInput.trim())) {
      setLinkConfigStatus('Invalid Treasury or Vault address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const nextVault = vaultLinkInput.trim();
      const treasuryWrite = new Contract(
        treasuryAddress,
        ['function setVault(address _vault) external'],
        signer
      );
      const tx = await treasuryWrite.setVault(nextVault);
      await tx.wait();
      setRuntimeAddress('Vault', nextVault);
      setVaultAddress(nextVault);
      setLinkConfigStatus('Treasury -> Vault linked');
      await refreshTreasuryState();
    } catch (e: any) {
      setLinkConfigStatus(`Vault link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  async function handleSetTreasuryEscrowLink() {
    if (!signer || !isValidAddress(treasuryAddress) || !isValidAddress(escrowLinkInput.trim())) {
      setLinkConfigStatus('Invalid Treasury or Escrow address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const nextEscrow = escrowLinkInput.trim();
      const treasuryWrite = new Contract(
        treasuryAddress,
        ['function setEscrow(address _escrow) external'],
        signer
      );
      const tx = await treasuryWrite.setEscrow(nextEscrow);
      await tx.wait();
      setRuntimeAddress('InvestmentEscrow', nextEscrow);
      setEscrowAddress(nextEscrow);
      setLinkConfigStatus('Treasury -> Escrow linked');
      await refreshTreasuryState();
    } catch (e: any) {
      setLinkConfigStatus(`Escrow link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  async function handleSetTreasuryReserveLink() {
    if (!signer || !isValidAddress(treasuryAddress) || !isValidAddress(reserveLinkInput.trim())) {
      setLinkConfigStatus('Invalid Treasury or Reserve address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const nextReserve = reserveLinkInput.trim();
      const treasuryWrite = new Contract(
        treasuryAddress,
        ['function setReserveAddress(address _reserve) external'],
        signer
      );
      const tx = await treasuryWrite.setReserveAddress(nextReserve);
      await tx.wait();
      setRuntimeAddress('ReserveController', nextReserve);
      setLinkedReserveAddress(nextReserve);
      setLinkConfigStatus('Treasury -> Reserve linked');
      await refreshTreasuryState();
    } catch (e: any) {
      setLinkConfigStatus(`Reserve link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  // ── RENDER HELPERS ──

  function getBankLotPhase(lot: typeof bankLots[number]): 'ready' | 'in_escrow' | 'settlement_received' | 'distribution_pending' | 'complete' | 'exceptions' {
    const s = (lot.protocolStatus ?? '').toLowerCase();
    if (s === 'exception' || s === 'failed' || s === 'error') return 'exceptions';
    if (s === 'wire_return_complete' || s === 'distribution_complete') return 'complete';
    if (s === 'distribution_pending') return 'distribution_pending';
    // wire_ready = settle-from-lifecycle confirmed → advance to distribution, not settlement_received.
    // Showing Return ↑ after wire_ready is a false state: the return already happened.
    if (s === 'wire_ready') return 'distribution_pending';
    // settled = canonical returned_amount_usd written by applyBatchSettlementToTermPositions
    if (s === 'settled' || s === 'settlement_received') return 'settlement_received';
    if (lot.treasurySettlementStatus === 'settled') return 'settlement_received';
    if (lot.returnedAmountUsd != null && lot.returnedAmountUsd > 0) return 'settlement_received';
    if (lot.treasuryBatchId) return 'in_escrow';
    return 'ready';
  }

  function formatOrigin(lot: typeof bankLots[number]): string {
    const raw = lot.originInstitutionId || (lot.policyProfileId ? lot.policyProfileId.split(':')[0] : '');
    if (!raw) return 'Unknown';
    return raw.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  const PHASE_META: Record<string, { label: string; color: string; bg: string }> = {
    ready:                { label: 'Ready',        color: '#86efac', bg: 'rgba(134,239,172,0.12)' },
    in_escrow:            { label: 'In Escrow',    color: '#93c5fd', bg: 'rgba(147,197,253,0.12)' },
    settlement_received:  { label: 'Settled',      color: '#fde68a', bg: 'rgba(253,230,138,0.12)' },
    distribution_pending: { label: 'Dist. Pending',color: '#f9a8d4', bg: 'rgba(249,168,212,0.12)' },
    complete:             { label: 'Complete',     color: '#6ee7b7', bg: 'rgba(110,231,183,0.12)' },
    exceptions:           { label: 'Exception',   color: '#fca5a5', bg: 'rgba(252,165,165,0.12)' },
  };

  const bankLotsWithPhase = bankLots.map(lot => ({ ...lot, _phase: getBankLotPhase(lot) }));

  function toggleLot(lot: typeof bankLotsWithPhase[number]) {
    setExpandedLots(prev => {
      const next = new Set(prev);
      if (next.has(lot.id)) {
        next.delete(lot.id);
      } else {
        next.add(lot.id);
        if (lot.escrowBatchId && canInspectDistributionPreview(lot._phase)) {
          if (!distributionPreviews[lot.escrowBatchId]) {
            void loadDistributionPreview(lot.escrowBatchId);
          }
          if (!distributionExecutions[lot.escrowBatchId]) {
            void loadDistributionExecution(lot.escrowBatchId);
          }
        }
      }
      return next;
    });
  }

  function renderDistributionPreview(lot: typeof bankLotsWithPhase[number]) {
    if (!canInspectDistributionPreview(lot._phase)) return null;

    if (!lot.escrowBatchId) {
      return (
        <div style={{ gridColumn: '1 / -1', marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
          <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.06)', padding: '0.875rem 1rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fde68a', marginBottom: '0.25rem' }}>Distribution Manifest Preview</div>
            <div style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>
              Treasury batch #{lot.treasuryBatchId ?? 'â€”'} is on the distribution path, but no escrow lifecycle mapping is available yet for preview lookup.
            </div>
          </div>
        </div>
      );
    }

    const preview = distributionPreviews[lot.escrowBatchId] ?? EMPTY_DISTRIBUTION_PREVIEW_STATE;
    const execState = distributionExecutions[lot.escrowBatchId] ?? EMPTY_DISTRIBUTION_EXECUTION_STATE;
    const manifest = preview.manifest;
    const payload: DistributionManifestPayload | null = manifest?.manifest_payload ?? null;
    const institutionRows: DistributionManifestInstitutionRow[] = payload?.institution_rows ?? [];
    const accountRows: DistributionManifestAccountRow[] = payload?.account_rows ?? [];
    const validationErrors = manifest?.validation_errors?.length
      ? manifest.validation_errors
      : payload?.validation_errors ?? [];
    const ruleKey = payload?.rule_key ?? preview.rule?.rule_key ?? 'Pending';
    const ruleVersion = payload?.rule_version ?? manifest?.rule_version ?? preview.rule?.rule_version ?? null;
    const coverageStatus = manifest?.coverage_status ?? payload?.coverage_status ?? 'not_required';
    const statusLabel = manifest
      ? manifest.status === 'blocked'
        ? 'Distribution Blocked'
        : coverageStatus === 'treasury_coverage_available'
          ? 'Validated with Treasury Coverage'
          : coverageStatus === 'treasury_coverage_required'
            ? 'Coverage Check Pending'
            : 'Validated'
      : preview.error
        ? 'Manifest Generation Failed'
        : 'Preview Pending';
    const statusStyle = manifest?.status === 'blocked'
      ? { color: '#fca5a5', bg: 'rgba(252,165,165,0.1)', border: 'rgba(252,165,165,0.22)' }
      : coverageStatus === 'treasury_coverage_required'
        ? { color: '#fcd34d', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.24)' }
        : manifest?.status === 'validated'
          ? { color: '#86efac', bg: 'rgba(134,239,172,0.1)', border: 'rgba(134,239,172,0.22)' }
          : { color: '#cbd5e1', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)' };
    const coverageReason = manifest?.treasury_coverage_reason ?? payload?.treasury_coverage_reason ?? null;
    const institutionSettlementTotal = payload?.institution_settlement_total
      ?? institutionRows.reduce((sum, row) => sum + Number(row.institution_settlement_total || 0), 0).toFixed(6);
    const previewJson = manifest
      ? JSON.stringify({
          manifest_payload: manifest.manifest_payload,
          validation_errors: manifest.validation_errors,
        }, null, 2)
      : '';

    return (
      <div style={{ gridColumn: '1 / -1', marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
        <div style={{ borderRadius: '0.85rem', border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(180deg,rgba(20,24,42,0.92) 0%,rgba(8,12,24,0.92) 100%)', padding: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.875rem' }}>
            <div>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#e2e8f0' }}>Distribution Manifest Preview</div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                Internal preview only. No Fineract posting, Treasury transfer, or distribution execution happens here.
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', borderRadius: '9999px', border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, padding: '0.2rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>
                {statusLabel}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '9999px', border: '1px solid rgba(147,197,253,0.18)', background: 'rgba(147,197,253,0.08)', color: '#bfdbfe', padding: '0.2rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>
                Escrow {formatHashShort(lot.escrowBatchId)}
              </span>
              {preview.rule && (
                <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '9999px', border: '1px solid rgba(212,168,48,0.18)', background: 'rgba(212,168,48,0.08)', color: '#fcd34d', padding: '0.2rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>
                  Active rule {preview.rule.rule_key} v{preview.rule.rule_version}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.875rem' }}>
            <button
              onClick={() => void handleGenerateDistributionPreview(lot.escrowBatchId!)}
              disabled={preview.generating}
              style={{ background: preview.generating ? 'rgba(255,255,255,0.04)' : 'rgba(212,168,48,0.15)', border: `1px solid ${preview.generating ? 'rgba(255,255,255,0.08)' : 'rgba(212,168,48,0.3)'}`, borderRadius: '0.45rem', padding: '0.35rem 0.75rem', color: preview.generating ? '#64748b' : '#fcd34d', fontSize: '0.76rem', fontWeight: 700, cursor: preview.generating ? 'not-allowed' : 'pointer' }}
            >
              {preview.generating ? 'Refreshingâ€¦' : manifest ? 'Refresh Preview' : 'Generate Preview'}
            </button>
            {manifest && (
              <button
                onClick={() => patchDistributionPreview(lot.escrowBatchId!, (current) => ({ ...current, jsonOpen: !current.jsonOpen }))}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.45rem', padding: '0.35rem 0.75rem', color: '#cbd5e1', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}
              >
                {preview.jsonOpen ? 'Hide Manifest JSON' : 'View Manifest JSON'}
              </button>
            )}
            {preview.loading && (
              <span style={{ display: 'inline-flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.74rem' }}>Loading previewâ€¦</span>
            )}
          </div>

          {preview.error && (
            <div style={{ marginBottom: '0.875rem', borderRadius: '0.65rem', border: '1px solid rgba(252,165,165,0.18)', background: 'rgba(127,29,29,0.22)', padding: '0.75rem 0.875rem', color: '#fecaca', fontSize: '0.76rem' }}>
              {preview.error}
            </div>
          )}

          {!manifest ? (
            <div style={{ borderRadius: '0.75rem', border: '1px dashed rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.45)', padding: '0.9rem 1rem' }}>
              <div style={{ color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 600 }}>
                {preview.error ? 'Manifest generation failed.' : 'No distribution manifest generated yet.'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {preview.error
                  ? 'The backend rejected preview generation. Review the error above, then retry after the canonical batch data is repaired.'
                  : 'Generate Preview to inspect manifest status, validation errors, and the canonical payload for Treasury distribution readiness.'}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '0.65rem', marginBottom: '0.9rem' }}>
                {[
                  ['Manifest Status', statusLabel],
                  ['Escrow Batch ID', manifest.escrow_batch_id],
                  ['Treasury Batch ID', manifest.treasury_batch_id ?? 'â€”'],
                  ['Source Batch ID', manifest.source_batch_id],
                  ['Rule Key', ruleKey],
                  ['Rule Version', ruleVersion != null ? `v${ruleVersion}` : 'Pending'],
                  ['Principal USD', formatUsdAmount(manifest.principal_usd)],
                  ['Returned USD', formatUsdAmount(manifest.returned_usd)],
                  ['Gross Yield USD', formatUsdAmount(manifest.gross_yield_usd)],
                  ['Depositor Principal USD', formatUsdAmount(manifest.depositor_principal_usd)],
                  ['Depositor Yield USD', formatUsdAmount(manifest.depositor_yield_usd)],
                  ['Bank Fee USD', formatUsdAmount(manifest.bank_fee_usd)],
                  ['Treasury Fee Retained USD', formatUsdAmount(payload?.treasury_fee_retained_usd ?? manifest.treasury_fee_usd)],
                  ['Treasury Fee Target USD', formatUsdAmount(payload?.treasury_fee_target_usd ?? manifest.treasury_fee_usd)],
                  ['Treasury Fee Foregone USD', formatUsdAmount(payload?.treasury_fee_foregone_usd ?? 0)],
                  ['Coverage Status', humanizeValue(coverageStatus)],
                  ['Treasury Cash Coverage Used', formatUsdAmount(payload?.treasury_cash_coverage_used_usd ?? manifest.treasury_coverage_required_usd)],
                  ['Treasury Coverage Required', formatUsdAmount(manifest.treasury_coverage_required_usd)],
                  ['Treasury Coverage Available', manifest.treasury_coverage_available_usd ? formatUsdAmount(manifest.treasury_coverage_available_usd) : 'Pending'],
                  ['Coverage Source', humanizeValue(manifest.treasury_coverage_source)],
                  ['Institution Settlement Total', formatUsdAmount(institutionSettlementTotal)],
                  ['External Institution Transfer Gap', formatUsdAmount(manifest.external_institution_transfer_gap_usd)],
                  ['Net Treasury Impact', formatUsdAmount(manifest.net_treasury_impact_usd)],
                  ['Surplus USD', formatUsdAmount(manifest.surplus_usd)],
                  ['Shortfall USD', formatUsdAmount(manifest.shortfall_usd)],
                  ['Institution Count', String(manifest.institution_count)],
                  ['Account Count', String(manifest.account_count)],
                  ['Manifest Hash', formatHashShort(manifest.manifest_hash)],
                  ['Created At', formatDateTime(manifest.created_at)],
                  ['Updated At', formatDateTime(manifest.updated_at)],
                ].map(([label, value]) => (
                  <div key={label} style={{ borderRadius: '0.65rem', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(15,23,42,0.5)', padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontSize: '0.62rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.18rem' }}>{label}</div>
                    <div style={{ fontSize: '0.8rem', color: '#e2e8f0', fontFamily: label.includes('ID') || label.includes('Hash') ? 'monospace' : 'inherit', overflowWrap: 'anywhere' }}>{value}</div>
                  </div>
                ))}
              </div>

              {coverageStatus !== 'not_required' && (
                <div style={{ marginBottom: '0.9rem', borderRadius: '0.75rem', border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, padding: '0.85rem 0.95rem' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: statusStyle.color, marginBottom: '0.35rem' }}>
                    {coverageStatus === 'treasury_coverage_available'
                      ? 'Treasury coverage available'
                      : coverageStatus === 'treasury_coverage_unavailable'
                        ? 'Treasury coverage unavailable'
                        : 'Treasury coverage required'}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>
                    {coverageReason ?? 'Treasury coverage is being assessed for this manifest.'}
                  </div>
                </div>
              )}

              {validationErrors.length > 0 && (
                <div style={{ marginBottom: '0.9rem', borderRadius: '0.75rem', border: '1px solid rgba(252,165,165,0.18)', background: 'rgba(69,10,10,0.28)', padding: '0.85rem 0.95rem' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#fca5a5', marginBottom: '0.45rem' }}>
                    {manifest.status === 'blocked' ? 'Distribution blocked' : 'Validation notes'}
                  </div>
                  <div style={{ display: 'grid', gap: '0.35rem' }}>
                    {validationErrors.map((error, index) => (
                      <div key={`${manifest.manifest_id}-error-${index}`} style={{ color: '#fecaca', fontSize: '0.75rem' }}>
                        {error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {institutionRows.length > 0 && (
                <div style={{ marginBottom: '0.9rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.45rem' }}>
                    Institution Rows
                  </div>
                  <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <table style={{ width: '100%', minWidth: '980px', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                      <thead>
                        <tr style={{ background: 'rgba(15,23,42,0.75)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          <th style={thSt}>Institution ID</th>
                          <th style={thSt}>Institution Name</th>
                          <th style={thSt}>Eligibility</th>
                          <th style={thSt}>Eligibility Reason</th>
                          <th style={thSt}>Treasury Payout Destination</th>
                          <th style={thSt}>Fineract Settlement Clearing Ref</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Principal</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Depositor Yield</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Bank Fee</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Institution Settlement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {institutionRows.map((row) => {
                          const payoutOk = !!row.settlement_wallet_address && row.payout_approval_status === 'approved' && row.payout_status === 'active';
                          const payoutMissing = !row.settlement_wallet_address;
                          const payoutNotApproved = row.settlement_wallet_address && row.payout_approval_status && row.payout_approval_status !== 'approved';
                          const payoutInactive = row.settlement_wallet_address && row.payout_status && row.payout_status !== 'active';
                          return (
                          <tr key={`${manifest.manifest_id}-${row.institution_id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.72rem' }}>{row.institution_id}</td>
                            <td style={cellSt}>{row.institution_name ?? '—'}</td>
                            <td style={cellSt}>
                              <span style={{ color: row.eligibility_status === 'eligible' ? '#86efac' : '#fca5a5', fontWeight: 700 }}>
                                {humanizeValue(row.eligibility_status)}
                              </span>
                            </td>
                            <td style={cellSt}>{row.eligibility_reason}</td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.72rem' }}>
                              {payoutMissing ? (
                                <span style={{ color: '#f87171', fontWeight: 600 }}>missing</span>
                              ) : payoutNotApproved ? (
                                <span style={{ color: '#fbbf24', fontWeight: 600 }} title={`payout_approval_status: ${row.payout_approval_status}`}>
                                  {row.settlement_wallet_address?.slice(0, 12)}… <span style={{ fontSize: '0.65rem' }}>(not approved)</span>
                                </span>
                              ) : payoutInactive ? (
                                <span style={{ color: '#fbbf24', fontWeight: 600 }} title={`payout_status: ${row.payout_status}`}>
                                  {row.settlement_wallet_address?.slice(0, 12)}… <span style={{ fontSize: '0.65rem' }}>(inactive)</span>
                                </span>
                              ) : (
                                <span style={{ color: payoutOk ? '#86efac' : '#94a3b8' }} title={`${row.payout_destination_type ?? ''} ${row.settlement_wallet_address}`}>
                                  {row.settlement_wallet_address?.slice(0, 18)}…
                                </span>
                              )}
                            </td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.72rem' }}>
                              {row.fineract_settlement_account_ref
                                ? <span style={{ color: '#86efac' }}>#{row.fineract_settlement_account_ref}</span>
                                : <span style={{ color: '#f87171', fontWeight: 600 }}>missing</span>}
                            </td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.principal_total)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.depositor_yield_total)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.bank_fee_total)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.institution_settlement_total)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {accountRows.length > 0 && (
                <div style={{ marginBottom: preview.jsonOpen ? '0.9rem' : 0 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.45rem' }}>
                    Account Rows
                  </div>
                  <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <table style={{ width: '100%', minWidth: '1040px', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                      <thead>
                        <tr style={{ background: 'rgba(15,23,42,0.75)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          <th style={thSt}>Institution ID</th>
                          <th style={thSt}>Customer / Term Position</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Principal</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Term Days</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Principal Days</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Depositor Yield</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Bank Fee Share</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Treasury Fee Share</th>
                          <th style={thSt}>Settlement Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountRows.map((row) => (
                          <tr key={`${manifest.manifest_id}-${row.term_position_id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.72rem' }}>{row.institution_id}</td>
                            <td style={cellSt}>
                              <div style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.72rem' }}>{row.term_position_id}</div>
                              <div style={{ color: '#64748b', fontSize: '0.68rem' }}>{row.owner_key}</div>
                            </td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.principal)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.term_days}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.principal_days}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.depositor_yield)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.bank_fee_share)}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(row.treasury_fee_share)}</td>
                            <td style={cellSt}>{humanizeValue(row.settlement_status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.jsonOpen && (
                <div style={{ marginTop: '0.9rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(2,6,23,0.75)', padding: '0.85rem 0.95rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.45rem' }}>
                    Manifest JSON
                  </div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#cbd5e1', fontSize: '0.73rem', lineHeight: 1.5 }}>
                    {previewJson}
                  </pre>
                </div>
              )}
            </>
          )}

          {/* ── TREASURY DISTRIBUTION EXECUTION ── */}
          {renderDistributionExecution(lot.escrowBatchId, manifest, execState)}
        </div>
      </div>
    );
  }

  function renderDistributionExecution(
    escrowBatchId: string,
    manifest: DistributionManifestRecord | null,
    execState: DistributionExecutionState
  ) {
    const execution = execState.execution;
    const coverageStatus = manifest?.coverage_status ?? 'not_required';
    const canExecute =
      manifest !== null &&
      manifest.status === 'validated' &&
      (coverageStatus === 'treasury_coverage_available' || coverageStatus === 'not_required') &&
      !execState.executing &&
      (execution === null || execution.status !== 'completed');

    const execStatusLabel = execution
      ? EXECUTION_STATUS_LABELS[execution.status] ?? humanizeValue(execution.status)
      : null;
    const execStatusStyle = !execution ? null
      : execution.status === 'completed'
        ? { color: '#86efac', bg: 'rgba(134,239,172,0.1)', border: 'rgba(134,239,172,0.22)' }
        : execution.status === 'partially_completed'
          ? { color: '#fcd34d', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.24)' }
          : execution.status === 'failed' || execution.status === 'failed_before_payout' || execution.status === 'payout_failed'
            ? { color: '#fca5a5', bg: 'rgba(252,165,165,0.1)', border: 'rgba(252,165,165,0.22)' }
            : { color: '#93c5fd', bg: 'rgba(147,197,253,0.1)', border: 'rgba(147,197,253,0.22)' };

    return (
      <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '1rem' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Treasury Distribution Execution
          {execState.loading && <span style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 400 }}>Loading…</span>}
          {execState.executing && <span style={{ color: '#93c5fd', fontSize: '0.72rem', fontWeight: 400 }}>Executing…</span>}
          {execution && execStatusStyle && (
            <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '9999px', border: `1px solid ${execStatusStyle.border}`, background: execStatusStyle.bg, color: execStatusStyle.color, padding: '0.15rem 0.5rem', fontSize: '0.68rem', fontWeight: 700 }}>
              {execStatusLabel}
            </span>
          )}
        </div>

        {execState.idempotentMessage && (
          <div style={{ marginBottom: '0.75rem', borderRadius: '0.65rem', border: '1px solid rgba(147,197,253,0.2)', background: 'rgba(147,197,253,0.07)', padding: '0.65rem 0.875rem', color: '#93c5fd', fontSize: '0.76rem' }}>
            {execState.idempotentMessage}
          </div>
        )}

        {execState.error && (
          <div style={{ marginBottom: '0.75rem', borderRadius: '0.65rem', border: '1px solid rgba(252,165,165,0.18)', background: 'rgba(127,29,29,0.22)', padding: '0.65rem 0.875rem' }}>
            <div style={{ color: '#fca5a5', fontSize: '0.76rem', fontWeight: 600, marginBottom: '0.2rem' }}>
              {execState.errorCode === 'ledger_sync_unavailable'
                ? 'Fineract ledger sync unavailable. Distribution was not executed and no settlement rail movement occurred.'
                : execState.error}
            </div>
            {execState.errorCode && execState.errorCode !== 'ledger_sync_unavailable' && (
              <div style={{ color: '#fda4af', fontSize: '0.72rem', fontFamily: 'monospace' }}>code: {execState.errorCode}</div>
            )}
          </div>
        )}

        {!execution && !execState.executing && (
          <>
            {manifest === null ? (
              <div style={{ color: '#475569', fontSize: '0.76rem' }}>
                Generate a manifest preview first to enable execution controls.
              </div>
            ) : manifest.status === 'blocked' ? (
              <div style={{ color: '#fca5a5', fontSize: '0.76rem' }}>
                Distribution is blocked. Execution is not available until the manifest is unblocked.
              </div>
            ) : coverageStatus === 'treasury_coverage_unavailable' ? (
              <div style={{ color: '#fca5a5', fontSize: '0.76rem' }}>
                Treasury coverage unavailable. Execution is not available until coverage is secured.
              </div>
            ) : coverageStatus === 'treasury_coverage_required' ? (
              <div style={{ color: '#fcd34d', fontSize: '0.76rem' }}>
                Coverage check pending. Refresh the manifest to confirm coverage before executing.
              </div>
            ) : canExecute ? (
              <>
                {execState.confirming ? (
                  <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(212,168,48,0.3)', background: 'rgba(212,168,48,0.08)', padding: '0.875rem 1rem', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fde68a', marginBottom: '0.6rem' }}>
                      Confirm Distribution Execution
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {([
                        ['Institution Settlement Total', formatUsdAmount(manifest.manifest_payload?.institution_settlement_total ?? manifest.external_institution_transfer_gap_usd)],
                        ['Treasury Coverage Used', coverageStatus === 'not_required' ? 'Not required' : formatUsdAmount(manifest.manifest_payload?.treasury_cash_coverage_used_usd ?? manifest.treasury_coverage_required_usd)],
                        ['External Transfer Gap', formatUsdAmount(manifest.external_institution_transfer_gap_usd)],
                        ['Treasury Fee Retained', formatUsdAmount(manifest.manifest_payload?.treasury_fee_retained_usd ?? manifest.treasury_fee_usd)],
                        ['Treasury Fee Foregone', formatUsdAmount(manifest.manifest_payload?.treasury_fee_foregone_usd ?? 0)],
                        ['Institution Count', String(manifest.institution_count)],
                        ['Account Count', String(manifest.account_count)],
                        ['Rail Type', 'Treasury / Settlement Rail'],
                        ['Manifest Hash', formatHashShort(manifest.manifest_hash)],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} style={{ borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(15,23,42,0.5)', padding: '0.5rem 0.65rem' }}>
                          <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>{label}</div>
                          <div style={{ fontSize: '0.76rem', color: '#e2e8f0', overflowWrap: 'anywhere', fontFamily: label.includes('Hash') ? 'monospace' : 'inherit' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#94a3b8', marginBottom: '0.65rem' }}>
                      This action moves the batch from planning to distribution execution. Settlement will be sent through the configured rail and Fineract ledger postings will be synchronized.
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => void handleExecuteDistribution(escrowBatchId)}
                        style={{ background: 'rgba(212,168,48,0.2)', border: '1px solid rgba(212,168,48,0.4)', borderRadius: '0.45rem', padding: '0.35rem 0.875rem', color: '#fcd34d', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Confirm Execute Distribution
                      </button>
                      <button
                        onClick={() => patchDistributionExecution(escrowBatchId, { confirming: false })}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.45rem', padding: '0.35rem 0.75rem', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <button
                      onClick={() => patchDistributionExecution(escrowBatchId, { confirming: true, error: null, errorCode: null })}
                      style={{ alignSelf: 'flex-start', background: 'rgba(212,168,48,0.15)', border: '1px solid rgba(212,168,48,0.35)', borderRadius: '0.45rem', padding: '0.35rem 0.875rem', color: '#fcd34d', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Execute Distribution
                    </button>
                    <div style={{ color: '#64748b', fontSize: '0.73rem' }}>
                      Sends settlement through the configured rail and synchronizes Fineract ledger postings.
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}

        {execution && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {([
                ['Execution Status', execStatusLabel ?? '—'],
                ['Execution ID', execution.execution_id ?? execution.id],
                ['Manifest Hash', formatHashShort(execution.manifest_hash)],
                ['Rail Type', execution.rail_type ?? '—'],
                ['Rail Reference', execution.rail_reference ?? '—'],
                ['Treasury Coverage Used', formatUsdAmount(execution.treasury_coverage_used_usd)],
                ['External Transfer Gap', formatUsdAmount(execution.external_institution_transfer_gap_usd)],
                ['Institution Settlement Total', formatUsdAmount(execution.institution_settlement_total_usd)],
                ['Treasury Fee Retained', formatUsdAmount(execution.treasury_fee_retained_usd)],
                ['Net Treasury Impact', formatUsdAmount(execution.net_treasury_impact_usd)],
                ['Started At', formatDateTime(execution.started_at)],
                ['Completed At', formatDateTime(execution.completed_at)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(15,23,42,0.5)', padding: '0.5rem 0.65rem' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>{label}</div>
                  <div style={{ fontSize: '0.76rem', color: '#e2e8f0', overflowWrap: 'anywhere', fontFamily: (label.includes('ID') || label.includes('Hash') || label.includes('Reference')) ? 'monospace' : 'inherit' }}>{value}</div>
                </div>
              ))}
            </div>

            {(() => {
              const railLine = execState.lines.find(l => l.line_type === 'circle_payout');
              const railPending = railLine?.status === 'pending';
              const railFailed  = railLine?.status === 'failed';
              const railDone    = railLine?.status === 'completed';
              const preRailDone = execState.lines.some(
                l => l.line_type !== 'circle_payout' && l.status === 'completed'
              );

              if (execution.status === 'partially_completed') {
                const msg = execution.error_message
                  ? `Distribution partially completed. Settlement rail succeeded, but Fineract ledger sync failed. ${execution.error_message}`
                  : 'Distribution partially completed. Settlement rail succeeded, but Fineract ledger sync failed. Review line items below.';
                return (
                  <div style={{ marginBottom: '0.75rem', borderRadius: '0.65rem', border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.07)', padding: '0.65rem 0.875rem', color: '#fde68a', fontSize: '0.76rem' }}>
                    {msg}
                  </div>
                );
              }

              if (execution.status === 'failed' || execution.status === 'failed_before_payout' || execution.status === 'payout_failed') {
                let msg: string;
                if (execution.error_message) {
                  msg = execution.error_message;
                } else if (railPending && preRailDone) {
                  msg = 'Settlement rail payout is pending — the Circle transfer was not confirmed. Pre-rail steps (coverage, fee, evidence) completed. No Fineract institution credit was posted.';
                } else if (railFailed) {
                  msg = 'Settlement rail failed. No Fineract institution posting was attempted.';
                } else if (railDone && preRailDone) {
                  msg = 'Distribution execution failed after settlement rail movement. Review line items for the specific failure.';
                } else {
                  msg = 'Distribution execution failed before settlement rail movement.';
                }
                return (
                  <div style={{ marginBottom: '0.75rem', borderRadius: '0.65rem', border: '1px solid rgba(252,165,165,0.18)', background: 'rgba(127,29,29,0.22)', padding: '0.65rem 0.875rem', color: '#fca5a5', fontSize: '0.76rem' }}>
                    {msg}
                  </div>
                );
              }

              return null;
            })()}

            {execState.lines.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
                  Execution Line Items
                </div>
                <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <table style={{ width: '100%', minWidth: '1100px', borderCollapse: 'collapse', fontSize: '0.73rem' }}>
                    <thead>
                      <tr style={{ background: 'rgba(15,23,42,0.75)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                        <th style={thSt}>Line Type</th>
                        <th style={thSt}>Institution ID</th>
                        <th style={thSt}>Term Position ID</th>
                        <th style={thSt}>Fineract Account ID</th>
                        <th style={{ ...thSt, textAlign: 'right' }}>Amount</th>
                        <th style={thSt}>Status</th>
                        <th style={thSt}>External Ref</th>
                        <th style={thSt}>Fineract Ref</th>
                        <th style={thSt}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {execState.lines.map((line) => {
                        const lineOk = line.status === 'completed';
                        const lineFail = line.status === 'failed';
                        return (
                          <tr key={line.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: lineFail ? 'rgba(127,29,29,0.1)' : 'transparent' }}>
                            <td style={cellSt}>
                              <span style={{ color: lineOk ? '#86efac' : lineFail ? '#fca5a5' : '#94a3b8', fontWeight: lineOk || lineFail ? 600 : 400 }}>
                                {LINE_TYPE_LABELS[line.line_type] ?? humanizeValue(line.line_type)}
                              </span>
                            </td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{line.institution_id ?? '—'}</td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{line.term_position_id ?? '—'}</td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{line.fineract_account_id ?? '—'}</td>
                            <td style={{ ...cellSt, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUsdAmount(line.amount_usd)}</td>
                            <td style={cellSt}>
                              <span style={{ color: lineOk ? '#86efac' : lineFail ? '#fca5a5' : '#94a3b8', fontWeight: 600, fontSize: '0.7rem' }}>
                                {humanizeValue(line.status)}
                              </span>
                            </td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{line.external_ref ?? '—'}</td>
                            <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{line.fineract_ref ?? '—'}</td>
                            <td style={{ ...cellSt, color: '#fca5a5', fontSize: '0.7rem', maxWidth: '220px', overflowWrap: 'anywhere' }}>{line.error_message ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(execution.execution_payload || execution.execution_receipt) && (
              <div>
                <button
                  onClick={() => patchDistributionExecution(escrowBatchId, (s) => ({ ...s, receiptOpen: !s.receiptOpen }))}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.45rem', padding: '0.3rem 0.65rem', color: '#cbd5e1', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer', marginBottom: '0.5rem' }}
                >
                  {execState.receiptOpen ? 'Hide Receipt JSON' : 'View Receipt JSON'}
                </button>
                {execState.receiptOpen && (
                  <div style={{ borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(2,6,23,0.75)', padding: '0.85rem 0.95rem' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#cbd5e1', fontSize: '0.7rem', lineHeight: 1.5 }}>
                      {JSON.stringify({ execution_payload: execution.execution_payload, execution_receipt: execution.execution_receipt, lines: execState.lines }, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {execution.status === 'completed' && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  onClick={() => void handleExecuteDistribution(escrowBatchId)}
                  disabled={execState.executing}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.45rem', padding: '0.3rem 0.65rem', color: '#64748b', fontSize: '0.73rem', cursor: execState.executing ? 'not-allowed' : 'pointer' }}
                >
                  Re-check Execution (idempotent)
                </button>
              </div>
            )}

            {(execution.status === 'failed' || execution.status === 'failed_before_payout' || execution.status === 'payout_failed' || execution.status === 'partially_completed') && (
              <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  onClick={() => void handleExecuteDistribution(escrowBatchId)}
                  disabled={execState.executing}
                  style={{ background: execState.executing ? 'rgba(255,255,255,0.04)' : 'rgba(212,168,48,0.15)', border: `1px solid ${execState.executing ? 'rgba(255,255,255,0.08)' : 'rgba(212,168,48,0.35)'}`, borderRadius: '0.45rem', padding: '0.35rem 0.875rem', color: execState.executing ? '#475569' : '#fcd34d', fontSize: '0.78rem', fontWeight: 700, cursor: execState.executing ? 'not-allowed' : 'pointer' }}
                >
                  {execState.executing ? 'Retrying…' : 'Retry Distribution'}
                </button>
                <span style={{ color: '#475569', fontSize: '0.72rem' }}>
                  Creates a new execution attempt. Previous failed attempt is retained for audit.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const bankPhaseCounts = {
    all:                  bankLotsWithPhase.length,
    ready:                bankLotsWithPhase.filter(l => l._phase === 'ready').length,
    in_escrow:            bankLotsWithPhase.filter(l => l._phase === 'in_escrow').length,
    settlement_received:  bankLotsWithPhase.filter(l => l._phase === 'settlement_received').length,
    distribution_pending: bankLotsWithPhase.filter(l => l._phase === 'distribution_pending').length,
    complete:             bankLotsWithPhase.filter(l => l._phase === 'complete').length,
    exceptions:           bankLotsWithPhase.filter(l => l._phase === 'exceptions').length,
  };
  const requiresActionCount = bankPhaseCounts.settlement_received + bankPhaseCounts.distribution_pending + bankPhaseCounts.exceptions;

  const filteredBankLots = bankLotsWithPhase.filter(lot => {
    if (bankLotFilter !== 'all' && lot._phase !== bankLotFilter) return false;
    if (lotSearch) {
      const s = lotSearch.toLowerCase();
      return !!(
        lot.treasuryOriginLotId?.toLowerCase().includes(s) ||
        lot.treasuryBatchId?.toLowerCase().includes(s) ||
        formatOrigin(lot).toLowerCase().includes(s) ||
        lot.policyProfileId?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const sortedBankLots = [...filteredBankLots].sort((a, b) => {
    let av: any, bv: any;
    if (lotSortCol === 'lot')           { av = a.treasuryOriginLotId ?? ''; bv = b.treasuryOriginLotId ?? ''; }
    else if (lotSortCol === 'principal') { av = a.principalUsd;              bv = b.principalUsd; }
    else if (lotSortCol === 'maturity')  { av = a.maturityDate ?? '';         bv = b.maturityDate ?? ''; }
    else                                { av = a.entryDate ?? a.id;          bv = b.entryDate ?? b.id; }
    if (av < bv) return lotSortDir === 'asc' ? -1 : 1;
    if (av > bv) return lotSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const bankLotPageCount = Math.max(1, Math.ceil(sortedBankLots.length / LOT_PAGE_SIZE));
  const safeBankPage     = Math.min(lotPage, bankLotPageCount);
  const pagedBankLots    = sortedBankLots.slice((safeBankPage - 1) * LOT_PAGE_SIZE, safeBankPage * LOT_PAGE_SIZE);

  const filteredVaultLots = vaultLots.filter(lot => {
    if (vaultLotFilter === 'eligible') return lot.status === 1 && lot.batchId === 0;
    if (vaultLotFilter === 'batched')  return lot.batchId > 0 && lot.status !== 3;
    if (vaultLotFilter === 'settled')  return lot.status === 3;
    return true;
  });
  const sortedVaultLots = [...filteredVaultLots].sort((a, b) =>
    lotSortDir === 'asc' ? a.id - b.id : b.id - a.id
  );
  const vaultLotPageCount = Math.max(1, Math.ceil(sortedVaultLots.length / LOT_PAGE_SIZE));
  const safeVaultPage     = Math.min(lotPage, vaultLotPageCount);
  const pagedVaultLots    = sortedVaultLots.slice((safeVaultPage - 1) * LOT_PAGE_SIZE, safeVaultPage * LOT_PAGE_SIZE);

  const cellSt: import('react').CSSProperties = { padding: '0.5rem 0.625rem', verticalAlign: 'middle', color: '#cbd5e1', borderBottom: '1px solid rgba(255,255,255,0.04)' };
  const thSt: import('react').CSSProperties   = { padding: '0.375rem 0.625rem', textAlign: 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' };

  function sortBtn(col: typeof lotSortCol, label: string) {
    const active = lotSortCol === col;
    return (
      <button
        onClick={() => { if (active) setLotSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setLotSortCol(col); setLotSortDir('asc'); } }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: active ? '#fcd34d' : '#64748b', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}
      >
        {label}{active ? (lotSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    );
  }

  // ── RETURN ──

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PageHeader title="Treasury Engine" description={`Chain: ${selectedChain.name}`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ color: '#64748b', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            Rendered {renderedAtLabel}
          </span>
          <button
            onClick={() => refreshTreasuryState()}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.375rem', padding: '0.375rem 0.75rem', color: '#94a3b8', fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            <RefreshCw style={{ width: '0.875rem', height: '0.875rem' } as import('react').CSSProperties} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* METRICS STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '0.75rem' }}>
        <MetricCard title="Treasury USDC"      value={formatUsd(usdcBalance)}                          hint="On-chain USDC in Treasury contract (includes depositor obligations)" />
        <MetricCard title="Net Treasury Capital" value={formatUsd(Math.max(0, usdcBalance - collateralizedUsd))} hint="Treasury USDC minus depositor obligations — reflects Treasury's own capital" />
        <MetricCard title="Depositor Obligations" value={formatUsd(collateralizedUsd)}                 hint="USDC owed back to depositors (principal + yield)" />
        <MetricCard title="Escrow USDC"        value={formatUsd(escrowUsdcBalance)}                    hint="USDC held by Escrow" />
        <MetricCard
          title="Coverage Ratio"
          value={formatCoverageRatio(coverageRatio)}
          hint="(Treasury + Reserve) / Collateralized"
          tone={coverageRatio == null ? 'neutral' : coverageRatio >= 1 ? 'success' : 'danger'}
        />
      </div>

      {/* TREASURY LOT OPERATIONS */}
      <div style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.03) 0%,rgba(255,255,255,0) 100%)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>

        {/* Section header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e2e8f0' }}>Treasury Lot Operations</span>
            {requiresActionCount > 0 && (
              <span style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.5rem' }}>
                {requiresActionCount} require action
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(0,0,0,0.25)', borderRadius: '0.5rem', padding: '0.125rem' }}>
            {(['BANK', 'VAULT'] as const).map(src => (
              <button key={src} onClick={() => { setLotSource(src); setLotPage(1); }}
                style={{ background: lotSource === src ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', borderRadius: '0.375rem', padding: '0.25rem 0.75rem', color: lotSource === src ? '#e2e8f0' : '#64748b', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer' }}
              >{src}</button>
            ))}
          </div>
        </div>

        {/* ── BANK ── */}
        {lotSource === 'BANK' && (<>

          {/* Pipeline filter chips */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {([
              ['all',                  'All'],
              ['ready',                'Ready to Batch'],
              ['in_escrow',            'In Escrow'],
              ['settlement_received',  'Settlement Received'],
              ['distribution_pending', 'Distribution Pending'],
              ['complete',             'Complete'],
              ['exceptions',           'Exceptions'],
            ] as [string, string][]).map(([phase, pLabel]) => {
              const cnt = bankPhaseCounts[phase as keyof typeof bankPhaseCounts];
              const active = bankLotFilter === phase;
              const alert = cnt > 0 && (phase === 'exceptions' || phase === 'settlement_received' || phase === 'distribution_pending');
              return (
                <button key={phase}
                  onClick={() => { setBankLotFilter(phase as typeof bankLotFilter); setLotPage(1); }}
                  style={{ background: active ? (alert ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.12)') : 'rgba(255,255,255,0.04)', border: active ? (alert ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.18)') : '1px solid rgba(255,255,255,0.07)', borderRadius: '9999px', padding: '0.2rem 0.625rem', color: active ? (alert ? '#fbbf24' : '#e2e8f0') : '#64748b', fontSize: '0.72rem', fontWeight: active ? 600 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  {pLabel}
                  {cnt > 0 && <span style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '9999px', padding: '0 0.3rem', fontSize: '0.65rem' }}>{cnt}</span>}
                </button>
              );
            })}
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            <input type="text" placeholder="Search lot ID, batch, origin…" value={lotSearch}
              onChange={e => { setLotSearch(e.target.value); setLotPage(1); }}
              style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.375rem', padding: '0.375rem 0.625rem', color: '#e2e8f0', fontSize: '0.8rem', outline: 'none' }}
            />
            <button onClick={handleCreateBankBatch} disabled={bankBatchLoading}
              style={{ background: bankBatchLoading ? 'rgba(255,255,255,0.04)' : 'rgba(212,168,48,0.15)', border: `1px solid ${bankBatchLoading ? 'rgba(255,255,255,0.08)' : 'rgba(212,168,48,0.35)'}`, borderRadius: '0.375rem', padding: '0.375rem 0.875rem', color: bankBatchLoading ? '#475569' : '#fcd34d', fontSize: '0.8rem', fontWeight: 600, cursor: bankBatchLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
            >{bankBatchLoading ? 'Creating…' : '+ Create Bank Batch'}</button>
            <button onClick={() => fetchBankLots()} disabled={bankLotsLoading} title="Reload"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.375rem 0.5rem', color: '#64748b', cursor: bankLotsLoading ? 'not-allowed' : 'pointer' }}
            ><RefreshCw style={{ width: '0.875rem', height: '0.875rem' } as import('react').CSSProperties} /></button>
          </div>

          {bankBatchStatus && (
            <div style={{ marginBottom: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: bankBatchTone === 'success' ? 'rgba(134,239,172,0.1)' : bankBatchTone === 'warning' ? 'rgba(253,230,138,0.1)' : 'rgba(252,165,165,0.1)', color: bankBatchTone === 'success' ? '#86efac' : bankBatchTone === 'warning' ? '#fde68a' : '#fca5a5', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              {bankBatchStatus}
            </div>
          )}
          {returnToBankError && (
            <div style={{ marginBottom: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: 'rgba(252,165,165,0.1)', color: '#fca5a5', fontSize: '0.8rem', border: '1px solid rgba(252,165,165,0.2)' }}>
              Return failed (Batch #{returnToBankError.batchId}): {returnToBankError.message}
            </div>
          )}
          {bankLotsError && (
            <div style={{ marginBottom: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: 'rgba(252,165,165,0.08)', color: '#fca5a5', fontSize: '0.8rem', border: '1px solid rgba(252,165,165,0.15)' }}>
              {bankLotsError}
            </div>
          )}

          {bankLotsLoading && <div style={{ padding: '1.5rem', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>Loading lots…</div>}

          {!bankLotsLoading && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr>
                    <th style={thSt}>#</th>
                    <th style={thSt}>{sortBtn('lot', 'Origin')}</th>
                    <th style={thSt}>{sortBtn('principal', 'Principal')}</th>
                    <th style={thSt}>Term</th>
                    <th style={thSt}>{sortBtn('maturity', 'Matures')}</th>
                    <th style={thSt}>Batch</th>
                    <th style={thSt}>Returned</th>
                    <th style={thSt}>Yield</th>
                    <th style={thSt}>Phase</th>
                    <th style={thSt}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedBankLots.flatMap(lot => {
                    const expanded  = expandedLots.has(lot.id);
                    const anchor    = lot.treasuryBatchId ? anchorCache[`${selectedChain.key}:${lot.treasuryBatchId}`] : undefined;
                    const yieldUsd  = lot.returnedAmountUsd != null ? lot.returnedAmountUsd - lot.principalUsd : null;
                    const meta      = PHASE_META[lot._phase];
                    const returning = returningToBankBatchId === lot.treasuryBatchId;
                    const rows: JSX.Element[] = [];

                    rows.push(
                      <tr key={lot.id} onClick={() => toggleLot(lot)}
                        style={{ cursor: 'pointer', background: expanded ? 'rgba(255,255,255,0.025)' : 'transparent' }}
                      >
                        <td style={{ ...cellSt, color: '#64748b', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                          {lot.treasuryOriginLotId?.slice(-6) || lot.id}
                        </td>
                        <td style={cellSt}>{formatOrigin(lot)}</td>
                        <td style={{ ...cellSt, fontVariantNumeric: 'tabular-nums' }}>{formatUsd(lot.principalUsd * 1_000_000)}</td>
                        <td style={{ ...cellSt, color: '#94a3b8' }}>{lot.durationClass ?? '—'}</td>
                        <td style={{ ...cellSt, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          {formatDateOnly(lot.maturityDate)}
                        </td>
                        <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {lot.treasuryBatchId ? `#${lot.treasuryBatchId}` : '—'}
                        </td>
                        <td style={{ ...cellSt, fontVariantNumeric: 'tabular-nums' }}>
                          {lot.returnedAmountUsd != null ? formatUsd(lot.returnedAmountUsd * 1_000_000) : '—'}
                        </td>
                        <td style={{ ...cellSt, fontVariantNumeric: 'tabular-nums', color: yieldUsd == null ? '#475569' : yieldUsd >= 0 ? '#86efac' : '#fca5a5' }}>
                          {yieldUsd != null ? `${yieldUsd >= 0 ? '+' : ''}${formatUsd(yieldUsd * 1_000_000)}` : '—'}
                        </td>
                        <td style={cellSt}>
                          <span style={{ display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 600, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40`, whiteSpace: 'nowrap' }}>
                            {meta.label}
                          </span>
                        </td>
                        <td style={cellSt} onClick={e => e.stopPropagation()}>
                          {lot._phase === 'settlement_received' && lot.treasuryBatchId && (
                            <button onClick={() => handleReturnToTreasury(lot.treasuryBatchId!)} disabled={returning}
                              style={{ background: returning ? 'rgba(255,255,255,0.04)' : 'rgba(134,239,172,0.15)', border: `1px solid ${returning ? 'rgba(255,255,255,0.08)' : 'rgba(134,239,172,0.3)'}`, borderRadius: '0.375rem', padding: '0.2rem 0.5rem', color: returning ? '#475569' : '#86efac', fontSize: '0.72rem', fontWeight: 600, cursor: returning ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                            >{returning ? '…' : 'Return ↑'}</button>
                          )}
                          {lot._phase === 'distribution_pending' && lot.escrowBatchId && (
                            <button
                              onClick={() => toggleLot(lot)}
                              title={`Execute distribution for escrow batch ${lot.escrowBatchId}`}
                              style={{ background: 'rgba(212,168,48,0.15)', border: '1px solid rgba(212,168,48,0.35)', borderRadius: '0.375rem', padding: '0.2rem 0.5rem', color: '#fcd34d', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >{expanded ? 'Hide ↑' : 'Distribute →'}</button>
                          )}
                        </td>
                      </tr>
                    );

                    if (expanded) {
                      rows.push(
                        <tr key={`${lot.id}-exp`}>
                          <td colSpan={10} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.2)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Identity</span>
                                <div><span style={{ color: '#64748b' }}>Lot ID: </span>{lot.treasuryOriginLotId || lot.id}</div>
                                <div><span style={{ color: '#64748b' }}>Policy: </span>{lot.policyProfileId ?? '—'}</div>
                                <div><span style={{ color: '#64748b' }}>Strategy: </span>{lot.strategyClass ?? '—'}</div>
                                <div><span style={{ color: '#64748b' }}>Duration: </span>{lot.durationClass ?? '—'}</div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Timeline</span>
                                <div><span style={{ color: '#64748b' }}>Entry: </span>{formatDateOnly(lot.entryDate)}</div>
                                <div><span style={{ color: '#64748b' }}>Expiration: </span>{formatDateOnly(lot.expirationDate)}</div>
                                <div><span style={{ color: '#64748b' }}>Maturity: </span>{formatDateOnly(lot.maturityDate)}</div>
                                <div><span style={{ color: '#64748b' }}>Liability Unlock: </span>{lot.liabilityUnlockAt ? formatDateTime(lot.liabilityUnlockAt) : '—'}</div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Settlement</span>
                                <div><span style={{ color: '#64748b' }}>Status: </span>{lot.treasurySettlementStatus ?? lot.protocolStatus ?? '—'}</div>
                                <div><span style={{ color: '#64748b' }}>Returned: </span>{lot.returnedAmountUsd != null ? formatUsd(lot.returnedAmountUsd * 1_000_000) : '—'}</div>
                                <div>
                                  <span style={{ color: '#64748b' }}>Anchor: </span>
                                  {anchor ? (
                                    <span style={{ color: anchor.status === 'anchored' ? '#86efac' : anchor.status === 'pending' ? '#fde68a' : '#64748b' }}>
                                      {anchor.status}{anchor.anchoredAt ? ` · ${formatDateOnly(anchor.anchoredAt)}` : ''}
                                    </span>
                                  ) : '—'}
                                </div>
                                {lot.escrowExecutionOrderId && <div><span style={{ color: '#64748b' }}>Exec Order: </span>{lot.escrowExecutionOrderId}</div>}
                              </div>
                              {(lot.treasuryLotTxHash || lot.treasuryBatchTxHash || lot.circleTransferTxHash) && (
                                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  {lot.treasuryLotTxHash   && <div><span style={{ color: '#64748b' }}>Lot TX: </span>{renderTxHash(lot.treasuryLotTxHash)}</div>}
                                  {lot.treasuryBatchTxHash && <div><span style={{ color: '#64748b' }}>Batch TX: </span>{renderTxHash(lot.treasuryBatchTxHash)}</div>}
                                  {lot.circleTransferTxHash && <div><span style={{ color: '#64748b' }}>Circle TX: </span>{renderTxHash(lot.circleTransferTxHash)}</div>}
                                </div>
                              )}
                              {renderDistributionPreview(lot)}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return rows;
                  })}
                  {pagedBankLots.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>No lots match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {bankLotPageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.78rem', color: '#64748b' }}>
              <span>{sortedBankLots.length} lots · page {safeBankPage} of {bankLotPageCount}</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button onClick={() => setLotPage(p => Math.max(1, p - 1))} disabled={safeBankPage === 1}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.25rem', padding: '0.2rem 0.5rem', color: safeBankPage === 1 ? '#334155' : '#94a3b8', cursor: safeBankPage === 1 ? 'not-allowed' : 'pointer' }}>‹</button>
                <button onClick={() => setLotPage(p => Math.min(bankLotPageCount, p + 1))} disabled={safeBankPage === bankLotPageCount}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.25rem', padding: '0.2rem 0.5rem', color: safeBankPage === bankLotPageCount ? '#334155' : '#94a3b8', cursor: safeBankPage === bankLotPageCount ? 'not-allowed' : 'pointer' }}>›</button>
              </div>
            </div>
          )}
        </>)}

        {/* ── VAULT ── */}
        {lotSource === 'VAULT' && (<>
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            {([['all','All'],['eligible','Eligible'],['batched','Batched'],['settled','Settled']] as [string,string][]).map(([f,l]) => (
              <button key={f} onClick={() => { setVaultLotFilter(f as typeof vaultLotFilter); setLotPage(1); }}
                style={{ background: vaultLotFilter === f ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: vaultLotFilter === f ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.07)', borderRadius: '9999px', padding: '0.2rem 0.625rem', color: vaultLotFilter === f ? '#e2e8f0' : '#64748b', fontSize: '0.72rem', fontWeight: vaultLotFilter === f ? 600 : 400, cursor: 'pointer' }}
              >{l}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={() => fetchVaultLots()} disabled={vaultLotsLoading}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.2rem 0.5rem', color: '#64748b', cursor: vaultLotsLoading ? 'not-allowed' : 'pointer' }}
            ><RefreshCw style={{ width: '0.875rem', height: '0.875rem' } as import('react').CSSProperties} /></button>
          </div>

          {vaultBatchStatus && (
            <div style={{ marginBottom: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: vaultBatchTone === 'success' ? 'rgba(134,239,172,0.1)' : vaultBatchTone === 'warning' ? 'rgba(253,230,138,0.1)' : 'rgba(252,165,165,0.1)', color: vaultBatchTone === 'success' ? '#86efac' : vaultBatchTone === 'warning' ? '#fde68a' : '#fca5a5', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              {vaultBatchStatus}
            </div>
          )}
          {vaultLotsError && (
            <div style={{ marginBottom: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: 'rgba(252,165,165,0.08)', color: '#fca5a5', fontSize: '0.8rem', border: '1px solid rgba(252,165,165,0.15)' }}>
              {vaultLotsError}
            </div>
          )}
          {vaultLotsLoading && <div style={{ padding: '1.5rem', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>Loading vault lots…</div>}

          {!vaultLotsLoading && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr>
                    <th style={thSt}>#</th>
                    <th style={thSt}>Receipt ID</th>
                    <th style={thSt}>Amount</th>
                    <th style={thSt}>Funded</th>
                    <th style={thSt}>Unlocks</th>
                    <th style={thSt}>Batch</th>
                    <th style={thSt}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVaultLots.map(lot => (
                    <tr key={lot.id}>
                      <td style={{ ...cellSt, color: '#64748b', fontFamily: 'monospace', fontSize: '0.75rem' }}>{lot.id}</td>
                      <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8' }}>{formatHashShort(lot.receiptId?.toString())}</td>
                      <td style={{ ...cellSt, fontVariantNumeric: 'tabular-nums' }}>{formatUsd(lot.amountUsd6)}</td>
                      <td style={{ ...cellSt, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatChainTime(lot.fundedAt)}</td>
                      <td style={{ ...cellSt, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatChainTime(lot.liabilityUnlockAt)}</td>
                      <td style={{ ...cellSt, fontFamily: 'monospace', fontSize: '0.75rem' }}>{lot.batchId > 0 ? `#${lot.batchId}` : '—'}</td>
                      <td style={cellSt}>
                        <span style={{ display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 600, background: lot.status === 3 ? 'rgba(110,231,183,0.12)' : lot.batchId > 0 ? 'rgba(147,197,253,0.12)' : 'rgba(134,239,172,0.12)', color: lot.status === 3 ? '#6ee7b7' : lot.batchId > 0 ? '#93c5fd' : '#86efac' }}>
                          {TREASURY_BATCH_STATUS[lot.status] ?? 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pagedVaultLots.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>No vault lots match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!vaultLotsLoading && (() => {
            const { eligibleLots } = getVaultBatchWindow();
            return (
              <div style={{ marginTop: '0.75rem' }}>
                <button onClick={handleCreateVaultBatch} disabled={vaultBatchLoading || eligibleLots.length === 0}
                  style={{ background: vaultBatchLoading || eligibleLots.length === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(147,197,253,0.15)', border: `1px solid ${vaultBatchLoading || eligibleLots.length === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(147,197,253,0.3)'}`, borderRadius: '0.375rem', padding: '0.375rem 0.875rem', color: vaultBatchLoading || eligibleLots.length === 0 ? '#475569' : '#93c5fd', fontSize: '0.8rem', fontWeight: 600, cursor: vaultBatchLoading || eligibleLots.length === 0 ? 'not-allowed' : 'pointer' }}
                >{vaultBatchLoading ? 'Creating…' : `Create Vault Batch (${eligibleLots.length} eligible)`}</button>
              </div>
            );
          })()}

          {vaultLotPageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.78rem', color: '#64748b' }}>
              <span>{sortedVaultLots.length} lots · page {safeVaultPage} of {vaultLotPageCount}</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button onClick={() => setLotPage(p => Math.max(1, p - 1))} disabled={safeVaultPage === 1}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.25rem', padding: '0.2rem 0.5rem', color: safeVaultPage === 1 ? '#334155' : '#94a3b8', cursor: safeVaultPage === 1 ? 'not-allowed' : 'pointer' }}>‹</button>
                <button onClick={() => setLotPage(p => Math.min(vaultLotPageCount, p + 1))} disabled={safeVaultPage === vaultLotPageCount}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.25rem', padding: '0.2rem 0.5rem', color: safeVaultPage === vaultLotPageCount ? '#334155' : '#94a3b8', cursor: safeVaultPage === vaultLotPageCount ? 'not-allowed' : 'pointer' }}>›</button>
              </div>
            </div>
          )}
        </>)}
      </div>

      {/* PROTOCOL WIRING */}
      <div style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.03) 0%,rgba(255,255,255,0) 100%)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
        <button onClick={() => setWiringOpen(o => !o)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e2e8f0' }}>Protocol Wiring</span>
          <span style={{ fontSize: '0.72rem', color: '#475569' }}>{wiringOpen ? '▲ collapse' : '▼ expand'}</span>
        </button>

        {wiringOpen && (
          <div style={{ padding: '0 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {linkConfigStatus && (
              <div style={{ padding: '0.375rem 0.625rem', borderRadius: '0.375rem', background: 'rgba(134,239,172,0.08)', color: '#86efac', fontSize: '0.78rem', border: '1px solid rgba(134,239,172,0.15)' }}>
                {linkConfigStatus}
              </div>
            )}

            {/* Address inputs */}
            {([
              ['Treasury', treasuryAddressInput, setTreasuryAddressInput, handleUseTreasuryAddress],
              ['GoldOracle', goldOracleAddressInput, setGoldOracleAddressInput, handleUseGoldOracleAddress],
            ] as [string, string, (v: string) => void, () => void][]).map(([lbl, val, setter, handler]) => (
              <div key={lbl} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ width: '7rem', fontSize: '0.78rem', color: '#64748b', flexShrink: 0 }}>{lbl}</label>
                <input type="text" value={val} onChange={e => setter(e.target.value)} placeholder="0x…"
                  style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.3rem 0.5rem', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', fontFamily: 'monospace' }}
                />
                <button onClick={handler}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', padding: '0.3rem 0.625rem', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}
                >Use</button>
              </div>
            ))}

            {/* Link buttons */}
            {([
              ['Vault',   vaultLinkInput,   setVaultLinkInput,   handleSetTreasuryVaultLink,   vaultAddress],
              ['Escrow',  escrowLinkInput,  setEscrowLinkInput,  handleSetTreasuryEscrowLink,  escrowAddress],
              ['Reserve', reserveLinkInput, setReserveLinkInput, handleSetTreasuryReserveLink, linkedReserveAddress],
            ] as [string, string, (v: string) => void, () => Promise<void>, string | null][]).map(([lbl, val, setter, handler, linked]) => (
              <div key={lbl} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ width: '7rem', fontSize: '0.78rem', color: '#64748b', flexShrink: 0 }}>
                  {lbl}
                  {linked && <span style={{ display: 'block', fontSize: '0.62rem', color: '#22c55e' }}>● linked</span>}
                </label>
                <input type="text" value={val} onChange={e => setter(e.target.value)} placeholder="0x…"
                  style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.3rem 0.5rem', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', fontFamily: 'monospace' }}
                />
                <button onClick={handler} disabled={linkConfigLoading}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', padding: '0.3rem 0.625rem', color: '#94a3b8', fontSize: '0.78rem', cursor: linkConfigLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                >{linkConfigLoading ? '…' : `Link ${lbl}`}</button>
              </div>
            ))}

            {/* Execution Authorization */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.5rem' }}>Execution Authorization</div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <input type="text" placeholder="Batch ID" value={authBatchIdInput} onChange={e => setAuthBatchIdInput(e.target.value)}
                  style={{ width: '6rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.3rem 0.5rem', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none' }}
                />
                <button onClick={handleFetchBatch} disabled={authBatchLoading}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', padding: '0.3rem 0.625rem', color: '#94a3b8', fontSize: '0.78rem', cursor: authBatchLoading ? 'not-allowed' : 'pointer' }}
                >{authBatchLoading ? '…' : 'Fetch Batch'}</button>
              </div>
              {authBatchFetchError && <div style={{ color: '#fca5a5', fontSize: '0.75rem', marginBottom: '0.4rem' }}>{authBatchFetchError}</div>}
              {authBatchInfo && (
                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', marginBottom: '0.625rem', fontSize: '0.78rem', color: '#94a3b8', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.3rem 1rem' }}>
                  <div><span style={{ color: '#64748b' }}>Batch: </span>#{authBatchInfo.batchId}</div>
                  <div><span style={{ color: '#64748b' }}>Type: </span>{TREASURY_ORIGIN_TYPE[authBatchInfo.originType] ?? authBatchInfo.originType}</div>
                  <div><span style={{ color: '#64748b' }}>Status: </span>{TREASURY_BATCH_STATUS[authBatchInfo.status] ?? authBatchInfo.status}</div>
                  <div><span style={{ color: '#64748b' }}>Lots: </span>{authBatchInfo.lotCount}</div>
                  <div><span style={{ color: '#64748b' }}>Principal: </span>{formatUsd(authBatchInfo.principalAllocated)}</div>
                  <div><span style={{ color: '#64748b' }}>Expected Return: </span>{formatChainTime(authBatchInfo.expectedReturnAt)}</div>
                </div>
              )}
              {authBatchInfo && authBatchInfo.status < 2 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {([
                    ['Route ID', authRouteId, setAuthRouteId],
                    ['Max Alloc (USD)', authMaxAllocation, setAuthMaxAllocation],
                    ['Close Time (unix)', authExpectedCloseTime, setAuthExpectedCloseTime],
                    ['Unit', authSettlementUnit, setAuthSettlementUnit],
                  ] as [string, string, (v: string) => void][]).map(([lbl2, val2, setter2]) => (
                    <div key={lbl2}>
                      <div style={{ fontSize: '0.65rem', color: '#475569', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lbl2}</div>
                      <input type="text" value={val2} onChange={e => setter2(e.target.value)}
                        style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.375rem', padding: '0.3rem 0.5rem', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>
              )}
              {authBatchInfo && authBatchInfo.status < 2 && (
                <button onClick={handleAuthorizeExecution} disabled={authLoading || !signer}
                  style={{ background: authLoading || !signer ? 'rgba(255,255,255,0.04)' : 'rgba(212,168,48,0.15)', border: `1px solid ${authLoading || !signer ? 'rgba(255,255,255,0.08)' : 'rgba(212,168,48,0.35)'}`, borderRadius: '0.375rem', padding: '0.35rem 0.875rem', color: authLoading || !signer ? '#475569' : '#fcd34d', fontSize: '0.8rem', fontWeight: 600, cursor: authLoading || !signer ? 'not-allowed' : 'pointer' }}
                >{authLoading ? 'Authorizing…' : !signer ? 'Signer required' : 'Authorize Execution'}</button>
              )}
              {authStatus && (
                <div style={{ marginTop: '0.4rem', padding: '0.3rem 0.5rem', borderRadius: '0.375rem', background: authStatusTone === 'success' ? 'rgba(134,239,172,0.1)' : authStatusTone === 'warning' ? 'rgba(253,230,138,0.1)' : 'rgba(252,165,165,0.1)', color: authStatusTone === 'success' ? '#86efac' : authStatusTone === 'warning' ? '#fde68a' : '#fca5a5', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                  {authStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ENGINE LOG */}
      <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.75rem', overflow: 'hidden' }}>
        <button onClick={() => setLogCollapsed(c => !c)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 1rem', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>Engine Log</span>
          <span style={{ fontSize: '0.7rem', color: '#334155' }}>{logCollapsed ? `▼ ${log.length} entries` : '▲ collapse'}</span>
        </button>
        {!logCollapsed && (
          <div style={{ padding: '0 0.75rem 0.75rem', maxHeight: '14rem', overflowY: 'auto' }}>
            {log.length === 0 && <div style={{ color: '#334155', fontSize: '0.75rem', padding: '0.5rem 0', textAlign: 'center' }}>No events yet.</div>}
            {log.map((entry, i) => (
              <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#475569', padding: '0.15rem 0', borderBottom: i < log.length - 1 ? '1px solid rgba(255,255,255,0.025)' : 'none', wordBreak: 'break-all' }}>
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
