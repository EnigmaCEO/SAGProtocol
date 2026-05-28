import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";

export interface FineractFixedDepositProduct {
  id?: number;
  name?: string;
  shortName?: string;
  currency?: { code?: string };
  [key: string]: unknown;
}

export function listFixedDepositProducts(
  client = new FineractHttpClient(),
): Promise<FineractFixedDepositProduct[]> {
  return client.get<FineractFixedDepositProduct[]>("/fixeddepositproducts");
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await listFixedDepositProducts(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
