import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Info,
  Layers,
  Lock,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types matching escrowLifecycleTypes.ts on the server
// ─────────────────────────────────────────────────────────────────────────────

export type LifecycleStatus = 'active' | 'running' | 'blocked' | 'failed' | 'settled' | 'admin_hold';
export type ChecklistItemStatus = 'pass' | 'fail' | 'pending' | 'skipped';
export type ChecklistSource = 'db' | 'chain' | 'signer' | 'config' | 'registry' | 'server' | 'internal_api';

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistItemStatus;
  source: ChecklistSource;
  observedValue: string | null;
  expectedValue: string | null;
  blocking: boolean;
  errorCode: string | null;
  resolutionHint: string | null;
  retrySafe: boolean;
}

export interface ChecklistResult {
  phase: number;
  ready: boolean;
  blockingCount: number;
  items: ChecklistItem[];
  generatedAt: string;
}

export interface LifecycleRow {
  escrow_batch_id: string;
  escrow_batch_id_hash: string;
  chain_id: number;
  chain_key: string;
  treasury_address: string;
  source_batch_id: string;
  opened_at_unix: number;
  wallet_address: string | null;
  current_phase: number;
  status: LifecycleStatus;
  active_transition_id: string | null;
  active_phase: number | null;
  transition_lease_until: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
  current_blocking_summary: string | null;
  admin_events: unknown[];
  created_at: string;
  updated_at: string;
}

export interface PhaseEvidenceRow {
  id: string;
  escrow_batch_id: string;
  phase: number;
  transition_id: string;
  evidence_json: Record<string, unknown>;
  evidence_hash: string;
  created_at: string;
}

export interface PhaseAttemptRow {
  transition_id: string;
  escrow_batch_id: string;
  phase: number;
  attempt_number: number;
  status: string;
  started_at: string;
  lease_until: string;
  completed_at: string | null;
  tx_hash: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface BatchLifecycleState {
  lifecycle: LifecycleRow;
  evidence: Record<number, PhaseEvidenceRow>;
  latestAttempt: PhaseAttemptRow | null;
  allAttempts?: PhaseAttemptRow[];
  currentChecklist: ChecklistResult | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase metadata
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE_NAMES: Record<number, string> = {
  1: 'Treasury Handoff Registered',
  2: 'Authority Binding Anchored',
  3: 'Batch Wallet Created & Bound',
  4: 'Batch Wallet Funded',
  5: 'AAA Allocation Anchored',
  6: 'Destination Approvals Created',
  7: 'Deployment Approval Created',
  8: 'Deployment Legs Executed',
  9: 'Settlement Evidence Produced',
};

// ─────────────────────────────────────────────────────────────────────────────
// Small UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function trunc(s: string | null | undefined, n = 18): string {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: LifecycleStatus }) {
  const colours: Record<LifecycleStatus, string> = {
    active: 'bg-blue-900/40 text-blue-300',
    running: 'bg-yellow-900/40 text-yellow-300',
    blocked: 'bg-orange-900/40 text-orange-300',
    failed: 'bg-red-900/40 text-red-300',
    settled: 'bg-green-900/40 text-green-300',
    admin_hold: 'bg-purple-900/40 text-purple-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colours[status] ?? 'bg-slate-700 text-slate-300'}`}>
      {status}
    </span>
  );
}

function ChecklistStatusIcon({ status }: { status: ChecklistItemStatus }) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />;
  if (status === 'fail') return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
  if (status === 'pending') return <Clock3 className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
  return <Info className="h-4 w-4 text-slate-500 flex-shrink-0" />;
}

