import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";

export interface HealthResponse {
  status: string;
  [key: string]: unknown;
}

export function getHealth(client = new FineractHttpClient()): Promise<HealthResponse> {
  return client.requestAbsolute<HealthResponse>(client.config.healthUrl);
}

async function main(): Promise<void> {
  const health = await getHealth();
  console.log(JSON.stringify(health, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
