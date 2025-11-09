import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadAddresses() {
  const p = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  if (!fs.existsSync(p)) throw new Error("frontend/src/lib/addresses.ts not found");
  const src = fs.readFileSync(p, "utf8");
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) throw new Error("CONTRACT_ADDRESSES not found in addresses.ts");
  try { return JSON.parse(m[1].trim()); } catch {
    // fallback to eval-like parse
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[1].trim()});`)();
  }
}

function fmtBig(b: any) {
  try { return b.toString(); } catch { return String(b); }
}

async function probeOracle(oracleAddress: string, vaultAddress: string, mdotAddress: string) {
  const provider = hre.ethers.provider;
  console.log("Oracle address:", oracleAddress);

  // Try common ABIs
  const orclIface = [
    "function getPrice() view returns (uint256)",
    "function getSagPriceUsd() view returns (uint256)",
    "function getGoldPriceUsd() view returns (uint256)",
    "function latestAnswer() view returns (int256)",
    "function price() view returns (uint256)",
    // fallback generic
    "function getPriceUsd() view returns (uint256)"
  ];

  const oracle = new hre.ethers.Contract(oracleAddress, orclIface, provider);

  const results: Record<string, string> = {};
  for (const fn of ["getPrice","getSagPriceUsd","getGoldPriceUsd","latestAnswer","price","getPriceUsd"]) {
    try {
      // @ts-ignore
      const v = await oracle[fn]();
      results[fn] = fmtBig(v);
    } catch (err: any) {
      results[fn] = `ERR: ${String(err.message || err).split("\n")[0]}`;
    }
  }

  console.log("\nRaw oracle method outputs:");
  for (const [k,v] of Object.entries(results)) {
    console.log(`  ${k} -> ${v}`);
  }

  // Interpret values
  function interpret(raw: string) {
    if (raw.startsWith("ERR")) return { as8: "N/A", as1e18: "N/A" };
    const bi = BigInt(raw);
    const as8 = Number(bi) / 1e8;
    const as1e18 = Number(bi) / 1e18;
    return { as8: as8.toString(), as1e18: as1e18.toString() };
  }

  console.log("\nInterpreted prices:");
  for (const [k,v] of Object.entries(results)) {
    const iv = interpret(v);
    console.log(`  ${k}: as 8-decimals => ${iv.as8} USD ; as 1e18 => ${iv.as1e18} USD`);
  }

  // Also show what Vault expects (from Vault._usd6 comment: getPrice() returns 8 decimals)
  console.log("\nNotes:");
  console.log(" - Vault deposit path expects oracle.getPrice() to return price with 8 decimals (e.g., 700000000 => $7.00).");
  console.log(" - Treasury code in repo expects getSagPriceUsd()/getGoldPriceUsd() returning 1e18-based price (e.g., 7000000000000000000 => $7.0).");
  console.log(" - If oracle returns 8-decimals but Treasury expects 1e18, that's a mismatch and will cause calls to revert or compute wrong values.");
}

async function main() {
  const addrs = await loadAddresses();
  const VAULT = addrs.Vault;
  const MDOT = addrs.MockDOT;
  if (!VAULT || !MDOT) {
    throw new Error("Vault or MockDOT address missing in frontend addresses.ts");
  }
  const [caller] = await hre.ethers.getSigners();
  console.log("Running as:", caller.address);
  console.log("Vault:", VAULT);
  console.log("mDOT:", MDOT);

  const vault = await hre.ethers.getContractAt("Vault", VAULT, caller);
  let assetInfo;
  try {
    assetInfo = await vault.assets(MDOT);
  } catch (err) {
    console.error("Failed to read Vault.assets(mdot):", err);
    process.exit(1);
  }
  console.log("Vault.assets(mDOT):", assetInfo);

  const oracleAddr = assetInfo.oracle || addrs.MockOracle;
  await probeOracle(oracleAddr, VAULT, MDOT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
