import React, { useEffect, useState } from 'react';
import MetricCard from '../ui/MetricCard';
import { ClockIcon as Clock } from '../icons/SagittaIcons';

// AAA + PortfolioRegistry types
type AAAAssetWeight = { symbol: string; weight: number; expectedReturn?: number; volatility?: number; };
type AAAAllocation = { source: 'aaa' | 'fallback'; timestamp: string; batchId?: string; assets: AAAAssetWeight[]; };
type StoredAAAAllocation = {
  batchId: string;
  source: 'aaa' | 'fallback';
  timestamp: string;
  principalReceivedUsd?: number;
  eligibleAssetCount?: number;
  excludedAssetCount?: number;
  excludedAssets?: Array<{ symbol: string; name?: string; reasons: string[]; stage?: string }>;
  assets: Array<{
    symbol: string;
    assetName?: string;
    riskClass?: number | null;
    role?: number | null;
    weight: number;
    principalAllocatedUsd: number;
    expectedCloseAt?: string;
    routeTypes?: string[];
    routeIds?: string[];
  }>;
};
type PortfolioRegistryAsset = {
  symbol: string;
  name: string;
  token: string;
  riskClass: number;
  role: number;
  minimumInvestmentUsd6: bigint;
};
type ExecutionRouteView = {
  routeId: number;
  assetSymbol: string;
  routeType: number;
  documentsComplete: boolean;
  sagittaFundApproved: boolean;
  ndaSigned: boolean;
  pnlEndpoint: string;
  manualMarksRequired: boolean;
  active: boolean;
};
type AllocationExclusion = {
  symbol: string;
  name: string;
  reasons: string[];
};
type AAADisplayLeg = {
  batchId: string;
  symbol: string;
  assetName: string;
  riskClassLabel: string;
  roleLabel: string;
  weightPct: string;
  principalUsd6: bigint;
  expectedCloseAt: string;
  source: 'aaa' | 'fallback';
  routeSummary: string;
};
type BackendExecutionOrder = {
  id: string;
  batchId: string;
  sourceType?: string;
  originInstitutionId?: string;
  principalReceivedUsd: number;
  durationClass: string;
  productDuration?: string;
  executionHorizon?: string;
  targetReturnAt: string;
  hardCloseAt: string;
  policyProfileId: string;
  policyVersion?: number;
  aaaRequestStatus?: string;
  deploymentStatus?: string;
  settlementStatus?: string;
  strategyClass: string;
  executionStatus: string;
  routeStatus: string;
  eligibleRouteTypes: string[];
  createdAt?: string;
  updatedAt?: string;
};
type BackendAllocationLeg = {
  legId: string;
  batchId: string;
  routeType: string;
  routeId?: string;
  adapterId?: string;
  portfolio?: string;
  principalAllocatedUsd: number;
  expectedCloseAt: string;
  hardCloseAt: string;
  deployedAt?: string;
  returnedAt?: string;
  returnedAmountUsd?: number;
  status: string;
};
type BackendAllocationPlan = {
  planId: string;
  batchId: string;
  aaaDecisionId: string;
  allocatorVersion: string;
  regime: string;
  policyProfileId?: string;
  policyVersion?: number;
  marketContextSnapshot?: Record<string, unknown>;
  performanceContextSnapshot?: Record<string, unknown>;
  universeSnapshot?: {
    summary?: { eligibleCandidates?: number; excludedCandidates?: number };
    excludedUniverse?: Array<{ assetSymbol: string; reasons: string[] }>;
  };
  decisionContext?: Record<string, unknown>;
  planPayload?: Record<string, unknown>;
  allocationResult?: StoredAAAAllocation;
  validationResult?: { valid?: boolean; errors?: string[] };
  status: string;
};

const RISK_CLASS_LABELS = ['Wealth Management','Stablecoin','DeFi Bluechip','Fund of Funds','Large Cap','Private Credit Fund','Real World Asset','External Protocol'];
const ASSET_ROLE_LABELS = ['Core','Liquidity','Satellite','Defensive','Speculative','Yield Fund','External'];
const PORTFOLIO_REGISTRY_ABI = [
  'function getAllAssets() external view returns (tuple(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6, uint256 addedAt)[])',
];
const EXECUTION_ROUTE_REGISTRY_ABI = [
  'function getAllRoutes() external view returns (tuple(uint256 routeId, string assetSymbol, uint8 routeType, bytes32 counterpartyRefHash, bytes32 jurisdictionRefHash, bytes32 custodyRefHash, bool documentsComplete, bool sagittaFundApproved, bool ndaSigned, string pnlEndpoint, bool manualMarksRequired, bool active)[])',
];
const AAA_ENDPOINT = 'https://aaa.sagitta.systems/api/v1/allocation';

// NEW imports for on-chain interactions
import { JsonRpcProvider, Contract, Wallet, Interface, ethers } from 'ethers';
import INVESTMENT_ESCROW_ABI from '../../lib/abis/InvestmentEscrow.json';
import TREASURY_ABI from '../../lib/abis/Treasury.json';
import { getRuntimeAddress, isValidAddress, setRuntimeAddress, useRuntimeAddress } from '../../lib/runtime-addresses';
import { emitUiRefresh } from '../../lib/ui-refresh';
import useRoleAccess from '../../hooks/useRoleAccess';
import useProtocolPause from '../../hooks/useProtocolPause';
import PageHeader from '../ui/PageHeader';
import { RPC_URL } from '../../lib/network';

async function readJsonResponse(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return { error: raw || `HTTP ${response.status}` };
  }
}

