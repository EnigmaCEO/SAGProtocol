import React, { useEffect, useState } from 'react';
import MetricCard from '../ui/MetricCard';
import { ClockIcon as Clock } from '../icons/SagittaIcons';

// AAA + PortfolioRegistry types
type AAAAssetWeight = { symbol: string; weight: number; expectedReturn?: number; volatility?: number; };
type AAAAllocation = { source: 'aaa' | 'fallback'; timestamp: string; assets: AAAAssetWeight[]; };
type PortfolioRegistryAsset = { symbol: string; name: string; token: string; riskClass: number; role: number; };

const RISK_CLASS_LABELS = ['Wealth Management','Stablecoin','DeFi Bluechip','Fund of Funds','Large Cap','Private Credit Fund','Real World Asset','External Protocol'];
const ASSET_ROLE_LABELS = ['Core','Liquidity','Satellite','Defensive','Speculative','Yield Fund','External'];
const PORTFOLIO_REGISTRY_ABI = [
  'function getAllAssets() external view returns (tuple(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 addedAt)[])',
];
const AAA_ENDPOINT = 'https://aaa.sagitta.systems/api/v1/allocation';

// NEW imports for on-chain interactions
import { JsonRpcProvider, Contract, Wallet, Interface } from 'ethers';
import INVESTMENT_ESCROW_ABI from '../../lib/abis/InvestmentEscrow.json';
import TREASURY_ABI from '../../lib/abis/Treasury.json';
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';
import { emitUiRefresh } from '../../lib/ui-refresh';
import useRoleAccess from '../../hooks/useRoleAccess';
import useProtocolPause from '../../hooks/useProtocolPause';
import PageHeader from '../ui/PageHeader';
import { RPC_URL } from '../../lib/network';

