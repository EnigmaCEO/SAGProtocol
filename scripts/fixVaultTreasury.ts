import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadAddresses() {
  const addressesPath = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  if (!fs.existsSync(addressesPath)) throw new Error("addresses.ts not found: " + addressesPath);
  const src = fs.readFileSync(addressesPath, "utf8");
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) throw new Error("CONTRACT_ADDRESSES not found in addresses.ts");
  const objText = m[1].trim();
  try {
    return JSON.parse(objText);
  } catch {
    // fallback to evaluate object literal
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${objText});`);
    return fn();
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Using deployer:", deployer.address);

  const addrs = await loadAddresses();
  const vaultAddr = addrs.Vault;
  const treasuryAddr = addrs.Treasury;
  if (!vaultAddr || !treasuryAddr) throw new Error("Vault or Treasury address missing in addresses.ts");

  const vault = await hre.ethers.getContractAt("Vault", vaultAddr, deployer);
  console.log("Current vault.treasury():", await vault.treasury());
  console.log("Setting vault.treasury() ->", treasuryAddr);
  const tx = await vault.setTreasury(treasuryAddr);
  await tx.wait();
  const after = await vault.treasury();
  console.log("After set, vault.treasury():", after);
  if (after.toLowerCase() !== treasuryAddr.toLowerCase()) {
    throw new Error("Failed to set vault.treasury correctly");
  }
  console.log("Success: Vault wired to Treasury.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