export default function EscrowTab() {
  const { isPaused } = useProtocolPause();
  const { isOperator, role } = useRoleAccess();
  const portfolioRegistryAddress = useRuntimeAddress('PortfolioRegistry');
  const executionRouteRegistryAddress = useRuntimeAddress('ExecutionRouteRegistry');
  // On-chain constants
  const LOCALHOST_RPC = RPC_URL;
  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const [provider, setProvider] = useState<JsonRpcProvider | null>(null);
  const [escrow, setEscrow] = useState<Contract | null>(null);
  const [signer, setSigner] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // Form state: close batch
  const [closeBatchId, setCloseBatchId] = useState<string>('');
  const [closeFinalNav, setCloseFinalNav] = useState<string>('1.00'); // decimal e.g. 1.05 = +5%

  // Batch summary
  const [currentPendingId, setCurrentPendingId] = useState<number | null>(null);
  const [pendingTotalUsd, setPendingTotalUsd] = useState<number | null>(null);

  const [newBatchId, setNewBatchId] = useState<number | null>(null);
  const [rollTargetId, setRollTargetId] = useState<string>(''); // input for roll specific batch

  // NEW: batches state
  const [activeBatches, setActiveBatches] = useState<any[]>([]);
  const [pendingBatches, setPendingBatches] = useState<any[]>([]);
  const [investedBatches, setInvestedBatches] = useState<any[]>([]); // status 4
  const [closedBatches, setClosedBatches] = useState<Array<{ batch: any; result: any }>>([]);
  const [allBatchesDebug, setAllBatchesDebug] = useState<Array<{ id:number; ok:boolean; batch:any; error?:string }>>([]);
  const [dumpLimit, setDumpLimit] = useState<number>(40);

  // Escrow runtime config + linking controls
  const [escrowAddr, setEscrowAddr] = useState<string>(() => getRuntimeAddress('InvestmentEscrow'));
  const [escrowAddrInput, setEscrowAddrInput] = useState<string>(escrowAddr);
  const [vaultLinkInput, setVaultLinkInput] = useState<string>(() => getRuntimeAddress('Vault'));
  const [keeperInput, setKeeperInput] = useState<string>(() => getRuntimeAddress('Treasury'));
  const [linkedVaultAddress, setLinkedVaultAddress] = useState<string | null>(null);
  const [linkedKeeperAddress, setLinkedKeeperAddress] = useState<string | null>(null);
  const [linkConfigLoading, setLinkConfigLoading] = useState(false);
  const [linkConfigStatus, setLinkConfigStatus] = useState<string | null>(null);

  // NEW: EscrowTab state for batch operations
  const [escrowUsdc, setEscrowUsdc] = useState<number>(0);
  const [batchIdInput, setBatchIdInput] = useState('');
  const [navInput, setNavInput] = useState('1.10');
  const [batchFilter, setBatchFilter] = useState('');
  const [batchPageSize, setBatchPageSize] = useState<number>(6);
  const [orderPage, setOrderPage] = useState<number>(1);
  const [deploymentHistoryPage, setDeploymentHistoryPage] = useState<number>(1);
  const [expandedDeploymentBatches, setExpandedDeploymentBatches] = useState<string[]>([]);
  const [selectedAllocationBatchId, setSelectedAllocationBatchId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<number>(1);
  const [investedPage, setInvestedPage] = useState<number>(1);
  const [closedPage, setClosedPage] = useState<number>(1);

  // AAA allocation state
  const [aaaAllocation, setAaaAllocation] = useState<StoredAAAAllocation | null>(null);
  const [aaaLoading, setAaaLoading] = useState(false);
  const [aaaError, setAaaError] = useState<string | null>(null);
  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioRegistryAsset[]>([]);
  const [executionRoutes, setExecutionRoutes] = useState<ExecutionRouteView[]>([]);
  const [backendExecutionOrders, setBackendExecutionOrders] = useState<BackendExecutionOrder[]>([]);
  const [backendAllocationLegs, setBackendAllocationLegs] = useState<BackendAllocationLeg[]>([]);
  const [backendAllocationPlans, setBackendAllocationPlans] = useState<BackendAllocationPlan[]>([]);
  const [backendQueueError, setBackendQueueError] = useState<string | null>(null);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [manualStageAction, setManualStageAction] = useState<'returned' | 'settled' | null>(null);

  // Keep address states in sync whenever loadGeneratedRuntimeAddresses() or setRuntimeAddress() fires.
  useEffect(() => {
    const sync = () => {
      setEscrowAddr(getRuntimeAddress('InvestmentEscrow'));
      setVaultLinkInput(getRuntimeAddress('Vault'));
      setKeeperInput(getRuntimeAddress('Treasury'));
    };
    window.addEventListener('sagitta:addresses-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sagitta:addresses-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    const rp = new JsonRpcProvider(LOCALHOST_RPC);
    const w = new Wallet(TEST_PRIVATE_KEY, rp);
    setProvider(rp);
    setSigner(w);
  }, []);

  useEffect(() => {
    if (!provider) return;
    if (!isValidAddress(escrowAddr)) {
      setEscrow(null);
      setLinkedVaultAddress(null);
      setLinkedKeeperAddress(null);
      return;
    }
    const c = new Contract(escrowAddr, INVESTMENT_ESCROW_ABI, provider);
    setEscrow(c);
  }, [provider, escrowAddr]);

  useEffect(() => {
    setEscrowAddrInput(escrowAddr);
  }, [escrowAddr]);

  // React to new blocks so UI reflects simulation actions immediately
  useEffect(() => {
    if (!provider) return;
    const onBlock = async (_blockNumber: number) => {
      // lightweight refresh when a new block is mined
      try {
        await Promise.allSettled([refreshBatchSummary(), refresh()]);
      } catch (_) {}
    };
    provider.on('block', onBlock);
    return () => { provider.off('block', onBlock); };
  }, [provider]);

  useEffect(() => {
    if (!escrow) return;
    refreshEscrowLinks();
  }, [escrow]);

  async function refreshEscrowLinks() {
    if (!escrow) return;
    try {
      const [vaultAddr, keeperAddr] = await Promise.all([
        (escrow as any).vault?.().catch(() => null),
        (escrow as any).keeper?.().catch(() => null),
      ]);
      if (typeof vaultAddr === 'string' && vaultAddr !== '0x0000000000000000000000000000000000000000') {
        setLinkedVaultAddress(vaultAddr);
        setVaultLinkInput(vaultAddr);
      } else {
        setLinkedVaultAddress(null);
      }

      if (typeof keeperAddr === 'string' && keeperAddr !== '0x0000000000000000000000000000000000000000') {
        setLinkedKeeperAddress(keeperAddr);
        setKeeperInput(keeperAddr);
      } else {
        setLinkedKeeperAddress(null);
      }
    } catch {
      // ignore read failures
    }
  }

  async function postWriteRefresh(reason: string) {
    await Promise.allSettled([refresh(), refreshBatchSummary(), refreshEscrowLinks(), refreshBackendExecutionQueue(), fetchPortfolioAssets(), fetchExecutionRoutes()]);
    emitUiRefresh(`escrow:${reason}`);
  }

  function handleUseEscrowAddress() {
    const next = escrowAddrInput.trim();
    if (!setRuntimeAddress('InvestmentEscrow', next)) {
      setLinkConfigStatus('Invalid Escrow address');
      return;
    }
    setEscrowAddr(next);
    setLinkConfigStatus(`Using Escrow ${next}`);
  }

  async function handleSetEscrowVaultLink() {
    if (!signer || !isValidAddress(escrowAddr) || !isValidAddress(vaultLinkInput.trim())) {
      setLinkConfigStatus('Invalid Escrow or Vault address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const nextVault = vaultLinkInput.trim();
      const escrowWrite = new Contract(
        escrowAddr,
        ['function setVault(address _vault) external'],
        signer
      );
      const tx = await escrowWrite.setVault(nextVault);
      await tx.wait();
      setRuntimeAddress('Vault', nextVault);
      setLinkedVaultAddress(nextVault);
      setLinkConfigStatus('Escrow -> Vault linked');
      await postWriteRefresh('link-vault');
    } catch (e: any) {
      setLinkConfigStatus(`Vault link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  async function handleSetEscrowKeeper() {
    if (!signer || !isValidAddress(escrowAddr) || !isValidAddress(keeperInput.trim())) {
      setLinkConfigStatus('Invalid Escrow or Keeper address');
      return;
    }
    try {
      setLinkConfigLoading(true);
      const nextKeeper = keeperInput.trim();
      const escrowWrite = new Contract(
        escrowAddr,
        ['function setKeeper(address _keeper) external'],
        signer
      );
      const tx = await escrowWrite.setKeeper(nextKeeper);
      await tx.wait();
      setLinkedKeeperAddress(nextKeeper);
      setLinkConfigStatus('Escrow keeper updated');
      await postWriteRefresh('set-keeper');
    } catch (e: any) {
      setLinkConfigStatus(`Keeper update failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  function toBigIntSafe(v: any): bigint {
    try {
      return BigInt(v?.toString?.() ?? String(v ?? '0'));
    } catch {
      return 0n;
    }
  }

  function deriveClosedResultFromBatch(batch: any) {
    const principalUsd = toBigIntSafe(batch?.totalCollateralUsd);
    const finalNavPerShare = toBigIntSafe(batch?.finalNavPerShare);
    if (principalUsd <= 0n || finalNavPerShare <= 0n) return null;

    const finalValueUsd = (principalUsd * finalNavPerShare) / 1000000000000000000n; // 1e18
    const profitUsd = finalValueUsd > principalUsd ? finalValueUsd - principalUsd : 0n;
    const userProfitUsd = (profitUsd * 80n) / 100n;
    const feeUsd = profitUsd - userProfitUsd;

    return {
      principalUsd: principalUsd.toString(),
      finalNavPerShare: finalNavPerShare.toString(),
      finalValueUsd: finalValueUsd.toString(),
      profitUsd: profitUsd.toString(),
      userProfitUsd: userProfitUsd.toString(),
      feeUsd: feeUsd.toString(),
      _derived: true,
    };
  }

  async function resolveClosedBatchResult(batch: any) {
    const id = Number(batch?.id ?? 0);
    if (!escrow || !Number.isFinite(id) || id <= 0) {
      return deriveClosedResultFromBatch(batch);
    }

    try {
      const anyEscrow: any = escrow;
      if (typeof anyEscrow.getClosedBatchResult === 'function') {
        const res = await anyEscrow.getClosedBatchResult(id);
        if (res) return res;
      }
    } catch {
      // fall through to deterministic derivation
    }

    return deriveClosedResultFromBatch(batch);
  }

  async function refreshBatchSummary() {
    if (!escrow || !provider) return;
    try {
      // currentBatchId public variable exists
      const cur = await escrow.currentBatchId();
      const curNum = Number(cur);
      setCurrentPendingId(curNum);

      // read the batch struct for the pending batch if exists
      let batch: any = null;
      try {
        // Try the normal contract call first
        batch = await escrow.getBatch(curNum);
      } catch (err) {
        // Fallback: low-level call + try multiple decode shapes to tolerate ABI mismatches
        try {
          const data = escrow.interface.encodeFunctionData('getBatch', [BigInt(curNum)]);
          const raw = await provider.call({ to: escrow.target, data });
          if (!raw || raw === '0x' || /^0x0+$/.test(raw)) {
            // empty / all-zero response -> treat as missing batch
            batch = null;
          } else {
            // Use a dynamic Interface decode to avoid importing `utils`.
            // Build a temporary function fragment with the requested return types
            // and use Interface.decodeFunctionResult to decode the raw return bytes.
            const tryDecode = (types: string[]) => {
              try {
                const fragment = `function f() view returns (${types.join(',')})`;
                const TempIface = new Interface([fragment]);
                return TempIface.decodeFunctionResult('f', raw);
              } catch {
                return null;
              }
            };

            // Candidate shapes (most likely -> fallback)
            let dec: any = tryDecode(['uint256','uint256','uint256','uint256','uint256','uint256','uint8','bool']);
            if (!dec) dec = tryDecode(['uint256','uint256','uint256','uint256','uint256','uint256','uint256','bool']);
            if (!dec) dec = tryDecode(['uint256','uint256','uint256','uint256','uint256','uint256','uint8']);
            if (!dec) dec = tryDecode(['uint256','uint256','uint256','uint256','uint256','uint256']);

            if (dec) {
              const id = Number(dec[0].toString());
              const startTime = Number(dec[1].toString());
              const endTime = Number(dec[2].toString());
              const totalCollateralUsd = dec[3] ? dec[3].toString() : '0';
              const totalShares = dec[4] ? dec[4].toString() : '0';
              const finalNavPerShare = dec[5] ? dec[5].toString() : '0';
              const status = dec.length >= 7 ? Number(dec[6].toString()) : 0;
              const distributed = dec.length >= 8 ? Boolean(dec[7]) : false;
              batch = {
                id,
                startTime,
                endTime,
                totalCollateralUsd,
                totalShares,
                finalNavPerShare,
                status,
                distributed
              };
            } else {
              batch = null;
            }
          }
        } catch {
          batch = null;
        }
      }

      // batch.totalCollateralUsd stored as uint256 (USD6) - normalize safely
      try {
        const t = batch && (batch.totalCollateralUsd ?? batch.totalCollateralUsd?.toString?.());
        setPendingTotalUsd(t ? Number(t) : 0);
      } catch {
        setPendingTotalUsd(0);
      }

      // NEW: fetch running and closed batches
      try {
        // Safe wrapper: call getBatchesByStatus only if present on the contract,
        // return [] on any error so UI falls back to dump/probe logic.
        const getByStatus = async (s: number) => {
          try {
            const anyEscrow: any = escrow;
            if (typeof anyEscrow.getBatchesByStatus !== 'function') return [];
            return await anyEscrow.getBatchesByStatus(s);
          } catch {
            return [];
          }
        };

        // 0 = Pending, 1 = Running, 2 = Closed (enum BatchStatus)
        const [pending, running, closed, invested] = await Promise.all([
          getByStatus(0),
          getByStatus(1),
          getByStatus(2),
          getByStatus(4)
        ]);

        // If returned arrays are empty (contract missing function or ABI mismatch),
        // fallback to a full probe using dumpBatches to reconstruct lists.
        const totalFromStatusCalls = (Array.isArray(pending) ? pending.length : 0)
          + (Array.isArray(running) ? running.length : 0)
          + (Array.isArray(closed) ? closed.length : 0)
          + (Array.isArray(invested) ? invested.length : 0);

        if (totalFromStatusCalls === 0) {
          // probe a reasonable range: at least dumpLimit or currentPendingId + 5
          const probeLimit = Math.max(dumpLimit, (curNum ?? 0) + 5);
          const probe = await dumpBatches(probeLimit);
          const pList: any[] = [];
          const rList: any[] = [];
          const cList: any[] = [];
          const iList: any[] = [];
          for (const entry of probe) {
            //console.log('Probed batch:', entry.batch);
            if (!entry.ok || !entry.batch) continue;
            
            const s = Number(entry.batch.status ?? 0);
            if (s === 0) pList.push(entry.batch);
            else if (s === 1) rList.push(entry.batch);
            else if (s === 2) cList.push(entry.batch);
            else if (s === 4) iList.push(entry.batch);
          }
          // Normalize + dedupe probe results
          //setPendingBatches(normalizeBatches(pList));
          setActiveBatches(normalizeBatches(rList));
          setInvestedBatches(normalizeBatches(iList));
          // rebuild closedWithResults from cList
          const closedWithResults: Array<{ batch: any; result: any }> = [];
          for (const b of cList) {
            const res = await resolveClosedBatchResult(b);
            closedWithResults.push({ batch: b, result: res });
          }
          setClosedBatches(closedWithResults);
        } else {
          // Normal path when getBatchesByStatus returned usable arrays
          // Normalize + dedupe status-call results
          setPendingBatches(normalizeBatches(pending));
          setActiveBatches(normalizeBatches(running));
          setInvestedBatches(normalizeBatches(invested));
          // for closed batches fetch result details
          const closedWithResults: Array<{ batch: any; result: any }> = [];
          for (const b of closed || []) {
            const res = await resolveClosedBatchResult(b);
            closedWithResults.push({ batch: b, result: res });
          }
          setClosedBatches(closedWithResults);
        }
      } catch {
        // ignore if contract doesn't expose enumeration
        setActiveBatches([]);
        setInvestedBatches([]);
        setPendingBatches([]);
        setClosedBatches([]);
        console.log('Escrow contract does not support getBatchesByStatus enumeration');
      }

      // FALLBACK: if enumeration returned nothing but we have a previous dump (allBatchesDebug),
      // use it to populate active/pending/closed so the UI reflects the dumped state.
      if ((activeBatches.length === 0 && pendingBatches.length === 0 && investedBatches.length === 0) && allBatchesDebug.length > 0) {
        const pList: any[] = [];
        const rList: any[] = [];
        const cList: any[] = [];
        const iList: any[] = [];

        console.log('FALLBACK: reconstructing batches from allBatchesDebug');
        for (const entry of allBatchesDebug) {
          if (!entry.ok || !entry.batch) continue;
          const s = Number(entry.batch.status ?? 0);
          if (s === 0) pList.push(entry.batch);
          else if (s === 1) rList.push(entry.batch);
          else if (s === 2) cList.push(entry.batch);
          else if (s === 4) iList.push(entry.batch);
        }
        setPendingBatches(normalizeBatches(pList));
        setActiveBatches(normalizeBatches(rList));
        setInvestedBatches(normalizeBatches(iList));
        const closedWithResults: Array<{ batch: any; result: any }> = [];
        for (const b of cList) {
          const res = await resolveClosedBatchResult(b);
          closedWithResults.push({ batch: b, result: res });
        }
        setClosedBatches(closedWithResults);
      }

    } catch (e: any) {
      setLog(l => [`[refresh] ${String(e?.message || e)}`, ...l]);
    }
  }

  function fmtUsd6(raw: any) {
    try {
      // raw may be BigNumber or numeric string
      const s = raw?.toString?.() ?? String(raw ?? '0');
      // use ethers utils to format with 6 decimals
      return `$${(Number(s) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } catch {
      return '$0.00';
    }
  }

  async function refreshBackendExecutionQueue() {
    try {
      const [ordersRes, legsRes, plansRes] = await Promise.all([
        fetch('/api/banking/escrow/execution-orders'),
        fetch('/api/banking/escrow/allocation-legs'),
        fetch('/api/banking/escrow/allocation-plans'),
      ]);
      const [ordersJson, legsJson, plansJson] = await Promise.all([
        readJsonResponse(ordersRes),
        readJsonResponse(legsRes),
        readJsonResponse(plansRes),
      ]);
      if (!ordersRes.ok) throw new Error(ordersJson?.error || `orders HTTP ${ordersRes.status}`);
      if (!legsRes.ok) throw new Error(legsJson?.error || `legs HTTP ${legsRes.status}`);
      if (!plansRes.ok) throw new Error(plansJson?.error || `plans HTTP ${plansRes.status}`);
      const nextOrders = ordersJson?.data ?? ordersJson ?? [];
      const nextLegs = legsJson?.data ?? legsJson ?? [];
      const nextPlans = plansJson?.data ?? plansJson ?? [];
      setBackendExecutionOrders(nextOrders);
      setBackendAllocationLegs(nextLegs);
      setBackendAllocationPlans(nextPlans);
      setBackendQueueError(null);
    } catch (e: any) {
      setBackendQueueError(String(e?.message || e));
    }
  }

  async function runBackendAutomation() {
    setAutomationRunning(true);
    try {
      const response = await fetch('/api/banking/escrow/run-automation', { method: 'POST' });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload?.error || `automation HTTP ${response.status}`);
      setLog(l => [`[escrow worker] ${JSON.stringify(payload?.data ?? payload)}`, ...l]);
      await refreshBackendExecutionQueue();
    } catch (e: any) {
      setBackendQueueError(String(e?.message || e));
    } finally {
      setAutomationRunning(false);
    }
  }

  async function manuallyAdvanceSelectedBatch(stage: 'returned' | 'settled') {
    if (!selectedAllocationOrder?.batchId) return;
    setManualStageAction(stage);
    try {
      const path = stage === 'returned'
        ? `/api/banking/escrow/execution-orders/${selectedAllocationOrder.batchId}/advance-return`
        : `/api/banking/escrow/execution-orders/${selectedAllocationOrder.batchId}/advance-settlement`;
      const response = await fetch(path, { method: 'POST' });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload?.error || `advance ${stage} HTTP ${response.status}`);
      setLog((items) => [`[escrow ${stage}] batch ${selectedAllocationOrder.batchId}`, ...items]);
      await Promise.allSettled([refreshBackendExecutionQueue(), refreshBatchSummary(), refresh()]);
    } catch (e: any) {
      setBackendQueueError(String(e?.message || e));
    } finally {
      setManualStageAction(null);
    }
  }

  useEffect(() => {
    // initial load (no periodic timer)
    refreshBatchSummary();
    refreshBackendExecutionQueue();
    // no interval â€” avoid noisy periodic refreshes/log spam
    return;
  }, [escrow]);

  // Debug helper: probe and collect batches 1..limit (best-effort, tolerant to ABI mismatch)
  async function dumpBatches(limit = 40) {
    if (!provider || !escrow) {
      // provider or escrow not ready â€” silently return (no dump log)
      return;
    }
    setLoading(true);
    const out: Array<{ id:number; ok:boolean; batch:any; error?:string }> = [];
    for (let id = 1; id <= limit; id++) {
      try {
        let b: any = null;
        try {
          // prefer normal call
          b = await escrow.getBatch(id);
        } catch {
          // fallback low-level call + decode shapes (reuse decode pattern)
          try {
            const data = escrow.interface.encodeFunctionData('getBatch', [BigInt(id)]);
            const raw = await provider.call({ to: (escrow as any).target ?? (escrow as any).address, data });
            if (!raw || raw === '0x' || /^0x0+$/.test(raw)) {
              b = null;
            } else {
              const tryDecodeLocal = (types: string[]) => {
                try {
                  const fragment = `function f() view returns (${types.join(',')})`;
                  const TempIface = new Interface([fragment]);
                  return TempIface.decodeFunctionResult('f', raw);
                } catch {
                  return null;
                }
              };
              let dec: any = tryDecodeLocal(['uint256','uint256','uint256','uint256','uint256','uint256','uint8','bool']);
              if (!dec) dec = tryDecodeLocal(['uint256','uint256','uint256','uint256','uint256','uint256','uint256','bool']);
              if (!dec) dec = tryDecodeLocal(['uint256','uint256','uint256','uint256','uint256','uint256','uint8']);
              if (!dec) dec = tryDecodeLocal(['uint256','uint256','uint256','uint256','uint256','uint256']);
              if (dec) {
                b = {
                  id: Number(dec[0].toString()),
                  startTime: Number(dec[1].toString()),
                  endTime: Number(dec[2].toString()),
                  totalCollateralUsd: dec[3]?.toString?.() ?? '0',
                  totalShares: dec[4]?.toString?.() ?? '0',
                  finalNavPerShare: dec[5]?.toString?.() ?? '0',
                  status: dec.length >= 7 ? Number(dec[6].toString()) : 0,
                  distributed: dec.length >= 8 ? Boolean(dec[7]) : false
                };
              } else {
                b = null;
              }
            }
          } catch (innerErr:any) {
            throw new Error('lowlevel decode failed: ' + String(innerErr?.message || innerErr));
          }
        }
        out.push({ id, ok: true, batch: b });
      } catch (err:any) {
        out.push({ id, ok: false, batch: null, error: String(err?.message || err) });
      }
    }
    setAllBatchesDebug(out);
    setLoading(false);
    // intentionally do NOT add a "[dump]" log entry to avoid log spam
    return out;
  }

  /** Preflight check before rolling a batch. Returns { ok, reason }. */
  async function canRollBatch(batchId: number): Promise<{ ok: boolean; reason: string }> {
    if (!escrow) return { ok: false, reason: 'escrow not ready' };
    try {
      const batch = await escrow.getBatch(batchId);
      const status = Number(batch.status ?? batch[6] ?? -1);
      // BatchStatus.Pending == 0
      if (status !== 0) return { ok: false, reason: `batch ${batchId} is not Pending (status=${status})` };
      const collateral = BigInt(batch.totalCollateralUsd?.toString?.() ?? batch[3]?.toString?.() ?? '0');
      if (collateral === 0n) return { ok: false, reason: `batch ${batchId} has no collateral` };
      return { ok: true, reason: '' };
    } catch {
      // If getBatch fails we can't confirm — allow the attempt and let the contract revert if needed
      return { ok: true, reason: '' };
    }
  }

  async function handleStartBatch() {
    if (isPaused) {
      setLog(l => ['[escrow] protocol is paused; batch actions are disabled', ...l]);
      return;
    }
    if (!isOperator) {
      setLog(l => ['[escrow] operator or owner role required to start batches', ...l]);
      return;
    }
    if (!escrow || !signer) return alert('Escrow contract or signer not ready');

    // read current pending id
    try {
      const cur = await escrow.currentBatchId();
      const curNum = Number(cur);
      const pre = await canRollBatch(curNum);
      if (!pre.ok) {
        setLog(l => [`[roll batch PRECHECK FAILED] ${pre.reason}`, ...l]);
        return alert(`Cannot roll: ${pre.reason}`);
      }
    } catch (err) {
      // fallback to existing time check if getBatch fails
    }

    setLoading(true);
    try {
      const escrowWithSigner = escrow.connect(signer) as any;

      // Try primary function first
      try {
        const tx = await escrowWithSigner.rollToNewBatch();
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] rollToNewBatch executed`, ...l]);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('function not found') || msg.includes('no such function') || msg.includes('does not exist')) {
          // Fallback to alternative function
          try {
            const tx = await escrowWithSigner.rollPendingBatch();
            await tx.wait();
            setLog(l => [`[${new Date().toLocaleTimeString()}] rollPendingBatch executed (fallback)`, ...l]);
          } catch (e2: any) {
            throw new Error(`Contract does not expose rollToNewBatch or rollPendingBatch: ${String(e2?.message || e2)}`);
          }
        } else {
          throw e;
        }
      }

      await postWriteRefresh('start-batch');
    } catch (e: any) {
      const msg = String(e?.message || e);
      setLog(l => [`[roll batch ERROR] ${msg}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCloseBatch() {
    if (!escrow || !signer) return alert('Escrow contract or signer not ready');
    if (!closeBatchId) return alert('Provide batchId to close');
    const batchIdNum = Number(closeBatchId);
    if (!Number.isFinite(batchIdNum) || batchIdNum <= 0) return alert('Invalid batchId');
    const navFloat = parseFloat(closeFinalNav);
    if (isNaN(navFloat) || navFloat <= 0) return alert('Invalid NAV value');
    const finalNavPerShareBn = BigInt(Math.round(navFloat * 1e18));
    setLoading(true);
    try {
      const escrowWithSigner = escrow.connect(signer) as any;

      if (typeof escrowWithSigner.closeBatch === 'function') {
        const tx = await escrowWithSigner.closeBatch(batchIdNum, finalNavPerShareBn);
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] closeBatch(${batchIdNum}, ${closeFinalNav}) executed`, ...l]);
      } else if (typeof escrowWithSigner.closePendingBatch === 'function') {
        const tx = await escrowWithSigner.closePendingBatch(batchIdNum, finalNavPerShareBn);
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] closePendingBatch(${batchIdNum}, ${closeFinalNav}) executed (fallback)`, ...l]);
      } else {
        throw new Error('Contract does not expose closeBatch or closePendingBatch');
      }

      await postWriteRefresh('close-batch');
    } catch (e: any) {
      setLog(l => [`[closeBatch ERROR] ${String(e?.message || e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBatch() {
    if (!escrow || !signer) return alert('Escrow contract or signer not ready');

    // NEW: prevent calling contract when current pending batch has no deposits
    if (!pendingTotalUsd || pendingTotalUsd === 0) {
      const msg = 'Cannot create pending batch: current pending batch has no deposits';
      setLog(l => [`[createPendingBatch SKIPPED] ${msg}`, ...l]);
      return alert(msg);
    }

    setLoading(true);
    try {
      const escrowWithSigner = escrow.connect(signer) as any;

      if (typeof escrowWithSigner.createPendingBatch === 'function') {
        const tx = await escrowWithSigner.createPendingBatch();
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] createPendingBatch executed`, ...l]);
      } else if (typeof escrowWithSigner.createBatch === 'function') {
        const tx = await escrowWithSigner.createBatch();
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] createBatch executed (fallback)`, ...l]);
      } else {
        throw new Error('Contract does not expose createPendingBatch or createBatch');
      }

      await postWriteRefresh('create-pending-batch');
    } catch (e: any) {
      setLog(l => [`[createPendingBatch ERROR] ${String(e?.message || e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRollSpecificBatch() {
    if (!escrow || !signer) return alert('Escrow contract or signer not ready');
    if (!rollTargetId) return alert('Provide batchId to roll');
    const batchIdNum = Number(rollTargetId);
    if (!Number.isFinite(batchIdNum) || batchIdNum <= 0) return alert('Invalid batchId');

    // Preflight check
    const pre = await canRollBatch(batchIdNum);
    if (!pre.ok) {
      setLog(l => [`[rollBatch PRECHECK FAILED] ${pre.reason}`, ...l]);
      return alert(`Cannot roll batch: ${pre.reason}`);
    }

    setLoading(true);
    try {
      const escrowWithSigner = escrow.connect(signer) as any;

      if (typeof (escrowWithSigner as any).rollBatch === 'function') {
        const tx = await (escrowWithSigner as any).rollBatch(batchIdNum);
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] rollBatch(${batchIdNum}) executed`, ...l]);
      } else if (typeof (escrowWithSigner as any).rollSpecificBatch === 'function') {
        const tx = await (escrowWithSigner as any).rollSpecificBatch(batchIdNum);
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] rollSpecificBatch(${batchIdNum}) executed (fallback)`, ...l]);
      } else {
        throw new Error('Contract does not expose rollBatch or rollSpecificBatch');
      }

      await postWriteRefresh('roll-specific-batch');
    } catch (e: any) {
      setLog(l => [`[rollBatch ERROR] ${String(e?.message || e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // NEW: refresh escrow balances and small status probe
  async function refresh() {
    if (!provider || !escrowAddr) return;
    setLoading(true);
    try {
      // read usdc token from escrow by probing treasury for usdc (fallback to addresses)
      const treasuryAddr = getRuntimeAddress('Treasury');
      let usdcAddr: string | null = null;
      try {
        const tre = new Contract(treasuryAddr, TREASURY_ABI, provider);
        usdcAddr = await tre.usdc().catch(() => null);
      } catch {
        usdcAddr = null;
      }
      if (!usdcAddr) {
        // try common frontend address
        usdcAddr = getRuntimeAddress('MockUSDC');
      }
      if (usdcAddr) {
        const usdc = new Contract(usdcAddr, ['function balanceOf(address) view returns (uint256)'], provider);
        const bal = await usdc.balanceOf(escrowAddr).catch(() => null);
        setEscrowUsdc(bal ? Number(bal) : 0);
      } else {
        setEscrowUsdc(0);
      }
    } catch (e) {
      setLog(l => [`[refresh] failed: ${String(e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [provider, escrowAddr]);

  async function fetchPortfolioAssets() {
    const registryAddr = portfolioRegistryAddress;
    if (!provider || !isValidAddress(registryAddr)) {
      setPortfolioAssets([]);
      return;
    }
    try {
      const registry = new Contract(registryAddr, PORTFOLIO_REGISTRY_ABI, provider);
      const raw = await registry.getAllAssets();
      setPortfolioAssets(raw.map((a: any) => ({
        symbol: a.symbol,
        name: a.name,
        token: a.token,
        riskClass: Number(a.riskClass),
        role: Number(a.role),
        minimumInvestmentUsd6: BigInt(a.minimumInvestmentUsd6 ?? 0),
      })));
    } catch (e) {
      console.warn('Failed to fetch portfolio assets:', e);
    }
  }

  async function fetchExecutionRoutes() {
    const registryAddr = executionRouteRegistryAddress;
    if (!provider || !isValidAddress(registryAddr)) {
      setExecutionRoutes([]);
      return;
    }
    try {
      const registry = new Contract(registryAddr, EXECUTION_ROUTE_REGISTRY_ABI, provider);
      const raw = await registry.getAllRoutes();
      setExecutionRoutes(raw.map((route: any) => ({
        routeId: Number(route.routeId ?? route[0] ?? 0),
        assetSymbol: String(route.assetSymbol ?? route[1] ?? ''),
        routeType: Number(route.routeType ?? route[2] ?? 0),
        documentsComplete: Boolean(route.documentsComplete ?? route[6] ?? false),
        sagittaFundApproved: Boolean(route.sagittaFundApproved ?? route[7] ?? false),
        ndaSigned: Boolean(route.ndaSigned ?? route[8] ?? false),
        pnlEndpoint: String(route.pnlEndpoint ?? route[9] ?? ''),
        manualMarksRequired: Boolean(route.manualMarksRequired ?? route[10] ?? false),
        active: Boolean(route.active ?? route[11] ?? false),
      })));
    } catch (e) {
      console.warn('Failed to fetch execution routes:', e);
      setExecutionRoutes([]);
    }
  }

  function isExternalPortfolioAsset(asset: PortfolioRegistryAsset): boolean {
    return asset.role === 6 || !isValidAddress(asset.token) || asset.token === ethers.ZeroAddress;
  }

  function getEligibleAllocationUniverse(
    assets: PortfolioRegistryAsset[],
    batchPrincipalUsd6: bigint
  ): { eligible: PortfolioRegistryAsset[]; excluded: AllocationExclusion[] } {
    const eligible: PortfolioRegistryAsset[] = [];
    const excluded: AllocationExclusion[] = [];

    for (const asset of assets) {
      const reasons: string[] = [];

      if (asset.minimumInvestmentUsd6 > batchPrincipalUsd6) {
        reasons.push(`min ${fmtUsd6(asset.minimumInvestmentUsd6)} exceeds batch ${fmtUsd6(batchPrincipalUsd6)}`);
      }

      if (isExternalPortfolioAsset(asset)) {
        const matchingRoutes = executionRoutes.filter(
          (route) => route.routeType === 3 && route.assetSymbol.toLowerCase() === asset.symbol.toLowerCase()
        );
        const hasEligibleRoute = matchingRoutes.some((route) =>
          route.active &&
          route.documentsComplete &&
          route.sagittaFundApproved &&
          route.ndaSigned &&
          route.pnlEndpoint.trim().length > 0
        );
        if (!hasEligibleRoute) {
          reasons.push(matchingRoutes.length > 0 ? 'blocked by compliance' : 'no compliant execution route');
        }
      }

      if (reasons.length > 0) {
        excluded.push({ symbol: asset.symbol, name: asset.name, reasons });
      } else {
        eligible.push(asset);
      }
    }

    return { eligible, excluded };
  }

  function normalizeAllocationWeights(weights: AAAAssetWeight[]): AAAAssetWeight[] {
    const positive = weights.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
    const total = positive.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return [];
    return positive.map((item) => ({ ...item, weight: item.weight / total }));
  }

  async function fetchAAAAllocation(assets: PortfolioRegistryAsset[], batchId?: string | null) {
    setAaaLoading(true);
    setAaaError(null);
    const targetBatchId = batchId
      || selectedAllocationBatchId
      || backendExecutionOrders.find((order) => !['settled', 'failed'].includes(order.executionStatus))?.batchId
      || backendExecutionOrders[0]?.batchId;
    const selectedOrder = targetBatchId
      ? backendExecutionOrders.find((order) => order.batchId === targetBatchId)
      : null;
    if (!selectedOrder) {
      setAaaAllocation(null);
      setAaaError('No Escrow execution order is available for AAA allocation.');
      setAaaLoading(false);
      return;
    }
    const selectedPlan = backendAllocationPlans.find((plan) => plan.batchId === selectedOrder.batchId);
    if (selectedPlan?.allocationResult) {
      setAaaAllocation(selectedPlan.allocationResult);
      setAaaError(null);
      setAaaLoading(false);
      return;
    }
    setAaaAllocation(null);
    setAaaError(`No stored AAA allocation result yet for batch #${selectedOrder.batchId}.`);
    setAaaLoading(false);
    return;
    const batchPrincipalUsd6 = BigInt(Math.max(0, Math.round(Number(selectedOrder.principalReceivedUsd || 0) * 1_000_000)));
    const universe = getEligibleAllocationUniverse(assets, batchPrincipalUsd6);
    const excludedSummary = universe.excluded.length > 0
      ? ` Excluded: ${universe.excluded.map((asset) => `${asset.symbol} (${asset.reasons.join(', ')})`).join('; ')}.`
      : '';

    if (universe.eligible.length === 0) {
      setAaaAllocation(null);
      setAaaError(`No eligible assets for this batch.${excludedSummary}`);
      setAaaLoading(false);
      return;
    }
    try {
      const aaaPayload = {
        durationClass: selectedOrder?.durationClass,
        policyProfileId: selectedOrder?.policyProfileId,
        strategyClass: selectedOrder?.strategyClass,
        timing: selectedOrder ? {
          targetReturnAt: selectedOrder.targetReturnAt,
          hardCloseAt: selectedOrder.hardCloseAt,
        } : undefined,
        routeAllowlist: selectedOrder?.eligibleRouteTypes,
        marketContext: { source: 'escrow-ui', mode: 'localhost' },
        universe: universe.eligible.map((asset) => ({
          symbol: asset.symbol,
          riskClass: asset.riskClass,
          role: asset.role,
          minimumInvestmentUsd6: asset.minimumInvestmentUsd6.toString(),
        })),
      };
      const resp = await fetch(AAA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aaaPayload),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const fetched: AAAAssetWeight[] = data.assets ?? data.allocations ?? [];
        if (fetched.length > 0) {
          const eligibleSymbols = new Set(universe.eligible.map((asset) => asset.symbol.toLowerCase()));
          const normalized = normalizeAllocationWeights(
            fetched.filter((asset) => eligibleSymbols.has(String(asset.symbol ?? '').toLowerCase()))
          );
          if (normalized.length > 0) {
            setAaaAllocation(null);
            if (excludedSummary) {
              setAaaError(`AAA weights filtered by batch rules.${excludedSummary}`);
            }
            setAaaLoading(false);
            return;
          }
        }
      }
    } catch (_) {}
    // Fallback: equal weights across all active portfolio assets
    if (universe.eligible.length > 0) {
      const w = 1 / universe.eligible.length;
      setAaaAllocation(null);
      setAaaError('AAA service not reachable — showing equal-weight fallback');
    } else {
      setAaaError('AAA service not reachable and no portfolio assets found in registry');
    }
    setAaaLoading(false);
  }

  useEffect(() => {
    if (provider) fetchPortfolioAssets();
  }, [provider, portfolioRegistryAddress]);

  useEffect(() => {
    if (provider) fetchExecutionRoutes();
  }, [provider, executionRouteRegistryAddress]);

  async function depositReturnForBatch() {
    if (isPaused) {
      setLog(l => ['[escrow] protocol is paused; return deposit is disabled', ...l]);
      return;
    }
    if (!isOperator) {
      setLog(l => ['[escrow] operator or owner role required to deposit returns', ...l]);
      return;
    }
    if (!provider || !signer || !escrowAddr) return;
    const escrow = new Contract(escrowAddr, INVESTMENT_ESCROW_ABI, signer);
    const batchId = Number(batchIdInput);
    if (!batchId) { setLog(l => ['[escrow] invalid batch id', ...l]); return; }
    const navFloat = Number(navInput);
    if (!isFinite(navFloat) || navFloat <= 0) { setLog(l => ['[escrow] invalid NAV', ...l]); return; }
    const navBn = BigInt(Math.round(navFloat * 1e18));
    try {
      setLoading(true);
      const batch = await escrow.getBatch(batchId);
      const status = Number(batch.status ?? 0);
      // enforce: Deposit Returns only allowed for Invested batches (status 4)
      if (status !== 4) {
        setLog(l => [`[escrow] depositReturnForBatch aborted: batch ${batchId} status=${status} (expected Invested=4). Deposit Returns only apply to Invested batches.`, ...l]);
        return;
      }
      const tx = await escrow.depositReturnForBatch(batchId, navBn);
      await tx.wait();
      setLog(l => [`[escrow] depositReturnForBatch tx=${tx.hash}`, ...l]);
      await postWriteRefresh('deposit-return');
    } catch (e) {
      setLog(l => [`[escrow] depositReturnForBatch failed: ${String(e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // New: burn escrow USDC assigned to batch
  async function distributeBatch() {
    if (!provider || !signer || !escrowAddr) return;
    const escrow = new Contract(escrowAddr, INVESTMENT_ESCROW_ABI, signer);
    const batchId = Number(batchIdInput);
    if (!batchId) { setLog(l => ['[escrow] invalid batch id', ...l]); return; }

    // Preflight: check batch status (allow Running=1 or Closed=2)
    let wasRunning = false;
    try {
      const batch = await escrow.getBatch(batchId);
      const status = Number(batch.status);
      if (status === 1) wasRunning = true; // Running -> acceptable, will mark Invested on-chain
      if (!(status === 1 || status === 2)) {
        setLog(l => [`[escrow] batch ${batchId} is not in a distributable state (status=${batch.status})`, ...l]);
        return;
      }
    } catch (e) {
      setLog(l => [`[escrow] failed to check batch status: ${String(e)}`, ...l]);
      return;
    }

    try {
      setLoading(true);
      const tx = await escrow.distributeBatchBurn(batchId);
      await tx.wait();
      if (wasRunning) {
        setLog(l => [`[escrow] distributeBatchBurn(batch=${batchId}) executed -> marked Invested (tx=${tx.hash})`, ...l]);
      } else {
        setLog(l => [`[escrow] distributeBatchBurn(batch=${batchId}) executed -> burned ${batchId} funds (tx=${tx.hash})`, ...l]);
      }
      await postWriteRefresh('distribute-batch-burn');
    } catch (e: any) {
      const msg = String(e?.message || e);
      // If the deployed contract is still the old version it will revert "Batch not closed".
      // As a last-resort admin recovery, attempt owner-only forceSetBatchInvested if available and if signer is the owner.
      if (msg.includes('Batch not closed') || msg.includes('Batch not running')) {
        setLog(l => [`[escrow] distributeBatchBurn reverted: ${msg} â€” attempting owner-only forceSetBatchInvested() as fallback`, ...l]);
        try {
          const escrowWithSigner = escrow.connect(signer) as any;
          if (typeof escrowWithSigner.forceSetBatchInvested === 'function') {
            // Optional: estimate owner by calling owner() first; attempt call only if signer address equals owner
            try {
              const onchainOwner = await escrowWithSigner.owner();
              const signerAddr = await signer.getAddress?.() ?? signer.address ?? null;
              if (signerAddr && signerAddr.toLowerCase() === onchainOwner.toLowerCase()) {
                const tx2 = await escrowWithSigner.forceSetBatchInvested(batchId);
                await tx2.wait();
                setLog(l => [`[escrow] forceSetBatchInvested(${batchId}) succeeded (tx=${tx2.hash})`, ...l]);
                await postWriteRefresh('force-set-invested');
                setLoading(false);
                return;
              } else {
                setLog(l => [`[escrow] signer is not owner, skipping forceSetBatchInvested`, ...l]);
              }
            } catch (ownerErr) {
              setLog(l => [`[escrow] owner check failed: ${String(ownerErr)}`, ...l]);
            }
          } else {
            setLog(l => ['[escrow] fallback forceSetBatchInvested() not available in ABI; redeploy updated contract', ...l]);
          }
        } catch (e2:any) {
          setLog(l => [`[escrow] fallback forceSetBatchInvested failed: ${String(e2?.message || e2)}`, ...l]);
        }
      }

      setLog(l => [`[escrow] distributeBatchBurn failed: ${msg}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // New: invest batch -> burns escrow USDC and marks batch Invested
  async function investBatch() {
    if (isPaused) {
      setLog(l => ['[escrow] protocol is paused; investment actions are disabled', ...l]);
      return;
    }
    if (!isOperator) {
      setLog(l => ['[escrow] operator or owner role required to invest batches', ...l]);
      return;
    }
    if (!provider || !signer || !escrowAddr) return;
    const escrow = new Contract(escrowAddr, INVESTMENT_ESCROW_ABI, signer);
    const batchId = Number(batchIdInput);
    if (!batchId) { setLog(l => ['[escrow] invalid batch id', ...l]); return; }

    // Preflight: ensure batch is Running (1)
    try {
      const batch = await escrow.getBatch(batchId);
      const status = Number(batch.status);
      if (status !== 1) {
        setLog(l => [`[escrow] batch ${batchId} must be Running to invest (status=${batch.status})`, ...l]);
        return;
      }
    } catch (e) {
      setLog(l => [`[escrow] failed to read batch status: ${String(e)}`, ...l]);
      return;
    }

    try {
      setLoading(true);
      // Preferred call: investBatch (new canonical function)
      if (typeof escrow.investBatch === 'function') {
        const tx = await escrow.investBatch(batchId);
        await tx.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] investBatch(${batchId}) executed (tx=${tx.hash})`, ...l]);
        await postWriteRefresh('invest-batch');
        return;
      }

      // Fallback for older deployments: try distributeBatchBurn compatibility wrapper
      if (typeof escrow.distributeBatchBurn === 'function') {
        const tx2 = await escrow.distributeBatchBurn(batchId);
        await tx2.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] distributeBatchBurn(batch=${batchId}) executed (compat) tx=${tx2.hash}`, ...l]);
        await postWriteRefresh('invest-batch-compat');
        return;
      }

      setLog(l => ['[escrow] contract does not expose investBatch or distributeBatchBurn', ...l]);
    } catch (e:any) {
      const errMsg = String(e?.message || e);
      setLog(l => [`[escrow] investBatch failed: ${errMsg}`, ...l]);


      // TRY SAFE PUBLIC FALLBACK: markBatchInvestedWithoutTransfer (accounting-only, no ERC20 transfer)
      try {
        if (typeof escrow.markBatchInvestedWithoutTransfer === 'function') {
          setLog(l => ['[escrow] attempting markBatchInvestedWithoutTransfer() fallback (accounting-only)', ...l]);
          const txm = await escrow.markBatchInvestedWithoutTransfer(batchId);
          await txm.wait();
          setLog(l => [`[escrow] markBatchInvestedWithoutTransfer(${batchId}) succeeded (tx=${txm.hash})`, ...l]);
          await postWriteRefresh('mark-invested-without-transfer');
          setLoading(false);
          return;
        }
      } catch (markErr:any) {
        setLog(l => [`[escrow] markBatchInvestedWithoutTransfer fallback failed: ${String(markErr?.message || markErr)}`, ...l]);
      }

      // TRY SAFE PUBLIC FALLBACK: investBatchIfFunded (any caller) â€” only succeeds if Escrow already holds the batch's USDC.
      try {
        if (typeof escrow.investBatchIfFunded === 'function') {
          setLog(l => ['[escrow] attempting investBatchIfFunded() fallback (public-funded path)', ...l]);
          const txf = await escrow.investBatchIfFunded(batchId);
          await txf.wait();
          setLog(l => [`[escrow] investBatchIfFunded(${batchId}) succeeded (tx=${txf.hash})`, ...l]);
          await postWriteRefresh('invest-batch-if-funded');
          setLoading(false);
          return;
        }
      } catch (pubErr:any) {
        setLog(l => [`[escrow] investBatchIfFunded fallback failed: ${String(pubErr?.message || pubErr)}`, ...l]);
      }

      // Diagnostic probe to find root cause (batch status, escrow USDC, owner/keeper)
      try {
        // read batch
        const batch = await escrow.getBatch?.(batchId).catch(() => null);
        const batchStatus = batch ? Number(batch.status) : 'n/a';
        const batchPrincipal = batch ? (batch.totalCollateralUsd?.toString?.() ?? String(batch.totalCollateralUsd)) : 'n/a';

        // onchain roles
        const onchainOwner = await escrow.owner?.().catch(() => null);
        const onchainKeeper = await escrow.keeper?.().catch(() => null);
        const signerAddr = await signer.getAddress?.() ?? signer.address ?? null;

        // find USDC address via Treasury (fallback to runtime MockUSDC)
        let usdcAddr: string | null = null;
        try {
          const treAddr = getRuntimeAddress('Treasury');
          if (treAddr) {
            const tre = new Contract(treAddr, TREASURY_ABI, provider);
            usdcAddr = await tre.usdc().catch(() => null);
          }
        } catch { usdcAddr = null; }
        if (!usdcAddr) usdcAddr = getRuntimeAddress('MockUSDC');

        let escrowUsdcBal: string = 'n/a';
        if (usdcAddr) {
          try {
            const usdc = new Contract(usdcAddr, ['function balanceOf(address) view returns (uint256)'], provider);
            const bal = await usdc.balanceOf(escrow.address ?? escrowAddr);
            escrowUsdcBal = bal?.toString?.() ?? String(bal ?? '0');
          } catch {
            escrowUsdcBal = 'err';
          }
        }

        setLog(l => [
          `[escrow:diag] batch=${batchId} status=${batchStatus} principalUsd6=${batchPrincipal}`,
          `[escrow:diag] escrow USDC balance=${escrowUsdcBal} (token=${usdcAddr ?? 'none'})`,
          `[escrow:diag] owner=${onchainOwner ?? 'n/a'} keeper=${onchainKeeper ?? 'n/a'} signer=${signerAddr ?? 'n/a'}`,
          ...l
        ]);

        // If the signer is the owner, try owner-only recovery forceSetBatchInvested (best-effort)
        if (signerAddr && onchainOwner && signerAddr.toLowerCase() === onchainOwner.toLowerCase()) {
          try {
            if (typeof (escrow as any).forceSetBatchInvested === 'function') {
              setLog(l => [`[escrow:diag] signer is owner -> attempting forceSetBatchInvested(${batchId})`, ...l]);
              const escrowWithSigner = escrow.connect(signer) as any;
              const txf = await escrowWithSigner.forceSetBatchInvested(batchId);
              await txf.wait();
              setLog(l => [`[escrow:diag] forceSetBatchInvested succeeded (tx=${txf.hash})`, ...l]);
              await postWriteRefresh('diag-force-set-invested');
              setLoading(false);
              return;
            } else {
              setLog(l => ['[escrow:diag] contract ABI missing forceSetBatchInvested', ...l]);
            }
          } catch (e2:any) {
            setLog(l => [`[escrow:diag] forceSetBatchInvested failed: ${String(e2?.message || e2)}`, ...l]);
          }
        } else {
          setLog(l => ['[escrow:diag] signer is not owner â€” cannot perform owner-only recovery', ...l]);
        }

        // If we reach here, provide actionable instructions
        setLog(l => [
          '[escrow:diag] Actionable hints:',
          '- If escrow lacks USDC, fund it (Treasury.fundEscrowBatch already moves USDC at roll).',
          '- If you expect investBatch to burn without USDC present, you must call forceSetBatchInvested as owner or deploy updated escrow logic.',
          "- Or close batch after returning USDC (depositReturnForBatch / closeBatch) so distribution path can run.",
          ...l
        ]);
      } catch (diagErr) {
        setLog(l => [`[escrow:diag] diagnostic failed: ${String(diagErr)}`, ...l]);
      }
    } finally {
      setLoading(false);
    }
  }

  // New: public burn helper (dev-only)
  async function publicBurnBatchCall() {
    if (!provider || !signer || !escrowAddr) {
      setLog(l => ['[escrow] publicBurnBatch: provider/signer/escrow not ready', ...l]);
      return;
    }
    const escrowWrite = new Contract(escrowAddr, INVESTMENT_ESCROW_ABI, signer);
    const batchId = Number(batchIdInput);
    if (!batchId) { setLog(l => ['[escrow] publicBurnBatch: invalid batch id', ...l]); return; }
    try {
      setLoading(true);
      if (typeof escrowWrite.publicBurnBatch !== 'function') {
        setLog(l => ['[escrow] publicBurnBatch not available in ABI', ...l]);
        setLoading(false);
        return;
      }
      const tx = await escrowWrite.publicBurnBatch(batchId);
      await tx.wait();
      setLog(l => [`[escrow] publicBurnBatch(${batchId}) executed (tx=${tx.hash})`, ...l]);
      await postWriteRefresh('manual-public-burn-batch');
    } catch (e:any) {
      setLog(l => [`[escrow] publicBurnBatch failed: ${String(e?.message || e)}`, ...l]);
    } finally {
      setLoading(false);
    }
  }

  // Helper: sanitize, dedupe and normalize batch arrays
  function normalizeBatches(raw: any[] | undefined) {
    if (!Array.isArray(raw)) return [];
    const map = new Map<number, any>();
    for (const r of raw) {
      if (!r) continue;
      // allow numeric id, BigNumber-like objects with toString, or strings
      const idNum = Number(r?.id?.toString?.() ?? r?.id ?? NaN);
      if (!Number.isFinite(idNum) || idNum <= 0) continue;
      // avoid duplicates: keep first occurrence
      if (map.has(idNum)) continue;
      // normalize fields to safe primitives
      const normalized = {
        id: idNum,
        startTime: Number(r?.startTime?.toString?.() ?? r?.startTime ?? 0),
        endTime: Number(r?.endTime?.toString?.() ?? r?.endTime ?? 0),
        totalCollateralUsd: r?.totalCollateralUsd?.toString?.() ?? String(r?.totalCollateralUsd ?? '0'),
        totalShares: r?.totalShares?.toString?.() ?? String(r?.totalShares ?? '0'),
        finalNavPerShare: r?.finalNavPerShare?.toString?.() ?? String(r?.finalNavPerShare ?? '0'),
        status: Number(r?.status?.toString?.() ?? r?.status ?? 0),
        distributed: Boolean(r?.distributed ?? false)
      };
      map.set(idNum, normalized);
    }
    return Array.from(map.values()).sort((a,b) => a.id - b.id);
  }

  function formatAddressShort(addr: string | null) {
    if (!addr || addr === 'not set') return 'not set';
    if (addr.length < 16) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  }

  function formatUsd6Value(raw: number) {
    return `$${(raw / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function matchBatchFilter(batchId: number, filter: string) {
    const query = filter.trim();
    if (!query) return true;
    return String(batchId).includes(query);
  }

  function matchOrderFilter(order: BackendExecutionOrder, filter: string) {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return [
      order.batchId,
      order.sourceType,
      order.executionStatus,
      order.routeStatus,
      order.policyProfileId,
      order.strategyClass,
    ].some((value) => String(value ?? '').toLowerCase().includes(query));
  }

  function orderStageIndex(order: BackendExecutionOrder) {
    if (order.executionStatus === 'settled' || order.settlementStatus === 'settled') return 5;
    if (order.executionStatus === 'returned' || order.settlementStatus === 'return_recorded') return 4;
    if (order.executionStatus === 'deployed' || order.deploymentStatus === 'deployed') return 3;
    if (order.executionStatus === 'allocation_validated' || order.aaaRequestStatus === 'completed') return 2;
    if (order.executionStatus === 'pending_allocation' || order.aaaRequestStatus === 'requesting') return 1;
    return 0;
  }

  function orderTone(order: BackendExecutionOrder): 'success' | 'warning' | 'danger' | 'neutral' {
    if (order.executionStatus === 'failed') return 'danger';
    if (order.executionStatus === 'settled' || order.settlementStatus === 'settled') return 'success';
    if (order.executionStatus === 'deployed' || order.executionStatus === 'returned') return 'success';
    if (order.executionStatus === 'received' || order.executionStatus === 'pending_allocation') return 'warning';
    return 'neutral';
  }

  const orderStageLabels = ['Received', 'Allocation', 'Validated', 'Deployed', 'Returned', 'Settled'];
  const filteredExecutionOrders = [...backendExecutionOrders]
    .sort((a, b) => {
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number(b.batchId);
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number(a.batchId);
      return bTime - aTime;
    })
    .filter((order) => matchOrderFilter(order, batchFilter));
  const orderTotalPages = Math.max(1, Math.ceil(filteredExecutionOrders.length / batchPageSize));
  const safeOrderPage = Math.min(orderPage, orderTotalPages);
  const visibleExecutionOrders = filteredExecutionOrders.slice((safeOrderPage - 1) * batchPageSize, safeOrderPage * batchPageSize);

  const activeSortedFiltered = [...activeBatches]
    .sort((a: any, b: any) => Number(b?.id ?? 0) - Number(a?.id ?? 0))
    .filter((b: any) => matchBatchFilter(Number(b?.id ?? 0), batchFilter));

  const investedSortedFiltered = [...investedBatches]
    .sort((a: any, b: any) => Number(b?.id ?? 0) - Number(a?.id ?? 0))
    .filter((b: any) => matchBatchFilter(Number(b?.id ?? 0), batchFilter));

  const closedSortedFiltered = [...closedBatches]
    .sort((a: any, b: any) => Number((b as any)?.batch?.id ?? 0) - Number((a as any)?.batch?.id ?? 0))
    .filter(({ batch }: any) => matchBatchFilter(Number(batch?.id ?? 0), batchFilter));

  const activeTotalPages = Math.max(1, Math.ceil(activeSortedFiltered.length / batchPageSize));
  const investedTotalPages = Math.max(1, Math.ceil(investedSortedFiltered.length / batchPageSize));
  const closedTotalPages = Math.max(1, Math.ceil(closedSortedFiltered.length / batchPageSize));

  const safeActivePage = Math.min(activePage, activeTotalPages);
  const safeInvestedPage = Math.min(investedPage, investedTotalPages);
  const safeClosedPage = Math.min(closedPage, closedTotalPages);

  const activeVisible = activeSortedFiltered.slice((safeActivePage - 1) * batchPageSize, safeActivePage * batchPageSize);
  const investedVisible = investedSortedFiltered.slice((safeInvestedPage - 1) * batchPageSize, safeInvestedPage * batchPageSize);
  const closedVisible = closedSortedFiltered.slice((safeClosedPage - 1) * batchPageSize, safeClosedPage * batchPageSize);

  useEffect(() => {
    setOrderPage(1);
    setDeploymentHistoryPage(1);
    setActivePage(1);
    setInvestedPage(1);
    setClosedPage(1);
  }, [batchFilter, batchPageSize]);

  const runningCount = activeBatches.filter((b: any) => Number(b?.id) > 0).length;
  const investedCount = investedBatches.filter((b: any) => Number(b?.id) > 0).length;
  const closedCount = closedBatches.filter((b: any) => Number((b as any)?.batch?.id) > 0).length;
  const activeAllocationOrder = backendExecutionOrders.find((order) => !['settled', 'failed'].includes(order.executionStatus))
    ?? backendExecutionOrders[0]
    ?? null;
  const selectedAllocationOrder = (selectedAllocationBatchId
    ? backendExecutionOrders.find((order) => order.batchId === selectedAllocationBatchId)
    : null) ?? activeAllocationOrder;
  const selectedAllocationPlan = selectedAllocationOrder
    ? backendAllocationPlans.find((plan) => plan.batchId === selectedAllocationOrder.batchId) ?? null
    : null;
  const selectedAllocationPrincipalUsd6 = BigInt(Math.max(0, Math.round(Number(selectedAllocationOrder?.principalReceivedUsd || 0) * 1_000_000)));
  const allocationEligibility = getEligibleAllocationUniverse(portfolioAssets, selectedAllocationPrincipalUsd6);

  useEffect(() => {
    if (selectedAllocationBatchId && backendExecutionOrders.some((order) => order.batchId === selectedAllocationBatchId)) {
      return;
    }
    const nextDefaultBatchId = activeAllocationOrder?.batchId ?? null;
    if (nextDefaultBatchId !== selectedAllocationBatchId) {
      setSelectedAllocationBatchId(nextDefaultBatchId);
    }
  }, [selectedAllocationBatchId, backendExecutionOrders, activeAllocationOrder?.batchId]);

  useEffect(() => {
    if (!selectedAllocationOrder) {
      setAaaAllocation(null);
      setAaaError('No Escrow execution order is available for AAA allocation.');
      return;
    }
    if (selectedAllocationPlan?.allocationResult) {
      setAaaAllocation(selectedAllocationPlan.allocationResult);
      setAaaError(null);
      return;
    }
    setAaaAllocation(null);
    setAaaError(`No stored AAA allocation result yet for batch #${selectedAllocationOrder.batchId}.`);
  }, [selectedAllocationOrder, selectedAllocationPlan]);

  useEffect(() => {
    if (!provider) return;
    if (!selectedAllocationOrder) return;
    if (portfolioAssets.length === 0) return;
    void fetchAAAAllocation(portfolioAssets, selectedAllocationOrder.batchId);
  }, [
    provider,
    selectedAllocationOrder?.batchId,
    selectedAllocationOrder?.principalReceivedUsd,
    selectedAllocationOrder?.policyProfileId,
    selectedAllocationOrder?.strategyClass,
    selectedAllocationOrder?.targetReturnAt,
    selectedAllocationOrder?.hardCloseAt,
    portfolioAssets.length,
    executionRoutes.length,
  ]);
  const eligibleAssetSymbols = new Set(allocationEligibility.eligible.map((asset) => asset.symbol.toLowerCase()));
  const aaaDeploymentLegs: AAADisplayLeg[] = selectedAllocationOrder && aaaAllocation && aaaAllocation.batchId === selectedAllocationOrder.batchId
    ? aaaAllocation.assets
        .filter((asset) => eligibleAssetSymbols.has(asset.symbol.toLowerCase()))
        .map((asset) => {
          const meta = allocationEligibility.eligible.find((item) => item.symbol.toLowerCase() === asset.symbol.toLowerCase())
            ?? portfolioAssets.find((item) => item.symbol.toLowerCase() === asset.symbol.toLowerCase());
          const matchingRoutes = executionRoutes.filter((route) => route.assetSymbol.toLowerCase() === asset.symbol.toLowerCase() && route.active);
          return {
            batchId: selectedAllocationOrder.batchId,
            symbol: asset.symbol,
            assetName: meta?.name || asset.symbol,
            riskClassLabel: RISK_CLASS_LABELS[Number(meta?.riskClass ?? 0)] || `Risk ${Number(meta?.riskClass ?? 0)}`,
            roleLabel: ASSET_ROLE_LABELS[Number(meta?.role ?? 0)] || `Role ${Number(meta?.role ?? 0)}`,
            weightPct: `${(asset.weight * 100).toFixed(1)}%`,
            principalUsd6: BigInt(Math.round(Number(selectedAllocationOrder.principalReceivedUsd || 0) * asset.weight * 1_000_000)),
            expectedCloseAt: selectedAllocationOrder.targetReturnAt,
            source: aaaAllocation.source,
            routeSummary: matchingRoutes.length > 0
              ? `${matchingRoutes.length} eligible route${matchingRoutes.length === 1 ? '' : 's'}`
              : 'Portfolio asset only',
          };
        })
    : [];
  const portfolioAssetBySymbol = new Map(portfolioAssets.map((asset) => [asset.symbol.toLowerCase(), asset] as const));
  const deploymentBatchGroups = [...backendExecutionOrders]
    .sort((a, b) => {
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number(b.batchId);
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number(a.batchId);
      return bTime - aTime;
    })
    .filter((order) => matchOrderFilter(order, batchFilter))
    .map((order) => {
      const plan = backendAllocationPlans.find((item) => item.batchId === order.batchId);
      const planDecisionContext = (plan?.decisionContext ?? {}) as Record<string, any>;
      const planSource: 'aaa' | 'fallback' = planDecisionContext?.aaaServiceUsed ? 'aaa' : 'fallback';
      let legs: AAADisplayLeg[] = [];
      const storedLegs = backendAllocationLegs.filter((leg) => leg.batchId === order.batchId);

      if (storedLegs.length > 0) {
        const grouped = new Map<string, { principalUsd6: bigint; expectedCloseAt: string; routeTypes: Set<string> }>();
        for (const leg of storedLegs) {
          const symbol = String(leg.portfolio || leg.routeId || leg.routeType || '').trim();
          if (!symbol) continue;
          const existing = grouped.get(symbol) ?? {
            principalUsd6: 0n,
            expectedCloseAt: String(leg.expectedCloseAt || order.targetReturnAt),
            routeTypes: new Set<string>(),
          };
          existing.principalUsd6 += BigInt(Math.max(0, Math.round(Number(leg.principalAllocatedUsd || 0) * 1_000_000)));
          if (leg.routeType) existing.routeTypes.add(String(leg.routeType));
          if (!existing.expectedCloseAt && leg.expectedCloseAt) existing.expectedCloseAt = String(leg.expectedCloseAt);
          grouped.set(symbol, existing);
        }
        legs = Array.from(grouped.entries()).map(([symbol, groupedLeg]) => {
          const meta = portfolioAssetBySymbol.get(symbol.toLowerCase());
          const principalWeight = Number(order.principalReceivedUsd || 0) > 0
            ? Number(groupedLeg.principalUsd6) / Math.round(Number(order.principalReceivedUsd || 0) * 1_000_000)
            : 0;
          const routeTypes = Array.from(groupedLeg.routeTypes);
          return {
            batchId: order.batchId,
            symbol,
            assetName: meta?.name || symbol,
            riskClassLabel: RISK_CLASS_LABELS[Number(meta?.riskClass ?? 0)] || `Risk ${Number(meta?.riskClass ?? 0)}`,
            roleLabel: ASSET_ROLE_LABELS[Number(meta?.role ?? 0)] || `Role ${Number(meta?.role ?? 0)}`,
            weightPct: `${(principalWeight * 100).toFixed(1)}%`,
            principalUsd6: groupedLeg.principalUsd6,
            expectedCloseAt: groupedLeg.expectedCloseAt || order.targetReturnAt,
            source: planSource,
            routeSummary: routeTypes.length > 0
              ? `${routeTypes.length} deployed route${routeTypes.length === 1 ? '' : 's'}: ${routeTypes.join(', ')}`
              : 'Stored deployment legs',
          };
        });
      } else if (plan?.allocationResult?.assets && plan.allocationResult.assets.length > 0) {
        legs = plan.allocationResult.assets.map((asset) => ({
          batchId: order.batchId,
          symbol: asset.symbol,
          assetName: asset.assetName || portfolioAssetBySymbol.get(asset.symbol.toLowerCase())?.name || asset.symbol,
          riskClassLabel: RISK_CLASS_LABELS[Number(asset.riskClass ?? portfolioAssetBySymbol.get(asset.symbol.toLowerCase())?.riskClass ?? 0)] || `Risk ${Number(asset.riskClass ?? 0)}`,
          roleLabel: ASSET_ROLE_LABELS[Number(asset.role ?? portfolioAssetBySymbol.get(asset.symbol.toLowerCase())?.role ?? 0)] || `Role ${Number(asset.role ?? 0)}`,
          weightPct: `${(Number(asset.weight || 0) * 100).toFixed(1)}%`,
          principalUsd6: BigInt(Math.max(0, Math.round(Number(asset.principalAllocatedUsd || 0) * 1_000_000))),
          expectedCloseAt: asset.expectedCloseAt || order.targetReturnAt,
          source: plan.allocationResult?.source || planSource,
          routeSummary: Array.isArray(asset.routeTypes) && asset.routeTypes.length > 0
            ? `${asset.routeTypes.length} planned route${asset.routeTypes.length === 1 ? '' : 's'}: ${asset.routeTypes.join(', ')}`
            : 'Stored AAA allocation result',
        }));
      } else {
        const proposedLegs = Array.isArray((plan as any)?.proposedLegs) ? ((plan as any).proposedLegs as Array<Record<string, any>>) : [];
        const grouped = new Map<string, { principalUsd6: bigint; expectedCloseAt: string; routeTypes: Set<string> }>();
        for (const leg of proposedLegs) {
          const symbol = String(leg?.portfolio || '').trim();
          if (!symbol) continue;
          const existing = grouped.get(symbol) ?? {
            principalUsd6: 0n,
            expectedCloseAt: String(leg?.expectedCloseAt || order.targetReturnAt),
            routeTypes: new Set<string>(),
          };
          existing.principalUsd6 += BigInt(Math.max(0, Math.round(Number(leg?.principalAllocatedUsd || 0) * 1_000_000)));
          if (leg?.routeType) existing.routeTypes.add(String(leg.routeType));
          if (!existing.expectedCloseAt && leg?.expectedCloseAt) existing.expectedCloseAt = String(leg.expectedCloseAt);
          grouped.set(symbol, existing);
        }
        legs = Array.from(grouped.entries()).map(([symbol, groupedLeg]) => {
          const meta = portfolioAssetBySymbol.get(symbol.toLowerCase());
          const principalWeight = Number(order.principalReceivedUsd || 0) > 0
            ? Number(groupedLeg.principalUsd6) / Math.round(Number(order.principalReceivedUsd || 0) * 1_000_000)
            : 0;
          const routeTypes = Array.from(groupedLeg.routeTypes);
          return {
            batchId: order.batchId,
            symbol,
            assetName: meta?.name || symbol,
            riskClassLabel: RISK_CLASS_LABELS[Number(meta?.riskClass ?? 0)] || `Risk ${Number(meta?.riskClass ?? 0)}`,
            roleLabel: ASSET_ROLE_LABELS[Number(meta?.role ?? 0)] || `Role ${Number(meta?.role ?? 0)}`,
            weightPct: `${(principalWeight * 100).toFixed(1)}%`,
            principalUsd6: groupedLeg.principalUsd6,
            expectedCloseAt: groupedLeg.expectedCloseAt || order.targetReturnAt,
            source: planSource,
            routeSummary: routeTypes.length > 0
              ? `${routeTypes.length} planned route${routeTypes.length === 1 ? '' : 's'}: ${routeTypes.join(', ')}`
              : 'Stored allocation plan',
          };
        });
      }

      return { order, plan, legs };
    })
    .filter((group) => group.legs.length > 0);
  const deploymentHistoryTotalPages = Math.max(1, Math.ceil(deploymentBatchGroups.length / batchPageSize));
  const safeDeploymentHistoryPage = Math.min(deploymentHistoryPage, deploymentHistoryTotalPages);
  const visibleDeploymentBatchGroups = deploymentBatchGroups.slice(
    (safeDeploymentHistoryPage - 1) * batchPageSize,
    safeDeploymentHistoryPage * batchPageSize
  );
  const vaultOrderBatchIds = new Set(
    backendExecutionOrders
      .filter((order) => String(order.sourceType || '').toUpperCase() === 'VAULT')
      .map((order) => order.batchId)
  );
  const vaultCapitalDeployedExternallyUsd6 = backendAllocationLegs.reduce((sum, leg) => {
    if (!vaultOrderBatchIds.has(leg.batchId)) return sum;
    if (leg.status !== 'deployed') return sum;
    return sum + BigInt(Math.max(0, Math.round(Number(leg.principalAllocatedUsd || 0) * 1_000_000)));
  }, 0n);
  // In simulated mode the on-chain escrow balance stays at the original funded principal — it
  // never receives profit from route adapters. Add the net gain/loss from returned legs so the
  // displayed available balance reflects the actual returned value (including yield or drawdown).
  const returnedLegsNetUsd6 = backendAllocationLegs.reduce((sum, leg) => {
    if (!vaultOrderBatchIds.has(leg.batchId)) return sum;
    if (!['returned', 'settled'].includes(leg.status)) return sum;
    const principal = Number(leg.principalAllocatedUsd || 0) * 1_000_000;
    const returned = Number(leg.returnedAmountUsd || leg.principalAllocatedUsd || 0) * 1_000_000;
    return sum + (returned - principal);
  }, 0);
  const escrowWalletUsdcUsd6 = BigInt(Math.max(0, Math.round(Number(escrowUsdc || 0))));
  const availableEscrowUsdcUsd6 = BigInt(Math.max(
    0,
    Math.round(Number(escrowWalletUsdcUsd6) + returnedLegsNetUsd6 - Number(vaultCapitalDeployedExternallyUsd6))
  ));
  const ordersByStatus = {
    queued: backendExecutionOrders.filter(o => ['received', 'pending_allocation', 'allocation_validated'].includes(o.executionStatus)).length,
    deployed: backendExecutionOrders.filter(o => o.deploymentStatus === 'deployed' || o.executionStatus === 'deployed').length,
    closing: backendExecutionOrders.filter(o => ['closing', 'returned'].includes(o.executionStatus)).length,
    settled: backendExecutionOrders.filter(o => o.settlementStatus === 'settled' || o.executionStatus === 'settled').length,
  };
  const canAdvanceSelectedToReturned = Boolean(
    selectedAllocationOrder &&
    ['deployed', 'closing'].includes(selectedAllocationOrder.executionStatus) &&
    selectedAllocationOrder.settlementStatus !== 'settled'
  );
  const canAdvanceSelectedToSettled = Boolean(
    selectedAllocationOrder &&
    (selectedAllocationOrder.executionStatus === 'returned' || selectedAllocationOrder.settlementStatus === 'return_recorded') &&
    selectedAllocationOrder.settlementStatus !== 'settled'
  );

  return (
    <div className="tab-screen">
      <PageHeader
        title="Escrow Orchestration"
        description="Monitor Treasury execution orders, AAA allocation, adapter deployment, return, and settlement automation."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {new Date().toLocaleTimeString()}</span>
            <span className="data-chip">Escrow: {formatAddressShort(escrowAddr)}</span>
            <span className="data-chip">Orders: {backendExecutionOrders.length}</span>
            <span className="data-chip" data-tone={isOperator ? 'warning' : 'neutral'}>Role: {role}</span>
            <span className="data-chip" data-tone={ordersByStatus.deployed > 0 ? 'warning' : 'success'}>
              {ordersByStatus.deployed > 0 ? `${ordersByStatus.deployed} deployed` : 'No deployed orders'}
            </span>
          </>
        }
      />

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="section-title !mb-0">Batch Tracker</h3>
              <p className="section-subtitle !mt-1 !mb-0">Treasury handoffs awaiting allocation, route assignment, deployment, return, and settlement.</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="action-button" onClick={refreshBackendExecutionQueue}>Refresh Queue</button>
              <button className="action-button action-button--primary" onClick={runBackendAutomation} disabled={automationRunning}>
                {automationRunning ? 'Running...' : 'Run Workers'}
              </button>
            </div>
          </div>
          <div className="filter-toolbar mb-4">
            <div className="min-w-[220px] grow">
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Batch Filter</label>
              <input
                className="w-full mt-1 p-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                placeholder="Batch, source, status, policy, strategy"
              />
            </div>
            <div className="w-[160px]">
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Rows</label>
              <select
                className="w-full mt-1 p-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                value={String(batchPageSize)}
                onChange={(e) => setBatchPageSize(Number(e.target.value))}
              >
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
            </div>
            <div className="text-xs text-slate-400 pb-1">
              {visibleExecutionOrders.length} / {filteredExecutionOrders.length} shown
            </div>
          </div>
          {backendQueueError ? (
            <div className="status-banner status-banner--warning">{backendQueueError}</div>
          ) : null}
          {backendExecutionOrders.length === 0 ? (
            <div className="panel-note">No Treasury execution orders have been handed to Escrow yet.</div>
          ) : filteredExecutionOrders.length === 0 ? (
            <div className="panel-note">No execution orders match the current filter.</div>
          ) : (
            <div className="panel-stack panel-stack--dense">
              {visibleExecutionOrders.map((order) => {
                const legs = backendAllocationLegs.filter((leg) => leg.batchId === order.batchId);
                const plan = backendAllocationPlans.find((item) => item.batchId === order.batchId);
                const stage = orderStageIndex(order);
                const eligibleCount = Number(plan?.universeSnapshot?.summary?.eligibleCandidates ?? 0);
                const excludedCount = Number(plan?.universeSnapshot?.summary?.excludedCandidates ?? 0);
                return (
                  <div key={order.id} className="panel-row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
                    <span className="panel-row__label" style={{ minWidth: 120 }}>
                      Batch #{order.batchId}
                      <div className="text-[11px] text-slate-500">{order.sourceType || 'BANK'} source</div>
                    </span>
                    <span className="panel-row__value" style={{ flex: 1 }}>
                      <div>
                        {formatUsd6Value(order.principalReceivedUsd * 1_000_000)}
                        {' | '}
                        {order.durationClass}
                        {' | '}
                        horizon {order.executionHorizon || 'n/a'}
                        {' | '}
                        {order.policyProfileId}
                        {' | '}
                        {order.strategyClass}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        target {new Date(order.targetReturnAt).toLocaleDateString()}
                        {' | hard close '}
                        {new Date(order.hardCloseAt).toLocaleDateString()}
                        {plan ? ` | AAA plan ${plan.status}` : ' | no AAA plan yet'}
                        {plan ? ` | universe ${eligibleCount} eligible / ${excludedCount} excluded` : ''}
                        {legs.length ? ` | ${legs.length} leg${legs.length === 1 ? '' : 's'}` : ' | no legs yet'}
                        {legs.some((leg) => leg.returnedAmountUsd) ? ` | returned ${formatUsd6Value(legs.reduce((sum, leg) => sum + (leg.returnedAmountUsd || 0), 0) * 1_000_000)}` : ''}
                      </div>
                      {plan?.validationResult?.errors && plan.validationResult.errors.length > 0 && (
                        <div className="text-[11px] text-amber-400 mt-1">
                          {plan.validationResult.errors.join(' | ')}
                        </div>
                      )}
                      {plan?.universeSnapshot?.excludedUniverse && plan.universeSnapshot.excludedUniverse.length > 0 && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Excluded: {plan.universeSnapshot.excludedUniverse.slice(0, 3).map((item) => `${item.assetSymbol} (${item.reasons.join(', ')})`).join('; ')}
                          {plan.universeSnapshot.excludedUniverse.length > 3 ? ` +${plan.universeSnapshot.excludedUniverse.length - 3} more` : ''}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {orderStageLabels.map((label, index) => (
                          <span
                            key={label}
                            className="rounded px-2 py-1 text-[11px] border"
                            style={{
                              borderColor: index <= stage ? 'rgba(74, 222, 128, 0.35)' : 'rgba(100, 116, 139, 0.35)',
                              color: index <= stage ? 'rgb(187, 247, 208)' : 'rgb(148, 163, 184)',
                              background: index <= stage ? 'rgba(22, 101, 52, 0.16)' : 'rgba(15, 23, 42, 0.35)',
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </span>
                    <span className="panel-row__value" data-tone={orderTone(order)} style={{ minWidth: 200, textAlign: 'right' }}>
                      {order.executionStatus.replaceAll('_', ' ')}
                      <div className="text-[11px] text-slate-500">
                        AAA {order.aaaRequestStatus || 'n/a'} / deploy {order.deploymentStatus || 'n/a'} / settle {order.settlementStatus || 'n/a'}
                      </div>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {filteredExecutionOrders.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <button
                className="pagination-button"
                onClick={() => setOrderPage(Math.max(1, safeOrderPage - 1))}
                disabled={safeOrderPage <= 1}
              >
                Prev
              </button>
              <span>Page {safeOrderPage} / {orderTotalPages}</span>
              <button
                className="pagination-button"
                onClick={() => setOrderPage(Math.min(orderTotalPages, safeOrderPage + 1))}
                disabled={safeOrderPage >= orderTotalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>

      
      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 lg:col-span-4">
          <h3 className="section-title">Escrow Snapshot</h3>
          <div className="space-y-3">
            <MetricCard title="Available Escrow USDC" value={fmtUsd6(availableEscrowUsdcUsd6)} tone="neutral" />
            <div className="panel-stack text-sm">
              <div className="panel-row">
                <span className="panel-row__label">Escrow wallet USDC</span>
                <span className="panel-row__value">{fmtUsd6(escrowWalletUsdcUsd6)}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row__label">Transferred to external investments</span>
                <span className="panel-row__value">{fmtUsd6(vaultCapitalDeployedExternallyUsd6)}</span>
              </div>
              {returnedLegsNetUsd6 !== 0 && (
                <div className="panel-row">
                  <span className="panel-row__label">Returned yield / drawdown</span>
                  <span className={`panel-row__value ${returnedLegsNetUsd6 >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {returnedLegsNetUsd6 >= 0 ? '+' : ''}{fmtUsd6(BigInt(Math.round(returnedLegsNetUsd6)))}
                  </span>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-700/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.005)),rgba(8,9,12,0.88)] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Escrow Address</div>
              <div className="mt-3 text-lg text-slate-100 font-mono">{formatAddressShort(escrowAddr)}</div>
              <div className="mt-2 text-xs text-slate-400 break-all">{escrowAddr ?? 'not set'}</div>
            </div>
          </div>
        </div>

        <div className="sagitta-cell col-span-12 md:col-span-6 lg:col-span-4">
          <h3 className="section-title">Automation Status</h3>
          <div className="panel-stack text-sm">
            <div className="panel-row">
              <span className="panel-row__label">Queued / allocation</span>
              <span className="panel-row__value">{ordersByStatus.queued}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Deployed</span>
              <span className="panel-row__value">{ordersByStatus.deployed}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Closing / settled</span>
              <span className="panel-row__value">{ordersByStatus.closing} / {ordersByStatus.settled}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Workers are idempotent; retries refresh pending lifecycle jobs without duplicating legs.</p>
        </div>

        <div className="sagitta-cell col-span-12 md:col-span-6 lg:col-span-4">
          <h3 className="section-title">Worker Queue</h3>
          <div className="panel-stack text-sm">
            <div className="panel-row"><span className="panel-row__label">Allocation plans</span><span className="panel-row__value">{backendAllocationPlans.length}</span></div>
            <div className="panel-row"><span className="panel-row__label">Allocation legs</span><span className="panel-row__value">{backendAllocationLegs.length}</span></div>
            <div className="panel-row"><span className="panel-row__label">Returned capital</span><span className="panel-row__value">{formatUsd6Value(backendAllocationLegs.reduce((sum, leg) => sum + (leg.returnedAmountUsd || 0), 0) * 1_000_000)}</span></div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Treasury forms and funds batches. Escrow workers handle allocation, deployment, close, and settlement.</p>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 xl:col-span-8">
          <h3 className="section-title">Deployment Legs</h3>
          <p className="section-subtitle !mt-1">Historic and active batch legs grouped by batch. Expand a batch to inspect the asset-level allocation view.</p>
          {selectedAllocationOrder == null && deploymentBatchGroups.length === 0 ? (
            <div className="panel-note">No Escrow deployment leg history is available yet.</div>
          ) : aaaLoading && selectedAllocationOrder != null && deploymentBatchGroups.length === 0 ? (
            <div className="panel-note">Fetching AAA deployment legs for batch #{selectedAllocationOrder.batchId}...</div>
          ) : deploymentBatchGroups.length === 0 ? (
            <div className="panel-note">No deployment leg history matches the current filter.</div>
          ) : (
            <div className="panel-stack panel-stack--dense">
              {visibleDeploymentBatchGroups.map(({ order, plan, legs }) => {
                const isExpanded = expandedDeploymentBatches.includes(order.batchId);
                const totalPrincipalUsd6 = legs.reduce((sum, leg) => sum + leg.principalUsd6, 0n);
                return (
                  <div key={`deployment-history-${order.batchId}`} className="rounded-xl border border-slate-700/50 overflow-hidden">
                    <button
                      type="button"
                      className="w-full px-4 py-3 bg-slate-900/35 text-left hover:bg-slate-900/50 transition-colors"
                      onClick={() => {
                        setSelectedAllocationBatchId(order.batchId);
                        setExpandedDeploymentBatches((current) =>
                          current.includes(order.batchId)
                            ? current.filter((batchId) => batchId !== order.batchId)
                            : [...current, order.batchId]
                        );
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-slate-100">Batch #{order.batchId}</span>
                            <span className={`data-chip ${(legs[0]?.source ?? 'fallback') === 'aaa' ? '' : 'text-amber-400'}`}>
                              {(legs[0]?.source ?? 'fallback') === 'aaa' ? 'AAA' : 'Local AAA Fallback'}
                            </span>
                            <span className="text-xs text-slate-500">{order.sourceType || 'BANK'} source</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {order.executionStatus.replaceAll('_', ' ')}
                            {' | '}
                            {legs.length} asset leg{legs.length === 1 ? '' : 's'}
                            {' | '}
                            {fmtUsd6(totalPrincipalUsd6)}
                            {' | target '}
                            {new Date(order.targetReturnAt).toLocaleString()}
                            {plan ? ` | plan ${plan.status}` : ''}
                          </div>
                        </div>
                        <div className="text-xs text-slate-300 whitespace-nowrap">
                          {isExpanded ? 'Hide legs' : 'Show legs'}
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-slate-300">
                          <thead>
                            <tr className="border-y border-slate-700/40 bg-slate-950/35">
                              <th className="text-left px-3 py-2">Asset</th>
                              <th className="text-left px-3 py-2">Risk / Role</th>
                              <th className="text-right px-3 py-2">Weight</th>
                              <th className="text-right px-3 py-2">Principal</th>
                              <th className="text-left px-3 py-2">Expected close</th>
                              <th className="text-left px-3 py-2">Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {legs.map((leg) => (
                              <tr key={`${order.batchId}:${leg.symbol}`} className="border-b border-slate-700/30">
                                <td className="px-3 py-2">
                                  <div className="font-semibold text-slate-100">{leg.symbol}</div>
                                  <div className="text-[11px] text-slate-500">{leg.assetName}</div>
                                </td>
                                <td className="px-3 py-2">
                                  <div>{leg.riskClassLabel}</div>
                                  <div className="text-[11px] text-slate-500">{leg.roleLabel} • {leg.routeSummary}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{leg.weightPct}</td>
                                <td className="px-3 py-2 text-right">{fmtUsd6(leg.principalUsd6)}</td>
                                <td className="px-3 py-2">{new Date(leg.expectedCloseAt).toLocaleString()}</td>
                                <td className="px-3 py-2">
                                  <span className={`data-chip ${leg.source === 'aaa' ? '' : 'text-amber-400'}`}>
                                    {leg.source === 'aaa' ? 'AAA' : 'Local AAA Fallback'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {deploymentBatchGroups.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <button
                className="pagination-button"
                onClick={() => setDeploymentHistoryPage(Math.max(1, safeDeploymentHistoryPage - 1))}
                disabled={safeDeploymentHistoryPage <= 1}
              >
                Prev
              </button>
              <span>Page {safeDeploymentHistoryPage} / {deploymentHistoryTotalPages}</span>
              <button
                className="pagination-button"
                onClick={() => setDeploymentHistoryPage(Math.min(deploymentHistoryTotalPages, safeDeploymentHistoryPage + 1))}
                disabled={safeDeploymentHistoryPage >= deploymentHistoryTotalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="sagitta-cell col-span-12 xl:col-span-4">
          <h3 className="section-title">Operator Overrides</h3>
          {selectedAllocationOrder && (
            <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Selected Batch</div>
              <div className="mt-2 text-sm text-slate-100 font-mono">#{selectedAllocationOrder.batchId}</div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedAllocationOrder.sourceType || 'BANK'} / {selectedAllocationOrder.executionStatus.replaceAll('_', ' ')}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  className="action-button action-button--secondary w-full"
                  onClick={() => manuallyAdvanceSelectedBatch('returned')}
                  disabled={!canAdvanceSelectedToReturned || manualStageAction !== null}
                >
                  {manualStageAction === 'returned' ? 'Advancing...' : 'Advance To Returned'}
                </button>
                <button
                  className="action-button action-button--secondary w-full"
                  onClick={() => manuallyAdvanceSelectedBatch('settled')}
                  disabled={!canAdvanceSelectedToSettled || manualStageAction !== null}
                >
                  {manualStageAction === 'settled' ? 'Advancing...' : 'Advance To Settled'}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Returned closes deployed legs and records returned USDC. Settled finalizes the batch and records Treasury unwind / wire readiness.
              </div>
            </div>
          )}
          <ul className="note-list">
            <li>Normal testnet flow runs through backend workers.</li>
            <li>On-chain position controls below remain available for diagnostics.</li>
            <li>Manual Start Batch, Invest Batch, and Deposit Returns are no longer the primary lifecycle.</li>
            <li>Use Run Workers to retry allocation, deployment, return, or settlement jobs.</li>
          </ul>
        </div>
      </section>

      {selectedAllocationOrder && (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="section-title !mb-0">AAA Allocation</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Stored AAA allocation result for batch #{selectedAllocationOrder.batchId}. This is the persisted plan linked to deployment, not a frontend-only preview.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {aaaAllocation && (
                  <span className={`data-chip ${aaaAllocation.source === 'aaa' ? '' : 'text-amber-400'}`}>
                    {aaaAllocation.source === 'aaa' ? 'Stored AAA Result' : 'Stored Local AAA Fallback'}
                  </span>
                )}
                <button
                  className="action-button action-button--secondary"
                  onClick={() => runBackendAutomation()}
                  disabled={aaaLoading}
                >
                  {aaaLoading ? 'Refreshing...' : aaaAllocation ? 'Refresh AAA' : 'Run AAA'}
                </button>
              </div>
            </div>

            {aaaError && (
              <div className="text-amber-400 text-xs mb-3 px-1">{aaaError}</div>
            )}

            {aaaAllocation && (() => {
              const order = selectedAllocationOrder;
              const principal = Math.round(Number(order?.principalReceivedUsd || 0) * 1_000_000);
              return (
                <div>
                  <div className="text-xs text-slate-400 mb-3">
                    Batch #{order?.batchId} &middot; {fmtUsd6(principal)} total
                    <span className="ml-2">{order?.sourceType || 'BANK'} / {order?.executionStatus.replaceAll('_', ' ')}</span>
                    <span className="ml-2">
                      {aaaAllocation.eligibleAssetCount ?? aaaAllocation.assets.length} eligible / {aaaAllocation.excludedAssetCount ?? aaaAllocation.excludedAssets?.length ?? 0} excluded
                    </span>
                    {aaaAllocation.source === 'fallback' && (
                      <span className="ml-2 text-amber-400">
                        (stored local AAA fallback)
                      </span>
                    )}
                  </div>
                  {(aaaAllocation.excludedAssets?.length ?? 0) > 0 && (
                    <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-900/35 p-3 text-xs text-slate-300">
                      <div className="uppercase tracking-[0.16em] text-slate-400 mb-2">Excluded From Allocation</div>
                      <div className="flex flex-wrap gap-2">
                        {aaaAllocation.excludedAssets?.map((asset) => (
                          <span key={`${asset.symbol}:${asset.stage || 'excluded'}`} className="rounded-full px-2 py-1 bg-rose-700/20 text-rose-200 border border-rose-700/30">
                            {asset.symbol}: {asset.reasons.join(', ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-widest text-slate-400 border-b border-slate-700">
                          <th className="pb-2 pr-6">Asset</th>
                          <th className="pb-2 pr-6">Risk Class</th>
                          <th className="pb-2 pr-6">Role</th>
                          <th className="pb-2 pr-6 text-right">Weight</th>
                          <th className="pb-2 text-right">USDC Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aaaAllocation.assets.map((a) => {
                          const meta = portfolioAssets.find(p => p.symbol === a.symbol);
                          const usdcAmt = Math.round(Number(a.principalAllocatedUsd || 0) * 1_000_000);
                          return (
                            <tr key={a.symbol} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                              <td className="py-2 pr-6">
                                <span className="font-mono text-slate-100">{a.symbol}</span>
                                {(a.assetName || meta?.name) && <span className="ml-2 text-slate-500 text-xs">{a.assetName || meta?.name}</span>}
                              </td>
                              <td className="py-2 pr-6 text-slate-400 text-xs">
                                {meta ? RISK_CLASS_LABELS[meta.riskClass] : '–'}
                              </td>
                              <td className="py-2 pr-6 text-slate-400 text-xs">
                                {meta ? ASSET_ROLE_LABELS[meta.role] : '–'}
                              </td>
                              <td className="py-2 pr-6 text-right text-slate-200 font-mono">
                                {(a.weight * 100).toFixed(1)}%
                              </td>
                              <td className="py-2 text-right text-slate-200 font-mono">
                                {fmtUsd6(usdcAmt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-600">
                          <td colSpan={3} className="pt-2 text-xs text-slate-500">Total</td>
                          <td className="pt-2 text-right font-mono text-slate-200 text-xs">
                            {(aaaAllocation.assets.reduce((s, a) => s + a.weight, 0) * 100).toFixed(1)}%
                          </td>
                          <td className="pt-2 text-right font-mono text-slate-200 text-xs">
                            {fmtUsd6(principal)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })()}

            {!aaaAllocation && !aaaLoading && (
              <div className="text-slate-500 text-sm py-6 text-center">
                Run the Escrow workers to generate and store an AAA allocation result for the active batch.
              </div>
            )}
          </div>
        </section>
      )}

      {/* Engine Log */}
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <div className="log-shell">
            <h3 className="log-shell__title">Escrow Log</h3>
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
