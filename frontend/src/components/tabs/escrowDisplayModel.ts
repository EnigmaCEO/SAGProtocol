/**
 * Canonical display model for a single escrow batch.
 *
 * buildEscrowBatchDisplayModel() is a pure function — no async, no React.
 * Every tab in the batch detail panel and every management table row
 * must derive its display values from this model instead of reading
 * batch.*, lcRow.*, or evidence[*] directly.
 *
 * Source precedence for each field group is documented inline.
 */

import type { EscrowBatch } from '../../lib/escrow/batches';
import type { LifecycleRow, PhaseEvidenceRow } from '../BatchLifecycleCard';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-shapes
// ─────────────────────────────────────────────────────────────────────────────

export type WalletStatus = 'created_bound' | 'predicted' | 'not_created';
export type WalletSource = 'phase3_evidence' | 'metadata_predicted' | 'none';
export type AmountSource = 'phase1_evidence' | 'order_estimate';
export type SettlementSource = 'phase9_evidence' | 'batch_object' | 'none';
/** Where a leg's planned fields (provider, allocation, yield) were sourced from */
export type LegPlannedSource = 'phase7_evidence' | 'batch_object' | 'none';

export interface DisplayLeg {
  legId: string;
  provider: string;
  asset: string;
  strategyType: string;
  amountUsd: number;
  allocationPercent: number;
  targetYieldBps: number;
  status: string;
  destinationName?: string;
  destinationType?: string;
  destinationAddress?: string;
  providerReferenceId?: string;
  /** Confirmed from Phase 8 evidence; falls back to leg.deploymentTxHash */
  deploymentTxHash?: string;
  /** Confirmed from Phase 8 evidence; falls back to leg.deployedAt */
  deployedAt?: string;
  /** Live mark-to-market from batch object — NOT a settlement receipt */
  currentValueUsd?: number;
  /** Confirmed settlement receipt from Phase 9 evidence — null until Phase 9 completes */
  settledAmountUsd: number | null;
  /** settledAmountUsd - amountUsd; null until settled */
  legPnlUsd: number | null;
  /** legPnlUsd / amountUsd * 100; null until settled */
  legPnlPct: number | null;
  settledAt: string | null;
  /**
   * How the per-leg returned amount was derived.
   * 'proportional_allocation_from_batch_settlement': no per-leg on-chain receipt;
   * amount allocated in proportion to deployed principal from batch total.
   * 'dev_simulated_jitter': deterministic seeded NAV jitter; simulation: true,
   * productionValid: false — not real settlement evidence.
   * 'dev_leg_position_simulation': realized from dev leg position harness records.
   * null when Phase 9 evidence is absent.
   */
  legSettlementMethod: 'proportional_allocation_from_batch_settlement' | 'dev_simulated_jitter' | 'dev_leg_position_simulation' | null;

  // ── Dev leg position simulation (pre-Phase-9, dev-only) ─────────────────────
  /** True when a dev leg position record exists for this leg */
  isDevSimulated: boolean;
  /** Status from escrow_dev_leg_positions: 'deployed' | 'marked' | 'returned'; null if no record */
  devLegStatus: 'deployed' | 'marked' | 'returned' | null;
  /** Current mark-to-market value from dev simulation (usd6 bigint string); null if not marked */
  currentValueUsd6Dev: string | null;
  /** Unrealized P&L from dev simulation (usd6 bigint string); null if not marked */
  unrealizedPnlUsd6Dev: string | null;
  /** Unrealized P&L in basis points from dev simulation; null if not marked */
  unrealizedPnlBpsDev: number | null;

