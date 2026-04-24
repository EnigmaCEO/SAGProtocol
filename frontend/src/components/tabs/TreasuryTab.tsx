import { useEffect, useRef, useState } from 'react';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';

import MetricCard from '../ui/MetricCard';
import { ClockIcon as Clock, RefreshIcon as RefreshCw } from '../icons/SagittaIcons';
import PageHeader from '../ui/PageHeader';

import TREASURY_ABI from '../../lib/abis/Treasury.json';
import GOLD_ORACLE_ABI from '../../lib/abis/MockOracle.json'; // use MockOracle ABI for GOLD (or replace with GoldOracle.json if you add it)
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';
import { RPC_URL } from '../../lib/network';

const normalizeAbi = (x: any): any => Array.isArray(x) ? x : x?.abi ?? x?.default?.abi ?? x?.default ?? [];
const TREASURY_ABI_NORM: any = normalizeAbi(TREASURY_ABI);
const GOLD_ORACLE_ABI_NORM: any = normalizeAbi(GOLD_ORACLE_ABI);

const LOCALHOST_RPC = RPC_URL;
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

export default function TreasuryTab() {
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
  }>>([]);
  const [bankLotsLoading, setBankLotsLoading] = useState(false);
  const [bankLotsError, setBankLotsError] = useState<string | null>(null);
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
  }, []);

  // On mount: setup provider and contracts
  useEffect(() => {
    if (!isValidAddress(treasuryAddress) || !isValidAddress(goldOracleAddress)) {
      setTreasury(undefined);
      setGoldOracle(undefined);
      return;
    }
    const rp = new JsonRpcProvider(LOCALHOST_RPC);
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
  }, [treasuryAddress, goldOracleAddress]);

  useEffect(() => {
    fetchBankLots();
  }, []);

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
      const res = await fetch('/api/banking/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const positions = (data.termPositions ?? data.state?.termPositions ?? []) as Array<any>;
      setBankLots(
        positions
          .filter((p: any) => p.treasuryOriginLotId && p.status !== 'not_funded')
          .map((p: any) => ({
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
          }))
      );
    } catch (e: any) {
      setBankLotsError(String(e?.message || e));
    } finally {
      setBankLotsLoading(false);
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
        fetch('/api/banking/escrow/execution-orders'),
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
    if (!signer || !isValidAddress(treasuryAddress)) {
      setVaultBatchTone('danger');
      setVaultBatchStatus('Treasury signer not available. Ensure Treasury address is set.');
      return;
    }

    setVaultBatchLoading(true);
    setVaultBatchStatus(null);
    try {
      const treasuryWrite = new Contract(treasuryAddress, TREASURY_ABI_NORM, signer);
      const lotIds = eligibleLots.map(lot => BigInt(lot.id));
      const batchId = await treasuryWrite.createAndFundBatch.staticCall(
        ORIGIN_TYPE_VAULT,
        lotIds,
        BigInt(expectedReturnAt),
        BigInt(settlementDeadlineAt),
      );
      const tx = await treasuryWrite.createAndFundBatch(
        ORIGIN_TYPE_VAULT,
        lotIds,
        BigInt(expectedReturnAt),
        BigInt(settlementDeadlineAt),
      );
      await tx.wait();
      const batchIdStr = batchId.toString();
      setVaultBatchTone('success');
      setVaultBatchStatus(`Batch #${batchIdStr} created with ${eligibleLots.length} lot(s). Tx: ${tx.hash}`);
      pushEngineLog(`[TreasuryHandoff:Vault] batch=${batchIdStr} lots=${eligibleLots.map(l => l.id).join(',')}`);

      // Register the on-chain batch with the banking tracker (fire-and-forget — non-blocking)
      fetch('/api/banking/treasury/vault-batches/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: batchIdStr,
          txHash: tx.hash,
          lotIds: eligibleLots.map(l => String(l.id)),
          principalUsd: eligibleLots.reduce((sum, l) => sum + l.amountUsd6 / 1_000_000, 0),
          expectedReturnAt: new Date(expectedReturnAt * 1000).toISOString(),
          settlementDeadlineAt: new Date(settlementDeadlineAt * 1000).toISOString(),
        }),
      }).catch(() => {/* tracker unavailable — batch still succeeded on-chain */});

      await Promise.allSettled([fetchVaultLots(), refreshTreasuryState()]);
    } catch (e: any) {
      setVaultBatchTone('danger');
      setVaultBatchStatus(String(e?.reason || e?.message || e));
    } finally {
      setVaultBatchLoading(false);
    }
  }

  async function handleCreateBankBatch() {
    setBankBatchLoading(true);
    setBankBatchStatus(null);
    try {
      const res = await fetch('/api/banking/treasury/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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

  // --- Render ---
  // USDC deployed to Escrow has already left Treasury's balance. Only reserve the
  // *unfunded* portion of depositor liabilities (what Treasury hasn't yet sent out).
  const deployedToEscrow = escrowUsdcBalance;
  const unfundedLiability = Math.max(collateralizedUsd - deployedToEscrow, 0);
  const availableUsdc = Math.max(usdcBalance - unfundedLiability, 0);
  const collateralShortfall = Math.max(unfundedLiability - usdcBalance, 0);
  const treasuryValuationGap = Math.abs(treasuryUsd - usdcBalance);
  const vaultBatchWindow = getVaultBatchWindow();
  const vaultCompatibleLotCount = vaultBatchWindow.eligibleLots.length;
  return (
    <div className="tab-screen">
      <PageHeader
        title="Treasury Engine"
        description="Monitor liquid capital, reserve backing, and batch funding signals while steering Treasury-side operations."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {new Date().toLocaleTimeString()}</span>
            <span className="data-chip">Treasury: {formatAddressShort(treasuryAddress)}</span>
            <span className="data-chip">Vault: {formatAddressShort(vaultAddress)}</span>
            <span className="data-chip" data-tone={loading ? 'warning' : 'success'}>
              {loading ? 'Syncing' : 'Live'}
            </span>
          </>
        }
        actions={
          <button
            className="icon-button"
            onClick={refreshTreasuryState}
            disabled={loading}
            title="Refresh treasury state"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />
      {treasuryValuationGap > 1_000_000 && (
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--warning">
            <div>
              Treasury valuation mismatch detected. Contract reports {formatUsd(treasuryUsd)} while liquid USDC is {formatUsd(usdcBalance)}.
              This usually means the deployed Treasury is a legacy build valuing non-USDC assets.
            </div>
          </div>
        </div>
      )}
 
      <div>
        <div className="sagitta-grid treasury-metrics-grid">
          {/* Cell 1 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Oracle Prices</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard title="USDC Price (USD)" value="$1.00" tone="neutral" />
            <MetricCard title="Gold Price (USD)" value={goldPrice ? `$${goldPrice.toFixed(2)}` : '–'} tone="neutral" />
          </div>

          </div>

          {/* Cell 2 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Treasury Totals</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard title="Treasury Value (Contract)" value={formatUsd(treasuryUsd)} tone="success" />
              <MetricCard title="Liquid USDC (Treasury)" value={formatUsd(usdcBalance)} tone="neutral" />
            </div>
          </div>

          {/* Cell 3 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Gold Reserves</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard title="Reserve Value" value={formatUsd(reserveUsd)} tone="neutral" />
              <MetricCard title="Target Reserve" value={formatUsd(targetReserveUsd)} tone="neutral" />
            </div>
          </div>

          {/* Cell 4 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Asset Balances</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard title="Available USDC" value={formatUsd(availableUsdc)} tone="neutral" />
              <MetricCard
                title={collateralShortfall > 0 ? 'Collateral Shortfall' : 'Collateralized USDC'}
                value={formatUsd(collateralShortfall > 0 ? collateralShortfall : collateralizedUsd)}
                tone={collateralShortfall > 0 ? 'warning' : 'success'}
              />
            </div>
          </div>

          {/* Cell 5 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Escrow</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard
                title="Deployed to Batches"
                value={formatUsd(deployedToEscrow)}
                tone={deployedToEscrow > 0 ? 'warning' : 'neutral'}
              />
              <MetricCard title="Escrow Address" value={formatAddressShort(escrowAddress)} tone="neutral" />
            </div>
          </div>

          {/* Cell 6 */}
          <div className="sagitta-cell">
            <h3 className="section-title">Safety / Coverage</h3>
            <div className="panel-stack panel-stack--dense">
              <MetricCard title="Coverage Ratio" value={formatCoverageRatio(coverageRatio)} tone="success" />
              <MetricCard title="Treasury : Reserve Ratio" value={formatRatio(treasuryUsd, reserveUsd)} tone="neutral" />
            </div>
          </div>
          {/* Cell 7 */}
          <div className="sagitta-cell treasury-controls-cell">
            <h3 className="section-title">Write Surface</h3>
            <p className="section-subtitle">Treasury write controls were moved to DAO Administration so gold repricing, reserve rebalance, and manual receipt profit payout are all proposal-gated in one place.</p>
            <div className="panel-stack panel-stack--dense">
              <div className="panel-row">
                <span className="panel-row__label">DAO path</span>
                <span className="panel-row__value">DAO Administration -&gt; Treasury Control Proposals</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Treasury</span>
                <span className="panel-row__value">{formatAddressShort(treasuryAddress)}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Vault wiring</span>
                <span className="panel-row__value">{formatAddressShort(vaultAddress)}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Reserve wiring</span>
                <span className="panel-row__value">{formatAddressShort(linkedReserveAddress)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* BANK Liquidity */}
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
            <div>
              <h3 className="section-title !mb-0">Compatible Treasury Liquidity</h3>
              <p className="section-subtitle !mt-1 !mb-0">BANK-origin lots grouped by duration, policy profile, and strategy sleeve before Escrow handoff.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className="action-button" onClick={fetchBankLots} disabled={bankLotsLoading}>
                {bankLotsLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button
                className="action-button action-button--primary"
                onClick={handleCreateBankBatch}
                disabled={bankBatchLoading || bankLots.filter(l => !l.treasuryBatchId).length === 0}
              >
                {bankBatchLoading ? 'Creating…' : 'Create Bank Batch'}
              </button>
            </div>
          </div>

          {bankLotsError && (
            <div className="status-banner status-banner--warning" style={{ marginBottom: '0.5rem' }}>{bankLotsError}</div>
          )}
          {bankBatchStatus && (
            <div className={`status-banner status-banner--${bankBatchTone}`} style={{ marginBottom: '0.5rem' }}>{bankBatchStatus}</div>
          )}

          {bankLots.length === 0 && !bankLotsLoading && !bankLotsError ? (
            <div className="panel-stack panel-stack--dense">
              <div className="panel-row">
                <span className="panel-row__label" style={{ color: 'var(--text-muted)' }}>No BANK-origin lots on record. Refresh to load from banking backend.</span>
              </div>
            </div>
          ) : (
            <div className="panel-stack panel-stack--dense">
              {bankLots.map(lot => {
                const isSettled = lot.protocolStatus === 'settled' || lot.protocolStatus === 'wire_ready';
                const eligible = !lot.treasuryBatchId && !isSettled;
                const statusLabel = isSettled
                  ? lot.protocolStatus === 'wire_ready' ? 'Wire Return Pending' : 'Settled'
                  : lot.treasuryBatchId
                    ? `Handed to Escrow #${lot.treasuryBatchId}`
                    : lot.protocolStatus === 'lot_registered'
                      ? 'Waiting for compatible batch'
                      : (lot.protocolStatus ?? 'Waiting');
                return (
                  <div key={lot.id} className="panel-row" style={{ alignItems: 'flex-start' }}>
                    <span className="panel-row__label" style={{ minWidth: 90 }}>
                      Lot #{lot.treasuryOriginLotId}
                    </span>
                    <span className="panel-row__value" style={{ flex: 1 }}>
                      {formatUsd(lot.principalUsd * 1_000_000)}
                      {' | '}
                      {lot.durationClass || 'duration n/a'}
                      {' | '}
                      {lot.policyProfileId || 'policy n/a'}
                      {' | '}
                      {lot.strategyClass || 'sleeve n/a'}
                      {lot.maturityDate ? ` | matures ${new Date(lot.maturityDate).toLocaleDateString()}` : ''}
                    </span>
                    <span
                      className="panel-row__value"
                      data-tone={isSettled ? 'neutral' : eligible ? 'warning' : 'success'}
                      style={{ minWidth: 120, textAlign: 'right' }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* VAULT Liquidity */}
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
            <div>
              <h3 className="section-title !mb-0">Compatible Vault Collateral</h3>
              <p className="section-subtitle !mt-1 !mb-0">VAULT-origin lots grouped from collateralized receipt deposits before Escrow handoff.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className="action-button" onClick={fetchVaultLots} disabled={vaultLotsLoading || !treasury}>
                {vaultLotsLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                className="action-button action-button--primary"
                onClick={handleCreateVaultBatch}
                disabled={vaultBatchLoading || vaultCompatibleLotCount === 0 || !treasury}
              >
                {vaultBatchLoading ? 'Creating...' : 'Create Vault Batch'}
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-400" style={{ marginBottom: '0.75rem' }}>
            Current batch window: expected return {formatChainTime(vaultBatchWindow.expectedReturnAt)} with hard close {formatChainTime(vaultBatchWindow.settlementDeadlineAt)}. Only lots with liability unlock at or after hard close are compatible.
          </div>

          {vaultLotsError && (
            <div className="status-banner status-banner--warning" style={{ marginBottom: '0.5rem' }}>{vaultLotsError}</div>
          )}
          {vaultBatchStatus && (
            <div className={`status-banner status-banner--${vaultBatchTone}`} style={{ marginBottom: '0.5rem' }}>{vaultBatchStatus}</div>
          )}

          {vaultLots.length === 0 && !vaultLotsLoading && !vaultLotsError ? (
            <div className="panel-stack panel-stack--dense">
              <div className="panel-row">
                <span className="panel-row__label" style={{ color: 'var(--text-muted)' }}>No VAULT-origin lots on record. User deposits must register Treasury origin lots first.</span>
              </div>
            </div>
          ) : (
            <div className="panel-stack panel-stack--dense">
              {vaultLots.map(lot => {
                const compatible = vaultBatchWindow.eligibleLots.some(item => item.id === lot.id);
                const status = ORIGIN_LOT_STATUS[lot.status] ?? `Status ${lot.status}`;
                const isLotSettled = lot.status >= 3 || (lot.batchId > 0 && settledVaultBatchIds.has(String(lot.batchId)));
                const statusLabel = isLotSettled
                  ? lot.status === 4 ? 'Cancelled' : 'Settled'
                  : lot.batchId > 0
                    ? `Handed to Escrow #${lot.batchId}`
                    : compatible
                      ? 'Ready for batch'
                      : lot.status === 1
                        ? 'Unlock before batch window'
                        : status;
                return (
                  <div key={lot.id} className="panel-row" style={{ alignItems: 'flex-start' }}>
                    <span className="panel-row__label" style={{ minWidth: 90 }}>
                      Lot #{lot.id}
                    </span>
                    <span className="panel-row__value" style={{ flex: 1 }}>
                      {formatUsd(lot.amountUsd6)}
                      {' | receipt #'}
                      {lot.receiptId}
                      {' | funded '}
                      {formatChainTime(lot.fundedAt)}
                      {' | unlocks '}
                      {formatChainTime(lot.liabilityUnlockAt)}
                    </span>
                    <span
                      className="panel-row__value"
                      data-tone={isLotSettled ? 'neutral' : compatible ? 'warning' : lot.batchId > 0 ? 'success' : 'neutral'}
                      style={{ minWidth: 150, textAlign: 'right' }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Engine Log */}
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div className="log-shell">
            <h3 className="log-shell__title">Engine Log</h3>
            {log.length === 0 && <div className="text-slate-500">No actions yet.</div>}
            {log.map((entry, i) => (
              <div key={i} className="log-shell__entry">{entry}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
