import { useState, useEffect } from 'react';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Chain, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, ArrowDown, Lock, Unlock, Hash, DollarSign, Package, RefreshCw } from 'lucide-react';
import VaultABI from '../../lib/abis/Vault.json';
import MockDOTABI from '../../lib/abis/MockDOT.json';
import { CONTRACTS } from '../../lib/contracts';
import MockOracleABI from '../../lib/abis/MockOracle.json';
import { version } from 'viem/package.json';
console.warn('viem version (frontend):', version);

// Helper to cast ABI
function asAbi(abi: unknown): Abi[] {
  return abi as Abi[];
}

const VAULT_ABI = VaultABI as Abi[];
const MOCK_ORACLE_ABI = MockOracleABI as Abi[];

const VAULT_ADDRESS = CONTRACTS.VAULT;
const MOCK_DOT_ADDRESS = CONTRACTS.MOCK_DOT;
const TREASURY_ADDRESS = CONTRACTS.TREASURY;
const MOCK_ORACLE_ADDRESS = CONTRACTS.MOCK_ORACLE;

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

export default function UserTab() {
  const [depositAmount, setDepositAmount] = useState('');
  const [deposits, setDeposits] = useState<DepositReceipt[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dotBalance, setDotBalance] = useState<bigint>(BigInt(0));
  const [receiptCount, setReceiptCount] = useState<bigint>(BigInt(0));
  const [allowance, setAllowance] = useState<bigint>(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(10);
  const [assetDecimals, setAssetDecimals] = useState<number>(18); // default to 18 for mDOT

  const address = account.address;

  // Fetch balances and data
  const fetchData = async () => {
    try {
      // Verify contract is deployed and ABI-compatible
      const code = await publicClient.getBytecode({ address: VAULT_ADDRESS });
      if (!code || code === '0x') {
        setContractError('No contract found at VAULT_ADDRESS. Update CONTRACTS.VAULT to your deployed Vault address.');
        return;
      }
      // Quick ABI compatibility probe
      try {
        await publicClient.readContract({
          address: VAULT_ADDRESS,
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
          address: MOCK_DOT_ADDRESS,
          abi: MockDOTABI,
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
        address: MOCK_DOT_ADDRESS,
        abi: MockDOTABI,
        functionName: 'balanceOf',
        args: [address], 
      }) as bigint;
      setDotBalance(balance);

      // Read receipt count (ABI: function receiptCount(address user) external view returns (uint256))
      const count = await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'receiptCount',
        args: [address],
      }) as bigint;
      setReceiptCount(count);

      // Read allowance
      const allow = await publicClient.readContract({
        address: MOCK_DOT_ADDRESS,
        abi: MockDOTABI,
        functionName: 'allowance',
        args: [address, VAULT_ADDRESS],
      }) as bigint;
      setAllowance(allow);
    } catch (error: any) {
      // If selector not recognized, surface actionable hint
      if (String(error?.message || '').includes('function selector was not recognized')) {
        setContractError('Deployed Vault at VAULT_ADDRESS does not expose receiptCount. Redeploy Vault and update CONTRACTS.VAULT.');
        return;
      }
      console.error('Error fetching data:', error);
    }
  };

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
          address: VAULT_ADDRESS,
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
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [address]); // Add address dependency

  useEffect(() => {
    fetchReceipts();
  }, [receiptCount, address]); // Add dependencies to prevent stale closure

  const handleMintDOT = async () => {
    try {
      setIsLoading(true);
      const hash = await walletClient.writeContract({
        account: account,
        address: MOCK_DOT_ADDRESS,
        abi: MockDOTABI,
        functionName: 'mint',
        args: [address, parseUnits('1000', tokenDecimals)],
        chain: LOCALHOST_CHAIN,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      alert('Minted 1000 mDOT successfully!');
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
        address: MOCK_DOT_ADDRESS,
        abi: MockDOTABI,
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
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [assetArg, amountArg],
        chain: LOCALHOST_CHAIN,
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchData();
      setDepositAmount('');
      alert('Deposit successful!');
    } catch (error) {
      console.error('Error depositing:', error);
      alert('Failed to deposit');
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
      {contractError && (
        <div className="p-3 rounded-lg bg-amber-900/30 border border-amber-700 text-amber-200 text-sm">
          {contractError}
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          User Vault
        </h2>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          <button 
            onClick={handleMintDOT}
            disabled={isLoading}
            className="px-4 py-2 rounded-full bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/50 text-violet-300 transition-all disabled:opacity-50"
          >
            Mint 1000 mDOT
          </button>
          <span>Balance: {Number(formatUnits(dotBalance, tokenDecimals)).toFixed(2)} mDOT</span>
          <span className="text-xs">({address.slice(0, 6)}...{address.slice(-4)})</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Total Principal Locked" value={`$${totalPrincipalLocked.toFixed(2)}`} hint="USD" tone="neutral" />
        <MetricCard title="Active Deposits" value={lockedDeposits.length.toString()} hint="Receipts" tone="neutral" />
        <MetricCard title="Next Unlock" value={nextUnlockDate ? nextUnlockDate.toLocaleDateString() : 'N/A'} hint="Date" tone="neutral" />
      </MetricGrid>

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
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">mDOT</span>
          </div>
          {needsApproval ? (
            <button 
              onClick={handleApprove}
              disabled={!depositAmount || isLoading}
              className="w-full sm:w-auto px-8 py-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.amber.500)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Approve mDOT'}
            </button>
          ) : (
            <button 
              onClick={handleDeposit}
              disabled={!depositAmount || isLoading}
              className="w-full sm:w-auto px-8 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Deposit mDOT'}
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Deposits are automatically returned to your wallet at term end
        </p>
      </div>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg border border-slate-700/50 overflow-hidden">
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
          <table className="w-full text-left">
            <thead className="border-b-2 border-sky-700/40">
              <tr className="text-sm text-slate-400">
                <th className="p-4"><Hash size={14} className="inline-block mr-1"/>ID</th>
                <th className="p-4"><Package size={14} className="inline-block mr-1"/>Asset</th>
                <th className="p-4"><ArrowDown size={14} className="inline-block mr-1"/>Principal</th>
                <th className="p-4"><DollarSign size={14} className="inline-block mr-1"/>Entry Value</th>
                <th className="p-4">Shares (18d)</th>
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
                  <tr key={receipt.id} className="hover:bg-slate-800/40 transition-colors duration-300 border-t border-slate-800">
                    <td className="p-4 font-mono text-sky-400">#{receipt.id}</td>
                    <td className="p-4 font-bold">{receipt.asset}</td>
                    <td className="p-4 font-mono text-amber-300">
                      {Number(formatUnits(receipt.principalAmount, assetDecimals)).toFixed(4)}
                    </td>
                    <td className="p-4 font-mono text-slate-300">${receipt.entryValueUsd.toFixed(2)}</td>
                    <td className="p-4 font-mono text-slate-300">
                      {Number(formatUnits(receipt.shares, 18)).toFixed(4)}
                    </td>
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
  );
}
