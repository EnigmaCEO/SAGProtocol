/**
 * Fineract Datatables API wrapper for Sagitta settlement evidence.
 *
 * Verified against local Fineract instance (2026-05-27):
 *
 *   SUPPORTED:
 *     GET  /datatables                              — list all registered datatables
 *     POST /datatables                              — create a new datatable
 *     GET  /datatables/{tableName}/{appTableId}     — read row(s) for an entity
 *     POST /datatables/{tableName}/{appTableId}     — create a row
 *     PUT  /datatables/{tableName}/{appTableId}     — update the single row (multiRow=false tables)
 *     DELETE /datatables/{tableName}/{appTableId}   — delete all rows for an entity
 *
 *   IMPORTANT — apptable for Fixed Deposit accounts:
 *     Fixed deposit accounts are backed by m_savings_account in Fineract's schema.
 *     Registering a datatable with apptableName="m_fixed_deposit_account" returns 400.
 *     Use apptableName="m_savings_account" — the FD account id is the savings id.
 *
 *   externalId on FD accounts:
 *     PUT /fixeddepositaccounts/{id} with an externalId field returns 400 empty.
 *     externalId writeback to FD accounts is NOT supported in this Fineract build.
 *     Use this datatable + notes as the correlation surfaces instead.
 */

import { FineractHttpClient } from "./fineractHttp.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataTableColumn {
  name: string;
  /** "String" | "Number" | "Decimal" | "Date" | "DateTime" | "Text" | "Dropdown" */
  type: string;
  length?: number;
  mandatory: boolean;
  unique?: boolean;
  indexed?: boolean;
}

export interface CreateDataTablePayload {
  datatableName: string;
  apptableName: string;
  entitySubType?: string;
  /** false = at most one row per entity (upsert pattern); true = multiple rows. */
  multiRow: boolean;
  columns: DataTableColumn[];
}

export interface DataTableInfo {
  registeredTableName: string;
  applicationTableName: string;
  [key: string]: unknown;
}

