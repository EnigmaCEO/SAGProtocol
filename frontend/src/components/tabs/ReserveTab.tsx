import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import MetricCard from '../ui/MetricCard';
import { Clock, Scale, Gem, DollarSign, Globe } from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import ReserveControllerAbi from '../../lib/abis/ReserveController.json';
import GOLDAbiFile from '../../lib/abis/GOLD.json';
import GoldOracleAbiFile from '../../lib/abis/GoldOracle.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import { useWallet } from '../../hooks/useWallet'; // use wallet hook to know if wallet is connected
import useRoleAccess from '../../hooks/useRoleAccess';
import useProtocolPause from '../../hooks/useProtocolPause';
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';

export default function ReserveTab() {
  // wallet hook: we will only use injected provider/signer if the user connected
  const { provider: injectedProvider, account, connectWallet } = useWallet();
  const { isPaused } = useProtocolPause();
  const { isOperator, role } = useRoleAccess();
  // on-chain wired state
  const [oraclePrice, setOraclePrice] = useState<number>(1.0010);
  const [nav, setNav] = useState<number>(1.0012);
  const [goldBalance, setGoldBalance] = useState<number>(1250); // oz
  const [coverageRatio, setCoverageRatio] = useState<number>(105.2); // %
  const [priceInput, setPriceInput] = useState<string>(oraclePrice.toString());
  const [loading, setLoading] = useState<boolean>(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<string | null>(null);

  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  // runtime config (persisted in browser localStorage)
  const [reserveAddress, setReserveAddress] = useState<string>(() => getRuntimeAddress('ReserveController'));
  const [reserveAddressInput, setReserveAddressInput] = useState<string>(reserveAddress);
  const [goldOracleAddress, setGoldOracleAddress] = useState<string>(() => getRuntimeAddress('GoldOracle'));
  const [goldOracleAddressInput, setGoldOracleAddressInput] = useState<string>(goldOracleAddress);
  const [treasuryLinkInput, setTreasuryLinkInput] = useState<string>(() => getRuntimeAddress('Treasury'));
  const [linkedTreasuryAddress, setLinkedTreasuryAddress] = useState<string | null>(null);
  const [linkConfigLoading, setLinkConfigLoading] = useState(false);
  const [linkConfigStatus, setLinkConfigStatus] = useState<string | null>(null);

  // resolve addresses
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const RESERVE_ADDRESS = reserveAddress;
  const GOLD_FALLBACK_ADDRESS =
    (CONTRACT_ADDRESSES as any)?.GOLD ||
    (CONTRACT_ADDRESSES as any)?.Gold ||
    process.env.NEXT_PUBLIC_GOLD_ADDRESS ||
    ZERO_ADDRESS;
  const GOLD_ORACLE_ADDRESS = goldOracleAddress;
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545';
  const configuredTreasuryAddress = treasuryLinkInput.trim();
  const hasConfiguredTreasury = isValidAddress(configuredTreasuryAddress);

  const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  useEffect(() => {
    setReserveAddressInput(reserveAddress);
  }, [reserveAddress]);

  useEffect(() => {
    setGoldOracleAddressInput(goldOracleAddress);
  }, [goldOracleAddress]);

  async function getWriteSigner() {
    const providerAny: any = await getProvider();
    if (providerAny && account && typeof providerAny.getSigner === 'function') {
      return await providerAny.getSigner();
    }

    const JsonRpcProviderCtor = (ethers as any).JsonRpcProvider ?? (ethers as any).providers?.JsonRpcProvider;
    if (!JsonRpcProviderCtor) {
      throw new Error('No JSON-RPC provider constructor available');
    }
    const localProvider = new JsonRpcProviderCtor(RPC_URL);
    return new ethers.Wallet(TEST_PRIVATE_KEY, localProvider);
  }

  async function refreshReserveLinks(providerOverride?: any) {
    if (!isValidAddress(RESERVE_ADDRESS)) {
      setLinkedTreasuryAddress(null);
      return;
    }
    try {
      const providerAny = providerOverride ?? await getProvider();
      if (!providerAny) return;
      const reserve = new ethers.Contract(RESERVE_ADDRESS, (ReserveControllerAbi as any), providerAny);
      const linked = await reserve.treasury().catch(() => null);
      if (typeof linked === 'string' && linked !== ZERO_ADDRESS) {
        setLinkedTreasuryAddress(linked);
        setTreasuryLinkInput(linked);
      } else {
        setLinkedTreasuryAddress(null);
      }
    } catch {
      setLinkedTreasuryAddress(null);
    }
  }

  function handleUseReserveAddress() {
    const next = reserveAddressInput.trim();
    if (!setRuntimeAddress('ReserveController', next)) {
      setLinkConfigStatus('Invalid ReserveController address');
      return;
    }
    setReserveAddress(next);
    setLinkConfigStatus(`Using ReserveController ${next}`);
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

  async function handleSetReserveTreasuryLink() {
    if (isPaused) {
      setLinkConfigStatus('Protocol is paused. Reserve write actions are disabled.');
      return;
    }
    if (!isOperator) {
      setLinkConfigStatus('Only operator or owner wallets can link Reserve to Treasury');
      return;
    }
    const nextTreasury = treasuryLinkInput.trim();
    if (!isValidAddress(RESERVE_ADDRESS) || !isValidAddress(nextTreasury)) {
      setLinkConfigStatus('Invalid ReserveController or Treasury address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const signerForWrite: any = await getWriteSigner();
      const reserveWrite = new ethers.Contract(
        RESERVE_ADDRESS,
        ['function setTreasury(address _treasury) external'],
        signerForWrite
      );
      const tx = await reserveWrite.setTreasury(nextTreasury);
      await tx.wait();
      setRuntimeAddress('Treasury', nextTreasury);
      setLinkedTreasuryAddress(nextTreasury);
      setLinkConfigStatus('ReserveController -> Treasury linked');
      await refreshReserveLinks();
    } catch (err: any) {
      setLinkConfigStatus(`Treasury link failed: ${String(err?.message || err)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

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

        if (!isValidAddress(RESERVE_ADDRESS)) {
          setUiError(`Invalid ReserveController address: ${RESERVE_ADDRESS}`);
          setLoading(false);
          return;
        }
        if (!isValidAddress(GOLD_ORACLE_ADDRESS)) {
          setUiError(`Invalid GoldOracle address: ${GOLD_ORACLE_ADDRESS}`);
          setLoading(false);
          return;
        }

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

        await refreshReserveLinks(provider);

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

        // Oracle price: MockOracle / GoldOracle return 8-decimal values (price * 1e8).
        let oracleNum = safeToNumber(toStringValue(oraclePriceUsd6_fromOracle)) / 1e8;
        if (!oracleNum || oracleNum <= 0) oracleNum = 4000;

        // Compute GOLD value (USD) and use as NAV
        const goldValueUsd = goldOz * oracleNum;
        const navNum = goldValueUsd;

        // Fetch Treasury USD (use minimal ABI inline)
        let treasuryUsd6 = 0;
        try {
          const treasuryAddr = getRuntimeAddress('Treasury');
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
    if (isPaused) {
      setUiError('Protocol is paused. Reserve write actions are disabled.');
      return;
    }
    if (!isOperator) {
      setUiError('Only operator or owner wallets can update reserve controls');
      return;
    }
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
      const price6Str = Math.round(parsed * 1e8).toString(); // oracle uses 8 decimal precision
      // Try setGoldPrice (GoldOracle) then setPrice (MockOracle)
      if (typeof (oracleWithSigner as any).setGoldPrice === 'function') {
        const tx = await (oracleWithSigner as any).setGoldPrice(price6Str);
        await tx.wait();
      } else if (typeof (oracleWithSigner as any).setPrice === 'function') {
        const tx = await (oracleWithSigner as any).setPrice(price6Str);
        await tx.wait();
      } else {
        throw new Error('Gold oracle does not expose setGoldPrice or setPrice');
      }
      // refresh on-chain price from oracle
      const goldPriceUsd6 = await oracleWithSigner.getGoldPrice();
      const oracleNum = safeToNumber(toStringValue(goldPriceUsd6)) / 1e8;
      setOraclePrice(oracleNum);
      setNav((n) => oracleNum + 0.0002);
    } catch (err) {
      console.error('set price failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tab-screen">
      <PageHeader
        title="Gold Reserve"
        description="Track reserve valuation, oracle pricing, and the reserve-to-treasury cover ratio in one operator surface."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {new Date().toLocaleTimeString()}</span>
            <span className="data-chip">Reserve: {RESERVE_ADDRESS ? `${RESERVE_ADDRESS.slice(0, 6)}...${RESERVE_ADDRESS.slice(-4)}` : 'Not set'}</span>
            <span className="data-chip">
              Treasury Link: {hasConfiguredTreasury ? `${configuredTreasuryAddress.slice(0, 6)}...${configuredTreasuryAddress.slice(-4)}` : 'Not set'}
            </span>
            <span className="data-chip" data-tone={linkedTreasuryAddress ? 'success' : 'warning'}>
              Reserve Link: {linkedTreasuryAddress ? `${linkedTreasuryAddress.slice(0, 6)}...${linkedTreasuryAddress.slice(-4)}` : 'Not linked'}
            </span>
            <span className="data-chip" data-tone={isOperator ? 'warning' : 'neutral'}>
              Role: {role}
            </span>
            <span className="data-chip" data-tone={account ? 'success' : 'warning'}>
              {account ? 'Wallet Connected' : 'Wallet Needed For Writes'}
            </span>
          </>
        }
      />

      {uiError && (
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">{uiError}</div>
        </div>
      )}

      <div className="sagitta-grid sagitta-grid--quarters">
        <div className="sagitta-cell">
          <h3 className="section-title">Reserve Value (USD)</h3>
          <MetricCard value={formatUsd(nav)} tone="success" icon={<DollarSign />} />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Gold Balance</h3>
          <MetricCard value={`${goldBalance.toLocaleString()} oz`} tone="neutral" icon={<Gem />} />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Oracle Price</h3>
          <MetricCard value={formatUsd(oraclePrice)} tone="neutral" icon={<Globe />} />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Reserve / Treasury %</h3>
          <MetricCard value={`${coverageRatio.toFixed(1)}%`} tone="success" icon={<Scale />} />
        </div>
      </div>

      <div className="sagitta-grid sagitta-grid--wide">
        <div className="sagitta-cell">
          <h3 className="section-title">Runtime Wiring</h3>
          <p className="section-subtitle">Reserve health depends on contract links being accurate across the reserve controller, treasury, and oracle. The DAO address book can be populated even when the Reserve contract itself is still unlinked.</p>
          <div className="panel-stack">
            <div className="panel-row">
              <span className="panel-row__label">Reserve controller</span>
              <span className="panel-row__value">{RESERVE_ADDRESS || 'Not set'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Gold oracle</span>
              <span className="panel-row__value">{GOLD_ORACLE_ADDRESS || 'Not set'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Configured treasury</span>
              <span className="panel-row__value">{hasConfiguredTreasury ? configuredTreasuryAddress : 'Not set'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Linked treasury</span>
              <span className="panel-row__value">{linkedTreasuryAddress ?? 'Not linked'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Network</span>
              <span className="panel-row__value">{networkInfo ?? 'Unavailable'}</span>
            </div>
          </div>
          {!linkedTreasuryAddress && hasConfiguredTreasury && (
            <div className="mt-4 status-banner status-banner--warning">
              The address book has a Treasury value, but `ReserveController.treasury()` is still unset on-chain. Link the Reserve controller to that Treasury address to remove the warning.
            </div>
          )}
          {linkConfigStatus && <div className="mt-4 panel-note">{linkConfigStatus}</div>}
        </div>

        <div className="sagitta-cell">
          <h3 className="section-title">Operator Controls</h3>
          {isOperator ? (
            <>
              <p className="section-subtitle">Update the authoritative gold oracle price from a connected wallet, or link the Reserve controller to the configured Treasury address.</p>
              <div className="panel-stack">
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Gold Price (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceInput}
                    onChange={e => setPriceInput(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                    placeholder="4000"
                    disabled={isPaused || loading}
                  />
                </div>
                <button
                  type="button"
                  onClick={onOperatorClick}
                  disabled={isPaused || loading || !priceInput}
                  className="action-button action-button--warning"
                >
                  {loading ? 'Updating Price...' : 'Update Gold Price'}
                </button>
                <div className="panel-note">
                  Price writes require a connected wallet with permission on the configured gold oracle.
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Treasury Link Address</label>
                  <input
                    type="text"
                    value={treasuryLinkInput}
                    onChange={e => setTreasuryLinkInput(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                    placeholder="0x... treasury"
                    disabled={isPaused || loading || linkConfigLoading}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSetReserveTreasuryLink}
                  disabled={isPaused || loading || linkConfigLoading || !isValidAddress(treasuryLinkInput.trim())}
                  className="action-button action-button--primary"
                >
                  {linkConfigLoading ? 'Linking Treasury...' : 'Link Reserve To Treasury'}
                </button>
                <div className="panel-note">
                  {isPaused
                    ? 'Protocol is paused. Oracle and reserve-link updates are disabled until the protocol is resumed.'
                    : 'This writes `ReserveController.setTreasury(...)` on-chain. It is separate from storing an address in the DAO address matrix.'}
                </div>
              </div>
            </>
          ) : (
            <div className="panel-note mt-3">
              Reserve write controls are hidden for viewer wallets. Connect an operator or owner wallet to reveal oracle and linking actions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
