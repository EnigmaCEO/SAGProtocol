import { useState, useEffect } from 'react';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Chain, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, ArrowDown, Lock, Unlock, Hash, DollarSign, Package, RefreshCw } from 'lucide-react';
import VaultABI from '../../lib/abis/Vault.json';
import MockDOTABI from '../../lib/abis/MockDOT.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import MockOracleABI from '../../lib/abis/MockOracle.json';
import TreasuryABI from '../../lib/abis/Treasury.json';
import { version } from 'viem/package.json';
import useVaultMetrics from '../../hooks/useVaultMetrics';

// Helper to cast ABI and normalize JSON shape { abi: [...] } vs [...]
function normalizeAbi(x: any) {
  return Array.isArray(x) ? x : (x?.abi ?? []);
}

// Replace earlier ABI constants with normalized versions
const VAULT_ABI = normalizeAbi(VaultABI) as Abi[];
const MOCK_ORACLE_ABI = normalizeAbi(MockOracleABI) as Abi[];
const MOCK_DOT_ABI = normalizeAbi(MockDOTABI) as Abi[];

const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
const MOCK_DOT_ADDRESS = CONTRACT_ADDRESSES.MockDOT;
const TREASURY_ADDRESS = CONTRACT_ADDRESSES.Treasury;
const MOCK_ORACLE_ADDRESS = CONTRACT_ADDRESSES.DotOracle;

// Localhost test account (Anvil/Hardhat default account #0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

// Local 1337 chain (matches your node's chainId)
const LOCALHOST_CHAIN = {
  id: 1337,
  name: 'Localhost 1337',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public: { http: ['http://127.0.0.1:8545'] },
  },
} satisfies Chain;

// Create clients
const publicClient = createPublicClient({
  chain: LOCALHOST_CHAIN,
  transport: http('http://127.0.0.1:8545'),
});

const walletClient = createWalletClient({
  account,
  chain: LOCALHOST_CHAIN,
  transport: http('http://127.0.0.1:8545'),
});

interface DepositReceipt {
  id: number;
  asset: string;
  principalAmount: bigint;
  entryValueUsd: number;
  shares: bigint;
  status: 'LOCKED' | 'PENDING_RETURN' | 'RETURNED';
  unlockDate: Date;
  withdrawn: boolean;
  lockUntil: number;
}

const DEMO_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const LOCALHOST_RPC = "http://127.0.0.1:8545";

