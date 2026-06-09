import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Hash,
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
  currentChecklist: ChecklistResult | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase metadata
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_NAMES: Record<number, string> = {
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
// Section: Batch Identity
// ─────────────────────────────────────────────────────────────────────────────

function IdentitySection({ lc }: { lc: LifecycleRow }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Hash className="h-3.5 w-3.5" /> Batch Identity
      </h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-400">Escrow Batch ID</dt>
          <dd className="font-mono text-xs truncate" title={lc.escrow_batch_id}>{trunc(lc.escrow_batch_id, 22)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Source Batch ID</dt>
          <dd className="font-mono text-xs">{lc.source_batch_id}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Chain</dt>
          <dd className="font-mono text-xs">{lc.chain_key} ({lc.chain_id})</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Treasury</dt>
          <dd className="font-mono text-xs truncate" title={lc.treasury_address}>{trunc(lc.treasury_address, 20)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Opened At</dt>
          <dd className="font-mono text-xs">{lc.opened_at_unix ? new Date(lc.opened_at_unix * 1000).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Wallet</dt>
          <dd className="font-mono text-xs truncate" title={lc.wallet_address ?? ''}>
            {lc.wallet_address ? trunc(lc.wallet_address, 20) : <span className="text-slate-500">not yet set</span>}
          </dd>
        </div>
      </dl>
    </div>
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
  if (!checklist) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Phase Checklist
        </h4>
        <p className="text-xs text-slate-500">No checklist available. Click Refresh or Advance to evaluate.</p>
      </div>
    );
  }

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
  if (!attempt) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Database className="h-3.5 w-3.5" /> Last Attempt
        </h4>
        <p className="text-xs text-slate-500">No transitions attempted yet.</p>
      </div>
    );
  }

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
  onFinalizeSettlement,
  finalizingSettlement,
  finalizeSettlementError,
}: {
  lc: LifecycleRow;
  checklist: ChecklistResult | null;
  onAdvance: () => void;
  advancing: boolean;
  onFinalizeSettlement: () => void;
  finalizingSettlement: boolean;
  finalizeSettlementError: string | null;
}) {
  const nextPhase = lc.current_phase + 1;
  const canAdvance = lc.status !== 'running' && lc.status !== 'settled' && lc.status !== 'admin_hold' && nextPhase <= 9;

  let tooltip = '';
  if (lc.status === 'running') tooltip = 'A transition is in progress (lease held). Wait for it to complete.';
  if (lc.status === 'admin_hold') tooltip = 'Batch is in admin_hold. Admin action required before advancing.';
  if (lc.status === 'settled') tooltip = 'Batch has fully settled.';
  if (lc.status === 'blocked' && lc.current_blocking_summary) tooltip = lc.current_blocking_summary;

  const settlementBlocked = checklist?.items.some(
    (i) => i.errorCode === 'settlement_not_finalized' && i.blocking && i.status === 'fail',
  ) ?? false;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
      {lc.current_blocking_summary && (lc.status === 'blocked' || lc.status === 'failed') && (
        <div className="flex items-start gap-2 rounded-md bg-orange-900/20 p-3 text-sm text-orange-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-400" />
          <span>{lc.current_blocking_summary}</span>
        </div>
      )}

      {settlementBlocked && (
        <div className="rounded-md bg-indigo-900/20 p-3 text-sm text-indigo-300 space-y-2">
          <div className="flex items-start gap-2">
            <ArrowDownToLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-400" />
            <span>
              Investment proceeds have not yet returned to escrow.
              Click to simulate the return (calls <code className="font-mono text-xs">depositReturnForBatch</code> with 1:1 NAV).
            </span>
          </div>
          {finalizeSettlementError && (
            <div className="font-mono text-xs text-red-400">{finalizeSettlementError}</div>
          )}
          <button
            onClick={onFinalizeSettlement}
            disabled={finalizingSettlement}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors
              ${finalizingSettlement
                ? 'cursor-not-allowed bg-slate-700 text-slate-500'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
          >
            {finalizingSettlement
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Simulating return…</>
              : <><ArrowDownToLine className="h-3.5 w-3.5" /> Simulate Return &amp; Settle</>
            }
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {lc.status === 'settled'
            ? 'Batch is fully settled.'
            : nextPhase > 9
            ? 'All phases complete.'
            : `Current: Phase ${lc.current_phase} · Next: Phase ${nextPhase} — ${PHASE_NAMES[nextPhase] ?? ''}`}
        </div>
        <button
          onClick={onAdvance}
          disabled={!canAdvance || advancing}
          title={tooltip}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors
            ${canAdvance && !advancing
              ? lc.status === 'blocked' || lc.status === 'failed'
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-blue-600 text-white hover:bg-blue-700'
              : 'cursor-not-allowed bg-slate-700 text-slate-500'
            }`}
        >
          {advancing ? (
            <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Advancing…</>
          ) : lc.status === 'blocked' ? (
            <>Retry Phase {nextPhase}</>
          ) : (
            <>Advance to Phase {nextPhase}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface BatchLifecycleCardProps {
  // Supply exactly one identity: either a known escrowBatchId or chainKey+sourceBatchId pair.
  // When chainKey+sourceBatchId are supplied, the card registers the batch if needed and
  // resolves the escrowBatchId from the server before displaying lifecycle state.
  escrowBatchId?: string;
  chainKey?: string;
  sourceBatchId?: string;
  initialState?: BatchLifecycleState;
  onAdvanced?: (newState: BatchLifecycleState) => void;
}

export function BatchLifecycleCard({ escrowBatchId: propsEscrowBatchId, chainKey, sourceBatchId, initialState, onAdvanced }: BatchLifecycleCardProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(propsEscrowBatchId ?? null);
  const [state, setState] = useState<BatchLifecycleState | null>(initialState ?? null);
  const [loading, setLoading] = useState(!initialState);
  const [advancing, setAdvancing] = useState(false);
  const [finalizingSettlement, setFinalizingSettlement] = useState(false);
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

  const handleFinalizeSettlement = useCallback(async () => {
    if (!resolvedId) return;
    setFinalizingSettlement(true);
    setFinalizeSettlementError(null);
    try {
      const res = await fetch('/api/banking/escrow/admin/finalize-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowBatchId: resolvedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Reload so Phase 9 checklist re-evaluates
      await load(resolvedId);
    } catch (err: any) {
      setFinalizeSettlementError(err.message ?? 'Finalize settlement failed.');
    } finally {
      setFinalizingSettlement(false);
    }
  }, [resolvedId, load]);

  if (loading && !state) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-700/50 bg-slate-800/30 p-8">
        <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-400">Loading lifecycle state…</span>
      </div>
    );
  }

  if (error && !state) {
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

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
      {/* Header */}
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

      {error && (
        <div className="rounded-md bg-red-900/20 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{error}
        </div>
      )}

      {/* Six sections */}
      <IdentitySection lc={lc} />
      <PhaseProgressSection lc={lc} evidence={evidence} />
      <ChecklistSection checklist={currentChecklist} />
      <LastAttemptSection attempt={latestAttempt} />
      <AdvanceSection
        lc={lc}
        checklist={currentChecklist}
        onAdvance={handleAdvance}
        advancing={advancing}
        onFinalizeSettlement={handleFinalizeSettlement}
        finalizingSettlement={finalizingSettlement}
        finalizeSettlementError={finalizeSettlementError}
      />

      <p className="text-right text-[10px] text-slate-500">
        last updated {fmt(lc.updated_at)}
      </p>
    </div>
  );
}

export default BatchLifecycleCard;
