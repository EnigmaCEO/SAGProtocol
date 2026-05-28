import { FineractHttpClient } from "./fineractHttp.js";
import { getHealth } from "./health.js";
import { listOffices } from "./offices.js";
import { listFixedDepositProducts } from "./fixedDepositProducts.js";
import { listFixedDepositAccounts } from "./fixedDepositAccounts.js";

async function smokeTest(): Promise<void> {
  const client = new FineractHttpClient();

  console.log("Sagitta Fineract adapter smoke test");
  console.log(`API: ${client.config.baseUrl}`);
  console.log(`Tenant: ${client.config.tenantId}`);
  console.log(`TLS certificate validation disabled: ${client.config.sslInsecure}`);

  const health = await getHealth(client);
  if (health.status !== "UP") {
    throw new Error(`Fineract health status is ${health.status}, expected UP.`);
  }

  const [offices, products, accounts] = await Promise.all([
    listOffices(client),
    listFixedDepositProducts(client),
    listFixedDepositAccounts(client),
  ]);

  console.log("");
  console.log("Read-only results");
  console.log(`Health: ${health.status}`);
  console.log(`Offices: ${offices.length}`);
  console.log(`Fixed deposit products: ${products.length}`);
  console.log(`Fixed deposit accounts: ${accounts.length}`);
  console.log("Writes performed: none");

  if (process.env.CREATE_TEST_DATA?.toLowerCase() === "true") {
    console.log("CREATE_TEST_DATA=true is reserved for a future milestone; this smoke test remains read-only.");
  }
}

smokeTest().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
