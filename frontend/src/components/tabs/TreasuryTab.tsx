import { useEffect, useState } from 'react';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';

import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, RefreshCw, Settings, ArrowRightLeft } from 'lucide-react';

import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import TREASURY_ABI from '../../lib/abis/Treasury.json';
import SAG_ORACLE_ABI from '../../lib/abis/MockOracle.json'; // use MockOracle ABI for SAG
import GOLD_ORACLE_ABI from '../../lib/abis/MockOracle.json'; // use MockOracle ABI for GOLD (or replace with GoldOracle.json if you add it)
import VAULT_ABI from '../../lib/abis/Vault.json';

const TREASURY_ADDRESS = CONTRACT_ADDRESSES.Treasury;
const SAG_ORACLE_ADDRESS = CONTRACT_ADDRESSES.SagOracle;
const GOLD_ORACLE_ADDRESS = CONTRACT_ADDRESSES.GoldOracle;
const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;

const LOCALHOST_RPC = "http://localhost:8545";
// Local test private key (Hardhat/Anvil default account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function formatUsd(val: number | string, decimals = 6) {
  if (!val) return '$0';
  const n = typeof val === 'string' ? Number(val) : val;
  return '$' + (n / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatRatio(num: number, denom: number) {
  if (!denom || !isFinite(num / denom) || denom === 0) return '–';
  return (num / denom).toFixed(2) + ' : 1.0';
}

function formatPercent(num: number, denom: number) {
  if (!denom || !isFinite(num / denom) || denom === 0) return '–';
  return ((num * 100) / denom).toFixed(1) + '%';
}

export default function TreasuryTab() {
  const [sagPrice, setSagPrice] = useState<number>(0);
  const [goldPrice, setGoldPrice] = useState<number>(0);
  const [treasuryUsd, setTreasuryUsd] = useState<number>(0);
  const [reserveUsd, setReserveUsd] = useState<number>(0);
  const [targetReserveUsd, setTargetReserveUsd] = useState<number>(0);
  const [coverageRatio, setCoverageRatio] = useState<number>(0);
  const [totalDepositsUsd, setTotalDepositsUsd] = useState<number>(0);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // NEW: asset-level metrics
  const [sagValueUsd6, setSagValueUsd6] = useState<number>(0); // USD6
  const [usdcBalance, setUsdcBalance] = useState<number>(0);   // USDC raw (6 decimals)
  const [collateralizedUsd, setCollateralizedUsd] = useState<number>(0); // USD6 recorded collateralized amount;
  // Escrow info
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [escrowUsdcBalance, setEscrowUsdcBalance] = useState<number>(0);

  // Dev controls
  const [sagPriceInput, setSagPriceInput] = useState('');
  const [goldPriceInput, setGoldPriceInput] = useState('');
  // NEW: distribute batch UI state
  const [distributeBatchId, setDistributeBatchId] = useState('');
  const [distributeTokenIds, setDistributeTokenIds] = useState(''); // comma-separated token ids

  // Providers and contracts
  const [provider, setProvider] = useState<JsonRpcProvider>();
  const [treasury, setTreasury] = useState<Contract>();
  const [sagOracle, setSagOracle] = useState<Contract>();
  const [goldOracle, setGoldOracle] = useState<Contract>();
  const [signer, setSigner] = useState<any>(); // Wallet signer for write txs

  // NEW: show configured vault address and helper formatting
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);

  // On mount: setup provider and contracts
  useEffect(() => {
    const rp = new JsonRpcProvider(LOCALHOST_RPC);
    // create local contract instances immediately for initial fetch
    const localTreasury = new Contract(TREASURY_ADDRESS, TREASURY_ABI, rp);
    const localSagOracle = new Contract(SAG_ORACLE_ADDRESS, SAG_ORACLE_ABI, rp);
    const localGoldOracle = new Contract(GOLD_ORACLE_ADDRESS, GOLD_ORACLE_ABI, rp);
    const localVault = new Contract(VAULT_ADDRESS, VAULT_ABI, rp);
    const w = new Wallet(TEST_PRIVATE_KEY, rp);

    // set stateful references for later interactions (refresh, controls)
    setProvider(rp);
    setTreasury(localTreasury);
    setSagOracle(localSagOracle);
    setGoldOracle(localGoldOracle);
    setSigner(w);

    // read and surface vault address (if set)
    (async () => {
      try {
        const v = await localTreasury.vault();
        setVaultAddress(v && v !== '0x0000000000000000000000000000000000000000' ? v : null);
        if (!v || v === '0x0000000000000000000000000000000000000000') {
          setLog(l => [`[init] Treasury.vault is not set — collateralize() will revert`, ...l]);
        }
        // read escrow address (if set)
        try {
          const e = await localTreasury.escrow();
          setEscrowAddress(e && e !== '0x0000000000000000000000000000000000000000' ? e : null);
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    })();

    // initial load: fetch totals + treasury/oracle values so UI is populated on first render
    (async () => {
      setLoading(true);
      try {
        const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // update as needed
        // fetch vault totals first (so coverage ratio uses latest totalDepositsUsd)
        let totalDeposits = 0;
        try {
          const totals: any = await localVault.getUserTotals(demoAddress);
          totalDeposits = Number(totals.totalPrincipalLocked) || 0;
          setTotalDepositsUsd(totalDeposits);
        } catch {
          setTotalDepositsUsd(0);
          totalDeposits = 0;
        }

        const [
          sagPriceRaw,
          goldPriceRaw,
          treasuryUsdRaw,
          reserveUsdRaw,
          targetReserveUsdRaw,
        ] = await Promise.all([
          localSagOracle.getPrice(),
          localGoldOracle.getPrice(),
          localTreasury.getTreasuryValueUsd(),
          localTreasury.getReserveValueUsd(),
          localTreasury.getTargetReserveUsd(),
        ]);

        const sagUsd = Number(sagPriceRaw) / 1e8;
        const goldUsd = Number(goldPriceRaw) / 1e8;

        setSagPrice(sagUsd);
        setGoldPrice(goldUsd);
        setTreasuryUsd(Number(treasuryUsdRaw));
        setReserveUsd(Number(reserveUsdRaw));
        setTargetReserveUsd(Number(targetReserveUsdRaw));
        setCoverageRatio((Number(treasuryUsdRaw) + Number(reserveUsdRaw)) / Math.max(totalDeposits, 1));

        // NEW: fetch token balances and collateralized total
        try {
          const sagAddr = await localTreasury.sag();
          const usdcAddr = await localTreasury.usdc();
          const ercBalanceAbi = ['function balanceOf(address) view returns (uint256)'];
          const sagToken = new Contract(sagAddr, ercBalanceAbi, rp);
          const usdcToken = new Contract(usdcAddr, ercBalanceAbi, rp);
          const sagBalRaw = await sagToken.balanceOf(TREASURY_ADDRESS);
          const usdcBalRaw = await usdcToken.balanceOf(TREASURY_ADDRESS);
          // sagValueUsd6 = (sagBal * sagPrice8) / 1e20  (matches on-chain calc)
          const sagValue = Number(sagBalRaw) * Number(sagPriceRaw) / 1e20;
          setSagValueUsd6(sagValue);
          setUsdcBalance(Number(usdcBalRaw));
          try {
            const collUsd = await localTreasury.totalCollateralUsd();
            setCollateralizedUsd(Number(collUsd));
          } catch {
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
          setSagValueUsd6(0);
          setUsdcBalance(0);
          setCollateralizedUsd(0);
        }

      } catch (e) {
        console.error(e);
        setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching initial state: ${e}`, ...l]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Helper: format USD6 BigNumber or numeric into $ string
  function fmtUsd6FromAny(x: any) {
    try {
      const s = x?.toString?.() ?? String(x ?? '0');
      return '$' + (Number(s) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
    } catch {
      return '$0';
    }
  }

  // subscribe to new blocks and refresh Treasury state immediately
  useEffect(() => {
    if (!provider) return;
    const onBlock = async (_blockNumber: number) => {
      try { await refreshTreasuryState(); } catch (_) {}
    };
    provider.on('block', onBlock);
    return () => { provider.off('block', onBlock); };
  }, [provider, treasury, sagOracle, goldOracle]);

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

    const onAttempt = (requestedUsd: any, usdcBefore: any, sagBefore: any, sagNeeded: any, event: any) => {
      setLog(l => [`[CollateralizeAttempt] request=${fmtUsd6FromAny(requestedUsd)} usdcBefore=${fmtUsd6FromAny(usdcBefore)} sagBefore=${sagBefore.toString()} sagNeeded=${sagNeeded.toString()}`, ...l]);
    };
    const onInsufficient = (requestedUsd: any, sagBefore: any, sagNeeded: any, event: any) => {
      setLog(l => [`[CollateralizeInsufficientSAG] request=${fmtUsd6FromAny(requestedUsd)} sagBefore=${sagBefore.toString()} sagNeeded=${sagNeeded.toString()}`, ...l]);
    };
    const onSucceeded = (requestedUsd: any, usdcAfter: any, event: any) => {
      setLog(l => [`[CollateralizeSucceeded] request=${fmtUsd6FromAny(requestedUsd)} usdcAfter=${fmtUsd6FromAny(usdcAfter)}`, ...l]);
    };
    const onCollateralized = (amountUsd: any, event: any) => {
      setLog(l => [`[Collateralized] ${fmtUsd6FromAny(amountUsd)} recorded`, ...l]);
    };
    const onBatchFunded = (batchId: any, amountUsd: any, event: any) => {
      setLog(l => [`[BatchFunded] batch=${batchId.toString()} amount=${fmtUsd6FromAny(amountUsd)} (funds moved to Escrow)`, ...l]);
      // refresh balances so Escrow USDC shows up immediately
      try { refreshTreasuryState(); } catch {}
    };
    const onBatchResult = (batchId: any, principalUsd: any, userProfitUsd: any, feeUsd: any, event: any) => {
      setLog(l => [`[BatchResult] batch=${batchId.toString()} principal=${fmtUsd6FromAny(principalUsd)} userProfit=${fmtUsd6FromAny(userProfitUsd)} fee=${fmtUsd6FromAny(feeUsd)}`, ...l]);
    };

    // safe to attach since ABI has fragments
    treasury.on('CollateralizeAttempt', onAttempt);
    treasury.on('CollateralizeInsufficientSAG', onInsufficient);
    treasury.on('CollateralizeSucceeded', onSucceeded);
    treasury.on('Collateralized', onCollateralized);
    treasury.on('BatchFunded', onBatchFunded);
    treasury.on('BatchResult', onBatchResult);

    return () => {
      // remove listeners only if ABI supports events
      try {
        treasury.off('CollateralizeAttempt', onAttempt);
        treasury.off('CollateralizeInsufficientSAG', onInsufficient);
        treasury.off('CollateralizeSucceeded', onSucceeded);
        treasury.off('Collateralized', onCollateralized);
        treasury.off('BatchFunded', onBatchFunded);
        treasury.off('BatchResult', onBatchResult);
      } catch {
        // ignore cleanup errors
      }
    };
  }, [provider, treasury]);

  // Fetch all metrics
  async function refreshTreasuryState() {
    if (!treasury || !sagOracle || !goldOracle) return;
    setLoading(true);
    try {
      const [
        sagPriceRaw,
        goldPriceRaw,
        treasuryUsdRaw,
        reserveUsdRaw,
        targetReserveUsdRaw,
      ] = await Promise.all([
        // MockOracle returns price as 8-decimal integer (e.g. 75000000 => $0.75)
        // prefer getPrice() which is implemented by MockOracle
        sagOracle.getPrice(),
        goldOracle.getPrice(),
        treasury.getTreasuryValueUsd(),
        treasury.getReserveValueUsd(),
        treasury.getTargetReserveUsd(),
      ]);

      // convert oracle 8-decimal -> human USD numbers
      const sagUsd = Number(sagPriceRaw) / 1e8;
      const goldUsd = Number(goldPriceRaw) / 1e8;

      setSagPrice(sagUsd);
      setGoldPrice(goldUsd);
      setTreasuryUsd(Number(treasuryUsdRaw)); // already in USD6
      setReserveUsd(Number(reserveUsdRaw)); // USD6
      setTargetReserveUsd(Number(targetReserveUsdRaw)); // USD6
      setCoverageRatio((Number(treasuryUsdRaw) + Number(reserveUsdRaw)) / Math.max(totalDepositsUsd, 1));

      // Refresh total deposits from Vault for demo account
      if (provider) {
        const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
        const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        try {
          const result = await vault.getUserTotals(demoAddress);
          setTotalDepositsUsd(Number(result.totalPrincipalLocked));
        } catch {
          setTotalDepositsUsd(0);
        }
      }

      // NEW: update asset balances and collateralized amount
      try {
        const sagAddr = await treasury.sag();
        const usdcAddr = await treasury.usdc();
        const ercBalanceAbi = ['function balanceOf(address) view returns (uint256)'];
        const sagToken = new Contract(sagAddr, ercBalanceAbi, provider);
        const usdcToken = new Contract(usdcAddr, ercBalanceAbi, provider);
        const [sagBalRaw, usdcBalRaw, collUsdRaw] = await Promise.all([
          sagToken.balanceOf(TREASURY_ADDRESS),
          usdcToken.balanceOf(TREASURY_ADDRESS),
          treasury.totalCollateralUsd()
        ]);
        const sagValue = Number(sagBalRaw) * Number(sagPriceRaw) / 1e20;
        setSagValueUsd6(sagValue);
        setUsdcBalance(Number(usdcBalRaw));
        setCollateralizedUsd(Number(collUsdRaw));
        // update escrow USDC balance
        try {
          const escrowAddrLocal = await treasury.escrow().catch(()=>null);
          if (escrowAddrLocal && escrowAddrLocal !== '0x0000000000000000000000000000000000000000') {
            setEscrowAddress(escrowAddrLocal);
            const escrowUsdcRaw = await usdcToken.balanceOf(escrowAddrLocal).catch(()=>0);
            setEscrowUsdcBalance(Number(escrowUsdcRaw));
          } else {
            setEscrowUsdcBalance(0);
          }
        } catch { setEscrowUsdcBalance(0); }
      } catch {
        // ignore and keep previous values
      }

    } catch (e) {
      console.error(e);
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching state: ${e}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // --- Controls (write actions use local provider) ---

  async function handleSetSagPrice() {
    if (!provider) return;
    try {
      if (!signer) throw new Error('Signer not initialized');
      const sagOracleWrite = new Contract(SAG_ORACLE_ADDRESS, SAG_ORACLE_ABI, signer);
      // scale to 8-decimals expected by MockOracle
      const price8 = Math.round(Number(sagPriceInput) * 1e8).toString();
      const tx = await sagOracleWrite.setPrice(price8);
      await tx.wait();
      setLog(l => [`[${new Date().toLocaleTimeString()}] SAG Price set to $${sagPriceInput}`, ...l]);
      setSagPriceInput('');
      await refreshTreasuryState();
    } catch (e) {
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error setting SAG price: ${e}`, ...l]);
    }
  }

  async function handleSetGoldPrice() {
    if (!provider) return;
    try {
      if (!signer) throw new Error('Signer not initialized');
      const goldOracleWrite = new Contract(GOLD_ORACLE_ADDRESS, GOLD_ORACLE_ABI, signer);
      const price8 = Math.round(Number(goldPriceInput) * 1e8).toString();
      const tx = await goldOracleWrite.setPrice(price8);
      await tx.wait();
      setLog(l => [`[${new Date().toLocaleTimeString()}] Gold Price set to $${goldPriceInput}`, ...l]);
      setGoldPriceInput('');
      await refreshTreasuryState();
    } catch (e) {
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error setting Gold price: ${e}`, ...l]);
    }
  }

  async function handleRebalance() {
    if (!provider) return;
    try {
      setLoading(true);
      if (!signer) throw new Error('Signer not initialized');
      const treasuryWrite = new Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
      const tx = await treasuryWrite.rebalanceReserve();
      await tx.wait();
      setLog(l => [
        `[${new Date().toLocaleTimeString()}] Rebalance executed: Treasury ${formatUsd(treasuryUsd)}, Reserve ${formatUsd(reserveUsd)}, Ratio ${formatRatio(treasuryUsd, reserveUsd)}`,
        ...l,
      ]);
      await refreshTreasuryState();
    } catch (e) {
      setLog(l => [`[${new Date().toLocaleTimeString()}] Error running rebalance: ${e}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // NEW: call Treasury.distributeBatchToVault(batchId, tokenIds[])
  async function handleDistributeBatchToVault() {
    if (!provider || !signer) return;
    if (!distributeBatchId) return setLog(l => ['[treasury] provide batch id', ...l]);
    try {
      const treasuryWrite = new Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
      const batchIdNum = Number(distributeBatchId);
      if (!Number.isFinite(batchIdNum) || batchIdNum <= 0) { setLog(l => ['[treasury] invalid batch id', ...l]); return; }
      // parse comma-separated token ids
      const tokenIds = distributeTokenIds.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => BigInt(s));
      setLoading(true);
      const tx = await treasuryWrite.distributeBatchToVault(batchIdNum, tokenIds);
      await tx.wait();
      setLog(l => [`[${new Date().toLocaleTimeString()}] distributeBatchToVault(${batchIdNum}, [${tokenIds.join(',')}]) tx=${tx.hash}`, ...l]);
      // refresh after distribution
      await refreshTreasuryState();
    } catch (e:any) {
      setLog(l => [`[distribute ERROR] ${String(e?.message || e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // --- Render ---
  return (
    <div className="space-y-8 animate-fadeIn p-6 lg:p-12">
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <h2 style={{ marginBlockStart: '0.3em' }}>Treasury Engine</h2>
          <div className="text-slate-400 text-sm mt-1">Monitor and steer Treasury, Reserve, and coverage in real time.</div>
          <div style={{ height: 12 }} />
          <Clock size={16} />
          <span> Last updated: {new Date().toLocaleTimeString()} </span>
          <button
            className="ml-2 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
            onClick={refreshTreasuryState}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
 
      {/* Metrics: replaced with explicit inline grid to avoid conflicting global CSS */}
      <div>
        <div className="sagitta-grid">
          {/* Cell 1 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Oracle Prices</h3>
            <MetricCard title="SAG Price (USD)" value={sagPrice ? `$${sagPrice.toFixed(3)}` : '–'} tone="neutral" />
            <div style={{ height: 12 }} />
            <MetricCard title="Gold Price (USD)" value={goldPrice ? `$${goldPrice.toFixed(2)}` : '–'} tone="neutral" />
          </div>

          {/* Cell 2 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Treasury Totals</h3>
            <MetricCard title="Treasury Value (USD)" value={formatUsd(treasuryUsd)} tone="success" />
            <div style={{ height: 12 }} />
            <MetricCard title="USDC Balance (Treasury)" value={formatUsd(usdcBalance)} tone="neutral" />
          </div>

          {/* Cell 3 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Gold Reserves</h3>
            <MetricCard title="Reserve Value" value={formatUsd(reserveUsd)} tone="neutral" />
            <div style={{ height: 12 }} />
            <MetricCard title="Target Reserve" value={formatUsd(targetReserveUsd)} tone="neutral" />
          </div>

          {/* Cell 4 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Asset Balances</h3>
            <MetricCard title="SAG Value (Treasury)" value={formatUsd(sagValueUsd6)} tone="neutral" />
            <div style={{ height: 12 }} />
            <MetricCard title="Collateralized USDC" value={formatUsd(collateralizedUsd)} tone="success" />
          </div>

          {/* Cell 5 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Escrow</h3>
            <MetricCard title="Escrow USDC Balance" value={formatUsd(escrowUsdcBalance)} tone="neutral" />
            <div style={{ height: 12 }} />
            <MetricCard title="Escrow Address" value={escrowAddress ?? 'Not set'} tone="neutral" />
          </div>

          {/* Cell 6 */}
          <div className="sagitta-cell">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20, fontWeight: 600, color: 'rgb(226,232,240)' }}>Safety / Coverage</h3>
            <MetricCard title="Coverage Ratio" value={coverageRatio ? `${coverageRatio.toFixed(2)}×` : '–'} tone="success" />
            <div style={{ height: 12 }} />
            <MetricCard title="Treasury : Reserve Ratio" value={formatRatio(treasuryUsd, reserveUsd)} tone="neutral" />
          </div>
        </div>
      </div>
     {/* Controls */}
     <div className="sagitta-hero">
        <div className="sagitta-cell">
      
        <h3 className="text-lg font-semibold mb-6 text-slate-200 flex items-center gap-2">
          <Settings size={18} /> Simulation / Controls
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* SAG Price Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">SAG Price (USD) </label>
            <input
              type="number"
              min="0"
              step="0.001"
              className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
              value={sagPriceInput}
              onChange={e => setSagPriceInput(e.target.value)}
              placeholder="0.75"
            />
            <button
              className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold"
              style={{ backgroundColor: '#0000cc', color: 'white' }}
              onClick={handleSetSagPrice}
              disabled={!sagPriceInput || loading}
            >
              Set SAG Price
            </button>
          </div>
          <div style={{ height: 12 }}></div>
          {/* Gold Price Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">Gold Price (USD) </label>
            <input
              type="number"
              min="0"
              step="1"
              className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
              value={goldPriceInput}
              onChange={e => setGoldPriceInput(e.target.value)}
              placeholder="4000"
            />
            <button
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold"
              style={{ backgroundColor: '#0000cc', color: 'white' }}
              onClick={handleSetGoldPrice}
              disabled={!goldPriceInput || loading}
            >
              Set Gold Price
            </button>
          </div>
          <div style={{ height: 12 }}></div>
          {/* Rebalance Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">Rebalance Engine </label>
            <button
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)]"
              onClick={handleRebalance}
              disabled={loading}
            >
              <ArrowRightLeft size={18} />
              <span>Run Rebalance Engine</span>
            </button>
          </div>

          </div>
        </div>
      </div>
      {/* Engine Log */}
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div className="bg-slate-900/80 rounded-xl p-4 border border-slate-700/50 max-h-56 overflow-y-auto text-xs text-slate-300 font-mono">
            
            <h3 className="text-lg font-semibold mb-6 text-slate-200 flex items-center gap-2">
              Engine Log
            </h3>
            {log.length === 0 && <div className="text-slate-500">No actions yet.</div>}
            {log.map((entry, i) => (
              <div key={i} className="mb-1">{entry}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