  // ── Provenance ──────────────────────────────────────────────────────────────
  /** Whether planned fields were sourced from Phase 7 evidence, batch object, or unknown */
  plannedSource: LegPlannedSource;
  /** Planned deployment amount as a usd6 bigint string from Phase 7 evidence; null if absent */
  plannedAmountUsd6: string | null;
  /** Executed amount as a usd6 bigint string from Phase 8 evidence; null if absent */
  executedAmountUsd6: string | null;
  /** Returned (settled) amount as a usd6 bigint string from Phase 9 evidence; null if absent */
  returnedAmountUsd6: string | null;
  /** realizedPnlUsd6 = returnedAmountUsd6 − plannedAmountUsd6 as a signed bigint string; null if either is absent */
  realizedPnlUsd6: string | null;
  /** realizedPnl expressed in basis points (10000 = 100%); null if unavailable */
  realizedPnlBps: number | null;
  /**
   * Non-null when Phase 8 evidence exists but Phase 7 evidence has no planned payload.
   * The UI should display this warning next to the leg card rather than inventing values.
   */
  phase7Warning: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main model type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DISPLAY CACHE ONLY — hydrated from Phase evidence, lifecycle row, and the batch object.
 *
 * Never persist this as truth. Never use fields from this interface to write DB records.
 * All financial values shown to the user must trace to `settlementSource === 'phase9_evidence'`.
 * When `settlementSource === 'batch_object'`, values are unconfirmed cached estimates.
 */
export interface EscrowBatchDisplayModel {
  // ── Identity ──────────────────────────────────────────────────────────────
  batchId: string;
  /** lcRow.source_batch_id when available (matches chain registration) */
  sourceBatchId: string;
  escrowBatchIdHash: string | null;
  escrowBatchIdShort: string;
  origin: 'Vault' | 'Bank' | 'Unknown';
  chainId: number | null;
  chainKey: string | null;
  treasuryAddress: string | null;
  /** Authoritative open timestamp from lifecycle row (unix seconds → ISO) */
  openedAt: string | null;
  /** When treasury sent the batch — informational only */
  treasurySentAt: string | null;
  asset: string;

  // ── Lifecycle state ────────────────────────────────────────────────────────
  currentPhase: number;
  /** True when currentPhase < 1 — batch is a pre-registration candidate, not a confirmed lifecycle batch */
  isCandidatePhase: boolean;
  lcStatus: LifecycleRow['status'] | null;
  isSettled: boolean;
  isBlocked: boolean;
  isFailed: boolean;
  /** Human-readable blocking reason from lifecycle row */
  blockingReason: string | null;
  adminEvents: unknown[];
  /** ISO timestamp for each completed phase; key = phase number */
  phaseCompletedAt: Record<number, string>;

  // ── Wallet ────────────────────────────────────────────────────────────────
  walletStatus: WalletStatus;
  walletSource: WalletSource;
  /**
   * Non-null ONLY when walletStatus === 'created_bound'.
   * Source: lcRow.wallet_address (Phase 3 executor confirms on-chain).
   */
  walletAddress: string | null;
  /**
   * Pre-computed address from factory prediction — shown with amber "Predicted" chip.
   * Non-null ONLY when walletStatus === 'predicted'.
   */
  predictedAddress: string | null;
  custodyMode: EscrowBatch['custodyMode'];

  // ── Principal / amount ────────────────────────────────────────────────────
  principalUsd: number;
  principalSource: AmountSource;
  termMonths: number;

  // ── Binding hashes ─────────────────────────────────────────────────────────
  /**
   * EIP-712 struct hash computed locally when the binding was created.
   * Source: batch.batchAuthorityBinding.batchAuthorityBindingHash
   */
  localBindingHash: string | null;
  /**
   * Hash observed on-chain during Phase 3 wallet binding.
   * Source: batch.wallet.boundAuthorityBindingHash
   */
  onChainAnchorHash: string | null;
  /**
   * Server-canonical batch ID hash stored in the lifecycle table.
   * Source: lcRow.escrow_batch_id_hash
   */
  lifecycleBatchIdHash: string | null;
  /** True when any two of the three hashes exist and disagree */
  bindingHashMismatch: boolean;

  // ── Settlement / P&L ──────────────────────────────────────────────────────
  settlementSource: SettlementSource;
  /** Phase 9 evidence row hash */
  settlementEvidenceHash: string | null;
  /** finalizeBatchSettlement() tx on InvestmentEscrow — null when not captured */
  settlementTxHash: string | null;
  /**
   * Best available settlement reference when settlementTxHash is null.
   * May be a treasury_notification tx, a simulated_dev_ref, or null.
   */
  settlementReference: string | null;
  settlementReferenceType: 'onchain_tx' | 'treasury_notification' | 'simulated_dev_ref' | null;
  /**
   * Proof that USDC physically returned to Treasury:
   * 'funds_returned' — depositReturnForBatch() was called; depositReturnTxHash is the on-chain proof.
   * 'simulated_only' — dev accounting only; no real USDC moved; Treasury balance NOT updated.
   * 'on_chain' — USDC was returned externally before Phase 9 ran (production path).
   * null — Phase 9 evidence absent.
   */
  custodySettlementStatus: 'funds_returned' | 'simulated_only' | 'on_chain' | null;
  /** tx hash of depositReturnForBatch() call; non-null only when custodySettlementStatus='funds_returned' and call was made by Phase 9 */
  depositReturnTxHash: string | null;
  returnedAmountUsd: number | null;
  surplusUsd: number | null;
  /**
   * returnedAmountUsd - principalUsd when both are available.
   * Falls back to batch.performance.realizedYieldUsd as last resort.
   */
  pnlUsd: number | null;
  pnlPct: number | null;
  settledAt: string | null;
  maturityDate: string | null;
  expectedReturnUsd: number | null;
  bankRepaymentAmountUsd: number | null;

