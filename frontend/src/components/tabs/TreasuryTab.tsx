import React, { useEffect, useState } from 'react';
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
const MOCK_TOTAL_DEPOSITS_USD = 1_000_000 * 1e6; // 1M USDC, 6 decimals

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

  // Dev controls
  const [sagPriceInput, setSagPriceInput] = useState('');
  const [goldPriceInput, setGoldPriceInput] = useState('');

  // Providers and contracts
  const [provider, setProvider] = useState<JsonRpcProvider>();
  const [treasury, setTreasury] = useState<Contract>();
  const [sagOracle, setSagOracle] = useState<Contract>();
  const [goldOracle, setGoldOracle] = useState<Contract>();
  const [signer, setSigner] = useState<any>(); // Wallet signer for write txs

  // On mount: setup provider and contracts
  useEffect(() => {
    const rp = new JsonRpcProvider(LOCALHOST_RPC);
    // create local contract instances immediately for initial fetch
    const localTreasury = new Contract(TREASURY_ADDRESS, TREASURY_ABI.abi, rp);
    const localSagOracle = new Contract(SAG_ORACLE_ADDRESS, SAG_ORACLE_ABI.abi, rp);
    const localGoldOracle = new Contract(GOLD_ORACLE_ADDRESS, GOLD_ORACLE_ABI.abi, rp);
    const localVault = new Contract(VAULT_ADDRESS, VAULT_ABI, rp);
    const w = new Wallet(TEST_PRIVATE_KEY, rp);

    // set stateful references for later interactions (refresh, controls)
    setProvider(rp);
    setTreasury(localTreasury);
    setSagOracle(localSagOracle);
    setGoldOracle(localGoldOracle);
    setSigner(w);

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
      } catch (e) {
        console.error(e);
        setLog(l => [`[${new Date().toLocaleTimeString()}] Error fetching initial state: ${e}`, ...l]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
      const sagOracleWrite = new Contract(SAG_ORACLE_ADDRESS, SAG_ORACLE_ABI.abi, signer);
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
      const goldOracleWrite = new Contract(GOLD_ORACLE_ADDRESS, GOLD_ORACLE_ABI.abi, signer);
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
      const treasuryWrite = new Contract(TREASURY_ADDRESS, TREASURY_ABI.abi, signer);
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

  // --- Render ---
  return (
    <div className="space-y-8 animate-fadeIn p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
            Sagitta Treasury Engine
          </h2>
          <div className="text-slate-400 text-sm mt-1">Monitor and steer Treasury, Reserve, and coverage in real time.</div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
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
      {/* Metrics */}
      <div className="mb-6">
        <MetricGrid>
          {/* Market Inputs */}
          <MetricCard title="SAG Price (USD)" value={sagPrice ? `$${(sagPrice).toFixed(3)}` : '–'} tone="neutral" />
          <MetricCard title="Gold Price (USD)" value={goldPrice ? `$${(goldPrice).toFixed(2)}` : '–'} tone="neutral" />
          {/* Capital */}
          <MetricCard title="Treasury Value" value={formatUsd(treasuryUsd)} tone="success" />
          <MetricCard title="Reserve Value" value={formatUsd(reserveUsd)} tone="neutral" />
          <MetricCard title="Target Reserve" value={formatUsd(targetReserveUsd)} tone="neutral" />
          <MetricCard title="Total Deposits" value={formatUsd(totalDepositsUsd)} tone="neutral" />
          {/* Safety */}
          <MetricCard
            title="Treasury : Reserve Ratio"
            value={formatRatio(treasuryUsd, reserveUsd)}
            tone="neutral"
          />
          <MetricCard
            title="Reserve / Treasury %"
            value={formatPercent(reserveUsd, treasuryUsd)}
            tone={reserveUsd * 100 / (treasuryUsd || 1) > 50 ? 'danger' : 'success'}
          />
          <MetricCard
            title="Coverage Ratio"
            value={coverageRatio ? `${coverageRatio.toFixed(2)}×` : '–'}
            tone="success"
          />
          <MetricCard
            title="Deposit Capacity Remaining"
            value={formatUsd(treasuryUsd - totalDepositsUsd)}
            tone="neutral"
          />
        </MetricGrid>
      </div>
      {/* Controls */}
      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50 mb-6">
        <h3 className="text-lg font-semibold mb-6 text-slate-200 flex items-center gap-2">
          <Settings size={18} /> Simulation / Controls
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* SAG Price Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">SAG Price (USD)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
              value={sagPriceInput}
              onChange={e => setSagPriceInput(e.target.value)}
              placeholder="e.g. 0.75"
            />
            <button
              className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold"
              onClick={handleSetSagPrice}
              disabled={!sagPriceInput || loading}
            >
              Set SAG Price
            </button>
          </div>
          {/* Gold Price Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">Gold Price (USD)</label>
            <input
              type="number"
              min="0"
              step="1"
              className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
              value={goldPriceInput}
              onChange={e => setGoldPriceInput(e.target.value)}
              placeholder="e.g. 2100"
            />
            <button
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold"
              onClick={handleSetGoldPrice}
              disabled={!goldPriceInput || loading}
            >
              Set Gold Price
            </button>
          </div>
          {/* Rebalance Control */}
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">Rebalance Engine</label>
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
      {/* Engine Log */}
      <div className="bg-slate-900/80 rounded-xl p-4 border border-slate-700/50 max-h-56 overflow-y-auto text-xs text-slate-300 font-mono">
        <div className="mb-2 font-bold text-slate-400">Engine Log</div>
        {log.length === 0 && <div className="text-slate-500">No actions yet.</div>}
        {log.map((entry, i) => (
          <div key={i} className="mb-1">{entry}</div>
        ))}
      </div>
    </div>
  );
}
