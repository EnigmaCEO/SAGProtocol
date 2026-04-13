import { useEffect, useRef, useState } from 'react';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';

import MetricCard from '../ui/MetricCard';
import { Clock, RefreshCw } from 'lucide-react';
import PageHeader from '../ui/PageHeader';

import TREASURY_ABI from '../../lib/abis/Treasury.json';
import GOLD_ORACLE_ABI from '../../lib/abis/MockOracle.json'; // use MockOracle ABI for GOLD (or replace with GoldOracle.json if you add it)
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';
import { RPC_URL } from '../../lib/network';

const normalizeAbi = (x: any): any => Array.isArray(x) ? x : x?.abi ?? x?.default?.abi ?? x?.default ?? [];
const TREASURY_ABI_NORM: any = normalizeAbi(TREASURY_ABI);
const GOLD_ORACLE_ABI_NORM: any = normalizeAbi(GOLD_ORACLE_ABI);

const LOCALHOST_RPC = RPC_URL;
const LOCAL_CHAIN_IDS = new Set([1337, 31337]);
const BATCH_CADENCE_KEY = 'sagitta.batchCadenceSeconds';
const DEFAULT_BATCH_CADENCE_SECONDS = 7 * 24 * 60 * 60;
const BATCH_CADENCE_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { label: '2 weeks', seconds: 14 * 24 * 60 * 60 },
  { label: '1 month', seconds: 30 * 24 * 60 * 60 },
];
// Local test private key (Hardhat/Anvil default account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
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
  const [linkConfigLoading, setLinkConfigLoading] = useState(false);
  const [linkConfigStatus, setLinkConfigStatus] = useState<string | null>(null);
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

  const [isLocalhostNetwork, setIsLocalhostNetwork] = useState(false);
  const [localChainId, setLocalChainId] = useState<number | null>(null);
  const [localChainTime, setLocalChainTime] = useState<number | null>(null);
  const [timeControlLoading, setTimeControlLoading] = useState(false);
  const [batchCadenceSeconds, setBatchCadenceSeconds] = useState<number>(DEFAULT_BATCH_CADENCE_SECONDS);
  const [escrowLastRollTime, setEscrowLastRollTime] = useState<number | null>(null);

  // Providers and contracts
  const [provider, setProvider] = useState<JsonRpcProvider>();
  const [treasury, setTreasury] = useState<Contract>();
  const [goldOracle, setGoldOracle] = useState<Contract>();
  const [signer, setSigner] = useState<any>(); // Wallet signer for write txs
  const seenLogKeysRef = useRef<Set<string>>(new Set());

  // NEW: show configured vault address and helper formatting
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);

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

  async function refreshLocalChainClock(rpcProvider: JsonRpcProvider) {
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

  async function refreshProtocolConfigState(rpcProvider: JsonRpcProvider) {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    try {
      const configuredEscrow = escrowAddress && escrowAddress !== ZERO_ADDRESS ? escrowAddress : null;
      if (configuredEscrow) {
        try {
          const escrowRead = new Contract(
            configuredEscrow,
            ['function lastBatchRollTime() view returns (uint256)'],
            rpcProvider
          );
          const lastRollRaw = await escrowRead.lastBatchRollTime();
          const lastRollSec = Number(lastRollRaw);
          setEscrowLastRollTime(Number.isFinite(lastRollSec) && lastRollSec > 0 ? lastRollSec : null);
        } catch {
          setEscrowLastRollTime(null);
        }
      } else {
        setEscrowLastRollTime(null);
      }
    } catch {
      // ignore config refresh errors to keep dashboard resilient
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(BATCH_CADENCE_KEY);
    if (!saved) return;
    const parsed = Number(saved);
    if (Number.isFinite(parsed) && parsed > 0) {
      setBatchCadenceSeconds(parsed);
    }
  }, []);

  useEffect(() => {
    if (!provider) return;
    refreshLocalChainClock(provider);
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    refreshProtocolConfigState(provider);
  }, [provider, escrowAddress]);

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
        const fromBlock = Math.max(0, latest - 5000);

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

      if (provider) {
        await refreshLocalChainClock(provider);
      }

    } catch (e) {
      console.error(e);
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching state: ${e}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvanceLocalTime(seconds: number, label: string) {
    if (!provider) return;

    try {
      setTimeControlLoading(true);
      const network = await provider.getNetwork();
      const chainIdNum = Number(network.chainId);
      const rpcLooksLocal = LOCALHOST_RPC.includes('localhost') || LOCALHOST_RPC.includes('127.0.0.1');
      if (!rpcLooksLocal || !LOCAL_CHAIN_IDS.has(chainIdNum)) {
        setLog(l => [`[time controls] Skipped ${label}: active network is not localhost`, ...l]);
        return;
      }

      await provider.send('evm_increaseTime', [seconds]);
      await provider.send('evm_mine', []);
      await refreshLocalChainClock(provider);
      await refreshTreasuryState();

      setLog(l => [`[${new Date().toLocaleTimeString()}] Time advanced by ${label}`, ...l]);
    } catch (e) {
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error advancing time (${label}): ${e}`, ...l]);
    } finally {
      setTimeControlLoading(false);
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
  const availableUsdc = Math.max(usdcBalance - collateralizedUsd, 0);
  const collateralShortfall = Math.max(collateralizedUsd - usdcBalance, 0);
  const treasuryValuationGap = Math.abs(treasuryUsd - usdcBalance);
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
              <MetricCard title="Escrow USDC Balance" value={formatUsd(escrowUsdcBalance)} tone="neutral" />
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
