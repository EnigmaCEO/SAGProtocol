import { useState, useEffect } from 'react';
import { createPublicClient, createWalletClient, http, custom, parseUnits, formatUnits, type Chain, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import MetricCard from '../ui/MetricCard';
import {
  ClockIcon as Clock,
  ArrowDownIcon as ArrowDown,
  LockedIcon as Lock,
  UnlockedIcon as Unlock,
  HashIcon as Hash,
  USDCIcon as DollarSign,
  PackageIcon as Package,
  RefreshIcon as RefreshCw,
  WalletIcon,
  CalendarClockIcon as CalendarClock,
  ActivityIcon as Activity,
  QRCodeIcon as QrCode,
  NewDepositIcon,
  DepositIcon,
  ConnectWalletIcon,
} from '../icons/SagittaIcons';
import VaultABI from '../../lib/abis/Vault.json';
import MockUSDCABI from '../../lib/abis/MockUSDC.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import MockOracleABI from '../../lib/abis/MockOracle.json';
import TreasuryABI from '../../lib/abis/Treasury.json';
import InvestmentEscrowABI from '../../lib/abis/InvestmentEscrow.json';
import useVaultMetrics from '../../hooks/useVaultMetrics';
import { getRuntimeAddress, useRuntimeAddress, ZERO_ADDRESS } from '../../lib/runtime-addresses';
import { emitUiRefresh } from '../../lib/ui-refresh';
import useProtocolPause from '../../hooks/useProtocolPause';
import PageHeader from '../ui/PageHeader';
import QRConnectModal, { type ConnectedWallet } from '../ui/QRConnectModal';
import { RPC_URL, ACTIVE_CHAIN, CHAIN_ID, IS_LOCAL_CHAIN } from '../../lib/network';
import { useWallet } from '../../hooks/useWallet';
import { WALLET_MODE_CHANGED_EVENT } from '../../hooks/useRoleAccess';

// Helper to cast ABI and normalize JSON shape { abi: [...] } vs [...]
function normalizeAbi(x: any) {
  return Array.isArray(x) ? x : (x?.abi ?? []);
}

// Replace earlier ABI constants with normalized versions
const VAULT_ABI = normalizeAbi(VaultABI) as Abi[];
const MOCK_ORACLE_ABI = normalizeAbi(MockOracleABI) as Abi[];
const MOCK_USDC_ABI = normalizeAbi(MockUSDCABI) as Abi[];
const TREASURY_ABI = normalizeAbi(TreasuryABI) as Abi[];
const INVESTMENT_ESCROW_ABI = normalizeAbi(InvestmentEscrowABI) as Abi[];

const DEFAULT_VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
const DEFAULT_MOCK_USDC_ADDRESS = CONTRACT_ADDRESSES.MockUSDC;
const DEFAULT_TREASURY_ADDRESS = CONTRACT_ADDRESSES.Treasury;
const DEFAULT_ESCROW_ADDRESS = CONTRACT_ADDRESSES.InvestmentEscrow;
const DEFAULT_MOCK_ORACLE_ADDRESS = (CONTRACT_ADDRESSES as any).UsdcOracle;

// Localhost test account (Anvil/Hardhat default account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

// Create clients using env-aware chain config from network.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN as Chain,
  transport: http(RPC_URL),
}) as any; // viem 2.x added authorizationList to ReadContractParameters; cast avoids spurious TS errors

const walletClient = createWalletClient({
  account,
  chain: ACTIVE_CHAIN as Chain,
  transport: http(RPC_URL),
});

interface DepositReceipt {
  id: number;
  asset: string;
  principalAmount: bigint;
  entryValueUsd: number;
  estimatedProfitUsd: number | null;
  batchId: number | null;
  shares: bigint;
  status: 'LOCKED' | 'PENDING_RETURN' | 'RETURNED';
  unlockDate: Date;
  withdrawn: boolean;
  lockUntil: number;
}

type ToastState = {
  tone: 'success' | 'danger';
  message: string;
};

const DEMO_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdcFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});

