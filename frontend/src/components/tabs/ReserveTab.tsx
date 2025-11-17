import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, Scale, Gem, DollarSign, Globe } from 'lucide-react';
import ReserveControllerAbi from '../../lib/abis/ReserveController.json';
import GOLDAbiFile from '../../lib/abis/GOLD.json';
import GoldOracleAbiFile from '../../lib/abis/GoldOracle.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import { useWallet } from '../../hooks/useWallet'; // use wallet hook to know if wallet is connected

export default function ReserveTab() {
  // wallet hook: we will only use injected provider/signer if the user connected
  const { provider: injectedProvider, account, connectWallet } = useWallet();
  // on-chain wired state
  const [oraclePrice, setOraclePrice] = useState<number>(1.0010);
  const [nav, setNav] = useState<number>(1.0012);
  const [goldBalance, setGoldBalance] = useState<number>(1250); // oz
  const [coverageRatio, setCoverageRatio] = useState<number>(105.2); // %
  const [priceInput, setPriceInput] = useState<string>(oraclePrice.toString());
  const [loading, setLoading] = useState<boolean>(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<string | null>(null);

  // runtime overrides (do NOT persist to files) for dev troubleshooting
  const [overrideReserveAddress, setOverrideReserveAddress] = useState<string>('');
  const [overrideOracleAddress, setOverrideOracleAddress] = useState<string>('');
  const usedReserveAddress =
    overrideReserveAddress || (CONTRACT_ADDRESSES as any)?.ReserveController || process.env.NEXT_PUBLIC_RESERVE_CONTROLLER_ADDRESS || '0x0000000000000000000000000000000000000000';
  const usedOracleAddress =
    overrideOracleAddress || process.env.NEXT_PUBLIC_GOLD_ORACLE || (CONTRACT_ADDRESSES as any)?.GoldOracle || '0x0000000000000000000000000000000000000000';

  // resolve addresses like VaultTab/hooks do: prefer CONTRACT_ADDRESSES, then env, then zero address
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const RESERVE_ADDRESS = usedReserveAddress;
  const GOLD_FALLBACK_ADDRESS =
    (CONTRACT_ADDRESSES as any)?.GOLD ||
    (CONTRACT_ADDRESSES as any)?.Gold ||
    process.env.NEXT_PUBLIC_GOLD_ADDRESS ||
    ZERO_ADDRESS;
  const GOLD_ORACLE_ADDRESS = usedOracleAddress;
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545';

  const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const goldValueUsd = goldBalance * oraclePrice;

  // --- safe helpers (work across ethers v5 / v6 and plain values) ---
  const toStringValue = (v: any) => {
    if (v === undefined || v === null) return '0';
    try {
      return typeof v === 'string' ? v : (typeof v.toString === 'function' ? v.toString() : String(v));
    } catch {
      return String(v);
    }
  };

  const safeFormatUnits = (value: any, decimals = 18) => {
    // prefer ethers.formatUnits (v6) or ethers.utils.formatUnits (v5)
    try {
      if ((ethers as any).formatUnits) {
        return (ethers as any).formatUnits(value, decimals);
      }
      if ((ethers as any).utils && (ethers as any).utils.formatUnits) {
        return (ethers as any).utils.formatUnits(value, decimals);
      }
      // fallback: divide by 10**decimals using string conversion
      const s = toStringValue(value);
      const n = Number(s);
      return String(n / Math.pow(10, decimals));
    } catch {
      return '0';
    }
  };

  const safeToNumber = (value: any) => {
    const s = toStringValue(value);
    // Number() may lose precision for huge ints, but for prices/nav/usdc6 this is acceptable
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  // --- end helpers ---

  async function getProvider() {
    // Do NOT request accounts here. Prefer the local JSON-RPC provider (localhost) by default.
    // Use injected provider only when the user has explicitly connected (account is present),
    // or when NEXT_PUBLIC_USE_INJECTED === 'true' (explicit opt-in).
    const useInjected = !!account || process.env.NEXT_PUBLIC_USE_INJECTED === 'true';
    if (useInjected && injectedProvider) {
      return injectedProvider;
    }

    // Create JSON-RPC provider (works across ethers v5/v6)
    const JsonRpcProviderCtor = (ethers as any).JsonRpcProvider ?? (ethers as any).providers?.JsonRpcProvider;
    if (JsonRpcProviderCtor) {
      return new JsonRpcProviderCtor(RPC_URL);
    }
    if ((ethers as any).getDefaultProvider) {
      return (ethers as any).getDefaultProvider();
    }
    return undefined;
  }

  useEffect(() => {
    let mounted = true;
    const loadOnchain = async () => {
      try {
        setLoading(true);
        setUiError(null);
        const provider: any = await getProvider();
        if (!provider) {
          setUiError('No JSON-RPC provider available (check NEXT_PUBLIC_RPC_URL or wallet).');
          setLoading(false);
          return;
        }
        // show some network info for diagnostics
        try {
          const net = await provider.getNetwork();
          setNetworkInfo(`chain=${net.chainId} name=${(net as any).name ?? 'unknown'}`);
        } catch { setNetworkInfo(null); }

        // validate reserve contract exists
        try {
          const code = await provider.getCode(RESERVE_ADDRESS).catch(() => '0x');
          if (!code || code === '0x') {
            setUiError(`No contract deployed at ReserveController address ${RESERVE_ADDRESS}.`);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('getCode check failed', err);
        }

        const reserveAbi = (ReserveControllerAbi as any);
        const reserve = new ethers.Contract(RESERVE_ADDRESS, reserveAbi, provider);

        // read gold token address from reserve contract
        let goldAddr: string;
        try {
          goldAddr = await reserve.gold();
        } catch (err) {
          console.warn('reserve.gold() failed, falling back to configured GOLD address', err);
          goldAddr = GOLD_FALLBACK_ADDRESS;
        }
        const goldAbi = (GOLDAbiFile as any).abi ?? (GOLDAbiFile as any);
        const goldContract = new ethers.Contract(goldAddr, goldAbi, provider);

        // fetch values: reserve ratio and gold balance (we will read price from GoldOracle)
        const [reserveRatioBps, goldBalRaw] = await Promise.all([
          reserve.reserveRatio(), // bps
          goldContract.balanceOf(RESERVE_ADDRESS) // token units (assume 18 decimals)
        ]);

        // Read authoritative price directly from GoldOracle (single source)
        let oraclePriceUsd6_fromOracle: any = null;
        if (GOLD_ORACLE_ADDRESS && GOLD_ORACLE_ADDRESS !== ZERO_ADDRESS) {
          try {
            const oracleAbi = (GoldOracleAbiFile as any).abi ?? (GoldOracleAbiFile as any);
            const oracleContract = new ethers.Contract(GOLD_ORACLE_ADDRESS, oracleAbi, provider);
            if (typeof oracleContract.getGoldPrice === 'function') {
              oraclePriceUsd6_fromOracle = await oracleContract.getGoldPrice();
            } else if (typeof oracleContract.goldPrice === 'function') {
              oraclePriceUsd6_fromOracle = await oracleContract.goldPrice();
            }
          } catch (err) {
            console.debug('gold oracle read failed', err);
            oraclePriceUsd6_fromOracle = null;
          }
        } else {
          setUiError(`GoldOracle address not configured (using ${GOLD_ORACLE_ADDRESS}).`);
        }

        if (!mounted) return;

        // Use safe conversions
        const goldOz = Number(safeFormatUnits(goldBalRaw, 18)); // oz if token uses 18 decimals
        const ratioNum = safeToNumber(toStringValue(reserveRatioBps)) / 100; // percent (existing reserve ratio)

        // Oracle price (preferred). If missing, fallback to 4000.
        let oracleNum = safeToNumber(toStringValue(oraclePriceUsd6_fromOracle)) / 1e6;
        if (!oracleNum || oracleNum <= 0) oracleNum = 4000;

        // Compute GOLD value (USD) and use as NAV
        const goldValueUsd = goldOz * oracleNum;
        const navNum = goldValueUsd;

        // Fetch Treasury USD (use minimal ABI inline)
        let treasuryUsd6 = 0;
        try {
          const treasuryAddr = (CONTRACT_ADDRESSES as any)?.Treasury || process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
          if (treasuryAddr && treasuryAddr !== ZERO_ADDRESS) {
            const TREASURY_ABI = [{ "inputs": [], "name": "getTreasuryValueUsd", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }];
            const treasuryContract = new ethers.Contract(treasuryAddr, TREASURY_ABI, provider);
            const tval = await treasuryContract.getTreasuryValueUsd().catch(() => 0);
            treasuryUsd6 = safeToNumber(toStringValue(tval));
          }
        } catch (err) {
          console.debug('treasury read failed', err);
          treasuryUsd6 = 0;
        }

        // Compute coverage as "Reserve / Treasury" percentage:
        // i.e. what percent of the Treasury the reserve (NAV) represents.
        const treasuryUsd = treasuryUsd6 / 1e6;
        const coveragePct = treasuryUsd > 0 ? (navNum / treasuryUsd) * 100 : 0;

        // Set UI state
        setNav(navNum);
        setOraclePrice(oracleNum);
        setCoverageRatio(Number(coveragePct.toFixed(2)));
        setGoldBalance(goldOz);
        setPriceInput(oracleNum.toString());
      } catch (err) {
        // surface helpful error to UI
        console.error('reserve fetch error', err);
        setUiError(String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    };
    loadOnchain();
    return () => { mounted = false; };
  }, [RESERVE_ADDRESS, GOLD_ORACLE_ADDRESS, account, injectedProvider]); // refresh when wallet connection changes

  // When user clicks the operator button:
  // - if wallet is not connected, prompt user to connect (user-initiated).
  // - if wallet is connected, use its signer to send the tx.
  const onOperatorClick = async () => {
    const parsed = Number(priceInput);
    if (isNaN(parsed) || parsed <= 0) return;

    // If user hasn't connected, call connectWallet (user action — will open wallet)
    if (!account) {
      await connectWallet();
      // allow a short moment for the hook to update account/provider
      await new Promise((r) => setTimeout(r, 300));
    }

    // Use injected signer only when connected
    const providerOrInjected = await getProvider();
    if (!providerOrInjected || typeof providerOrInjected.getSigner !== 'function') {
      console.warn('No signer available. Connect a wallet to send transactions.');
      return;
    }

    try {
      setLoading(true);
      const signer = providerOrInjected.getSigner();
      // write price to the GoldOracle (single authoritative source)
      if (!GOLD_ORACLE_ADDRESS || GOLD_ORACLE_ADDRESS === ZERO_ADDRESS) {
        console.warn('Gold oracle address not configured');
        return;
      }
      const oracleAbi = (GoldOracleAbiFile as any).abi ?? (GoldOracleAbiFile as any);
      const oracleWithSigner = new ethers.Contract(GOLD_ORACLE_ADDRESS, oracleAbi, signer);
      const price6Str = Math.round(parsed * 1e6).toString();
      // Most oracle implementations use a setGoldPrice(uint256) owner-only call
      if (typeof oracleWithSigner.setGoldPrice === 'function') {
        const tx = await oracleWithSigner.setGoldPrice(price6Str);
        await tx.wait();
      } else {
        throw new Error('Gold oracle does not expose setGoldPrice');
      }
      // refresh on-chain price from oracle
      const goldPriceUsd6 = await oracleWithSigner.getGoldPrice();
      const oracleNum = safeToNumber(toStringValue(goldPriceUsd6)) / 1e6;
      setOraclePrice(oracleNum);
      setNav((n) => oracleNum + 0.0002);
    } catch (err) {
      console.error('set price failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <h2 style={{ marginBlockStart: '0.3em' }}>Gold Reserve</h2>
          <div className="text-slate-400 text-sm mt-1">Monitor gold reserves.</div>
          <div style={{ height: 12 }} />
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Clock size={16} />
            <span> Last updated: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
      <div className="sagitta-grid" style={{ gridTemplateColumns: 'repeat(4, 2fr)' }}>
        {/* Cell 1 */}
        <div className="sagitta-cell">
        <h3>Reserve Value (USD)</h3>
          <MetricGrid>
          <MetricCard title="" value={formatUsd(nav)} tone="success" icon={<DollarSign />} />
          
            </MetricGrid>
        </div>
        {/* Cell 2 */}
        <div className="sagitta-cell">
          <h3>Gold Balance</h3>
          <MetricCard title="" value={`${goldBalance.toLocaleString()} oz`} tone="neutral" icon={<Gem />} />
        </div>
        {/* Cell 3 */}
        <div className="sagitta-cell">
          <h3>Oracle Price</h3>
          <MetricCard title="" value={formatUsd(oraclePrice)} tone="neutral" icon={<Globe />} />
        </div>
        {/* Cell 4 */}
        <div className="sagitta-cell">
          <h3>Reserve / Treasury %</h3>
          <MetricCard title="" value={`${coverageRatio.toFixed(1)}%`} tone="success" icon={<Scale />} />
        </div>
      </div>
    </div>
  );
}
