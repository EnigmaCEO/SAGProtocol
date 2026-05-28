/**
 * Fineract Notes API wrapper for Fixed Deposit accounts.
 *
 * Verified against local Fineract instance (2026-05-27):
 *   - Fixed deposit accounts share the Savings entity in the notes system.
 *   - Endpoint: POST /savings/{accountId}/notes
 *   - Endpoint: GET  /savings/{accountId}/notes
 *   - /fixeddepositaccounts/{accountId}/notes returns 404 — use /savings/ path.
 *
 * Notes are append-only audit entries; multiple notes per account are fine.
 */

import { FineractHttpClient } from "./fineractHttp.js";

export interface FineractNote {
  id?: number;
  entityId?: number;
  entityTypeId?: number;
  note?: string;
  createdById?: number;
  updatedById?: number;
  createdDate?: string;
  updatedDate?: string;
}

export interface NoteResult {
  officeId?: number;
  clientId?: number;
  resourceId?: number;
  entityId?: number;
  [key: string]: unknown;
}

/**
 * List all notes attached to a Fineract fixed deposit account.
 *
 * Uses the /savings/{accountId}/notes path because Fineract's note service
 * maps fixed deposit accounts to the savings entity type.
 * Calling /fixeddepositaccounts/{accountId}/notes returns 404.
 */
export function listFdAccountNotes(
  accountId: number,
  client = new FineractHttpClient(),
): Promise<FineractNote[]> {
  return client.get<FineractNote[]>(`/savings/${accountId}/notes`);
}

/**
 * Attach a human-readable note to a Fineract fixed deposit account.
 *
 * @param accountId  Fineract fixed deposit account id.
 * @param noteText   The note body. Keep to one paragraph; no size limit in practice.
 * @param client     Optional injected HTTP client.
 * @returns          Fineract command result containing the new note's resourceId.
 *
 * @throws Error when the Fineract write fails.
 *
 * Production behaviour:
 *   Always POST a new note rather than updating an existing one.
 *   Notes are immutable audit entries — updating one would lose the original trail.
 */
export function addFdAccountNote(
  accountId: number,
  noteText: string,
  client = new FineractHttpClient(),
): Promise<NoteResult> {
  if (!noteText.trim()) {
    throw new Error("addFdAccountNote: noteText must not be blank.");
  }
  return client.post<NoteResult>(`/savings/${accountId}/notes`, { note: noteText });
}

/**
 * Build the canonical Sagitta settlement-evidence note text.
 *
 * Format is intentionally terse so it fits cleanly in Fineract's notes UI.
 *
 * Example output:
 *   Sagitta settlement evidence recorded.
 *   sagittaTermDepositId=SAGITTA_TD_1_20260527T000000Z
 *   status=pending
 *   evidenceVersion=sagitta-evidence-v1
 *   receipt=out/sagitta-fineract-settlement-writeback-demo.json
 *   [DEMO — synthetic evidence only]
 */
export function buildSettlementNoteText(opts: {
  sagittaTermDepositId: string;
  settlementStatus: string;
  receiptFilename: string;
  isDemo: boolean;
}): string {
  const lines = [
    "Sagitta settlement evidence recorded.",
    `sagittaTermDepositId=${opts.sagittaTermDepositId}`,
    `status=${opts.settlementStatus}`,
    `evidenceVersion=sagitta-evidence-v1`,
    `receipt=${opts.receiptFilename}`,
  ];
  if (opts.isDemo) {
    lines.push("[DEMO — synthetic evidence only, not real settlement data]");
  }
  return lines.join("\n");
}
