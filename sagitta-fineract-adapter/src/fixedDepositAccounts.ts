import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";

export interface FineractFixedDepositAccount {
  id?: number;
  clientId?: number;
  savingsProductId?: number;
  depositAmount?: number;
  depositPeriod?: number;
  currency?: { code?: string };
  status?: Record<string, unknown>;
  timeline?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CommandResult {
  officeId?: number;
  clientId?: number;
  resourceId?: number;
  savingsId?: number;
  [key: string]: unknown;
}

export type FixedDepositCreatePayload = Record<string, unknown>;
export type AccountClosureType = 100 | 200 | 300 | 400;

export interface CloseFixedDepositOptions {
  onAccountClosureId?: AccountClosureType;
  toSavingsAccountId?: number;
  transferDescription?: string;
}

function commandDatePayload(field: string, date: string): Record<string, unknown> {
  return {
    locale: "en",
    dateFormat: "yyyy-MM-dd",
    [field]: date,
  };
}

export function listFixedDepositAccounts(
  client = new FineractHttpClient(),
): Promise<FineractFixedDepositAccount[]> {
  return client.get<FineractFixedDepositAccount[]>("/fixeddepositaccounts");
}

export function getFixedDepositAccount(
  accountId: number,
  client = new FineractHttpClient(),
): Promise<FineractFixedDepositAccount> {
  return client.get<FineractFixedDepositAccount>(`/fixeddepositaccounts/${accountId}`);
}

export function createFixedDepositAccount(
  payload: FixedDepositCreatePayload,
  client = new FineractHttpClient(),
): Promise<CommandResult> {
  return client.post<CommandResult>("/fixeddepositaccounts", payload);
}

export function approveFixedDepositAccount(
  accountId: number,
  approvedOnDate: string,
  client = new FineractHttpClient(),
): Promise<CommandResult> {
  return client.post<CommandResult>(
    `/fixeddepositaccounts/${accountId}?command=approve`,
    commandDatePayload("approvedOnDate", approvedOnDate),
  );
}

export function activateFixedDepositAccount(
  accountId: number,
  activatedOnDate: string,
  client = new FineractHttpClient(),
): Promise<CommandResult> {
  return client.post<CommandResult>(
    `/fixeddepositaccounts/${accountId}?command=activate`,
    commandDatePayload("activatedOnDate", activatedOnDate),
  );
}

export function closeFixedDepositAccount(
  accountId: number,
  closedOnDate: string,
  options: CloseFixedDepositOptions = {},
  client = new FineractHttpClient(),
): Promise<CommandResult> {
  const onAccountClosureId = options.onAccountClosureId ?? 100;
  const payload: Record<string, unknown> = {
    ...commandDatePayload("closedOnDate", closedOnDate),
    onAccountClosureId,
  };

  if (onAccountClosureId === 200) {
    if (options.toSavingsAccountId === undefined) {
      throw new Error("toSavingsAccountId is required when onAccountClosureId is 200 (transfer to savings).");
    }
    payload.toSavingsAccountId = options.toSavingsAccountId;
    payload.transferDescription = options.transferDescription ?? "Sagitta fixed deposit closure transfer";
  }

  return client.post<CommandResult>(`/fixeddepositaccounts/${accountId}?command=close`, payload);
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await listFixedDepositAccounts(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