export default function EscrowTab() {
  const { isPaused } = useProtocolPause();
  const { isOperator, role } = useRoleAccess();
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
  const [activePage, setActivePage] = useState<number>(1);
  const [investedPage, setInvestedPage] = useState<number>(1);
  const [closedPage, setClosedPage] = useState<number>(1);

  // AAA allocation state
  const [aaaAllocation, setAaaAllocation] = useState<AAAAllocation | null>(null);
  const [aaaLoading, setAaaLoading] = useState(false);
  const [aaaError, setAaaError] = useState<string | null>(null);
  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioRegistryAsset[]>([]);

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
    await Promise.allSettled([refresh(), refreshBatchSummary(), refreshEscrowLinks()]);
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

  useEffect(() => {
    // initial load (no periodic timer)
    refreshBatchSummary();
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
    const registryAddr = getRuntimeAddress('PortfolioRegistry');
    if (!registryAddr || !provider) return;
    try {
      const registry = new Contract(registryAddr, PORTFOLIO_REGISTRY_ABI, provider);
      const raw = await registry.getAllAssets();
      setPortfolioAssets(raw.map((a: any) => ({
        symbol: a.symbol,
        name: a.name,
        token: a.token,
        riskClass: Number(a.riskClass),
        role: Number(a.role),
      })));
    } catch (e) {
      console.warn('Failed to fetch portfolio assets:', e);
    }
  }

  async function fetchAAAAllocation(assets: PortfolioRegistryAsset[]) {
    setAaaLoading(true);
    setAaaError(null);
    try {
      const resp = await fetch(AAA_ENDPOINT, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json();
        const fetched: AAAAssetWeight[] = data.assets ?? data.allocations ?? [];
        if (fetched.length > 0) {
          setAaaAllocation({ source: 'aaa', timestamp: new Date().toISOString(), assets: fetched });
          setAaaLoading(false);
          return;
        }
      }
    } catch (_) {}
    // Fallback: equal weights across all active portfolio assets
    if (assets.length > 0) {
      const w = 1 / assets.length;
      setAaaAllocation({
        source: 'fallback',
        timestamp: new Date().toISOString(),
        assets: assets.map(a => ({ symbol: a.symbol, weight: w })),
      });
      setAaaError('AAA service not reachable — showing equal-weight fallback');
    } else {
      setAaaError('AAA service not reachable and no portfolio assets found in registry');
    }
    setAaaLoading(false);
  }

  useEffect(() => {
    if (provider) fetchPortfolioAssets();
  }, [provider]);

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
    setActivePage(1);
    setInvestedPage(1);
    setClosedPage(1);
  }, [batchFilter, batchPageSize]);

  const runningCount = activeBatches.filter((b: any) => Number(b?.id) > 0).length;
  const investedCount = investedBatches.filter((b: any) => Number(b?.id) > 0).length;
  const closedCount = closedBatches.filter((b: any) => Number((b as any)?.batch?.id) > 0).length;

  return (
    <div className="tab-screen">
      <PageHeader
        title="Escrow Management"
        description="Track pending, invested, and closed batches while driving batch lifecycle actions from the escrow surface."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {new Date().toLocaleTimeString()}</span>
            <span className="data-chip">Escrow: {formatAddressShort(escrowAddr)}</span>
            <span className="data-chip">Pending batch: {currentPendingId ?? 'n/a'}</span>
            <span className="data-chip" data-tone={isOperator ? 'warning' : 'neutral'}>Role: {role}</span>
            <span className="data-chip" data-tone={runningCount > 0 ? 'warning' : 'success'}>
              {runningCount > 0 ? `${runningCount} running` : 'No running batches'}
            </span>
          </>
        }
      />

      
      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 lg:col-span-4">
          <h3 className="section-title">Escrow Snapshot</h3>
          <div className="space-y-3">
            <MetricCard title="Escrow USDC Balance" value={formatUsd6Value(escrowUsdc ?? 0)} tone="neutral" />
            <div className="rounded-xl border border-slate-700/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.005)),rgba(8,9,12,0.88)] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Escrow Address</div>
              <div className="mt-3 text-lg text-slate-100 font-mono">{formatAddressShort(escrowAddr)}</div>
              <div className="mt-2 text-xs text-slate-400 break-all">{escrowAddr ?? 'not set'}</div>
            </div>
          </div>
        </div>

        <div className="sagitta-cell col-span-12 md:col-span-6 lg:col-span-4">
          <h3 className="section-title">Batch Status</h3>
          <div className="panel-stack text-sm">
            <div className="panel-row">
              <span className="panel-row__label">Current pending batch</span>
              <span className="panel-row__value">{currentPendingId ?? 'n/a'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Pending principal</span>
              <span className="panel-row__value">{pendingTotalUsd !== null ? fmtUsd6(pendingTotalUsd) : '$0.00'}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Running / Invested / Closed</span>
              <span className="panel-row__value">{runningCount} / {investedCount} / {closedCount}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Verify these before running batch actions.</p>
        </div>

        <div className="sagitta-cell col-span-12 md:col-span-6 lg:col-span-4">
          <h3 className="section-title">Start Batch</h3>
          {isOperator ? (
            <>
              <p className="text-sm text-slate-400 mb-4">
                {isPaused
                  ? 'Protocol is paused. Batch creation is disabled until the protocol is resumed.'
                  : 'Roll pending into running and request treasury funding (admin path).'}
              </p>
              <button
                onClick={handleStartBatch}
                disabled={isPaused || loading}
                className="action-button action-button--primary w-full"
              >
                {loading ? 'Submitting...' : 'Start Batch'}
              </button>
            </>
          ) : (
            <div className="panel-note">
              Escrow write controls are hidden for viewer wallets. Connect an operator or owner wallet to reveal batch actions.
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 xl:col-span-8">
          <h3 className="section-title">Investment Actions</h3>
          {isOperator ? (
            <>
              <p className="section-subtitle">
                {isPaused
                  ? 'Protocol is paused. Investment and return posting are disabled until the protocol is resumed.'
                  : 'Advance a running batch into investment, then deposit the final result using the closing NAV.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-300">Batch ID</label>
                  <input
                    className="w-full mt-1 p-2 rounded bg-slate-900"
                    value={batchIdInput}
                    onChange={e => setBatchIdInput(e.target.value)}
                    placeholder="Batch ID"
                    disabled={isPaused || loading}
                  />
                  <label className="text-sm text-slate-300 mt-3 block">Final NAV per share (1.10 = 10% Profit)</label>
                  <input
                    className="w-full mt-1 p-2 rounded bg-slate-900"
                    value={navInput}
                    onChange={e => setNavInput(e.target.value)}
                    placeholder="1.10"
                    disabled={isPaused || loading}
                  />
                </div>
                <div className="flex flex-col justify-end gap-3">
                  <button
                    className="action-button action-button--danger w-full"
                    onClick={investBatch}
                    disabled={isPaused || loading}
                  >
                    Invest Batch (burn escrow USDC)
                  </button>
                  <button
                    className="action-button action-button--success w-full"
                    onClick={depositReturnForBatch}
                    disabled={isPaused || loading}
                  >
                    Deposit Returns
                  </button>
                  <p className="text-xs text-slate-500">
                    Invest when status is Running. Deposit returns after investment outcome is known.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="panel-note mt-3">
              Escrow lifecycle controls are hidden for viewer wallets. Batch lists remain visible for monitoring only.
            </div>
          )}
        </div>

        <div className="sagitta-cell col-span-12 xl:col-span-4">
          <h3 className="section-title">Operator Notes</h3>
          <ul className="note-list">
            <li>Start a pending batch.</li>
            <li>Invest the running batch.</li>
            <li>Deposit returns with final NAV.</li>
            <li>Confirm closed-batch results below.</li>
          </ul>
        </div>
      </section>

      {activeBatches.length > 0 && (
        <section className="grid grid-cols-12 gap-5">
          <div className="sagitta-cell col-span-12">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="section-title !mb-0">AAA Allocation</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Recommended weights from <span className="font-mono">aaa.sagitta.systems</span> for the active batch.
                  Review before confirming investment.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {aaaAllocation && (
                  <span className={`data-chip ${aaaAllocation.source === 'aaa' ? '' : 'text-amber-400'}`}>
                    {aaaAllocation.source === 'aaa' ? 'Live from AAA' : 'Equal-weight fallback'}
                  </span>
                )}
                <button
                  className="action-button action-button--secondary"
                  onClick={() => fetchAAAAllocation(portfolioAssets)}
                  disabled={aaaLoading}
                >
                  {aaaLoading ? 'Fetching...' : aaaAllocation ? 'Refresh AAA' : 'Fetch from AAA'}
                </button>
              </div>
            </div>

            {aaaError && (
              <div className="text-amber-400 text-xs mb-3 px-1">{aaaError}</div>
            )}

            {aaaAllocation && (() => {
              const batch = activeBatches[0];
              const principal = Number(batch?.totalCollateralUsd ?? 0);
              return (
                <div>
                  <div className="text-xs text-slate-400 mb-3">
                    Batch #{batch?.id} &middot; {fmtUsd6(principal)} total
                    {aaaAllocation.source === 'fallback' && (
                      <span className="ml-2 text-amber-400">
                        (equal weights — deploy AAA endpoint to get live weights)
                      </span>
                    )}
                  </div>
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
                          const usdcAmt = Math.round(principal * a.weight);
                          return (
                            <tr key={a.symbol} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                              <td className="py-2 pr-6">
                                <span className="font-mono text-slate-100">{a.symbol}</span>
                                {meta && <span className="ml-2 text-slate-500 text-xs">{meta.name}</span>}
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
                Click <strong>Fetch from AAA</strong> to load recommended allocation weights for the active batch.
              </div>
            )}
          </div>
        </section>
      )}

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12">
          <div className="filter-toolbar">
            <div className="min-w-[220px] grow">
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Batch Filter (ID)</label>
              <input
                className="w-full mt-1 p-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                placeholder="e.g. 12"
              />
            </div>
            <div className="w-[160px]">
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Rows / Column</label>
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
              Newest batches are shown first.
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-5">
        <div className="sagitta-cell col-span-12 lg:col-span-4" style={{ minHeight: '220px' }}>
          <div className="flex items-center justify-between">
            <h3 className="section-title !mb-0">Active Batches</h3>
            <span className="text-xs text-slate-400">
              {activeVisible.length} / {activeSortedFiltered.length}
            </span>
          </div>
          {runningCount === 0 && <div className="text-slate-500 text-sm">No running batches</div>}
          {runningCount > 0 && activeSortedFiltered.length === 0 && (
            <div className="text-slate-500 text-sm">No running batches match the current filter.</div>
          )}
          <div className="grid gap-3 mt-3 max-h-72 overflow-y-auto pr-1">
            {activeVisible.map((b: any, i: number) => (
              <div key={`running-${b?.id}-${i}`} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/40">
                <div className="text-sm text-slate-200 font-mono">Batch #{String(b?.id ?? '0')}</div>
                <div className="text-xs text-slate-400">Started: {b.startTime ? new Date(Number(b.startTime) * 1000).toLocaleString() : 'n/a'}</div>
                <div className="text-sm mt-1">Collateral: {fmtUsd6(b.totalCollateralUsd)}</div>
                <div className="text-xs text-slate-400">Shares: {String(b?.totalShares ?? '0')}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <button
              className="pagination-button"
              onClick={() => setActivePage(Math.max(1, safeActivePage - 1))}
              disabled={safeActivePage <= 1}
            >
              Prev
            </button>
            <span>Page {safeActivePage} / {activeTotalPages}</span>
            <button
              className="pagination-button"
              onClick={() => setActivePage(Math.min(activeTotalPages, safeActivePage + 1))}
              disabled={safeActivePage >= activeTotalPages}
            >
              Next
            </button>
          </div>
        </div>

        <div className="sagitta-cell col-span-12 lg:col-span-4" style={{ minHeight: '220px' }}>
          <div className="flex items-center justify-between">
            <h3 className="section-title !mb-0">Invested Batches</h3>
            <span className="text-xs text-slate-400">
              {investedVisible.length} / {investedSortedFiltered.length}
            </span>
          </div>
          {investedCount === 0 && <div className="text-slate-500 text-sm">No invested batches</div>}
          {investedCount > 0 && investedSortedFiltered.length === 0 && (
            <div className="text-slate-500 text-sm">No invested batches match the current filter.</div>
          )}
          <div className="grid gap-3 mt-3 max-h-72 overflow-y-auto pr-1">
            {investedVisible.map((b: any, i: number) => (
              <div key={`invested-${b?.id}-${i}`} className="p-3 bg-emerald-900/10 rounded-lg border border-emerald-700/20">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-200 font-mono">Batch #{String(b?.id ?? '0')}</div>
                  <div className="text-xs text-emerald-300 font-semibold">Invested</div>
                </div>
                <div className="text-xs text-slate-400">Started: {b.startTime ? new Date(Number(b.startTime) * 1000).toLocaleString() : 'n/a'}</div>
                <div className="text-sm mt-1">Collateral: {fmtUsd6(b.totalCollateralUsd)}</div>
                <div className="text-xs text-slate-400">Shares: {String(b?.totalShares ?? '0')}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <button
              className="pagination-button"
              onClick={() => setInvestedPage(Math.max(1, safeInvestedPage - 1))}
              disabled={safeInvestedPage <= 1}
            >
              Prev
            </button>
            <span>Page {safeInvestedPage} / {investedTotalPages}</span>
            <button
              className="pagination-button"
              onClick={() => setInvestedPage(Math.min(investedTotalPages, safeInvestedPage + 1))}
              disabled={safeInvestedPage >= investedTotalPages}
            >
              Next
            </button>
          </div>
        </div>

        <div className="sagitta-cell col-span-12 lg:col-span-4" style={{ minHeight: '220px' }}>
          <div className="flex items-center justify-between">
            <h3 className="section-title !mb-0">Closed Batches</h3>
            <span className="text-xs text-slate-400">
              {closedVisible.length} / {closedSortedFiltered.length}
            </span>
          </div>
          {closedCount === 0 && <div className="text-slate-500 text-sm">No closed batches</div>}
          {closedCount > 0 && closedSortedFiltered.length === 0 && (
            <div className="text-slate-500 text-sm">No closed batches match the current filter.</div>
          )}
          <div className="grid gap-3 mt-3 max-h-72 overflow-y-auto pr-1">
            {closedVisible.map(({ batch, result }, i) => (
              <div key={batch.id.toString() + i} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/40">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-slate-200 font-mono">Batch #{batch.id.toString()}</div>
                  <div className="text-xs text-slate-400">Closed: {new Date(Number(batch.endTime) * 1000).toLocaleString()}</div>
                </div>
                <div className="mt-1 text-sm">Principal: {fmtUsd6(batch.totalCollateralUsd)}</div>
                {result ? (
                  <div className="text-sm mt-1">
                    Final: {fmtUsd6(result.finalValueUsd)} - Profit: {fmtUsd6(result.profitUsd)} - User: {fmtUsd6(result.userProfitUsd)} - Fee: {fmtUsd6(result.feeUsd)}
                  </div>
                ) : (
                  <div className="text-sm mt-1 text-slate-400">Result unavailable (missing final NAV/result data on this deployment)</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <button
              className="pagination-button"
              onClick={() => setClosedPage(Math.max(1, safeClosedPage - 1))}
              disabled={safeClosedPage <= 1}
            >
              Prev
            </button>
            <span>Page {safeClosedPage} / {closedTotalPages}</span>
            <button
              className="pagination-button"
              onClick={() => setClosedPage(Math.min(closedTotalPages, safeClosedPage + 1))}
              disabled={safeClosedPage >= closedTotalPages}
            >
              Next
            </button>
          </div>
        </div>
      </section>

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
