import React, { useEffect, useState } from 'react';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, ShieldCheck, Handshake } from 'lucide-react';

// NEW imports for on-chain interactions
import { JsonRpcProvider, Contract, Wallet, Interface } from 'ethers';
import INVESTMENT_ESCROW_ABI from '../../lib/abis/InvestmentEscrow.json';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import TREASURY_ABI from '../../lib/abis/Treasury.json';
import { RefreshCw } from 'lucide-react';

export default function EscrowTab() {
  // On-chain constants
  const LOCALHOST_RPC = "http://127.0.0.1:8545";
  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const ESCROW_ADDRESS = (CONTRACT_ADDRESSES as any).InvestmentEscrow;

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

  // NEW: EscrowTab state for keeper/owner controls
  const [escrowAddr, setEscrowAddr] = useState<string | null>(CONTRACT_ADDRESSES.InvestmentEscrow || null);
  const [escrowUsdc, setEscrowUsdc] = useState<number>(0);
  const [batchIdInput, setBatchIdInput] = useState('');
  const [navInput, setNavInput] = useState('1.10');

  useEffect(() => {
    const rp = new JsonRpcProvider(LOCALHOST_RPC);
    const w = new Wallet(TEST_PRIVATE_KEY, rp);
    setProvider(rp);
    setSigner(w);
    if (ESCROW_ADDRESS && ESCROW_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      const c = new Contract(ESCROW_ADDRESS, INVESTMENT_ESCROW_ABI, rp);
      setEscrow(c);
    } else {
      setLog(l => [`No InvestmentEscrow address in CONTRACT_ADDRESSES`, ...l]);
    }
  }, []);

  // React to new blocks so UI reflects simulation actions immediately
  useEffect(() => {
    if (!provider) return;
    const onBlock = async (_blockNumber: number) => {
      // lightweight refresh when a new block is mined
      try { await refreshBatchSummary(); } catch (_) {}
    };
    provider.on('block', onBlock);
    return () => { provider.off('block', onBlock); };
  }, [provider]);

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

        console.log(`Fetched batches by status: pending=${Array.isArray(pending) ? pending.length : 'n/a'} running=${Array.isArray(running) ? running.length : 'n/a'} closed=${Array.isArray(closed) ? closed.length : 'n/a'} invested=${Array.isArray(invested) ? invested.length : 'n/a'}`);

        // If returned arrays are empty (contract missing function or ABI mismatch),
        // fallback to a full probe using dumpBatches to reconstruct lists.
        const totalFromStatusCalls = (Array.isArray(pending) ? pending.length : 0)
          + (Array.isArray(running) ? running.length : 0)
          + (Array.isArray(closed) ? closed.length : 0)
          + (Array.isArray(invested) ? invested.length : 0);

        console.log(`Batch status call totals: pending=${Array.isArray(pending) ? pending.length : 'n/a'} running=${Array.isArray(running) ? running.length : 'n/a'} closed=${Array.isArray(closed) ? closed.length : 'n/a'} invested=${Array.isArray(invested) ? invested.length : 'n/a'} => total=${totalFromStatusCalls}`);

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
            const id = Number(b.id);
            try {
              const res = await escrow.getClosedBatchResult(id);
              closedWithResults.push({ batch: b, result: res });
            } catch {
              closedWithResults.push({ batch: b, result: null });
            }
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
            const id = Number(b.id);
            try {
              const res = await escrow.getClosedBatchResult(id);
              closedWithResults.push({ batch: b, result: res });
            } catch {
              closedWithResults.push({ batch: b, result: null });
            }
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
          const id = Number(b.id);
          try {
            const res = await escrow.getClosedBatchResult(id);
            closedWithResults.push({ batch: b, result: res });
          } catch {
            closedWithResults.push({ batch: b, result: null });
          }
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
      return `$${(Number(s) / 1e6).toLocaleString(undefined, {maximumFractionDigits: 6})}`;
    } catch {
      return '$0';
    }
  }

  useEffect(() => {
    // initial load (no periodic timer)
    refreshBatchSummary();
    // no interval — avoid noisy periodic refreshes/log spam
    return;
  }, [escrow]);

  // Debug helper: probe and collect batches 1..limit (best-effort, tolerant to ABI mismatch)
  async function dumpBatches(limit = 40) {
    if (!provider || !escrow) {
      // provider or escrow not ready — silently return (no dump log)
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

  async function handleStartBatch() {
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
      const escrowWithSigner = escrow.connect(signer);

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

      await refreshBatchSummary();
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
      const escrowWithSigner = escrow.connect(signer);

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

      await refreshBatchSummary();
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
      const escrowWithSigner = escrow.connect(signer);

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

      await refreshBatchSummary();
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
      const escrowWithSigner = escrow.connect(signer);

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

      await refreshBatchSummary();
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
      const treasuryAddr = CONTRACT_ADDRESSES.Treasury;
      let usdcAddr: string | null = null;
      try {
        const tre = new Contract(treasuryAddr, TREASURY_ABI, provider);
        usdcAddr = await tre.usdc().catch(() => null);
      } catch {
        usdcAddr = null;
      }
      if (!usdcAddr) {
        // try common frontend address
        usdcAddr = CONTRACT_ADDRESSES.MockUSDC ?? null;
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

  async function depositReturnForBatch() {
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
      await refresh();
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
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message || e);
      // If the deployed contract is still the old version it will revert "Batch not closed".
      // As a last-resort admin recovery, attempt owner-only forceSetBatchInvested if available and if signer is the owner.
      if (msg.includes('Batch not closed') || msg.includes('Batch not running')) {
        setLog(l => [`[escrow] distributeBatchBurn reverted: ${msg} — attempting owner-only forceSetBatchInvested() as fallback`, ...l]);
        try {
          const escrowWithSigner = escrow.connect(signer);
          if (typeof escrowWithSigner.forceSetBatchInvested === 'function') {
            // Optional: estimate owner by calling owner() first; attempt call only if signer address equals owner
            try {
              const onchainOwner = await escrowWithSigner.owner();
              const signerAddr = await signer.getAddress?.() ?? signer.address ?? null;
              if (signerAddr && signerAddr.toLowerCase() === onchainOwner.toLowerCase()) {
                const tx2 = await escrowWithSigner.forceSetBatchInvested(batchId);
                await tx2.wait();
                setLog(l => [`[escrow] forceSetBatchInvested(${batchId}) succeeded (tx=${tx2.hash})`, ...l]);
                await refresh();
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
        await refresh();
        return;
      }

      // Fallback for older deployments: try distributeBatchBurn compatibility wrapper
      if (typeof escrow.distributeBatchBurn === 'function') {
        const tx2 = await escrow.distributeBatchBurn(batchId);
        await tx2.wait();
        setLog(l => [`[${new Date().toLocaleTimeString()}] distributeBatchBurn(batch=${batchId}) executed (compat) tx=${tx2.hash}`, ...l]);
        await refresh();
        return;
      }

      setLog(l => ['[escrow] contract does not expose investBatch or distributeBatchBurn', ...l]);
    } catch (e:any) {
      const errMsg = String(e?.message || e);
      setLog(l => [`[escrow] investBatch failed: ${errMsg}`, ...l]);

      // TRY DEV PUBLIC BURN FALLBACK: publicBurnBatch (no auth) - useful when token transfer paths revert
      try {
        if (typeof escrow.publicBurnBatch === 'function') {
          setLog(l => ['[escrow] attempting publicBurnBatch() fallback (dev public burn)', ...l]);
          const escrowWithSigner = escrow.connect(signer);
          const txpb = await escrowWithSigner.publicBurnBatch(batchId);
          await txpb.wait();
          setLog(l => [`[escrow] publicBurnBatch(${batchId}) succeeded (tx=${txpb.hash})`, ...l]);
          await refresh();
          setLoading(false);
          return;
        }
      } catch (pubBurnErr:any) {
        setLog(l => [`[escrow] publicBurnBatch fallback failed: ${String(pubBurnErr?.message || pubBurnErr)}`, ...l]);
      }

      // TRY SAFE PUBLIC FALLBACK: markBatchInvestedWithoutTransfer (accounting-only, no ERC20 transfer)
      try {
        if (typeof escrow.markBatchInvestedWithoutTransfer === 'function') {
          setLog(l => ['[escrow] attempting markBatchInvestedWithoutTransfer() fallback (accounting-only)', ...l]);
          const txm = await escrow.markBatchInvestedWithoutTransfer(batchId);
          await txm.wait();
          setLog(l => [`[escrow] markBatchInvestedWithoutTransfer(${batchId}) succeeded (tx=${txm.hash})`, ...l]);
          await refresh();
          setLoading(false);
          return;
        }
      } catch (markErr:any) {
        setLog(l => [`[escrow] markBatchInvestedWithoutTransfer fallback failed: ${String(markErr?.message || markErr)}`, ...l]);
      }

      // TRY SAFE PUBLIC FALLBACK: investBatchIfFunded (any caller) — only succeeds if Escrow already holds the batch's USDC.
      try {
        if (typeof escrow.investBatchIfFunded === 'function') {
          setLog(l => ['[escrow] attempting investBatchIfFunded() fallback (public-funded path)', ...l]);
          const txf = await escrow.investBatchIfFunded(batchId);
          await txf.wait();
          setLog(l => [`[escrow] investBatchIfFunded(${batchId}) succeeded (tx=${txf.hash})`, ...l]);
          await refresh();
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

        // find USDC address via Treasury (fallback to CONTRACT_ADDRESSES.MockUSDC)
        let usdcAddr: string | null = null;
        try {
          const treAddr = (CONTRACT_ADDRESSES as any).Treasury;
          if (treAddr) {
            const tre = new Contract(treAddr, TREASURY_ABI, provider);
            usdcAddr = await tre.usdc().catch(() => null);
          }
        } catch { usdcAddr = null; }
        if (!usdcAddr) usdcAddr = (CONTRACT_ADDRESSES as any).MockUSDC ?? null;

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
            if (typeof escrow.forceSetBatchInvested === 'function') {
              setLog(l => [`[escrow:diag] signer is owner -> attempting forceSetBatchInvested(${batchId})`, ...l]);
              const escrowWithSigner = escrow.connect(signer);
              const txf = await escrowWithSigner.forceSetBatchInvested(batchId);
              await txf.wait();
              setLog(l => [`[escrow:diag] forceSetBatchInvested succeeded (tx=${txf.hash})`, ...l]);
              await refresh();
              setLoading(false);
              return;
            } else {
              setLog(l => ['[escrow:diag] contract ABI missing forceSetBatchInvested', ...l]);
            }
          } catch (e2:any) {
            setLog(l => [`[escrow:diag] forceSetBatchInvested failed: ${String(e2?.message || e2)}`, ...l]);
          }
        } else {
          setLog(l => ['[escrow:diag] signer is not owner — cannot perform owner-only recovery', ...l]);
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
      await refresh();
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

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Escrow Management
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
          <div className="col-span-1"><MetricCard title="Escrow Address" value={escrowAddr ?? 'not set'} tone="neutral" /></div>
          <div className="col-span-1"><MetricCard title="Escrow USDC Balance" value={escrowUsdc ? `$${(escrowUsdc / 1e6).toFixed(2)}` : '$0'} tone="neutral" /></div>
        </MetricGrid>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Start Batch</h3>
          <p className="text-sm text-slate-400 mb-2">Roll the current pending batch into an active batch and request funds from Treasury (admin only).</p>
          <button
            onClick={handleStartBatch}
            disabled={loading}
            className="w-full px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold disabled:opacity-60"
          >
            {loading ? 'Submitting...' : 'Start Batch (rollToNewBatch)'}
          </button>
        </div>
      </div>

      {/* NEW: Active Batches */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold text-slate-200">Active Batches</h3>
        {activeBatches.filter((b:any)=>Number(b?.id)>0).length === 0 && <div className="text-slate-500 text-sm">No running batches</div>}
         <div className="grid gap-3 mt-3">
          {/* Pending batches first (filter out invalid id === 0) */}
          

          {/* Running batches */}
           {activeBatches.map((b: any, i: number) => (
             <div key={`running-${b?.id}-${i}`} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/40">
               <div className="text-sm text-slate-200 font-mono">Batch #{String(b?.id ?? '0')}</div>
               <div className="text-xs text-slate-400">Started: {b.startTime ? new Date(Number(b.startTime) * 1000).toLocaleString() : 'n/a'}</div>
               <div className="text-sm mt-1">Collateral: {fmtUsd6(b.totalCollateralUsd)}</div>
               <div className="text-xs text-slate-400">Shares: {String(b?.totalShares ?? '0')}</div>
             </div>
           ))}
         </div>
       </div>

      {/* NEW: Keeper/Owner Controls */}
      <div className="space-y-6 p-6">
        
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold">Investment Escrow</h3>
          
        </div>

        <div className="bg-slate-800 p-4 rounded">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-300 mb-2">Final NAV per share (1.10 = 10% Profit)</div>
              
              <label className="text-sm text-slate-300">Batch ID </label>
              <input className="w-full mt-1 p-2 rounded bg-slate-900" value={batchIdInput} onChange={e => setBatchIdInput(e.target.value)} placeholder="Batch ID" />
              <label className="text-sm text-slate-300 mt-2 block"> </label>
              <input className="w-full mt-1 p-2 rounded bg-slate-900" value={navInput} onChange={e => setNavInput(e.target.value)} placeholder="1.05" />
              
              <div className="flex gap-2 mt-3">
                <button
                  className="px-4 py-2 bg-rose-600 text-white rounded"
                  onClick={investBatch}
                  disabled={loading}
                >
                  Invest Batch (burn escrow USDC)
                </button>
              </div>
              
              
            </div>
            <div>
              <div className="text-sm text-slate-300 mb-2">Investments return USDC to the Escrow contract</div>
              <div className="flex gap-2 mt-3">
                <button className="px-4 py-2 bg-emerald-600 text-white rounded" onClick={depositReturnForBatch} disabled={loading}>Deposit Returns</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NEW: Invested Batches (status = 4) */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold text-slate-200">Invested Batches</h3>
        {investedBatches.length === 0 && <div className="text-slate-500 text-sm">No invested batches</div>}
        <div className="grid gap-3 mt-3">
          {investedBatches.map((b: any, i: number) => (
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
      </div>

      {/* NEW: Closed Batches with results */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold text-slate-200">Closed Batches (Results)</h3>
        {closedBatches.length === 0 && <div className="text-slate-500 text-sm">No closed batches</div>}
        <div className="grid gap-3 mt-3">
          {closedBatches.map(({ batch, result }, i) => (
            <div key={batch.id.toString() + i} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/40">
              <div className="flex justify-between items-center">
                <div className="text-sm text-slate-200 font-mono">Batch #{batch.id.toString()}</div>
                <div className="text-xs text-slate-400">Closed: {new Date(Number(batch.endTime) * 1000).toLocaleString()}</div>
              </div>
              <div className="mt-1 text-sm">Principal: {fmtUsd6(batch.totalCollateralUsd)}</div>
              {result ? (
                <div className="text-sm mt-1">
                  Final Value: {fmtUsd6(result.finalValueUsd)} • Profit: {fmtUsd6(result.profitUsd)} • User: {fmtUsd6(result.userProfitUsd)} • Fee: {fmtUsd6(result.feeUsd)}
                </div>
              ) : (
                <div className="text-sm mt-1 text-slate-400">Result unavailable</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <h3 className="text-lg font-semibold mb-6 text-slate-200 flex items-center gap-2">
          Escrow Log
        </h3>
        
        {log.length === 0 && <div className="text-slate-500">No actions yet.</div>}
        {log.map((entry, i) => (
          <div key={i} className="mb-1">{entry}</div>
        ))}
      </div>
    </div>
  );
}
