import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadFrontendAddresses() {
  const p = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, "utf8");
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Load addresses.ts for existing Treasury address
  const addrs = (await loadFrontendAddresses()) ?? {};
  const treasuryAddr = process.env.TREASURY_ADDRESS ?? addrs.Treasury;
  if (!treasuryAddr) {
    console.error("Treasury address not found in frontend addresses.ts or env TREASURY_ADDRESS");
    process.exit(1);
  }
  console.log("Using Treasury:", treasuryAddr);

  // Deploy updated MockOracle
  const MockOracle = await hre.ethers.getContractFactory("MockOracle");
  const oracle = await MockOracle.connect(deployer).deploy();
  await oracle.waitForDeployment();
  console.log("Deployed MockOracle:", oracle.address);

  // Set a sensible price (optional) — you can change value via script later
  // Example: $7.00 => 700000000 (8 decimals)
  const defaultPrice = process.env.MOCK_ORACLE_PRICE ?? "700000000";
  await (await oracle.setPrice(hre.ethers.BigNumber.from(defaultPrice))).wait();
  console.log("Set MockOracle price to:", defaultPrice);

  // Point existing Treasury to the new oracle
  const treasury = await hre.ethers.getContractAt("Treasury", treasuryAddr, deployer);
  const tx = await treasury.setPriceOracle(oracle.address);
  await tx.wait();
  console.log("Updated treasury.priceOracle ->", oracle.address);

  // Optionally update frontend addresses.ts
  try {
    const frontendPath = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
    if (fs.existsSync(frontendPath)) {
      const frontend = fs.readFileSync(frontendPath, "utf8");
      const updated = frontend.replace(/"MockOracle":\s*"0x[a-fA-F0-9]{40}"/, `"MockOracle": "${oracle.address}"`);
      fs.writeFileSync(frontendPath, updated, "utf8");
      console.log("Updated frontend/src/lib/addresses.ts with new MockOracle");
    }
  } catch (e) {
    console.warn("Failed to update frontend addresses.ts:", e);
  }

  console.log("\n✅ Done. Restart frontend or re-run debug script to verify getTreasuryValueUsd now works.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
