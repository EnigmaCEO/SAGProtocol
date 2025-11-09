import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseAddressesTs(src: string): Record<string, any> | null {
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) return null;
  const objText = m[1].trim();
  try {
    return JSON.parse(objText);
  } catch {
    // fallback to evaluation of literal
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${objText});`);
    return fn();
  }
}

async function main() {
  const addressesTs = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  const outPath = path.resolve(__dirname, "../deployments.json");

  if (!fs.existsSync(addressesTs)) {
    console.error("addresses.ts not found at", addressesTs);
    process.exit(1);
  }

  const src = fs.readFileSync(addressesTs, "utf8");
  const data = parseAddressesTs(src);
  if (!data) {
    console.error("Failed to parse CONTRACT_ADDRESSES from addresses.ts");
    process.exit(1);
  }

  // Normalize keys we expect (Vault, MockDOT, Treasury, MockOracle) and include chain metadata if present
  const deployments: Record<string, any> = {
    network: data.network ?? "localhost",
    chainId: data.chainId ?? 1337,
    SAGToken: data.SAGToken ?? data.SAG ?? null,
    MockUSDC: data.MockUSDC ?? null,
    MockGOLD: data.MockGOLD ?? null,
    MockDOT: data.MockDOT ?? null,
    Vault: data.Vault ?? null,
    Treasury: data.Treasury ?? null,
    ReserveController: data.ReserveController ?? null,
    InvestmentEscrow: data.InvestmentEscrow ?? null,
    MockOracle: data.MockOracle ?? null,
    ReceiptNFT: data.ReceiptNFT ?? null,
    AmmSAGUSDC: data.AmmSAGUSDC ?? null,
    AmmUSDCGOLD: data.AmmUSDCGOLD ?? null,
  };

  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log("Wrote deployments.json to", outPath);
  console.log("Preview:", deployments);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