function formatUsdValue(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatUsdcValue(value: number): string {
  return usdcFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatShortDate(value: Date): string {
  return dateFormatter.format(value);
}

function formatNullableUsdValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return formatUsdValue(value);
}

export default function UserTab() {
  const { isPaused } = useProtocolPause();
  const VAULT_ADDRESS = useRuntimeAddress('Vault') || DEFAULT_VAULT_ADDRESS;
  const MOCK_USDC_ADDRESS = useRuntimeAddress('MockUSDC') || DEFAULT_MOCK_USDC_ADDRESS;
  const TREASURY_ADDRESS = useRuntimeAddress('Treasury') || DEFAULT_TREASURY_ADDRESS;
  const ESCROW_ADDRESS = useRuntimeAddress('InvestmentEscrow') || DEFAULT_ESCROW_ADDRESS;
  const USDC_ORACLE_ADDRESS = useRuntimeAddress('UsdcOracle') || DEFAULT_MOCK_ORACLE_ADDRESS;

  const [depositAmount, setDepositAmount] = useState('');
  const [deposits, setDeposits] = useState<DepositReceipt[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(BigInt(0));
  const [receiptCount, setReceiptCount] = useState<bigint>(BigInt(0));
  const [allowance, setAllowance] = useState<bigint>(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(6); // default to 6 for USDC
  const [assetDecimals, setAssetDecimals] = useState<number>(6); // default to 6 for USDC

  // max deposit (USD6) and equivalent token amount
  const [maxDepositUsd6, setMaxDepositUsd6] = useState<bigint | null>(null);
  const [maxDepositToken, setMaxDepositToken] = useState<bigint | null>(null);
  const [oracleUsed, setOracleUsed] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // store last-probed oracle price and decimals so we can recompute max reactively
  const [probedOraclePrice, setProbedOraclePrice] = useState<bigint | null>(null);
  const [probedAssetDecimals, setProbedAssetDecimals] = useState<number | null>(null);

  // Wallet connection state — auto-restore from localStorage on mount.
  // Always try localStorage first so the displayed address matches the header on reload.
  // On localhost, contract ops still go through the hardhat test key (effectiveAddress below),
  // but we show the user's connected wallet in the badge for consistency with the header.
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet>(() => {
    if (typeof window !== 'undefined') {
      const walletMode = window.localStorage.getItem('sagitta.walletMode');
      // Explicit demo mode takes priority — ignore any stale persisted address
      if (walletMode === 'demo') {
        return { address: account.address, mode: 'demo' as const, label: 'Demo (Hardhat #0)' };
      }
      const persisted = window.localStorage.getItem('sagitta.connectedAccount');
      if (persisted && /^0x[a-fA-F0-9]{40}$/.test(persisted)) {
        return { address: persisted, mode: 'injected' as const, label: 'Browser Wallet' };
      }
    }
    return { address: account.address, mode: 'demo' as const, label: 'Demo (Hardhat #0)' };
  });
  const [showQRModal, setShowQRModal] = useState(false);
  // Bumped on every explicit wallet switch to force data re-fetch even when effectiveAddress is unchanged (localhost)
  const [refreshKey, setRefreshKey] = useState(0);

  // Sync with useWallet hook so that connecting from the header updates UserTab too
  // Skip when demo mode is explicitly active so the demo switch isn't overridden
  const { account: walletAccount } = useWallet();
  useEffect(() => {
    const mode = typeof window !== 'undefined' ? window.localStorage.getItem('sagitta.walletMode') : null;
    if (mode === 'demo') return;
    if (walletAccount && /^0x[a-fA-F0-9]{40}$/.test(walletAccount)) {
      setConnectedWallet({ address: walletAccount, mode: 'injected', label: 'Browser Wallet' });
    }
  }, [walletAccount]);

  // Keep in sync if the user switches accounts in MetaMask elsewhere in the app
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const handler = (accounts: string[]) => {
      const mode = typeof window !== 'undefined' ? window.localStorage.getItem('sagitta.walletMode') : null;
      if (mode === 'demo') return;
      if (Array.isArray(accounts) && accounts.length > 0) {
        window.localStorage.setItem('sagitta.connectedAccount', accounts[0]);
        setConnectedWallet({ address: accounts[0], mode: 'injected', label: 'Browser Wallet' });
      }
    };
    eth.on('accountsChanged', handler);
    return () => eth.removeListener?.('accountsChanged', handler);
  }, []);

  const address = connectedWallet.address;
  // Reads always use the displayed wallet address so each wallet sees only its own data.
  // Writes still go through walletClient (hardhat key) on localhost, but receipt/balance
  // reads are scoped to the connected address.
  const effectiveAddress: string = address;
  const metrics = useVaultMetrics();

  // Use viem publicClient for all balances to ensure consistency
  useEffect(() => {
    async function fetchBalances() {
      try {
        // USDC balance
        const usdcRaw = await publicClient.readContract({
          address: MOCK_USDC_ADDRESS as `0x${string}`,
          abi: MOCK_USDC_ABI,
          functionName: 'balanceOf',
          args: [effectiveAddress],
        }) as bigint;
        setUsdcBalance(usdcRaw);
      } catch (e) {
        setUsdcBalance(BigInt(0));
      }
    }
    fetchBalances();
  }, [effectiveAddress, tokenDecimals]);

  // helper to compute and set maxDeposit token & usd values (moved to component scope)
  const computeAndSetMax = (capacityUsd6: bigint, priceBn: bigint, aDecimals: number) => {
    try {
      if (!priceBn || priceBn === BigInt(0)) {
        console.debug('computeAndSetMax: priceBn is zero or undefined', { priceBn, capacityUsd6, aDecimals });
        setMaxDepositToken(null);
        setMaxDepositUsd6(null);
        return;
      }
      // capacityUsd6: USD scaled by 1e6
      // priceBn: USD per token scaled by 1e8
      // token base units = capacityUsd6 * 10^(aDecimals+2) / priceBn
      const numerator = capacityUsd6 * (BigInt(10) ** BigInt(aDecimals + 2));
      const maxToken = numerator / priceBn;
      console.debug('computeAndSetMax calc', { capacityUsd6: capacityUsd6.toString(), priceBn: priceBn.toString(), aDecimals, numerator: numerator.toString(), maxToken: maxToken.toString() });

      // Treat computed zero as "N/A" to avoid misleading tiny values displayed as 0.0000
      if (!maxToken || maxToken === BigInt(0)) {
        setMaxDepositToken(null);
        setMaxDepositUsd6(null);
        return;
      }

      setMaxDepositToken(maxToken);
      setMaxDepositUsd6(capacityUsd6);
    } catch (e) {
      console.error('computeAndSetMax error', e);
      setMaxDepositToken(null);
      setMaxDepositUsd6(null);
    }
  };

  // Fetch balances and data
  const fetchData = async () => {
    // On non-local chains the vault address is fetched async from ProtocolDAO.
    // Skip until the real address is known to avoid a spurious "no contract" error.
    if (!VAULT_ADDRESS || VAULT_ADDRESS === ZERO_ADDRESS) return;
    try {
      // Verify contract is deployed and ABI-compatible
      const code = await publicClient.getCode({ address: VAULT_ADDRESS as `0x${string}` });
      if (!code || code === '0x') {
        setContractError(
          `No contract found at current Vault address (${VAULT_ADDRESS}). ` +
          (IS_LOCAL_CHAIN
            ? `Open DAO tab, click "Load Generated", then "Refresh On-Chain".`
            : `Deploy contracts to testnet (npx hardhat run scripts/deploy.ts --network moonbase), regenerate addresses.ts, then rebuild the frontend.`)
        );
        return;
      }
      // Quick ABI compatibility probe
      try {
        await publicClient.readContract({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'owner',
        });
      } catch (e: any) {
        // Enhanced debugging
        let debugMsg = `Vault ABI/address mismatch. Update CONTRACTS.VAULT or ABI.`;
        debugMsg += `\nContract address: ${VAULT_ADDRESS}`;
        debugMsg += `\nError: ${e?.message || e}`;
        debugMsg += `\nABI owner() present: ${Array.isArray(VAULT_ABI) && VAULT_ABI.some((item: any) => item.name === 'owner' && item.type === 'function')}`;
        setContractError(debugMsg);
        // Also log to console for further inspection
        console.error('Vault ABI/address probe failed:', {
          address: VAULT_ADDRESS,
          error: e,
          abiOwnerPresent: Array.isArray(VAULT_ABI) && VAULT_ABI.some((item: any) => item.name === 'owner' && item.type === 'function'),
          abi: VAULT_ABI,
        });
        return;
      }

      setContractError(null);

      // Detect token decimals once and cache
      try {
        const dec = await publicClient.readContract({
          address: MOCK_USDC_ADDRESS as `0x${string}`,
          abi: MOCK_USDC_ABI,
          functionName: 'decimals',
        }) as number | bigint;
        setTokenDecimals(Number(dec));
        setAssetDecimals(Number(dec));
      } catch {
        setTokenDecimals(18);
        setAssetDecimals(18);
      }

      // Read USDC balance
      const balance = await publicClient.readContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'balanceOf',
        args: [effectiveAddress],
      }) as bigint;
      setUsdcBalance(balance);

      // Read receipt count (ABI: function receiptCount(address user) external view returns (uint256))
      const count = await publicClient.readContract({
        address: VAULT_ADDRESS as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'receiptCount',
        args: [effectiveAddress],
      }) as bigint;
      setReceiptCount(count);

      // Read allowance
      const allow = await publicClient.readContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'allowance',
        args: [effectiveAddress, VAULT_ADDRESS],
      }) as bigint;
      setAllowance(allow);

      // --- Compute max deposit allowed by reserve-backed capacity (USD6 and token amount) ---
      try {
        const treasuryUsdVal = await publicClient.readContract({
          address: TREASURY_ADDRESS as `0x${string}`,
          abi: TREASURY_ABI,
          functionName: 'getReserveValueUsd',
        }).catch(async () =>
          await publicClient.readContract({
            address: TREASURY_ADDRESS as `0x${string}`,
            abi: TREASURY_ABI,
            functionName: 'getTargetReserveUsd',
          }) as bigint
        ) as bigint;

        // update capacity only when read succeeds
        setMaxDepositUsd6(treasuryUsdVal);
        const treasuryUsd6 = treasuryUsdVal;

        // Read Vault asset info for USDC to determine decimals and oracle
        const assetInfo = await publicClient.readContract({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'assets',
          args: [MOCK_USDC_ADDRESS],
        }) as { enabled: boolean; decimals: number | bigint; oracle: string; };

        const aDecimals = Number(assetInfo?.decimals ?? tokenDecimals);
        setAssetDecimals(aDecimals);

        // Resolve oracle address: prefer assetInfo.oracle, fall back to deployed per-asset oracles or generic mock oracle
        
        const ZERO = '0x0000000000000000000000000000000000000000';
        function validAddr(a: any) {
          return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && a !== ZERO;
        }
        // NOTE: do NOT include TREASURY_ADDRESS here — probing Treasury as an oracle produced large values
        const candidates = [
          assetInfo?.oracle,
          USDC_ORACLE_ADDRESS,
          getRuntimeAddress('GoldOracle'),
        ].filter((c, i, arr) => c && validAddr(c) && arr.indexOf(c) === i) as string[];

        console.log("Oracle probe candidates:", candidates);

        if (candidates.length === 0) {
          // keep previous maxDepositToken / oracleUsed and surface error
          setContractError(`No oracle configured for USDC. Update Vault.assets(USDC) or frontend/src/lib/addresses.ts with a valid oracle address.`);
          return;
        }

        // helper to compute and set maxDepositToken from capacityUsd6 and price and decimals
        // use the shared helper defined in component scope
        // (computeAndSetMax will set maxDepositToken and maxDepositUsd6)


        // Read the asset oracle price (probe multiple methods on candidate addresses)
        const triedAddrs: string[] = [];
        let price: bigint | null = null;
        // helpers: treat addresses known from frontend as MockOracle deployments
        const knownOracleAddrs = [
          USDC_ORACLE_ADDRESS,
          getRuntimeAddress('GoldOracle'),
        ].filter(validAddr) as string[];

        const tryFns: { abi: any[]; fn: string }[] = [
          { abi: ["function getPrice() view returns (uint256)"], fn: "getPrice" },
          { abi: ["function getSagPriceUsd() view returns (uint256)"], fn: "getSagPriceUsd" },
          { abi: ["function getGoldPriceUsd() view returns (uint256)"], fn: "getGoldPriceUsd" },
          { abi: ["function price() view returns (uint256)"], fn: "price" },
          { abi: ["function latestAnswer() view returns (int256)"], fn: "latestAnswer" },
        ];

        // Try known oracle addresses first using full MockOracle ABI (more robust)
        for (const oracleAddrCandidate of candidates) {
          triedAddrs.push(oracleAddrCandidate);

          // if candidate matches a known mock oracle, try the full MockOracle ABI first
          const useMockAbi = knownOracleAddrs.includes(oracleAddrCandidate);
          if (useMockAbi) {
            try {
              const v = await publicClient.readContract({
                address: oracleAddrCandidate as `0x${string}`,
                abi: MOCK_ORACLE_ABI,
                functionName: 'getPrice',
              });
              if (v !== undefined && v !== null) {
                price = BigInt(v.toString());
                console.log(`Oracle ${oracleAddrCandidate} responded to getPrice() (mock-abi) ->`, price.toString());
                setOracleUsed(oracleAddrCandidate);
                break;
              }
            } catch (e) {
              // if mock-abi call fails, fall back to probing human-readable signatures below
              console.warn(`Mock-ABI probe failed for ${oracleAddrCandidate}:`, String((e as any)?.message || e).split("\n")[0]);
            }
          }

          // fallback: probe common function selectors one-by-one with small ABI shapes
          for (const t of tryFns) {
            try {
              const v = await publicClient.readContract({
                address: oracleAddrCandidate as `0x${string}`,
                abi: t.abi,
                functionName: t.fn as any,
              });
              if (v !== undefined && v !== null) {
                price = BigInt(v.toString());
                console.log(`Oracle ${oracleAddrCandidate} responded to ${t.fn}() ->`, price.toString());
                setOracleUsed(oracleAddrCandidate);
                break;
              }
            } catch {
              // ignore and try next method
            }
          }
          if (price) break;
        }

        if (!price || price === BigInt(0)) {
          // keep previous max values on oracle probe failures; just report error
          setContractError(`Failed to read price from any oracle candidates: ${triedAddrs.join(', ')}. Update Vault.assets or frontend addresses.`);
        } else {
          // persist probed oracle price and decimals so the UI can recompute when metrics change
          setProbedOraclePrice(price);
          setProbedAssetDecimals(aDecimals);

          // compute and set max (use metrics.maxAvailableUsd6 if available, otherwise the reserve-capacity fallback)
          const capacityUsd6 = (metrics && metrics.maxAvailableUsd6 && Number(metrics.maxAvailableUsd6) >= 0)
            ? BigInt(metrics.maxAvailableUsd6)
            : BigInt(treasuryUsd6);
          computeAndSetMax(capacityUsd6, price, aDecimals);
          // clear previous contract error on success
          setContractError(null);
        }
      } catch (err) {
        // transient failure reading Treasury / oracle — preserve existing max values and surface error
        console.error("Failed to compute max deposit from Treasury (direct read):", err);
        setContractError(`Failed to read reserve capacity (getReserveValueUsd/getTargetReserveUsd) from configured Treasury (${TREASURY_ADDRESS}): ${String((err as any)?.message || err)}`);
        // keep prior maxDepositUsd6 / maxDepositToken to avoid UI flipping to N/A on transient probe errors
      }
    } catch (error: any) {
      // If selector not recognized, surface actionable hint
      if (String(error?.message || '').includes('function selector was not recognized')) {
        setContractError('Deployed Vault at VAULT_ADDRESS does not expose receiptCount. Redeploy Vault and update CONTRACTS.VAULT.');
        return;
      }
      console.error('Error fetching data:', error);
    }
  };

  // Recompute maxDepositToken reactively when metrics.maxAvailableUsd6 OR probed oracle/decimals change.
  useEffect(() => {
    try {
      // compute using the same helper so logic is consistent with fetchData
      const priceBn = probedOraclePrice;
      const aDecimals = probedAssetDecimals;
      if (!priceBn || aDecimals == null) return;
      const capacityUsd6 = metrics?.maxAvailableUsd6 ? BigInt(metrics.maxAvailableUsd6) : null;
      if (capacityUsd6 == null) return;
      computeAndSetMax(capacityUsd6, priceBn, aDecimals);
    } catch (e) {
      // ignore and leave previous value
    }
  }, [metrics?.maxAvailableUsd6, probedOraclePrice, probedAssetDecimals]);

  // Fetch user receipts
  const fetchReceipts = async () => {
    if (!receiptCount || receiptCount === BigInt(0)) {
      setDeposits([]);
      return;
    }

    setIsRefreshing(true);
    const receipts: DepositReceipt[] = [];
    const count = Number(receiptCount);
    const batchMetaCache = new Map<number, { totalShares: bigint; userProfitUsd6: bigint; status: number }>();

    const readBatchMeta = async (batchId: number) => {
      if (batchMetaCache.has(batchId)) return batchMetaCache.get(batchId)!;
      const batch = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: INVESTMENT_ESCROW_ABI,
        functionName: 'getBatch',
        args: [BigInt(batchId)],
      }) as any;

      const userProfitUsd6 = await publicClient.readContract({
        address: TREASURY_ADDRESS as `0x${string}`,
        abi: TREASURY_ABI,
        functionName: 'batchProfitUsd',
        args: [BigInt(batchId)],
      }) as bigint;

      const totalShares = BigInt(batch?.totalShares?.toString?.() ?? batch?.[4]?.toString?.() ?? '0');
      const status = Number(batch?.status ?? batch?.[6] ?? 0);
      const meta = { totalShares, userProfitUsd6: BigInt(userProfitUsd6), status };
      batchMetaCache.set(batchId, meta);
      return meta;
    };

    for (let i = 0; i < count; i++) {
      try {
        const receipt = await publicClient.readContract({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'receipts',
          args: [effectiveAddress, i],
        }) as {
          asset: string;
          amount: bigint | string;
          amountUsd6: bigint | string;
          shares: bigint | string;
          lockUntil: bigint | string;
          withdrawn: boolean;
        };

        if (receipt) {
          const lockUntil = Number(
            typeof receipt.lockUntil === "bigint"
              ? receipt.lockUntil
              : receipt.lockUntil?.toString?.() ?? "0"
          );
          const receiptShares = BigInt(receipt.shares);
          const unlockTimestamp = lockUntil * 1000;
          const now = Date.now();
          const isWithdrawn = receipt.withdrawn;

          let status: 'LOCKED' | 'PENDING_RETURN' | 'RETURNED';
          if (isWithdrawn) {
            status = 'RETURNED';
          } else if (now >= unlockTimestamp) {
            status = 'PENDING_RETURN';
          } else {
            status = 'LOCKED';
          }

          let batchId: number | null = null;
          let estimatedProfitUsd: number | null = null;
          if (ESCROW_ADDRESS && ESCROW_ADDRESS !== '0x0000000000000000000000000000000000000000') {
            try {
              const rawBatchId = await publicClient.readContract({
                address: ESCROW_ADDRESS as `0x${string}`,
                abi: INVESTMENT_ESCROW_ABI,
                functionName: 'receiptBatchId',
                args: [BigInt(i)],
              }) as bigint;
              const parsedBatchId = Number(rawBatchId);
              if (Number.isFinite(parsedBatchId) && parsedBatchId > 0) {
                batchId = parsedBatchId;
                const meta = await readBatchMeta(parsedBatchId);
                // Closed/Distributed/Invested+closed path only; avoid showing profit on open batches.
                if (meta.totalShares > 0n && meta.userProfitUsd6 > 0n && meta.status >= 2) {
                  const profitUsd6 = (meta.userProfitUsd6 * receiptShares) / meta.totalShares;
                  estimatedProfitUsd = Number(formatUnits(profitUsd6, 6));
                }
              }
            } catch {
              // no batch mapping for this receipt on current deployment
            }
          }

          receipts.push({
            id: i,
            asset: receipt.asset,
            principalAmount: BigInt(receipt.amount),
            entryValueUsd: Number(formatUnits(typeof receipt.amountUsd6 === "bigint" ? receipt.amountUsd6 : BigInt(receipt.amountUsd6), 6)),
            estimatedProfitUsd,
            batchId,
            shares: receiptShares,
            status,
            unlockDate: new Date(unlockTimestamp),
            withdrawn: isWithdrawn,
            lockUntil,
          });
        }
      } catch (error) {
        console.error(`Error fetching receipt ${i}:`, error);
      }
    }

    setDeposits(receipts);
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [effectiveAddress, refreshKey, VAULT_ADDRESS]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchReceipts();
  }, [receiptCount, effectiveAddress, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Ensure MetaMask is on the correct chain before signing. Switches automatically.
  async function ensureCorrectChain() {
    const ethereum = (window as any).ethereum;
    if (!ethereum) return;
    const hexChainId = await ethereum.request({ method: 'eth_chainId' });
    const current = Number.parseInt(hexChainId, 16);
    if (current === CHAIN_ID) return; // already correct
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x507' }] });
    } catch (err: any) {
      if (err?.code === 4902 || err?.code === -32603) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x507',
            chainName: 'Moonbase Alpha',
            nativeCurrency: { name: 'DEV', symbol: 'DEV', decimals: 18 },
            rpcUrls: ['https://rpc.api.moonbase.moonbeam.network'],
            blockExplorerUrls: ['https://moonbase.moonscan.io'],
          }],
        });
      } else {
        throw new Error('Please switch MetaMask to Moonbase Alpha before continuing.');
      }
    }
  }

  // Returns an ethers signer: MetaMask when injected, demo key as fallback.
  async function getEthersSigner() {
    if (connectedWallet.mode === 'injected' && typeof window !== 'undefined' && (window as any).ethereum) {
      await ensureCorrectChain();
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      return provider.getSigner();
    }
    const { getSigner } = await import('../../lib/ethers');
    return getSigner();
  }

  const handleAddMoonbaseNetwork = async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setToast({ tone: 'danger', message: 'No wallet detected. Install MetaMask first.' });
      return;
    }
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x507' }],
      });
      setToast({ tone: 'success', message: 'Switched to Moonbase Alpha.' });
    } catch (switchErr: any) {
      if (switchErr?.code === 4902 || switchErr?.code === -32603) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x507',
              chainName: 'Moonbase Alpha',
              nativeCurrency: { name: 'DEV', symbol: 'DEV', decimals: 18 },
              rpcUrls: ['https://rpc.api.moonbase.moonbeam.network'],
              blockExplorerUrls: ['https://moonbase.moonscan.io'],
            }],
          });
          setToast({ tone: 'success', message: 'Moonbase Alpha added to MetaMask.' });
        } catch (addErr: any) {
          setToast({ tone: 'danger', message: addErr?.message || 'Failed to add network.' });
        }
      } else {
        setToast({ tone: 'danger', message: switchErr?.message || 'Failed to switch network.' });
      }
    }
  };

  // Wait for a tx hash using the direct RPC publicClient (more reliable than MetaMask polling).
  async function waitForTx(hash: string) {
    await publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
      timeout: 60_000,
    });
  }

  async function getWriteSigner() {
    const { ethers } = await import('ethers');
    if (IS_LOCAL_CHAIN) {
      return new ethers.Wallet(TEST_PRIVATE_KEY, new ethers.JsonRpcProvider(RPC_URL));
    }
    const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
    if (!eth) throw new Error('No wallet connected');
    return new ethers.BrowserProvider(eth).getSigner();
  }

  const handleMintUSDC = async () => {
    if (isPaused) return;
    try {
      setIsLoading(true);
      const { ethers } = await import('ethers');
      const signer = await getWriteSigner();
      const usdc = new ethers.Contract(MOCK_USDC_ADDRESS, normalizeAbi(MockUSDCABI), signer);
      const tx = await (usdc as any).mint(effectiveAddress, parseUnits('1000', tokenDecimals));
      await waitForTx(tx.hash);
      await fetchData();
      emitUiRefresh('user:mint-usdc');
      setToast({ tone: 'success', message: 'Minted 1,000.00 USDC successfully.' });
    } catch (error) {
      console.error('Error minting USDC:', error);
      setToast({ tone: 'danger', message: `Failed to mint USDC: ${(error as any)?.message ?? error}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (isPaused) return;
    if (!depositAmount) return;
    try {
      setIsLoading(true);
      const { ethers } = await import('ethers');
      const signer = await getWriteSigner();
      const usdc = new ethers.Contract(MOCK_USDC_ADDRESS, normalizeAbi(MockUSDCABI), signer);
      const tx = await (usdc as any).approve(VAULT_ADDRESS, parseUnits(depositAmount, tokenDecimals));
      await waitForTx(tx.hash);
      await fetchData();
      emitUiRefresh('user:approve-usdc');
      setToast({ tone: 'success', message: 'Approval successful.' });
    } catch (error) {
      console.error('Error approving:', error);
      setToast({ tone: 'danger', message: `Failed to approve: ${(error as any)?.message ?? error}` });
    } finally {
      setIsLoading(false);
    }
  };

  // Approve maximum uint256 allowance for convenience
  const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
  const handleApproveMax = async () => {
    if (isPaused) return;
    try {
      setIsLoading(true);
      const { ethers } = await import('ethers');
      const signer = await getWriteSigner();
      const usdc = new ethers.Contract(MOCK_USDC_ADDRESS, normalizeAbi(MockUSDCABI), signer);
      const tx = await (usdc as any).approve(VAULT_ADDRESS, MAX_UINT256);
      await waitForTx(tx.hash);
      await fetchData();
      emitUiRefresh('user:approve-max-usdc');
      setToast({ tone: 'success', message: 'Approved maximum USDC allowance.' });
    } catch (error) {
      console.error('Error approving max:', error);
      setToast({ tone: 'danger', message: `Failed to approve max: ${(error as any)?.message ?? error}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (isPaused) return;
    try {
      setIsLoading(true);
      const { ethers } = await import('ethers');
      const signer = await getWriteSigner();
      const vault = new ethers.Contract(VAULT_ADDRESS, normalizeAbi(VaultABI), signer);
      const amountArg = parseUnits(depositAmount, tokenDecimals);
      await (async () => {
        const tx = await (vault as any).deposit(MOCK_USDC_ADDRESS, amountArg);
        await waitForTx(tx.hash);
      })();
      // refresh vault UI first
      await fetchData();
      // --- NEW: attempt to call Treasury.collateralize(amountUsd6) from UI ---
      try {
        // read asset info to locate oracle and decimals
        const assetInfo = await publicClient.readContract({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'assets',
          args: [MOCK_USDC_ADDRESS],
        }) as { enabled: boolean; decimals: number | bigint; oracle: string; };

        const aDecimals = Number(assetInfo?.decimals ?? tokenDecimals);
        const oracleAddr = (assetInfo && assetInfo.oracle && assetInfo.oracle !== '0x0000000000000000000000000000000000000000') 
          ? assetInfo.oracle 
          : USDC_ORACLE_ADDRESS;

        // read price (8-decimals) from oracle
        const priceBn = await publicClient.readContract({
          address: oracleAddr as `0x${string}`,
          abi: MOCK_ORACLE_ABI,
          functionName: 'getPrice',
        }) as bigint;

        // compute USD6: (amount * price) / (10^(decimals + 2))
        const numerator = BigInt(amountArg as bigint) * BigInt(priceBn);
        const denom = BigInt(10) ** BigInt(aDecimals + 2);
        const amountUsd6 = numerator / denom;

        console.log('Computed deposit USD6 for collateralize:', {
          amountArg: amountArg.toString(),
          priceBn: priceBn.toString(),
          aDecimals,
          numerator: numerator.toString(),
          denom: denom.toString(),
          amountUsd6: amountUsd6.toString(),
        });
      } catch (computeErr) {
        console.warn('Failed to compute or call collateralize after deposit:', computeErr);
      }

      emitUiRefresh('user:deposit');
      const depositedAmount = Number(formatUnits(amountArg, tokenDecimals));
      setToast({ tone: 'success', message: `Deposit submitted: ${formatUsdcValue(depositedAmount)} USDC. Refreshing...` });
      // Reload the page after a short delay so receipt count and activity are read fresh from chain.
      setTimeout(() => window.location.reload(), 2000);
    } catch (error: any) {
      // Add actionable error for selector not recognized
      if (
        String(error?.message || '').includes('function selector was not recognized')
      ) {
        setContractError(
          'Error: The Vault contract at CONTRACTS.VAULT does not expose deposit(address,uint256). ' +
          'Redeploy the Vault contract and update CONTRACTS.VAULT and Vault.json ABI.'
        );
      }
      console.error('Error depositing:', error);
      setToast({ tone: 'danger', message: 'Deposit failed. Check allowance and contract config.' });
    } finally {
      setIsLoading(false);
    }
  };

  const lockedDeposits = deposits.filter(d => d.status === 'LOCKED');
  const pendingReturns = deposits.filter(d => d.status === 'PENDING_RETURN');
  const activeDeposits = deposits.filter(d => d.status !== 'RETURNED');
  const totalPrincipalLocked = lockedDeposits.reduce((sum, d) => sum + d.entryValueUsd, 0);
  const walletUsdc = Number(formatUnits(usdcBalance, assetDecimals));
  const maxDepositAmount = maxDepositToken !== null
    ? Number(formatUnits(maxDepositToken, assetDecimals))
    : null;

  const nextUnlockDate = lockedDeposits.length > 0
    ? [...lockedDeposits].sort((a, b) => a.unlockDate.getTime() - b.unlockDate.getTime())[0].unlockDate
    : null;

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const maturingSoonCount = lockedDeposits.filter(
    d => d.unlockDate.getTime() > nowMs && d.unlockDate.getTime() <= nowMs + sevenDaysMs
  ).length;

  let parsedDepositAmount: bigint | null = null;
  if (depositAmount) {
    try {
      parsedDepositAmount = parseUnits(depositAmount, tokenDecimals);
    } catch {
      parsedDepositAmount = null;
    }
  }

  const needsApproval = !!depositAmount && parsedDepositAmount !== null && allowance < parsedDepositAmount;
  const disableDepositAction = isPaused || !depositAmount || isLoading || parsedDepositAmount === null;
  const groupedActivityMap = new Map<string, {
    key: string;
    status: DepositReceipt['status'];
    day: string;
    count: number;
    totalUsd: number;
  }>();

  for (const item of [...deposits].sort((a, b) => b.unlockDate.getTime() - a.unlockDate.getTime())) {
    const day = formatShortDate(item.unlockDate);
    const key = `${item.status}|${day}`;
    const existing = groupedActivityMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalUsd += item.entryValueUsd;
    } else {
      groupedActivityMap.set(key, {
        key,
        status: item.status,
        day,
        count: 1,
        totalUsd: item.entryValueUsd,
      });
    }
  }

  const groupedActivity = Array.from(groupedActivityMap.values());
  const activityPreview = groupedActivity.slice(0, 3);
  const hiddenActivityCount = Math.max(0, groupedActivity.length - activityPreview.length);

  return (
    <div className="tab-screen">
      <PageHeader
        title="User Dashboard"
        description="Monitor balances, submit deposits, and track the maturity flow from wallet entry through auto-return."
        meta={
          <div className="hero-balance-wrapper">
            <button
              className="data-chip data-chip--btn"
              onClick={() => setShowQRModal(true)}
              title="Connect or change wallet"
            >
              <WalletIcon size={12} />
              {address.slice(0, 6)}…{address.slice(-4)}
              <span style={{ opacity: 0.55, fontSize: '0.65rem' }}>{IS_LOCAL_CHAIN ? 'LOCAL' : connectedWallet.mode === 'demo' ? 'DEMO' : 'LIVE'}</span>
            </button>
            <div className="hero-balance-display">
              <div className="hero-balance-display__primary">
                <div className="hero-balance-display__label">Available to Deposit</div>
                <div className="hero-balance-display__value">{formatUsdcValue(walletUsdc)} USDC</div>
              </div>
              <div className="hero-balance-display__divider" aria-hidden="true" />
              <div className="hero-balance-display__secondary">
                <div className="hero-balance-display__stat-label">Active Locks</div>
                <div className="hero-balance-display__stat-value">{lockedDeposits.length}</div>
              </div>
            </div>
          </div>
        }
        actions={
          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowQRModal(true)}
              className="action-button action-button--purple"
              title="Connect wallet via QR or browser extension"
            >
              <ConnectWalletIcon size={14} style={{ marginRight: '0.35rem' }} />
              Connect Wallet
            </button>
            <div className="nav-divider" style={{ height: '1.5rem' }} />
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              padding: '0.45rem 0.7rem',
              borderRadius: '0.6rem',
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(6,8,14,0.5)',
            }}>
              <span style={{
                fontSize: '0.55rem',
                fontWeight: 800,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--text-500)',
                opacity: 0.7,
              }}>
                Test Actions
              </span>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleMintUSDC}
                  disabled={isPaused || isLoading}
                  className="chip-button"
                  title="Mint 1000 test USDC to your wallet"
                >
                  Mint 1000 USDC
                </button>
                <button
                  onClick={handleAddMoonbaseNetwork}
                  className="chip-button"
                  title="Add Moonbase Alpha to MetaMask"
                >
                  Add Moonbase Alpha
                </button>
                <a
                  href="https://faucet.moonbeam.network/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip-button"
                  title="Get free DEV tokens for gas on Moonbase Alpha"
                >
                  Get DEV (faucet) ↗
                </a>
              </div>
            </div>
          </div>
        }
      />

      {contractError && (
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">
            <div className="whitespace-pre-wrap">{contractError}</div>
          </div>
        </div>
      )}

      <div className="sagitta-grid sagitta-grid--compact">
        <MetricCard
          title="Total Principal Locked (USD)"
          hint="Locked principal"
          value={formatUsdValue(totalPrincipalLocked)}
          tone="warning"
          icon={<DollarSign size={16} />}
        />
        <MetricCard
          title="Active Deposits"
          hint="Open receipts"
          value={activeDeposits.length.toString()}
          tone="neutral"
          icon={<Package size={16} />}
        />
        <MetricCard
          title="Maturing Soon (7D)"
          hint="Upcoming unlocks"
          value={maturingSoonCount.toString()}
          tone={maturingSoonCount > 0 ? 'warning' : 'neutral'}
          icon={<Clock size={16} />}
        />
        <MetricCard
          title="Next Unlock"
          hint="Nearest maturity"
          value={nextUnlockDate ? formatShortDate(nextUnlockDate) : 'None'}
          tone={nextUnlockDate ? 'success' : 'neutral'}
          icon={<CalendarClock size={16} />}
        />
      </div>

      <div className="sagitta-grid sagitta-grid--wide">
        {/* ── New Deposit ── */}
        <div className="sagitta-cell h-full flex flex-col gap-5">
          <div>
            <div className="ud-panel-title">
              <NewDepositIcon size={15} />
              New Deposit
            </div>
            <p className="ud-panel-sub">Prepare the deposit amount, confirm allowance, then send principal into the current vault lock schedule.</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 items-start">
            {/* Left: amount input */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="ud-field-label">Amount (USDC)</label>
                <div className="relative mt-1.5">
                  <input
                    type="number"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    disabled={isPaused || isLoading}
                    className="ud-input w-full pr-16 disabled:opacity-50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold tracking-widest" style={{ color: 'var(--gold-500)' }}>USDC</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[['25%', BigInt(25)], ['50%', BigInt(50)], ['75%', BigInt(75)]].map(([label, pct]) => (
                  <button
                    key={label as string}
                    type="button"
                    onClick={() => setDepositAmount(formatUnits((usdcBalance * (pct as bigint)) / BigInt(100), assetDecimals))}
                    disabled={isPaused || isLoading}
                    className="chip-button"
                  >
                    {label as string}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDepositAmount(formatUnits(usdcBalance, assetDecimals))}
                  disabled={isPaused || isLoading}
                  className="chip-button"
                >
                  Wallet Max
                </button>
              </div>
            </div>

            {/* Right: vault info rows */}
            <div className="panel-stack panel-stack--dense">
              <div className="panel-row">
                <span className="panel-row__label">Vault max deposit</span>
                <span className="panel-row__value">{maxDepositAmount !== null ? formatUsdcValue(maxDepositAmount) : 'N/A'} USDC</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Projected payout</span>
                <span className="panel-row__value">Principal only</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Term model</span>
                <span className="panel-row__value">Vault lock schedule</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-auto pt-1">
            {needsApproval ? (
              <>
                <button onClick={handleApprove} disabled={disableDepositAction} className="action-button action-button--warning flex-1 sm:flex-none">
                  {isLoading ? 'Processing…' : 'Approve USDC'}
                </button>
                <button onClick={handleApproveMax} disabled={isPaused || isLoading} className="action-button action-button--ghost">
                  {isLoading ? 'Processing…' : 'Approve Max'}
                </button>
              </>
            ) : (
              <button onClick={handleDeposit} disabled={disableDepositAction} className="action-button action-button--primary">
                {isLoading ? 'Processing…' : 'Deposit USDC'}
              </button>
            )}
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-500)' }}>
            {isPaused
              ? 'Protocol is paused — deposit, approval and mint actions are disabled.'
              : 'Deposits are automatically returned to your wallet at term end.'}
          </p>
          {parsedDepositAmount === null && depositAmount && (
            <p className="text-xs text-rose-300">Enter a valid numeric amount.</p>
          )}
        </div>

        {/* ── Account Activity ── */}
        <div className="sagitta-cell h-full flex flex-col gap-5">
          <div>
            <div className="ud-panel-title">
              <Activity size={14} />
              Account Activity
            </div>
            <p className="ud-panel-sub">Open receipts, pending returns, and the next maturity date in queue.</p>
          </div>

          <div className="panel-stack">
            <div className="panel-row">
              <span className="panel-row__label" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <Lock size={13} style={{ color: 'var(--gold-500)' }} /> Locked receipts
              </span>
              <span className="panel-row__value">{lockedDeposits.length}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <Unlock size={13} style={{ color: 'var(--tone-warning)' }} /> Pending return
              </span>
              <span className="panel-row__value" style={{ color: pendingReturns.length > 0 ? 'var(--tone-warning)' : undefined }}>
                {pendingReturns.length}
              </span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <CalendarClock size={13} style={{ color: 'var(--tone-success)' }} /> Next unlock
              </span>
              <span className="panel-row__value">{nextUnlockDate ? formatShortDate(nextUnlockDate) : '—'}</span>
            </div>
          </div>

          <div className="ud-snapshot">
            <div className="ud-snapshot__heading">Activity Snapshot</div>
            {activityPreview.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-500)' }}>
                No deposits yet — create your first receipt to start tracking.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activityPreview.map(item => {
                  const statusText = item.status === 'PENDING_RETURN' ? 'Pending Return'
                    : item.status === 'RETURNED' ? 'Returned' : 'Locked';
                  const statusColor = item.status === 'LOCKED' ? 'var(--gold-300)'
                    : item.status === 'PENDING_RETURN' ? 'var(--tone-warning)' : 'var(--tone-success)';
                  return (
                    <div key={item.key} className="ud-snapshot__row">
                      <span>
                        {item.count} receipt{item.count > 1 ? 's' : ''}{' '}
                        <span style={{ color: statusColor }}>{statusText}</span>
                      </span>
                      <span style={{ color: 'var(--text-500)' }}>{item.day}</span>
                      <span className="font-mono" style={{ color: 'var(--text-100)' }}>{formatUsdValue(item.totalUsd)}</span>
                    </div>
                  );
                })}
                {hiddenActivityCount > 0 && (
                  <div className="text-xs pt-1" style={{ color: 'var(--text-500)' }}>
                    +{hiddenActivityCount} more groups below
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div className="table-shell">
            <div className="table-toolbar">
              <div>
                <h3 className="section-title !mb-0">Your Deposit Receipts</h3>
                <p className="section-subtitle !mb-0 !mt-1">Receipt-level visibility into principal, estimated profit, unlock timing, and return state.</p>
              </div>
              <button
                onClick={fetchReceipts}
                disabled={isRefreshing}
                className="icon-button"
                title="Refresh receipts"
              >
                <RefreshCw size={16} className={`${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="px-4 py-3"><Hash size={14} className="inline-block mr-1" />ID</th>
                    <th className="px-4 py-3"><Package size={14} className="inline-block mr-1" />Asset</th>
                    <th className="px-4 py-3"><ArrowDown size={14} className="inline-block mr-1" />Principal</th>
                    <th className="px-4 py-3"><DollarSign size={14} className="inline-block mr-1" />Entry Value</th>
                    <th className="px-4 py-3"><DollarSign size={14} className="inline-block mr-1" />Est. Profit</th>
                    <th className="px-4 py-3"><Clock size={14} className="inline-block mr-1" />Unlock Date</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isRefreshing ? (
                    <tr><td colSpan={8} className="p-8 text-center" style={{ color: 'var(--text-500)' }}>Loading receipts...</td></tr>
                  ) : deposits.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center" style={{ color: 'var(--text-500)' }}>
                        <div className="space-y-2">
                          <div>You have no deposits yet.</div>
                          <div className="text-xs" style={{ color: 'var(--text-500)' }}>Use the New Deposit panel above to create your first receipt.</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    deposits.map((receipt) => (
                      <tr key={receipt.id} className="text-sm">
                        <td className="px-4 py-3 font-mono" style={{ color: 'var(--gold-300)' }}>#{receipt.id}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: 'var(--text-100)' }}>{receipt.asset}</td>
                        <td className="px-4 py-3 font-mono" style={{ color: 'var(--gold-300)' }}>
                          {formatUsdcValue(Number(formatUnits(receipt.principalAmount, assetDecimals)))}
                        </td>
                        <td className="px-4 py-3 font-mono" style={{ color: 'var(--text-300)' }}>{formatUsdValue(receipt.entryValueUsd)}</td>
                        <td className="px-4 py-3 font-mono text-emerald-300">{formatNullableUsdValue(receipt.estimatedProfitUsd)}</td>
                        <td className="px-4 py-3">{formatShortDate(receipt.unlockDate)}</td>
                        <td className="px-4 py-3">
                          {receipt.status === 'LOCKED' && (
                            <span className="status-badge status-badge--locked"><Lock size={11} /> Locked</span>
                          )}
                          {receipt.status === 'PENDING_RETURN' && (
                            <span className="status-badge status-badge--pending"><Unlock size={11} /> Pending Return</span>
                          )}
                          {receipt.status === 'RETURNED' && (
                            <span className="status-badge status-badge--returned"><Unlock size={11} /> Returned</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {deposits.some(r => r.status === 'PENDING_RETURN') && (
            <div className="status-banner status-banner--warning mt-4">
              Some of your deposits have matured and are pending auto-return. Your principal will be automatically sent to your wallet soon.
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            toast.tone === 'success'
              ? 'border-emerald-500/45 bg-emerald-950/75 text-emerald-200'
              : 'border-rose-500/45 bg-rose-950/75 text-rose-200'
          }`}
        >
          {toast.message}
        </div>
      )}

      {showQRModal && (
        <QRConnectModal
          currentWallet={connectedWallet}
          onConnect={(wallet) => {
            // Persist wallet mode + address so header (useRoleAccess) and UserTab share one source of truth
            if (wallet.mode === 'demo') {
              window.localStorage.removeItem('sagitta.connectedAccount');
              window.localStorage.setItem('sagitta.walletMode', 'demo');
            } else {
              window.localStorage.setItem('sagitta.connectedAccount', wallet.address);
              window.localStorage.setItem('sagitta.walletMode', 'injected');
            }
            window.dispatchEvent(new CustomEvent(WALLET_MODE_CHANGED_EVENT));
            // Clear stale data so the page shows a fresh load for the new wallet
            setDeposits([]);
            setReceiptCount(BigInt(0));
            setUsdcBalance(BigInt(0));
            setAllowance(BigInt(0));
            setConnectedWallet(wallet);
            setRefreshKey(k => k + 1);
            setShowQRModal(false);
            setToast({ tone: 'success', message: `Wallet connected: ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} (${wallet.label})` });
          }}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </div>
  );
}
