import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";

export interface FineractClient {
  id?: number;
  displayName?: string;
  accountNo?: string;
  [key: string]: unknown;
}

export interface FineractPage<T> {
  totalFilteredRecords?: number;
  pageItems?: T[];
  [key: string]: unknown;
}

export function listClients(client = new FineractHttpClient()): Promise<FineractPage<FineractClient> | FineractClient[]> {
  return client.get<FineractPage<FineractClient> | FineractClient[]>("/clients");
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await listClients(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
