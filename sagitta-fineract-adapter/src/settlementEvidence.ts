/**
 * Sagitta Settlement Evidence model.
 *
 * This module defines the canonical evidence shape and a builder that
 * produces either real evidence (all fields populated) or clearly-labelled
 * demo evidence (SAGITTA_DEMO_EVIDENCE=true).
 *
 * Never pass demo evidence to a production settlement pipeline.
 */

export type SettlementStatus = "not_started" | "pending" | "settled" | "failed";

export interface SagittaSettlementEvidence {
  /** Sagitta canonical term-deposit identifier, e.g. "SAGITTA_TD_1_20260527T000000Z". */
  sagittaTermDepositId: string;
  /** Fineract fixed deposit account numeric id. */
  fineractAccountId: number;
  /** Always "fineract" for this adapter. */
  externalCore: "fineract";
  /** Circle payment transfer id — null when Circle is not involved. */
  circleTransferId: string | null;
  /** Arc Protocol tx hash — null when Arc settlement has not run. */
  arcTxHash: string | null;
  /** Sagitta Treasury batch id — null when treasury batch has not been issued. */
  treasuryBatchId: string | null;
  /** Escrow execution order id — null when escrow has not been initiated. */
  escrowExecutionOrderId: string | null;
  /** SHA-256 of the allocation plan JSON — null until finalised. */
  allocationPlanHash: string | null;
  /** Reserve gate decision hash — null until the gate is run. */
  reserveGateHash: string | null;
  /** Current settlement pipeline status. */
  settlementStatus: SettlementStatus;
  /** Schema version tag; bump when the shape changes. */
  evidenceVersion: "sagitta-evidence-v1";
  /** ISO-8601 timestamp of when this evidence object was recorded. */
  recordedAt: string;
  /**
   * Present only when SAGITTA_DEMO_EVIDENCE=true.
   * Marks the record as synthetic — never treat as real settlement proof.
   */
  _demoOnly?: true;
}

/**
 * Which Fineract surface was used to store the evidence.
 *   datatable  — structured row in SAGITTA_SETTLEMENT_EVIDENCE datatable
 *   note       — human-readable note attached to the savings/FD account
 *   local_only — Fineract write was skipped or failed; evidence lives only in the local receipt
 */
export type WritebackMethod = "datatable" | "note" | "local_only";

export interface WritebackResult {
  method: WritebackMethod;
  /** true when the Fineract write succeeded */
  success: boolean;
  /** Fineract resourceId / noteId returned on success */
  fineractResourceId?: number;
  /** Error message when success=false */
  error?: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildEvidenceOptions {
  fineractAccountId: number;
  /** Optional: override the generated sagittaTermDepositId. */
  sagittaTermDepositId?: string;
  circleTransferId?: string | null;
  arcTxHash?: string | null;
  treasuryBatchId?: string | null;
  escrowExecutionOrderId?: string | null;
  allocationPlanHash?: string | null;
  reserveGateHash?: string | null;
  settlementStatus?: SettlementStatus;
}

/**
 * Build a SagittaSettlementEvidence object.
 *
 * When SAGITTA_DEMO_EVIDENCE=true the returned object carries _demoOnly=true
 * and all null hash/id fields are replaced with clearly-labelled fake values
 * so the receipt is easy to distinguish from a real settlement record.
 */
export function buildSettlementEvidence(opts: BuildEvidenceOptions): SagittaSettlementEvidence {
  const isDemo = process.env.SAGITTA_DEMO_EVIDENCE?.toLowerCase() === "true";
  const now = new Date().toISOString();

  const sagittaTermDepositId =
    opts.sagittaTermDepositId ??
    `SAGITTA_TD_${opts.fineractAccountId}_${now.replace(/[:.]/g, "").replace("T", "T").slice(0, 20)}Z`;

  if (isDemo) {
    // Clearly synthetic values — never real settlement data
    return {
      sagittaTermDepositId,
      fineractAccountId: opts.fineractAccountId,
      externalCore: "fineract",
      circleTransferId:
        opts.circleTransferId ?? "DEMO_CIRCLE_TRANSFER_00000000-0000-0000-0000-000000000000",
      arcTxHash: opts.arcTxHash ?? "DEMO_ARC_TX_0x0000000000000000000000000000000000000000000000000000000000000000",
      treasuryBatchId: opts.treasuryBatchId ?? "DEMO_TREASURY_BATCH_00000000",
      escrowExecutionOrderId: opts.escrowExecutionOrderId ?? "DEMO_ESCROW_ORDER_00000000",
      allocationPlanHash:
        opts.allocationPlanHash ??
        "DEMO_ALLOC_HASH_0000000000000000000000000000000000000000000000000000000000000000",
      reserveGateHash:
        opts.reserveGateHash ??
        "DEMO_RESERVE_GATE_HASH_0000000000000000000000000000000000000000000000000000000000000000",
      settlementStatus: opts.settlementStatus ?? "pending",
      evidenceVersion: "sagitta-evidence-v1",
      recordedAt: now,
      _demoOnly: true,
    };
  }

  // Real (production) evidence — caller must supply meaningful values
  return {
    sagittaTermDepositId,
    fineractAccountId: opts.fineractAccountId,
    externalCore: "fineract",
    circleTransferId: opts.circleTransferId ?? null,
    arcTxHash: opts.arcTxHash ?? null,
    treasuryBatchId: opts.treasuryBatchId ?? null,
    escrowExecutionOrderId: opts.escrowExecutionOrderId ?? null,
    allocationPlanHash: opts.allocationPlanHash ?? null,
    reserveGateHash: opts.reserveGateHash ?? null,
    settlementStatus: opts.settlementStatus ?? "not_started",
    evidenceVersion: "sagitta-evidence-v1",
    recordedAt: now,
  };
}