export interface DataTableRowResult {
  officeId?: number;
  clientId?: number;
  savingsId?: number;
  resourceId?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Settlement evidence table definition
// ---------------------------------------------------------------------------

export const SETTLEMENT_EVIDENCE_TABLE = "SAGITTA_SETTLEMENT_EVIDENCE";
export const SETTLEMENT_EVIDENCE_APPTABLE = "m_savings_account";

/**
 * Columns for the SAGITTA_SETTLEMENT_EVIDENCE datatable.
 * All hash/id fields are nullable strings; status + version + timestamp are mandatory.
 */
export const SETTLEMENT_EVIDENCE_COLUMNS: DataTableColumn[] = [
  { name: "sagitta_term_deposit_id", type: "String",  length: 100, mandatory: false },
  { name: "circle_transfer_id",      type: "String",  length: 100, mandatory: false },
  { name: "arc_tx_hash",             type: "String",  length: 100, mandatory: false },
  { name: "treasury_batch_id",       type: "String",  length: 100, mandatory: false },
  { name: "escrow_execution_order_id", type: "String", length: 100, mandatory: false },
  { name: "allocation_plan_hash",    type: "String",  length: 100, mandatory: false },
  { name: "reserve_gate_hash",       type: "String",  length: 100, mandatory: false },
  { name: "settlement_status",       type: "String",  length: 50,  mandatory: true  },
  { name: "evidence_version",        type: "String",  length: 50,  mandatory: true  },
  { name: "recorded_at",             type: "String",  length: 50,  mandatory: true  },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * List all datatables registered in this Fineract instance.
 * Optionally filter by apptable name (e.g. "m_savings_account").
 */
export function listDataTables(
  apptable?: string,
  client = new FineractHttpClient(),
): Promise<DataTableInfo[]> {
  const qs = apptable ? `?apptable=${encodeURIComponent(apptable)}` : "";
  return client.get<DataTableInfo[]>(`/datatables${qs}`);
}

/**
 * Check whether a named datatable already exists.
 * Returns the DataTableInfo if found, undefined otherwise.
 */
export async function findDataTable(
  tableName: string,
  client = new FineractHttpClient(),
): Promise<DataTableInfo | undefined> {
  const all = await listDataTables(undefined, client);
  return all.find(
    (t) =>
      typeof t.registeredTableName === "string" &&
      t.registeredTableName.toUpperCase() === tableName.toUpperCase(),
  );
}

/**
 * Create a datatable.
 * Returns the resourceIdentifier (table name) on success.
 * Throws a descriptive error if the table already exists or if the apptable
 * is unsupported (e.g. "m_fixed_deposit_account" is not a valid apptable).
 */
export async function createDataTable(
  payload: CreateDataTablePayload,
  client = new FineractHttpClient(),
): Promise<string> {
  const result = await client.post<{ resourceIdentifier: string }>("/datatables", payload);
  return result.resourceIdentifier;
}

/**
 * Ensure the SAGITTA_SETTLEMENT_EVIDENCE datatable exists.
 * Creates it if missing; skips creation if it already exists.
 *
 * @returns  "created" | "already_exists"
 */
export async function ensureSettlementEvidenceTable(
  client = new FineractHttpClient(),
): Promise<"created" | "already_exists"> {
  const existing = await findDataTable(SETTLEMENT_EVIDENCE_TABLE, client);
  if (existing) {
    return "already_exists";
  }
  await createDataTable(
    {
      datatableName: SETTLEMENT_EVIDENCE_TABLE,
      apptableName: SETTLEMENT_EVIDENCE_APPTABLE,
      entitySubType: "",
      multiRow: false,
      columns: SETTLEMENT_EVIDENCE_COLUMNS,
    },
    client,
  );
  return "created";
}

/**
 * Read the settlement evidence row for a fixed deposit account.
 * Returns the raw row object, or undefined if no row has been written yet.
 */
export async function readSettlementEvidenceRow(
  accountId: number,
  client = new FineractHttpClient(),
): Promise<Record<string, unknown> | undefined> {
  try {
    const result = await client.get<Record<string, unknown> | Record<string, unknown>[]>(
      `/datatables/${SETTLEMENT_EVIDENCE_TABLE}/${accountId}`,
    );
    if (Array.isArray(result)) {
      return result[0] ?? undefined;
    }
    return result ?? undefined;
  } catch (error) {
    // 404 means no row yet — not an error for our purposes
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("404")) return undefined;
    throw error;
  }
}

/**
 * Write (create or update) the settlement evidence row for a fixed deposit account.
 *
 * Because the table has multiRow=false there is at most one row per account.
 * Strategy: attempt POST; if the row already exists (HTTP 400/409) fall back to PUT.
 *
 * @returns  WriteRowOutcome describing what happened
 */
export type WriteRowOutcome = "inserted" | "updated";

export async function writeSettlementEvidenceRow(
  accountId: number,
  row: Record<string, unknown>,
  client = new FineractHttpClient(),
): Promise<{ outcome: WriteRowOutcome; result: DataTableRowResult }> {
  const url = `/datatables/${SETTLEMENT_EVIDENCE_TABLE}/${accountId}`;

  // Try POST first (new row)
  try {
    const result = await client.post<DataTableRowResult>(url, row);
    return { outcome: "inserted", result };
  } catch (postError) {
    // If POST fails it might be because a row already exists — try PUT
    const postMsg = postError instanceof Error ? postError.message : String(postError);
    const couldBeConflict =
      postMsg.includes("400") ||
      postMsg.includes("409") ||
      postMsg.toLowerCase().includes("duplicate") ||
      postMsg.toLowerCase().includes("already exists");

    if (!couldBeConflict) {
      throw new Error(
        `Failed to write settlement evidence row (POST) for account ${accountId}: ${postMsg}`,
      );
    }

    // Fall back to PUT (update existing row)
    try {
      const result = await client.request<DataTableRowResult>(url, { method: "PUT", body: row });
      return { outcome: "updated", result };
    } catch (putError) {
      const putMsg = putError instanceof Error ? putError.message : String(putError);
      throw new Error(
        `Failed to write settlement evidence row for account ${accountId}:\n` +
          `  POST error: ${postMsg}\n` +
          `  PUT  error: ${putMsg}`,
      );
    }
  }
}
