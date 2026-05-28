import type { FineractFixedDepositAccount } from "./fixedDepositAccounts.js";

export type SagittaTermDepositStatus =
  | "pending_core_approval"
  | "approved_not_active"
  | "active"
  | "matured_or_closed"
  | "closed_not_funded"
  | "unknown";

export interface SagittaTermDeposit {
  externalCore: "fineract";
  fineractAccountId: number | null;
  clientId: number | null;
  productId: number | null;
  currency: string | null;
  principalAmount: number | null;
  depositTerm: {
    value: number | null;
    unit: string | null;
  };
  interestRate: number | null;
  status: string | null;
  submittedOnDate: string | null;
  approvedOnDate: string | null;
  activatedOnDate: string | null;
  maturityDate: string | null;
  closedOnDate: string | null;
  sagittaStatus: SagittaTermDepositStatus;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fineractDateToIso(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const [year, month, day] = value;
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

export function mapSagittaStatus(status: Record<string, unknown>): SagittaTermDepositStatus {
  const statusText = `${status.code ?? ""} ${status.description ?? ""}`.toLowerCase();

  if (status.closed === true || status.prematureClosed === true || /matured|closed/.test(statusText)) {
    return "matured_or_closed";
  }
  if (status.rejected === true || status.withdrawnByApplicant === true || /rejected|withdrawn/.test(statusText)) {
    return "closed_not_funded";
  }
  if (status.active === true || /active/.test(statusText)) {
    return "active";
  }
  if (status.approved === true || /approved/.test(statusText)) {
    return "approved_not_active";
  }
  if (status.submittedAndPendingApproval === true || /submitted|pending/.test(statusText)) {
    return "pending_core_approval";
  }
  return "unknown";
}

export function mapFixedDepositToSagittaTermDeposit(account: FineractFixedDepositAccount): SagittaTermDeposit {
  const data = record(account);
  const currency = record(data.currency);
  const status = record(data.status);
  const timeline = record(data.timeline);
  const depositPeriodFrequency = record(data.depositPeriodFrequency);

  return {
    externalCore: "fineract",
    fineractAccountId: numberOrNull(data.id),
    clientId: numberOrNull(data.clientId),
    // Fineract FD accounts expose the product id as depositProductId; fall back to
    // savingsProductId and productId for older API shapes.
    productId: numberOrNull(data.depositProductId ?? data.savingsProductId ?? data.productId),
    currency: stringOrNull(currency.code),
    principalAmount: numberOrNull(data.depositAmount ?? data.principalAmount),
    depositTerm: {
      value: numberOrNull(data.depositPeriod),
      // Fineract returns depositPeriodFrequency.value ("Months"), falling back to
      // description and then code for older/alternate response shapes.
      unit: stringOrNull(depositPeriodFrequency.value ?? depositPeriodFrequency.description ?? depositPeriodFrequency.code),
    },
    interestRate: numberOrNull(data.nominalAnnualInterestRate ?? data.annualInterestRate),
    // Fineract status object has both code and value; value is the human-readable label.
    status: stringOrNull(status.value ?? status.description ?? status.code),
    submittedOnDate: fineractDateToIso(timeline.submittedOnDate),
    approvedOnDate: fineractDateToIso(timeline.approvedOnDate),
    activatedOnDate: fineractDateToIso(timeline.activatedOnDate),
    maturityDate: fineractDateToIso(data.maturityDate),
    closedOnDate: fineractDateToIso(timeline.closedOnDate ?? data.closedOnDate),
    sagittaStatus: mapSagittaStatus(status),
  };
}
