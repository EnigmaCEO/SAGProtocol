import { useState, useEffect } from 'react';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Chain, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import MetricCard from '../ui/MetricCard';
import { Clock, ArrowDown, Lock, Unlock, Hash, DollarSign, Package, RefreshCw, Wallet, CalendarClock, Activity, QrCode } from 'lucide-react';
import VaultABI from '../../lib/abis/Vault.json';
import MockUSDCABI from '../../lib/abis/MockUSDC.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import MockOracleABI from '../../lib/abis/MockOracle.json';
import TreasuryABI from '../../lib/abis/Treasury.json';
import InvestmentEscrowABI from '../../lib/abis/InvestmentEscrow.json';
import useVaultMetrics from '../../hooks/useVaultMetrics';
import { getRuntimeAddress } from '../../lib/runtime-addresses';
import { emitUiRefresh } from '../../lib/ui-refresh';
import useProtocolPause from '../../hooks/useProtocolPause';
import PageHeader from '../ui/PageHeader';
import QRConnectModal, { type ConnectedWallet } from '../ui/QRConnectModal';
import { RPC_URL, ACTIVE_CHAIN } from '../../lib/network';

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
  const VAULT_ADDRESS = getRuntimeAddress('Vault') || DEFAULT_VAULT_ADDRESS;
  const MOCK_USDC_ADDRESS = getRuntimeAddress('MockUSDC') || DEFAULT_MOCK_USDC_ADDRESS;
  const TREASURY_ADDRESS = getRuntimeAddress('Treasury') || DEFAULT_TREASURY_ADDRESS;
  const ESCROW_ADDRESS = getRuntimeAddress('InvestmentEscrow') || DEFAULT_ESCROW_ADDRESS;
  const MOCK_ORACLE_ADDRESS = DEFAULT_MOCK_ORACLE_ADDRESS;

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

  // Wallet connection state
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet>({
    address: account.address,
    mode: 'demo',
    label: 'Demo (Hardhat #0)',
  });
  const [showQRModal, setShowQRModal] = useState(false);

  const address = connectedWallet.address;
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
          args: [address],
        }) as bigint;
        setUsdcBalance(usdcRaw);
      } catch (e) {
        setUsdcBalance(BigInt(0));
      }
    }
    fetchBalances();
  }, [address, tokenDecimals]);

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
    try {
      // Verify contract is deployed and ABI-compatible
      const code = await publicClient.getCode({ address: VAULT_ADDRESS as `0x${string}` });
      if (!code || code === '0x') {
        setContractError(
          `No contract found at current Vault address (${VAULT_ADDRESS}). ` +
          `Open DAO tab, click "Load Generated", then "Refresh On-Chain".`
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
        args: [address], 
      }) as bigint;
      setUsdcBalance(balance);

      // Read receipt count (ABI: function receiptCount(address user) external view returns (uint256))
      const count = await publicClient.readContract({
        address: VAULT_ADDRESS as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'receiptCount',
        args: [address],
      }) as bigint;
      setReceiptCount(count);

      // Read allowance
      const allow = await publicClient.readContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'allowance',
        args: [address, VAULT_ADDRESS],
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
          (CONTRACT_ADDRESSES as any).UsdcOracle,
          CONTRACT_ADDRESSES.GoldOracle,
          MOCK_ORACLE_ADDRESS
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
          (CONTRACT_ADDRESSES as any).UsdcOracle,
          CONTRACT_ADDRESSES.GoldOracle,
          MOCK_ORACLE_ADDRESS
        ].filter(Boolean) as string[];

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
          args: [address, i],
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
    //const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    //return () => clearInterval(interval);
  }, [address]); // Add address dependency

  useEffect(() => {
    fetchReceipts();
  }, [receiptCount, address]); // Add dependencies to prevent stale closure

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleMintUSDC = async () => {
    if (isPaused) return;
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'mint',
        args: [address, parseUnits('1000', tokenDecimals)],
        chain: ACTIVE_CHAIN as Chain,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      emitUiRefresh('user:mint-usdc');
      setToast({ tone: 'success', message: 'Minted 1,000.00 USDC successfully.' });
    } catch (error) {
      console.error('Error minting USDC:', error);
      setToast({ tone: 'danger', message: 'Failed to mint USDC.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (isPaused) return;
    if (!depositAmount) return;
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'approve',
        args: [VAULT_ADDRESS, parseUnits(depositAmount, tokenDecimals)],
        chain: ACTIVE_CHAIN as Chain,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      emitUiRefresh('user:approve-usdc');
      setToast({ tone: 'success', message: 'Approval successful.' });
    } catch (error) {
      console.error('Error approving:', error);
      setToast({ tone: 'danger', message: 'Failed to approve allowance.' });
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
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: MOCK_USDC_ABI,
        functionName: 'approve',
        args: [VAULT_ADDRESS, MAX_UINT256],
        chain: ACTIVE_CHAIN as Chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      emitUiRefresh('user:approve-max-usdc');
      setToast({ tone: 'success', message: 'Approved maximum USDC allowance.' });
    } catch (error) {
      console.error('Error approving max:', error);
      setToast({ tone: 'danger', message: 'Failed to approve max allowance.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (isPaused) return;
    try {
      const assetArg = MOCK_USDC_ADDRESS;
      const amountArg = parseUnits(depositAmount, tokenDecimals);

      // Debug: log arguments and types
      console.log("writeContract args:", {
        assetArg,
        assetArgType: typeof assetArg,
        amountArg,
        amountArgType: typeof amountArg,
        VAULT_ADDRESS,
        depositAmount,
        tokenDecimals
      });

      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: VAULT_ADDRESS as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [assetArg, amountArg],
        chain: ACTIVE_CHAIN as Chain,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
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
          : MOCK_ORACLE_ADDRESS;

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

      await fetchReceipts();
      emitUiRefresh('user:deposit');
      console.log('Deposit successful!');
      const depositedAmount = Number(formatUnits(amountArg, tokenDecimals));
      setToast({ tone: 'success', message: `Deposit submitted: ${formatUsdcValue(depositedAmount)} USDC.` });
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
          <>
            <button
              className="data-chip data-chip--btn"
              onClick={() => setShowQRModal(true)}
              title="Connect or change wallet"
            >
              <QrCode size={12} />
              {address.slice(0, 6)}…{address.slice(-4)}
              <span style={{ opacity: 0.55, fontSize: '0.65rem' }}>{connectedWallet.mode === 'demo' ? 'DEMO' : 'LIVE'}</span>
            </button>
            <span className="data-chip">USDC {formatUsdcValue(walletUsdc)}</span>
            <span className="data-chip" data-tone={lockedDeposits.length > 0 ? 'success' : 'warning'}>
              {lockedDeposits.length > 0 ? `${lockedDeposits.length} active lock${lockedDeposits.length === 1 ? '' : 's'}` : 'No active locks'}
            </span>
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button
              onClick={() => setShowQRModal(true)}
              className="action-button action-button--ghost"
              title="Connect wallet via QR or browser extension"
            >
              <QrCode size={13} style={{ marginRight: '0.3rem' }} />
              Connect Wallet
            </button>
            <button
              onClick={handleMintUSDC}
              disabled={isPaused || isLoading}
              className="action-button action-button--ghost"
            >
              Mint 1000 USDC
            </button>
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
        <div className="sagitta-cell">
          <h3 className="section-title">Total Principal Locked (USD)</h3>
          <MetricCard title="Locked principal" value={formatUsdValue(totalPrincipalLocked)} tone="neutral" />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Active Deposits</h3>
          <MetricCard title="Open receipts" value={activeDeposits.length.toString()} tone="neutral" />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Maturing Soon (7D)</h3>
          <MetricCard title="Upcoming unlocks" value={maturingSoonCount.toString()} tone="warning" />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Next Unlock</h3>
          <MetricCard
            title="Nearest maturity"
            value={nextUnlockDate ? formatShortDate(nextUnlockDate) : 'No active locks'}
            tone={nextUnlockDate ? 'success' : 'neutral'}
          />
        </div>
      </div>

      <div className="sagitta-grid sagitta-grid--wide">
        <div className="sagitta-cell h-full">
          <h3 className="section-title">
            <ArrowDown size={20} className="text-emerald-400" /> New Deposit
          </h3>
          <p className="section-subtitle">Prepare the deposit amount, confirm allowance, then send principal into the current vault lock schedule.</p>
          <div className="grid gap-4 lg:grid-cols-2 items-end">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Amount (USDC)</label>
              <div className="relative">
                <input
                  type="number"
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  disabled={isPaused || isLoading}
                  className="w-full pl-4 pr-16 py-3 rounded-xl bg-slate-900/70 border border-slate-700 text-slate-200 placeholder-slate-500 outline-none transition-all disabled:opacity-50"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">USDC</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDepositAmount(formatUnits((usdcBalance * BigInt(25)) / BigInt(100), assetDecimals))}
                  disabled={isPaused || isLoading}
                  className="chip-button"
                >
                  25%
                </button>
                <button
                  type="button"
                  onClick={() => setDepositAmount(formatUnits((usdcBalance * BigInt(50)) / BigInt(100), assetDecimals))}
                  disabled={isPaused || isLoading}
                  className="chip-button"
                >
                  50%
                </button>
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

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            {needsApproval ? (
              <div className="w-full sm:w-auto flex gap-3">
                <button
                  onClick={handleApprove}
                  disabled={disableDepositAction}
                  className="action-button action-button--warning flex-1"
                >
                  {isLoading ? 'Processing...' : 'Approve USDC'}
                </button>
                <button
                  onClick={handleApproveMax}
                  disabled={isPaused || isLoading}
                  className="action-button action-button--ghost"
                >
                  {isLoading ? 'Processing...' : 'Approve Max'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleDeposit}
                disabled={disableDepositAction}
                className="action-button action-button--primary w-full sm:w-auto"
              >
                {isLoading ? 'Processing...' : 'Deposit USDC'}
              </button>
            )}
          </div>

          <p className="mt-3 text-sm text-slate-400">
            {isPaused ? 'Protocol is paused. Deposit, approval, and mint actions are disabled until the protocol is resumed.' : 'Deposits are automatically returned to your wallet at term end.'}
          </p>
          {parsedDepositAmount === null && depositAmount && (
            <p className="mt-2 text-xs text-rose-300">Enter a valid numeric deposit amount.</p>
          )}
        </div>

        <div className="sagitta-cell h-full">
          <h3 className="section-title">
            <Activity size={18} className="text-sky-300" /> Account Activity
          </h3>
          <p className="section-subtitle">A compact view of open receipts, pending returns, and the next maturity date in the queue.</p>
          <div className="panel-stack">
            <div className="panel-row">
              <span className="panel-row__label inline-flex items-center gap-2"><Lock size={14} /> Locked receipts</span>
              <span className="panel-row__value">{lockedDeposits.length}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label inline-flex items-center gap-2"><Unlock size={14} /> Pending return</span>
              <span className="panel-row__value text-amber-300">{pendingReturns.length}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label inline-flex items-center gap-2"><CalendarClock size={14} /> Next unlock</span>
              <span className="panel-row__value">{nextUnlockDate ? formatShortDate(nextUnlockDate) : '--'}</span>
            </div>
          </div>

          <div className="mt-4 panel-note">
            <div className="text-sm font-semibold text-slate-200 mb-2">Activity Snapshot</div>
            {activityPreview.length === 0 ? (
              <div className="text-sm text-slate-400">No deposits yet. Create your first deposit to start tracking activity.</div>
            ) : (
              <div className="space-y-2">
                {activityPreview.map(item => {
                  const statusText = item.status === 'PENDING_RETURN'
                    ? 'Pending Return'
                    : item.status === 'RETURNED'
                      ? 'Returned'
                      : 'Locked';
                  const statusTone = item.status === 'LOCKED'
                    ? 'text-amber-300'
                    : item.status === 'PENDING_RETURN'
                      ? 'text-yellow-300'
                      : 'text-emerald-300';
                  return (
                    <div key={item.key} className="text-sm text-slate-300 flex items-center justify-between gap-3">
                      <span>{item.count} receipt{item.count > 1 ? 's' : ''} <span className={statusTone}>{statusText}</span></span>
                      <span className="text-slate-400">{item.day}</span>
                      <span className="font-mono text-slate-200">{formatUsdValue(item.totalUsd)}</span>
                    </div>
                  );
                })}
                {hiddenActivityCount > 0 && (
                  <div className="text-xs text-slate-500 pt-1">+{hiddenActivityCount} more groups in receipts table</div>
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
                  <tr className="text-sm text-slate-400">
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
                    <tr><td colSpan={8} className="p-8 text-center text-slate-400">Loading receipts...</td></tr>
                  ) : deposits.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        <div className="space-y-2">
                          <div>You have no deposits yet.</div>
                          <div className="text-xs text-slate-500">Use the New Deposit panel above to create your first receipt.</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    deposits.map((receipt) => (
                      <tr key={receipt.id} className="text-sm text-slate-400">
                        <td className="px-4 py-3 font-mono text-amber-300">#{receipt.id}</td>
                        <td className="px-4 py-3 font-bold">{receipt.asset}</td>
                        <td className="px-4 py-3 font-mono text-amber-300">
                          {formatUsdcValue(Number(formatUnits(receipt.principalAmount, assetDecimals)))}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300">{formatUsdValue(receipt.entryValueUsd)}</td>
                        <td className="px-4 py-3 font-mono text-emerald-300">{formatNullableUsdValue(receipt.estimatedProfitUsd)}</td>
                        <td className="px-4 py-3">{formatShortDate(receipt.unlockDate)}</td>
                        <td className="px-4 py-3">
                          {receipt.status === 'LOCKED' && (
                            <span className="flex items-center gap-2 text-orange-400"><Lock size={14} /> Locked</span>
                          )}
                          {receipt.status === 'PENDING_RETURN' && (
                            <span className="flex items-center gap-2 text-yellow-400"><Unlock size={14} /> Pending Return</span>
                          )}
                          {receipt.status === 'RETURNED' && (
                            <span className="flex items-center gap-2 text-emerald-400"><Unlock size={14} /> Returned</span>
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
            setConnectedWallet(wallet);
            setShowQRModal(false);
            setToast({ tone: 'success', message: `Wallet connected: ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} (${wallet.label})` });
          }}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </div>
  );
}
