import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";

export interface FineractOffice {
  id?: number;
  name?: string;
  nameDecorated?: string;
  [key: string]: unknown;
}

export function listOffices(client = new FineractHttpClient()): Promise<FineractOffice[]> {
  return client.get<FineractOffice[]>("/offices");
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await listOffices(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