function SourceBadge({ source }: { source: ChecklistSource }) {
  const colour: Record<ChecklistSource, string> = {
    db: 'bg-slate-700 text-slate-300',
    chain: 'bg-indigo-900/50 text-indigo-300',
    signer: 'bg-amber-900/50 text-amber-300',
    config: 'bg-cyan-900/50 text-cyan-300',
    registry: 'bg-violet-900/50 text-violet-300',
    server: 'bg-emerald-900/50 text-emerald-300',
    internal_api: 'bg-pink-900/50 text-pink-300',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ${colour[source] ?? 'bg-slate-700/50'}`}>
      {source}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Phase Progress
// ─────────────────────────────────────────────────────────────────────────────

function PhaseProgressSection({ lc, evidence }: { lc: LifecycleRow; evidence: Record<number, PhaseEvidenceRow> }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Layers className="h-3.5 w-3.5" /> Phase Progress
      </h4>
      <ol className="space-y-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((phase) => {
          const isComplete = phase <= lc.current_phase;
          const isCurrent = phase === lc.current_phase + 1;
          const ev = evidence[phase];

          return (
            <li
              key={phase}
              className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm ${
                isCurrent ? 'bg-blue-900/30 ring-1 ring-blue-700/40' : ''
              } ${isComplete ? 'opacity-80' : isCurrent ? '' : 'opacity-40'}`}
            >
              <span className="mt-0.5 flex-shrink-0">
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : isCurrent ? (
                  <ChevronRight className="h-4 w-4 text-blue-500" />
                ) : (
                  <Lock className="h-4 w-4 text-slate-600" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-medium ${isCurrent ? 'text-blue-300' : isComplete ? 'text-slate-300' : 'text-slate-600'}`}>
                    Phase {phase}: {PHASE_NAMES[phase]}
                  </span>
                  {ev && (
                    <span className="flex-shrink-0 font-mono text-[10px] text-slate-500" title={ev.evidence_hash}>
                      {trunc(ev.evidence_hash, 12)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Current Phase Checklist
// ─────────────────────────────────────────────────────────────────────────────

function ChecklistSection({ checklist }: { checklist: ChecklistResult | null }) {
  if (!checklist) return null;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Phase {checklist.phase} Checklist
        </h4>
        <div className="flex items-center gap-2">
          {checklist.blockingCount > 0 && (
            <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-400">
              {checklist.blockingCount} blocking
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${checklist.ready ? 'bg-green-900/40 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
            {checklist.ready ? 'ready' : 'not ready'}
          </span>
        </div>
      </div>
      <ul className="space-y-2">
        {checklist.items.map((item) => (
          <li key={item.id} className={`rounded p-2 ${item.status === 'fail' && item.blocking ? 'bg-red-900/20 ring-1 ring-red-700/40' : 'bg-slate-800/30'}`}>
            <div className="flex items-start gap-2">
              <ChecklistStatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-200">{item.label}</span>
                  <SourceBadge source={item.source} />
                  {item.blocking && item.status === 'fail' && (
                    <span className="rounded bg-red-900/40 px-1 py-0.5 text-[10px] font-semibold uppercase text-red-400">blocking</span>
                  )}
                  {item.retrySafe && (
                    <span className="rounded bg-slate-700/50 px-1 py-0.5 text-[10px] text-slate-400">retry-safe</span>
                  )}
                </div>
                {(item.observedValue !== null || item.expectedValue !== null) && (
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                    {item.observedValue !== null && <span>observed: <code className="font-mono">{item.observedValue}</code></span>}
                    {item.expectedValue !== null && <span>expected: <code className="font-mono">{item.expectedValue}</code></span>}
                  </div>
                )}
                {item.errorCode && (
                  <div className="mt-0.5 font-mono text-xs text-red-400">{item.errorCode}</div>
                )}
                {item.resolutionHint && (
                  <div className="mt-1 text-xs text-amber-400">{item.resolutionHint}</div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-[10px] text-slate-500">evaluated {fmt(checklist.generatedAt)}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Last Attempt
// ─────────────────────────────────────────────────────────────────────────────

function LastAttemptSection({ attempt }: { attempt: PhaseAttemptRow | null }) {
  if (!attempt) return null;

  const statusColour: Record<string, string> = {
    claimed: 'text-yellow-400',
    running: 'text-blue-400',
    succeeded: 'text-green-400',
    failed: 'text-red-400',
    expired: 'text-slate-500',
    blocked: 'text-orange-400',
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Database className="h-3.5 w-3.5" /> Last Attempt
      </h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-slate-400">Phase</dt>
          <dd className="font-medium">{attempt.phase} ({PHASE_NAMES[attempt.phase] ?? '—'})</dd>
        </div>
        <div>
          <dt className="text-slate-400">Attempt #</dt>
          <dd className="font-medium">{attempt.attempt_number}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Status</dt>
          <dd className={`font-semibold ${statusColour[attempt.status] ?? 'text-slate-300'}`}>{attempt.status}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Started</dt>
          <dd>{fmt(attempt.started_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Completed</dt>
          <dd>{fmt(attempt.completed_at)}</dd>
        </div>
        {attempt.tx_hash && (
          <div className="col-span-full">
            <dt className="text-slate-400">Tx Hash</dt>
            <dd className="break-all font-mono text-xs text-indigo-400">{attempt.tx_hash}</dd>
          </div>
        )}
        {attempt.error_code && (
          <div className="col-span-full rounded bg-red-900/20 p-2">
            <dt className="font-semibold text-red-400">{attempt.error_code}</dt>
            {attempt.error_message && <dd className="mt-0.5 text-red-400">{attempt.error_message}</dd>}
          </div>
        )}
      </dl>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Blocking summary + Advance button
// ─────────────────────────────────────────────────────────────────────────────

function AdvanceSection({
  lc,
  checklist,
  onAdvance,
  advancing,
  onFinalizeAndAdvance,
  finalizeSettlementError,
}: {
  lc: LifecycleRow;
  checklist: ChecklistResult | null;
  onAdvance: () => void;
  advancing: boolean;
  onFinalizeAndAdvance: () => void;
  finalizeSettlementError: string | null;
}) {
  const nextPhase = lc.current_phase + 1;
  const canAdvance = lc.status !== 'running' && lc.status !== 'settled' && lc.status !== 'admin_hold' && nextPhase <= 9;

  const settlementBlocked = checklist?.items.some(
    (i) => i.errorCode === 'settlement_not_finalized' && i.blocking && i.status === 'fail',
  ) ?? false;

  let tooltip = '';
  if (lc.status === 'running') tooltip = 'A transition is in progress (lease held). Wait for it to complete.';
  if (lc.status === 'admin_hold') tooltip = 'Batch is in admin_hold. Admin action required before advancing.';
  if (lc.status === 'settled') tooltip = 'Batch has fully settled.';
  if (lc.status === 'blocked' && lc.current_blocking_summary && !settlementBlocked) tooltip = lc.current_blocking_summary;
  if (settlementBlocked) tooltip = 'Simulates investment return then advances Phase 9';

  const busy = advancing;
  const handleClick = settlementBlocked ? onFinalizeAndAdvance : onAdvance;

  const nextPhaseName = PHASE_NAMES[nextPhase] ?? '';

  return (
    <div className="space-y-2">
      {lc.current_blocking_summary && (lc.status === 'blocked' || lc.status === 'failed') && !settlementBlocked && (
        <div className="flex items-start gap-2 rounded-md bg-orange-900/20 p-3 text-sm text-orange-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-400" />
          <span>{lc.current_blocking_summary}</span>
        </div>
      )}
      {finalizeSettlementError && (
        <div className="rounded-md bg-red-900/20 px-3 py-2 font-mono text-xs text-red-400">
          {finalizeSettlementError}
        </div>
      )}
      {lc.status !== 'settled' && nextPhase <= 9 && (
        <p className="text-xs text-slate-500">
          Next: <span className="text-slate-300">{nextPhaseName}</span>
        </p>
      )}
      <button
        onClick={handleClick}
        disabled={!canAdvance || busy}
        title={tooltip}
        className={`action-button w-full ${
          !canAdvance || busy
            ? 'opacity-40 cursor-not-allowed bg-slate-700 border-slate-600 text-slate-400'
            : settlementBlocked
            ? 'action-button--success'
            : lc.status === 'blocked' || lc.status === 'failed'
            ? 'action-button--warning'
            : 'action-button--primary'
        }`}
      >
        {busy ? (
          <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {settlementBlocked ? 'Returning…' : 'Advancing…'}</>
        ) : lc.status === 'settled' ? (
          'Fully Settled'
        ) : nextPhase > 9 ? (
          'All Phases Complete'
        ) : settlementBlocked ? (
          <><ArrowDownToLine className="h-3.5 w-3.5" /> Simulate Return &amp; Advance</>
        ) : lc.status === 'blocked' ? (
          <>Retry Phase {nextPhase}</>
        ) : (
          <>Advance to Phase {nextPhase}</>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface BatchLifecycleCardProps {
  escrowBatchId?: string;
  chainKey?: string;
  sourceBatchId?: string;
  initialState?: BatchLifecycleState;
  onAdvanced?: (newState: BatchLifecycleState) => void;
  /** 'embedded' strips the outer card shell and mini-header — use when hosting inside another panel */
  variant?: 'card' | 'embedded' | 'rail';
}

export function BatchLifecycleCard({ escrowBatchId: propsEscrowBatchId, chainKey, sourceBatchId, initialState, onAdvanced, variant = 'card' }: BatchLifecycleCardProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(propsEscrowBatchId ?? null);
  const [state, setState] = useState<BatchLifecycleState | null>(initialState ?? null);
  const [loading, setLoading] = useState(!initialState);
  const [advancing, setAdvancing] = useState(false);
  const [finalizeSettlementError, setFinalizeSettlementError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (escrowBatchId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/banking/escrow/lifecycle?escrowBatchId=${encodeURIComponent(escrowBatchId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: BatchLifecycleState = await res.json();
      setState(data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load lifecycle state.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve escrowBatchId from chainKey+sourceBatchId if not supplied directly.
  useEffect(() => {
    if (propsEscrowBatchId) {
      setResolvedId(propsEscrowBatchId);
      return;
    }
    if (!chainKey || !sourceBatchId) return;
    setLoading(true);
    fetch('/api/banking/escrow/lifecycle/register-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainKey, sourceBatchId }),
    })
      .then((r) => r.json())
      .then((data) => {
        const id: string | undefined = data.escrowBatchId ?? data.lifecycle?.escrow_batch_id;
        if (id) setResolvedId(id);
        else setError('Batch not yet registered on-chain. Advance will trigger registration.');
      })
      .catch(() => setError('Could not resolve lifecycle identity for this batch.'))
      .finally(() => setLoading(false));
  }, [propsEscrowBatchId, chainKey, sourceBatchId]);

  useEffect(() => {
    if (resolvedId && !initialState) load(resolvedId);
  }, [resolvedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdvance = useCallback(async () => {
    if (!resolvedId) return;
    setAdvancing(true);
    setError(null);
    try {
      const res = await fetch('/api/banking/escrow/lifecycle/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowBatchId: resolvedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Reload fresh state after advance
      await load(resolvedId);
      if (onAdvanced && state) onAdvanced(state);
    } catch (err: any) {
      setError(err.message ?? 'Advance failed.');
    } finally {
      setAdvancing(false);
    }
  }, [resolvedId, load, onAdvanced, state]);

  const handleFinalizeAndAdvance = useCallback(async () => {
    if (!resolvedId) return;
    setAdvancing(true);
    setFinalizeSettlementError(null);
    try {
      // Step 1: trigger on-chain settlement (depositReturnForBatch)
      const fRes = await fetch('/api/banking/escrow/admin/finalize-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowBatchId: resolvedId }),
      });
      const fData = await fRes.json();
      if (!fRes.ok) throw new Error(fData.error ?? `HTTP ${fRes.status}`);
      // Step 2: advance Phase 9 now that settlement is finalized on-chain
      const aRes = await fetch('/api/banking/escrow/lifecycle/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowBatchId: resolvedId }),
      });
      const aData = await aRes.json();
      if (!aRes.ok) throw new Error(aData.error ?? `HTTP ${aRes.status}`);
      await load(resolvedId);
      if (onAdvanced && state) onAdvanced(state);
    } catch (err: any) {
      setFinalizeSettlementError(err.message ?? 'Simulate return & advance failed.');
    } finally {
      setAdvancing(false);
    }
  }, [resolvedId, load, onAdvanced, state]);

  if (loading && !state) {
    if (variant === 'rail') return (
      <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
        <RefreshCw className="h-3 w-3 animate-spin" /> Loading phase state…
      </div>
    );
    if (variant === 'embedded') return (
      <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading lifecycle…
      </div>
    );
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-700/50 bg-slate-800/30 p-8">
        <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-400">Loading lifecycle state…</span>
      </div>
    );
  }

  if (error && !state) {
    if (variant === 'rail' || variant === 'embedded') return (
      <div className="rounded px-2 py-1.5 text-xs text-red-400">
        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{error}
        <button onClick={() => resolvedId && load(resolvedId)} className="ml-2 underline">Retry</button>
      </div>
    );
    return (
      <div className="rounded-xl border border-red-700/50 bg-red-900/20 p-4 text-sm text-red-400">
        <AlertTriangle className="mr-1.5 inline h-4 w-4" />
        {error}
        <button onClick={() => resolvedId && load(resolvedId)} className="ml-3 underline hover:no-underline">Retry</button>
      </div>
    );
  }

  if (!state) return null;

  const { lifecycle: lc, evidence, latestAttempt, currentChecklist } = state;

  // ── Rail variant ─────────────────────────────────────────────────────────────
  if (variant === 'rail') {
    const nextPhase = lc.current_phase + 1;
    const canAdvance = lc.status !== 'running' && lc.status !== 'settled' && lc.status !== 'admin_hold' && nextPhase <= 9;
    const settlementBlocked = currentChecklist?.items.some(
      (i) => i.errorCode === 'settlement_not_finalized' && i.blocking && i.status === 'fail',
    ) ?? false;
    const railHandleClick = settlementBlocked ? handleFinalizeAndAdvance : handleAdvance;

    const railBtnClass = [
      'action-button flex-shrink-0',
      !canAdvance || advancing
        ? 'opacity-40 cursor-not-allowed bg-slate-700 border-slate-600 text-slate-400'
        : settlementBlocked
        ? 'action-button--success'
        : lc.status === 'blocked' || lc.status === 'failed'
        ? 'action-button--warning'
        : 'action-button--primary',
    ].join(' ');

    return (
      <div className="space-y-3">
        {/* Numbered phase circles with connecting lines */}
        <div className="flex items-center">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((phase, idx) => {
            const isComplete = phase <= lc.current_phase;
            const isCurrent = phase === lc.current_phase + 1;
            return (
              <React.Fragment key={phase}>
                {idx > 0 && (
                  <div className={`h-px flex-1 ${idx <= lc.current_phase ? 'bg-green-700/50' : 'bg-slate-700/40'}`} />
                )}
                <div
                  title={`Phase ${phase}: ${PHASE_NAMES[phase]}`}
                  className={[
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold border transition-all',
                    isComplete
                      ? 'border-green-600/60 bg-green-900/30 text-green-400'
                      : isCurrent
                      ? 'border-blue-500/60 bg-blue-900/20 text-blue-300 shadow-[0_0_0_3px_rgba(59,130,246,0.14)]'
                      : 'border-slate-700/50 bg-slate-800/20 text-slate-600',
                  ].join(' ')}
                >
                  {isComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{phase}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Blocking error strip */}
        {lc.current_blocking_summary && (lc.status === 'blocked' || lc.status === 'failed') && !settlementBlocked && (
          <div className="flex items-start gap-2 rounded bg-orange-900/20 px-3 py-1.5 text-xs text-orange-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{lc.current_blocking_summary}</span>
          </div>
        )}
        {finalizeSettlementError && (
          <div className="rounded bg-red-900/20 px-3 py-1.5 font-mono text-xs text-red-400">{finalizeSettlementError}</div>
        )}
        {error && (
          <div className="rounded bg-red-900/20 px-3 py-1.5 text-xs text-red-400">
            <AlertTriangle className="mr-1 inline h-3 w-3" />{error}
          </div>
        )}

        {/* Next phase label + advance button */}
        <div className="flex items-center justify-between gap-4">
          <p className="min-w-0 text-xs text-slate-400">
            {lc.status === 'settled' ? (
              <span className="text-green-400">Batch fully settled</span>
            ) : nextPhase > 9 ? (
              'All phases complete'
            ) : (
              <>Next: <span className="font-medium text-slate-200">{PHASE_NAMES[nextPhase]}</span></>
            )}
          </p>
          <button
            onClick={railHandleClick}
            disabled={!canAdvance || advancing}
            className={railBtnClass}
          >
            {advancing ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {settlementBlocked ? 'Returning…' : 'Advancing…'}</>
            ) : lc.status === 'settled' ? (
              'Settled'
            ) : nextPhase > 9 ? (
              'Complete'
            ) : settlementBlocked ? (
              <><ArrowDownToLine className="h-3.5 w-3.5" /> Simulate Return &amp; Advance</>
            ) : lc.status === 'blocked' ? (
              <>Retry Phase {nextPhase}</>
            ) : (
              <>Advance to Phase {nextPhase}</>
            )}
          </button>
        </div>

        <p className="text-right text-[10px] text-slate-600">updated {fmt(lc.updated_at)}</p>
      </div>
    );
  }

  // ── Embedded / Card variants ─────────────────────────────────────────────────
  const content = (
    <>
      {error && (
        <div className="rounded-md bg-red-900/20 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{error}
        </div>
      )}
      <PhaseProgressSection lc={lc} evidence={evidence} />
      <ChecklistSection checklist={currentChecklist} />
      <LastAttemptSection attempt={latestAttempt} />
      <AdvanceSection
        lc={lc}
        checklist={currentChecklist}
        onAdvance={handleAdvance}
        advancing={advancing}
        onFinalizeAndAdvance={handleFinalizeAndAdvance}
        finalizeSettlementError={finalizeSettlementError}
      />
      <p className="text-right text-[10px] text-slate-500">updated {fmt(lc.updated_at)}</p>
    </>
  );

  if (variant === 'embedded') {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-100">
              Batch #{lc.source_batch_id} · {lc.chain_key}
            </span>
            <StatusBadge status={lc.status} />
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{trunc(lc.escrow_batch_id, 28)}</p>
        </div>
        <button
          onClick={() => resolvedId && load(resolvedId)}
          disabled={loading}
          className="flex-shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {content}
    </div>
  );
}

export default BatchLifecycleCard;