  // ── Settlement economics (Phase 9) ───────────────────────────────────────
  /** Raw investment return before any surplus/reserve adjustment (= returnedAmountUsd) */
  grossReturnedUsd: number | null;
  /** What the depositor actually receives (gross − surplus + reserve coverage) */
  userPayoutUsd: number | null;
  /** Treasury's net take: protocol fee (production) or high-yield surplus (dev) */
  treasurySurplusUsd: number | null;
  /** Reserve fund top-up applied to cover shortfall (0 unless loss_covered/loss_uncovered) */
  reserveCoverageUsd: number | null;
  /** Loss not covered by reserve fund (0 unless loss_uncovered scenario) */
  uncoveredShortfallUsd: number | null;
  /** Promised payout to depositor — only present in dev scenarios, null in production */
  promisedPayoutUsd: number | null;
  /** Promised yield component of promisedPayoutUsd — null in production */
  promisedYieldUsd: number | null;
  /** Dev scenario identifier (e.g. 'target_yield'); null in production evidence */
  settlementScenario: string | null;
  /** Human-readable scenario label; null in production evidence */
  settlementScenarioLabel: string | null;
  // ── Term basis (Phase 9 evidence) ─────────────────────────────────────────
  /** Deposit duration in months as used for yield computation */
  termMonthsEvidence: number | null;
  /** ANNUAL yield rate in bps (e.g. 960 = 9.6% APR) */
  annualYieldBps: number | null;
  /** Total yield bps over the full term = annualYieldBps × termMonths / 12 */
  termAdjustedYieldBps: number | null;
  /** Actual gross return bps relative to principal for the full term */
  grossReturnBpsForTerm: number | null;

  // ── Deposits ──────────────────────────────────────────────────────────────
  deposits: EscrowBatch['deposits'];

  // ── Deployment legs (enriched) ────────────────────────────────────────────
  deploymentLegs: DisplayLeg[];