export default function UserTab() {
  const [depositAmount, setDepositAmount] = useState('');
  const [deposits, setDeposits] = useState<DepositReceipt[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dotBalance, setDotBalance] = useState<bigint>(BigInt(0));
  const [receiptCount, setReceiptCount] = useState<bigint>(BigInt(0));
  const [allowance, setAllowance] = useState<bigint>(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(6); // default to 6 for xcDOT
  const [assetDecimals, setAssetDecimals] = useState<number>(6); // default to 6 for xcDOT

  // max deposit (USD6) and equivalent token amount
  const [maxDepositUsd6, setMaxDepositUsd6] = useState<bigint | null>(null);
  const [maxDepositToken, setMaxDepositToken] = useState<bigint | null>(null);
  const [oracleUsed, setOracleUsed] = useState<string | null>(null);

  // store last-probed oracle price and decimals so we can recompute max reactively
  const [probedOraclePrice, setProbedOraclePrice] = useState<bigint | null>(null);
  const [probedAssetDecimals, setProbedAssetDecimals] = useState<number | null>(null);

  const address = account.address;
  const metrics = useVaultMetrics();

  // Use viem publicClient for all balances to ensure consistency
  useEffect(() => {
    async function fetchBalances() {
      try {
        // xcDOT balance
        const mdotRaw = await publicClient.readContract({
          address: MOCK_DOT_ADDRESS as `0x${string}`,
          abi: MOCK_DOT_ABI,
          functionName: 'balanceOf',
          args: [address],
        }) as bigint;
        setDotBalance(mdotRaw);
      } catch (e) {
        setDotBalance(BigInt(0));
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
        setContractError('No contract found at VAULT_ADDRESS. Update CONTRACTS.VAULT to your deployed Vault address.');
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
          address: MOCK_DOT_ADDRESS as `0x${string}`,
          abi: MOCK_DOT_ABI,
          functionName: 'decimals',
        }) as number | bigint;
        setTokenDecimals(Number(dec));
        setAssetDecimals(Number(dec));
      } catch {
        setTokenDecimals(18);
        setAssetDecimals(18);
      }

      // Read DOT balance
      const balance = await publicClient.readContract({
        address: MOCK_DOT_ADDRESS as `0x${string}`,
        abi: MOCK_DOT_ABI,
        functionName: 'balanceOf',
        args: [address], 
      }) as bigint;
      setDotBalance(balance);

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
        address: MOCK_DOT_ADDRESS as `0x${string}`,
        abi: MOCK_DOT_ABI,
        functionName: 'allowance',
        args: [address, VAULT_ADDRESS],
      }) as bigint;
      setAllowance(allow);

      // --- Compute max deposit allowed by Treasury (USD6 and token amount) ---
      try {
        
        const treasuryUsdVal = await publicClient.readContract({
          address: TREASURY_ADDRESS as `0x${string}`,
          abi: TreasuryABI,
          functionName: 'getTreasuryValueUsd',
        }) as bigint;

        // update capacity only when read succeeds
        setMaxDepositUsd6(treasuryUsdVal);
        const treasuryUsd6 = treasuryUsdVal;

        // Read Vault asset info for xcDOT to determine decimals and oracle
        const assetInfo = await publicClient.readContract({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'assets',
          args: [MOCK_DOT_ADDRESS],
        }) as { enabled: boolean; decimals: number | bigint; oracle: string; };

        const aDecimals = Number(assetInfo?.decimals ?? tokenDecimals);
        setAssetDecimals(aDecimals);

        // Resolve oracle address: prefer assetInfo.oracle, fall back to deployed per-asset oracles or generic mock oracle
        
        console.log("Front-end CONTRACTS oracle entries:", {
          DotOracle: CONTRACT_ADDRESSES.DotOracle,
          SagOracle: CONTRACT_ADDRESSES.SagOracle,
          GoldOracle: CONTRACT_ADDRESSES.GoldOracle
        });
        const ZERO = '0x0000000000000000000000000000000000000000';
        function validAddr(a: any) {
          return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && a !== ZERO;
        }
        // NOTE: do NOT include TREASURY_ADDRESS here — probing Treasury as an oracle produced large values
        const candidates = [
          assetInfo?.oracle,
          CONTRACT_ADDRESSES.DotOracle,
          CONTRACT_ADDRESSES.SagOracle,
          CONTRACT_ADDRESSES.GoldOracle,
          MOCK_ORACLE_ADDRESS
        ].filter((c, i, arr) => c && validAddr(c) && arr.indexOf(c) === i) as string[];

        console.log("Oracle probe candidates:", candidates);

        if (candidates.length === 0) {
          // keep previous maxDepositToken / oracleUsed and surface error
          setContractError(`No oracle configured for xcDOT. Update Vault.assets(xcDOT) or frontend/src/lib/addresses.ts with a valid oracle address.`);
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
          CONTRACT_ADDRESSES.DotOracle,
          CONTRACT_ADDRESSES.SagOracle,
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

          // compute and set max (use metrics.maxAvailableUsd6 if available, otherwise the configured Treasury capacity)
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
        setContractError(`Failed to read getTreasuryValueUsd from configured Treasury (${TREASURY_ADDRESS}): ${String((err as any)?.message || err)}`);
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

          receipts.push({
            id: i,
            asset: receipt.asset,
            principalAmount: BigInt(receipt.amount),
            entryValueUsd: Number(formatUnits(typeof receipt.amountUsd6 === "bigint" ? receipt.amountUsd6 : BigInt(receipt.amountUsd6), 6)),
            shares: BigInt(receipt.shares),
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

  const handleMintDOT = async () => {
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_DOT_ADDRESS as `0x${string}`,
        abi: MOCK_DOT_ABI,
        functionName: 'mint',
        args: [address, parseUnits('1000', tokenDecimals)],
        chain: LOCALHOST_CHAIN,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      alert('Minted 1000 xcDOT successfully!');
    } catch (error) {
      console.error('Error minting DOT:', error);
      alert('Failed to mint DOT');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!depositAmount) return;
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_DOT_ADDRESS as `0x${string}`,
        abi: MOCK_DOT_ABI,
        functionName: 'approve',
        args: [VAULT_ADDRESS, parseUnits(depositAmount, tokenDecimals)],
        chain: LOCALHOST_CHAIN,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      alert('Approval successful!');
    } catch (error) {
      console.error('Error approving:', error);
      alert('Failed to approve');
    } finally {
      setIsLoading(false);
    }
  };

  // Approve maximum uint256 allowance for convenience
  const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
  const handleApproveMax = async () => {
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_DOT_ADDRESS as `0x${string}`,
        abi: MOCK_DOT_ABI,
        functionName: 'approve',
        args: [VAULT_ADDRESS, MAX_UINT256],
        chain: LOCALHOST_CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      alert('Approved maximum xcDOT allowance!');
    } catch (error) {
      console.error('Error approving max:', error);
      alert('Failed to approve max');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = async () => {
    try {
      const assetArg = MOCK_DOT_ADDRESS;
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
        chain: LOCALHOST_CHAIN,
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
          args: [MOCK_DOT_ADDRESS],
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
      console.log('Deposit successful!');
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
    } finally {
      setIsLoading(false);
    }
  };

  const lockedDeposits = deposits.filter(d => d.status === 'LOCKED');
  const totalPrincipalLocked = lockedDeposits.reduce((sum, d) => sum + d.entryValueUsd, 0);
  const nextUnlockDate = lockedDeposits.length > 0 
    ? lockedDeposits.sort((a, b) => a.unlockDate.getTime() - b.unlockDate.getTime())[0].unlockDate 
    : null;

  const needsApproval = !!depositAmount && (allowance < parseUnits(depositAmount, tokenDecimals));

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <h2 style={{ marginBlockStart: '0.3em' }}>User Dashboard</h2>
          <div className="text-slate-400 text-sm mt-1">Manage deposits and balance.</div>
          <div style={{ height: 12 }} />
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span> Balance: {Number(formatUnits(dotBalance, assetDecimals)).toFixed(2)} xcDOT </span>
            <span className="text-xs">({address.slice(0, 6)}...{address.slice(-4)})</span>
          </div>
          <div style={{ height: 12 }} />
          <div>
          <button 
            onClick={handleMintDOT}
            disabled={isLoading}
            className="px-4 py-2 rounded-full bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/50 text-violet-300 transition-all disabled:opacity-50"
          >
            Mint 1000 xcDOT
          </button>
          </div>
        </div>
      </div>

      <div className="sagitta-grid" style={{ gridTemplateColumns: 'repeat(2, 2fr)' }}>
        {/* Cell 1 */}
        <div className="sagitta-cell">
        <h3>Total Principal Locked (USD)</h3>
          <MetricGrid>
            <MetricCard title="" value={`$${totalPrincipalLocked.toFixed(2)}`} tone="neutral" />
            </MetricGrid>
        </div>
        {/* Cell 2 */}
        <div className="sagitta-cell" style={{ gridRow: '2' }}>
          <h3>Active Deposits</h3>
            <MetricCard title="" value={lockedDeposits.length.toString()} tone="neutral" />
         
        </div>
        {/* Cell 3 */}
        <div className="sagitta-cell" style={{ gridRowStart: 'span 2' }}>
          <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
            <h3 className="text-lg font-semibold mb-4 text-slate-200 flex items-center gap-2">
              <ArrowDown size={20} className="text-emerald-400"/>New Deposit
            </h3>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="relative w-full sm:w-auto flex-grow">
                <input 
                  type="number" 
                  placeholder="Amount" 
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-4 pr-16 py-3 rounded-full bg-slate-900/70 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/50 text-slate-200 placeholder-slate-500 outline-none transition-all disabled:opacity-50"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold"> xcDOT</span>
              </div>
              <div style={{ height: 12 }} />
              {/* Max deposit hint */}
              <div className="w-full sm:w-auto text-sm text-slate-400">
                {maxDepositToken !== null ? (
                  <div>
                    Max deposit: <span className="font-mono text-slate-200">{Number(formatUnits(maxDepositToken, assetDecimals)).toFixed(4)} xcDOT</span>
                    {' '}(~${maxDepositUsd6 ? Number(formatUnits(maxDepositUsd6, 6)).toFixed(2) : 'N/A'})
                    
                  </div>
                ) : (
                  <div>Max deposit: N/A</div>
                )}
              </div>
              <div style={{ height: 12 }} />
              {needsApproval ? (
                <div className="w-full sm:w-auto flex gap-3">
                  <button 
                    onClick={handleApprove}
                    disabled={!depositAmount || isLoading}
                    className="flex-1 px-6 py-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.amber.500)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Processing...' : 'Approve xcDOT'}
                  </button>
                  <button
                    onClick={handleApproveMax}
                    disabled={isLoading}
                    className="px-4 py-3 rounded-full bg-slate-700/60 border border-slate-600 text-slate-200 font-medium hover:bg-slate-700 disabled:opacity-50"
                  >
                    {isLoading ? 'Processing...' : 'Approve Max'}
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleDeposit}
                  disabled={!depositAmount || isLoading}
                  className="w-full sm:w-auto px-8 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Processing...' : 'Deposit xcDOT'}
                </button>
              )}
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Deposits are automatically returned to your wallet at term end
            </p>
          </div>
        </div>
      </div>
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div className="flex justify-between items-center p-6">
            <h3 className="text-lg font-semibold text-slate-200">Your Deposit Receipts</h3>
            <button 
              onClick={fetchReceipts}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={`text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ width: '100%' }}>
              <thead className="border-b-2 border-sky-700/40">
                <tr className="text-sm text-slate-400">
                  <th className="p-4"><Hash size={14} className="inline-block mr-1"/>ID</th>
                  <th className="p-4"><Package size={14} className="inline-block mr-1"/>Asset</th>
                  <th className="p-4"><ArrowDown size={14} className="inline-block mr-1"/>Principal</th>
                  <th className="p-4"><DollarSign size={14} className="inline-block mr-1"/>Entry Value</th>
                  <th className="p-4"><Clock size={14} className="inline-block mr-1"/>Unlock Date</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {isRefreshing ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">Loading receipts...</td></tr>
                ) : deposits.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">You have no deposits.</td></tr>
                ) : (
                  deposits.map((receipt) => (
                    <tr key={receipt.id} className="text-sm text-slate-400">
                      <td className="p-4 font-mono text-amber-300">#{receipt.id}</td>
                      <td className="p-4 font-bold">{receipt.asset}</td>
                      <td className="p-4 font-mono text-amber-300">
                        {Number(formatUnits(receipt.principalAmount, assetDecimals)).toFixed(2)}
                      </td>
                      <td className="p-4 font-mono text-slate-300">${receipt.entryValueUsd.toFixed(2)}</td>
                      
                      <td className="p-4">{receipt.unlockDate.toLocaleDateString()}</td>
                      <td className="p-4">
                        {receipt.status === 'LOCKED' && (
                          <span className="flex items-center gap-2 text-orange-400"><Lock size={14}/> Locked</span>
                        )}
                        {receipt.status === 'PENDING_RETURN' && (
                          <span className="flex items-center gap-2 text-yellow-400"><Unlock size={14}/> Pending Return</span>
                        )}
                        {receipt.status === 'RETURNED' && (
                          <span className="flex items-center gap-2 text-emerald-400"><Unlock size={14}/> Returned</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Auto-return info message */}
          {deposits.some(r => r.status === 'PENDING_RETURN') && (
            <div className="p-4 bg-yellow-900/30 border-t border-yellow-700 text-yellow-200 text-sm">
              Some of your deposits have matured and are pending auto-return. Your principal will be automatically sent to your wallet soon.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