  // ── Raw batch (kept for sub-sections that have not yet migrated) ──────────
  batch: EscrowBatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (not exported — private to this module)
// ─────────────────────────────────────────────────────────────────────────────

function deriveBatchOrigin(batch: EscrowBatch): 'Vault' | 'Bank' | 'Unknown' {
  if (batch.deposits.some(d =>
    d.adapterType === 'fineract' || d.adapterType === 'core_adapter' || d.adapterType === 'fintech_partner'
  )) return 'Bank';
  if (batch.deposits.some(d =>
    d.depositId?.toLowerCase().startsWith('bank-receipt-') ||
    d.depositId?.toLowerCase().startsWith('bank-lot-') ||
    d.depositId?.toLowerCase().startsWith('bank-batch-')
  )) return 'Bank';
  if (batch.deposits.some(d =>
    d.depositId?.toLowerCase().includes('vault') ||
    d.originBank?.toLowerCase() === 'vault'
  )) return 'Vault';
  return 'Unknown';
}

function getApproximatePhase(batch: EscrowBatch): number {
  if (batch.status === 'settled' || batch.status === 'retired') return 9;
  if (batch.status === 'deployed' || batch.status === 'active' || batch.status === 'disputed') return 8;
  if (batch.status === 'settlement_pending') return 8;
  if (batch.status === 'deployment_pending') return 6;
  if (batch.status === 'aaa_plan_attached') return 5;
  if (batch.status === 'wallet_funded') return 4;
  // 'wallet_created' is set client-side when chainConfirmed===true (batch received on-chain = Phase 1).
  // It does NOT mean escrow lifecycle Phase 3 ran. Default to 1 to avoid false phase-3 display on new batches.
  if (batch.status === 'wallet_created' || batch.status === 'wallet_requested') return 1;
  if (batch.status === 'handoff_approved' || batch.status === 'treasury_received') return 1;
  return 0;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  const n = Number(v);
  return !isNaN(n) && v != null && v !== '' ? n : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of a single row from GET /banking/escrow/admin/dev/leg-positions/:id */
export type DevLegPositionRecord = {
  leg_id: string;
  status: 'deployed' | 'marked' | 'returned';
  deployed_amount_usd6: string;
  current_value_usd6: string | null;
  unrealized_pnl_usd6: string | null;
  unrealized_pnl_bps: number | null;
  returned_amount_usd6: string | null;
  realized_pnl_usd6: string | null;
  realized_pnl_bps: number | null;
  simulation_scenario: string;
};

/**
 * DISPLAY CACHE ONLY — pure function; produces a derived display model from phase evidence,
 * lifecycle row, and the batch object. No async, no writes, no DB calls.
 *
 * This model MUST be the only place that decides what the UI displays for any financial field.
 * All tabs must read from this model, not from batch.*, lcRow.*, or evidence[*] directly.
 *
 * Source precedence:
 *   Settlement values:  Phase 9 evidence (phase9_evidence) > batch.settlement (batch_object, unconfirmed)
 *   Principal:          Phase 1 evidence (phase1_evidence) > execution order estimate (order_estimate)
 *   Deployment txHash:  Phase 8 evidence per-leg > leg.deploymentTxHash fallback
 *
 * Forbidden:
 *   - Do NOT use raw batch.settlement.* as authoritative for financial values.
 *   - Do NOT use lcRow.current_phase as proof of correct settlement economics.
 *   - Do NOT hide a mismatch by preferring the prettier value between two sources.
 *   - Do NOT persist this model; it is a derived read-only cache.
 */
export function buildEscrowBatchDisplayModel(
  batch: EscrowBatch,
  lcRow: LifecycleRow | undefined,
  evidence: Record<number, PhaseEvidenceRow>,
  devLegPositions?: DevLegPositionRecord[],
): EscrowBatchDisplayModel {
  // ── Identity ────────────────────────────────────────────────────────────
  const sourceBatchId = lcRow?.source_batch_id ?? String(batch.sourceBatchId ?? '');
  const escrowBatchIdHash = lcRow?.escrow_batch_id_hash ?? null;
  const id = batch.batchId;
  const escrowBatchIdShort =
    id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  const openedAt = lcRow?.opened_at_unix
    ? new Date(lcRow.opened_at_unix * 1000).toISOString()
    : null;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  const currentPhase = lcRow?.current_phase ?? getApproximatePhase(batch);
  const lcStatus = lcRow?.status ?? null;
  const isSettled = lcStatus === 'settled' || batch.status === 'settled' || batch.status === 'retired';
  const isFailed = lcStatus === 'failed';
  const isBlocked = lcStatus === 'blocked' || lcStatus === 'admin_hold';
  const blockingReason =
    lcRow?.current_blocking_summary ??
    (lcRow?.last_error_code ? lcRow.last_error_code.replace(/_/g, ' ') : null);
  const adminEvents: unknown[] = Array.isArray(lcRow?.admin_events) ? lcRow!.admin_events : [];
  const phaseCompletedAt: Record<number, string> = {};
  for (const [phaseStr, row] of Object.entries(evidence)) {
    phaseCompletedAt[Number(phaseStr)] = row.created_at;
  }

  // ── Wallet ────────────────────────────────────────────────────────────────
  const phase3Complete = currentPhase >= 3;
  const lcWalletAddress = lcRow?.wallet_address ?? null;
  const metadataWalletAddress =
    (batch.wallet.walletAddress ?? batch.wallet.address) || null;

  let walletStatus: WalletStatus;
  let walletSource: WalletSource;
  let walletAddress: string | null;
  let predictedAddress: string | null;

  if (phase3Complete && lcWalletAddress) {
    walletStatus = 'created_bound';
    walletSource = 'phase3_evidence';
    walletAddress = lcWalletAddress;
    predictedAddress = null;
  } else if (metadataWalletAddress) {
    walletStatus = 'predicted';
    walletSource = 'metadata_predicted';
    walletAddress = null;
    predictedAddress = metadataWalletAddress;
  } else {
    walletStatus = 'not_created';
    walletSource = 'none';
    walletAddress = null;
    predictedAddress = null;
  }

  // ── Principal / Amount ────────────────────────────────────────────────────
  const principalSource: AmountSource = currentPhase >= 1 ? 'phase1_evidence' : 'order_estimate';
  const principalUsd = batch.totalAmountUsd;

  // ── Binding hashes ────────────────────────────────────────────────────────
  // localBindingHash: only expose after Phase 2 — before that it is a precomputed candidate preview,
  // not a confirmed authority binding, and must not trigger mismatch checks.
  const localBindingHash =
    currentPhase >= 2 ? (batch.batchAuthorityBinding?.batchAuthorityBindingHash ?? null) : null;
  // onChainAnchorHash: only meaningful after Phase 3 wallet binding confirmation.
  const onChainAnchorHash = currentPhase >= 3 ? (batch.wallet.boundAuthorityBindingHash ?? null) : null;
  const lifecycleBatchIdHash = escrowBatchIdHash;

  const nonNullHashes = [localBindingHash, onChainAnchorHash, lifecycleBatchIdHash].filter(Boolean) as string[];
  const uniqueHashes = new Set(nonNullHashes.map(h => h.toLowerCase()));
  // bindingHashMismatch must never fire at Phase 0 or 1 — no confirmed hashes exist yet.
  const bindingHashMismatch = currentPhase >= 2 && nonNullHashes.length >= 2 && uniqueHashes.size > 1;

  // ── Settlement — Phase 9 evidence first ──────────────────────────────────
  const phase9 = evidence[9];
  const p9json = phase9 ? asRecord(phase9.evidence_json) : undefined;

  const settlementEvidenceHash = phase9?.evidence_hash ?? null;
  // settlementTxHash: finalizeBatchSettlement() tx — null when not captured by executor
  const p9TxHash = p9json ? (asString(p9json.settlementTxHash) ?? null) : undefined;
  const p9Reference = p9json ? asString(p9json.settlementReference) : undefined;
  const p9ReferenceType = p9json
    ? (p9json.settlementReferenceType as 'onchain_tx' | 'treasury_notification' | 'simulated_dev_ref' | undefined)
    : undefined;
  const p9CustodyStatus = p9json
    ? ((p9json.custodySettlementStatus as 'funds_returned' | 'simulated_only' | 'on_chain' | undefined) ?? null)
    : null;
  const p9DepositReturnTxHash = p9json ? (asString(p9json.depositReturnTxHash) ?? null) : null;
  // returnedAmountUsd: float convenience field (canonical); fall back from usd6 bigint string
  const p9ReturnedUsdRaw = p9json ? asNumber(p9json.returnedAmountUsd) : undefined;
  const p9ReturnedUsd6 = p9json ? asString(p9json.returnedAmountUsd6) : undefined;
  const p9ReturnedUsd = p9ReturnedUsdRaw
    ?? (p9ReturnedUsd6 != null ? Number(p9ReturnedUsd6) / 1_000_000 : undefined);
  // surplusUsd: float convenience field; fall back from usd6
  const p9SurplusUsdRaw = p9json ? asNumber(p9json.surplusUsd) : undefined;
  const p9SurplusUsd6 = p9json ? asString(p9json.surplusUsd6) : undefined;
  const p9SurplusUsd = p9SurplusUsdRaw
    ?? (p9SurplusUsd6 != null ? Number(p9SurplusUsd6) / 1_000_000 : undefined);
  // settledAt: use the dedicated field first, fall back to evidence row created_at
  const p9SettledAt = p9json
    ? (asString(p9json.settledAt) ?? phase9?.created_at ?? undefined)
    : undefined;

  // ── Settlement economics ──────────────────────────────────────────────────
  const p9GrossReturnedUsd = p9json
    ? (asNumber(p9json.grossReturnedUsd) ?? (p9json.grossReturnedUsd6 ? Number(p9json.grossReturnedUsd6 as string) / 1_000_000 : null))
    : null;
  const p9UserPayoutUsd = p9json
    ? (asNumber(p9json.userPayoutUsd) ?? (p9json.userPayoutUsd6 ? Number(p9json.userPayoutUsd6 as string) / 1_000_000 : null))
    : null;
  const p9TreasurySurplusUsd = p9json
    ? (asNumber(p9json.treasurySurplusUsd) ?? (p9json.treasurySurplusUsd6 ? Number(p9json.treasurySurplusUsd6 as string) / 1_000_000 : null))
    : null;
  const p9ReserveCoverageUsd = p9json
    ? (asNumber(p9json.reserveCoverageUsd) ?? (p9json.reserveCoverageUsd6 ? Number(p9json.reserveCoverageUsd6 as string) / 1_000_000 : null))
    : null;
  const p9UncoveredShortfallUsd = p9json
    ? (asNumber(p9json.uncoveredShortfallUsd) ?? (p9json.uncoveredShortfallUsd6 ? Number(p9json.uncoveredShortfallUsd6 as string) / 1_000_000 : null))
    : null;
  const p9PromisedPayoutUsd = p9json
    ? (asNumber(p9json.promisedPayoutUsd) ?? (p9json.promisedPayoutUsd6 ? Number(p9json.promisedPayoutUsd6 as string) / 1_000_000 : null))
    : null;
  const p9PromisedYieldUsd = p9json
    ? (asNumber(p9json.promisedYieldUsd) ?? (p9json.promisedYieldUsd6 ? Number(p9json.promisedYieldUsd6 as string) / 1_000_000 : null))
    : null;
  const p9SettlementScenario = p9json ? ((p9json.settlementScenario as string | undefined) ?? null) : null;
  const p9ScenarioLabel = p9json ? ((p9json.scenarioLabel as string | undefined) ?? null) : null;
  // Term basis fields
  const p9TermMonthsEvidence  = p9json ? (typeof p9json.termMonths === 'number' ? p9json.termMonths : null) : null;
  const p9AnnualYieldBps      = p9json ? (typeof p9json.annualYieldBps === 'number' ? p9json.annualYieldBps : null) : null;
  const p9TermAdjustedYieldBps = p9json ? (typeof p9json.termAdjustedYieldBps === 'number' ? p9json.termAdjustedYieldBps : null) : null;
  const p9GrossReturnBpsForTerm = p9json ? (typeof p9json.grossReturnBpsForTerm === 'number' ? p9json.grossReturnBpsForTerm : null) : null;

  let settlementSource: SettlementSource;
  let settlementTxHash: string | null;
  let settlementReference: string | null;
  let settlementReferenceType: 'onchain_tx' | 'treasury_notification' | 'simulated_dev_ref' | null;
  let returnedAmountUsd: number | null;
  let surplusUsd: number | null;
  let settledAt: string | null;

  if (p9json) {
    settlementSource = 'phase9_evidence';
    settlementTxHash = p9TxHash ?? batch.settlement.settlementTxHash ?? null;
    settlementReference = p9Reference ?? null;
    settlementReferenceType = p9ReferenceType ?? null;
    returnedAmountUsd = p9ReturnedUsd ?? batch.settlement.returnedAmountUsd ?? null;
    surplusUsd = p9SurplusUsd ?? batch.settlement.surplusUsd ?? null;
    settledAt = p9SettledAt ?? null;
  } else if (
    batch.settlement.returnedAmountUsd != null ||
    batch.settlement.settlementTxHash != null
  ) {
    settlementSource = 'batch_object';
    settlementTxHash = batch.settlement.settlementTxHash ?? null;
    settlementReference = null;
    settlementReferenceType = null;
    returnedAmountUsd = batch.settlement.returnedAmountUsd ?? null;
    surplusUsd = batch.settlement.surplusUsd ?? null;
    settledAt = null;
  } else {
    settlementSource = 'none';
    settlementTxHash = null;
    settlementReference = null;
    settlementReferenceType = null;
    returnedAmountUsd = null;
    surplusUsd = null;
    settledAt = null;
  }

  // P&L: prefer computed from returned vs principal; fall back to batch.performance
  const pnlUsd =
    returnedAmountUsd != null
      ? returnedAmountUsd - principalUsd
      : (isSettled ? (batch.performance.realizedYieldUsd ?? null) : null);
  const pnlPct =
    pnlUsd != null && principalUsd > 0
      ? (pnlUsd / principalUsd) * 100
      : null;

  // ── Per-leg enrichment ────────────────────────────────────────────────────

  // Dev leg positions (optional, dev-only): keyed by leg_id
  const devPosById = new Map<string, DevLegPositionRecord>();
  if (devLegPositions) {
    for (const pos of devLegPositions) devPosById.set(pos.leg_id, pos);
  }

  // Phase 7: planned/approved deployment intent
  const phase7 = evidence[7];
  const p7json = phase7 ? asRecord(phase7.evidence_json) : undefined;
  // plannedLegs stored at top level; canonicalDeploymentApprovalPayload wraps the same array
  const p7PlannedLegsRaw = p7json
    ? ((p7json.plannedLegs
        ?? asRecord(p7json.canonicalDeploymentApprovalPayload)?.plannedLegs) as unknown[] | undefined)
    : undefined;
  const p7HasPayload = Array.isArray(p7PlannedLegsRaw) && p7PlannedLegsRaw.length > 0;

  type P7Leg = {
    legId?: unknown; assetSymbol?: unknown; amountUsd6?: unknown;
    allocationPercent?: unknown; destinationAddress?: unknown;
    targetYieldBps?: unknown; strategyType?: unknown; provider?: unknown;
  };
  const p7LegById = new Map<string, P7Leg>();
  if (p7HasPayload) {
    for (const raw of p7PlannedLegsRaw!) {
      const r = asRecord(raw);
      if (r && typeof r.legId === 'string') p7LegById.set(r.legId, r as P7Leg);
    }
  }

  // Phase 8: actual execution proof
  const phase8 = evidence[8];
  const p8json = phase8 ? asRecord(phase8.evidence_json) : undefined;
  const p8Legs = p8json ? asRecord(p8json.legs) : undefined;
  const phase8Exists = Boolean(phase8);

  // Phase 9: settlement/P&L (prefer legSettlementResults canonical schema; fall back to legs)
  const p9Legs = p9json
    ? asRecord(p9json.legSettlementResults ?? p9json.legs)
    : undefined;

  const deploymentLegs: DisplayLeg[] = batch.deploymentLegs.map(leg => {
    const p7Leg = p7LegById.get(leg.legId);
    const p8Leg = p8Legs ? asRecord(p8Legs[leg.legId]) : undefined;
    const devPos = devPosById.get(leg.legId) ?? null;
    const p9Leg = p9Legs ? asRecord(p9Legs[leg.legId]) : undefined;

    // ── Planned fields: Phase 7 > batch object ──────────────────────────────
    const plannedSource: LegPlannedSource =
      p7Leg ? 'phase7_evidence'
      : (leg.provider || (leg.allocationPercent ?? 0) > 0) ? 'batch_object'
      : 'none';

    const provider = (p7Leg ? asString(p7Leg.provider as unknown) : undefined) ?? String(leg.provider);
    const assetSymbol = (p7Leg ? asString(p7Leg.assetSymbol as unknown) : undefined)
      ?? String(leg.assetSymbol ?? leg.asset ?? 'USDC');
    const strategyType = (p7Leg ? asString(p7Leg.strategyType as unknown) : undefined) ?? leg.strategyType;
    const allocationPercent = (p7Leg ? asNumber(p7Leg.allocationPercent as unknown) : undefined)
      ?? leg.allocationPercent;
    const targetYieldBps = (p7Leg ? asNumber(p7Leg.targetYieldBps as unknown) : undefined)
      ?? leg.targetYieldBps;
    const plannedAmountUsd6 = p7Leg ? (asString(p7Leg.amountUsd6 as unknown) ?? null) : null;

    // Amount: Phase 7 bigint string for precision > batch float
    const amountUsd = plannedAmountUsd6 != null
      ? Number(plannedAmountUsd6) / 1_000_000
      : leg.amountUsd;

    // ── Execution fields: Phase 8 ───────────────────────────────────────────
    // Destination: Phase 8 on-chain confirmation > Phase 7 planned > batch
    const destinationAddress =
      (p8Leg ? asString(p8Leg.destination as unknown) : undefined)
      ?? (p7Leg ? asString(p7Leg.destinationAddress as unknown) : undefined)
      ?? leg.destinationAddress;
    const legDeployTx = (p8Leg ? asString(p8Leg.txHash as unknown) : undefined) ?? leg.deploymentTxHash;
    const legDeployedAt = p8Leg ? (asString(p8Leg.deployedAt as unknown) ?? null) : null;
    const executedAmountUsd6 = p8Leg
      ? (asString(p8Leg.amountUsd6 as unknown) ?? null)
      : null;

    // ── Settlement fields: Phase 9 ──────────────────────────────────────────
    const legReturnedUsd6 = p9Leg ? asString(p9Leg.returnedAmountUsd6 as unknown) : undefined;
    const settledAmountUsd = p9Leg
      ? (asNumber(p9Leg.returnedAmountUsd as unknown)
          ?? (legReturnedUsd6 ? Number(legReturnedUsd6) / 1_000_000 : null))
      : null;
    const returnedAmountUsd6 = legReturnedUsd6 ?? null;
    const legPnlUsd = settledAmountUsd != null ? settledAmountUsd - amountUsd : null;
    const legPnlPct = legPnlUsd != null && amountUsd > 0
      ? (legPnlUsd / amountUsd) * 100
      : null;
    const legSettledAt = p9Leg ? (asString(p9Leg.settledAt as unknown) ?? null) : null;

    // ── Realized P&L bigint strings (max precision when both are present) ───
    let realizedPnlUsd6: string | null = null;
    let realizedPnlBps: number | null = null;
    if (returnedAmountUsd6 != null && plannedAmountUsd6 != null) {
      try {
        const ret6 = BigInt(returnedAmountUsd6);
        const pln6 = BigInt(plannedAmountUsd6);
        realizedPnlUsd6 = (ret6 - pln6).toString();
        if (pln6 > 0n) {
          realizedPnlBps = Number(((ret6 - pln6) * 10000n) / pln6);
        }
      } catch { /* bigint parse failed — leave null */ }
    } else {
      realizedPnlBps = legPnlPct != null ? Math.round(legPnlPct * 100) : null;
    }

    // ── Warning when Phase 8 exists but Phase 7 payload was never stored ────
    const phase7Warning = phase8Exists && !p7HasPayload
      ? 'Approved deployment payload missing — planned fields unavailable.'
      : null;

    const legSettlementMethod = p9Leg
      ? ((p9Leg.legSettlementMethod as 'proportional_allocation_from_batch_settlement' | 'dev_simulated_jitter' | 'dev_leg_position_simulation' | null) ?? null)
      : null;

    return {
      legId: leg.legId,
      provider,
      asset: assetSymbol,
      strategyType,
      amountUsd,
      allocationPercent,
      targetYieldBps,
      status: p9Leg ? 'settled'
        : devPos?.status === 'returned' ? 'monitoring'
        : p8Leg?.status === 'executed' ? 'deployed'
        : p8Leg?.status === 'failed' ? 'exception'
        : leg.status,
      destinationName: leg.destinationName,
      destinationType: leg.destinationType,
      destinationAddress,
      providerReferenceId: leg.providerReferenceId,
      deploymentTxHash: legDeployTx,
      deployedAt: legDeployedAt,
      currentValueUsd: leg.currentValueUsd,
      settledAmountUsd,
      legPnlUsd,
      legPnlPct,
      settledAt: legSettledAt,
      legSettlementMethod,
      plannedSource,
      plannedAmountUsd6,
      executedAmountUsd6,
      returnedAmountUsd6,
      realizedPnlUsd6,
      realizedPnlBps,
      phase7Warning,
      // Dev leg position fields
      isDevSimulated: devPos !== null,
      devLegStatus: devPos?.status ?? null,
      currentValueUsd6Dev: devPos?.current_value_usd6 ?? null,
      unrealizedPnlUsd6Dev: devPos?.unrealized_pnl_usd6 ?? null,
      unrealizedPnlBpsDev: devPos?.unrealized_pnl_bps ?? null,
    };
  });

  return {
    batchId: id,
    sourceBatchId,
    escrowBatchIdHash,
    escrowBatchIdShort,
    origin: deriveBatchOrigin(batch),
    chainId: lcRow?.chain_id ?? null,
    chainKey: lcRow?.chain_key ?? null,
    treasuryAddress: lcRow?.treasury_address ?? null,
    openedAt,
    treasurySentAt: batch.treasuryHandoff.approvedAt ?? null,
    asset: batch.asset ?? 'USDC',
    currentPhase,
    isCandidatePhase: currentPhase < 1,
    lcStatus,
    isSettled,
    isBlocked,
    isFailed,
    blockingReason,
    adminEvents,
    phaseCompletedAt,
    walletStatus,
    walletSource,
    walletAddress,
    predictedAddress,
    custodyMode: batch.custodyMode,
    principalUsd,
    principalSource,
    termMonths: batch.termMonths,
    localBindingHash,
    onChainAnchorHash,
    lifecycleBatchIdHash,
    bindingHashMismatch,
    settlementSource,
    settlementEvidenceHash,
    settlementTxHash,
    settlementReference,
    settlementReferenceType,
    custodySettlementStatus: p9CustodyStatus,
    depositReturnTxHash: p9DepositReturnTxHash,
    returnedAmountUsd,
    surplusUsd,
    pnlUsd,
    pnlPct,
    settledAt,
    maturityDate: batch.settlement.maturityDate ?? null,
    expectedReturnUsd: batch.settlement.expectedReturnUsd ?? null,
    bankRepaymentAmountUsd: batch.settlement.bankRepaymentAmountUsd ?? null,
    grossReturnedUsd: p9GrossReturnedUsd,
    userPayoutUsd: p9UserPayoutUsd,
    treasurySurplusUsd: p9TreasurySurplusUsd,
    reserveCoverageUsd: p9ReserveCoverageUsd,
    uncoveredShortfallUsd: p9UncoveredShortfallUsd,
    promisedPayoutUsd: p9PromisedPayoutUsd,
    promisedYieldUsd: p9PromisedYieldUsd,
    settlementScenario: p9SettlementScenario,
    settlementScenarioLabel: p9ScenarioLabel,
    termMonthsEvidence: p9TermMonthsEvidence,
    annualYieldBps: p9AnnualYieldBps,
    termAdjustedYieldBps: p9TermAdjustedYieldBps,
    grossReturnBpsForTerm: p9GrossReturnBpsForTerm,
    deposits: batch.deposits,
    deploymentLegs,
    batch,
  };
}
