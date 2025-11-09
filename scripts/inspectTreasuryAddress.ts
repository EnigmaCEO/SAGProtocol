import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadAddressesTs(): Promise<Record<string, any> | null> {
  const p = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, "utf8");
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) return null;
  const objText = m[1].trim();
  try { return JSON.parse(objText); } catch {
    // fallback
    // eslint-disable-next-line no-new-func
    return new Function(`return (${objText});`)();
  }
}

function short(hex: string) {
  return hex ? hex.slice(0, 66) : "<empty>";
}

async function main() {
  const [caller] = await hre.ethers.getSigners();
  console.log("Running inspector as:", caller.address);

  const addrs = (await loadAddressesTs()) ?? {};
  const VAULT = process.env.VAULT_ADDRESS ?? addrs.Vault;
  const EXPECTED_TREASURY = process.env.TREASURY_ADDRESS ?? addrs.Treasury;

  if (!VAULT) {
    console.error("Vault address not provided. Set FRONTEND addresses.ts or export V AULT_ADDRESS env var.");
    process.exit(1);
  }

  console.log("Vault address:", VAULT);
  if (EXPECTED_TREASURY) console.log("Configured frontend Treasury:", EXPECTED_TREASURY);

  const vault = await hre.ethers.getContractAt("Vault", VAULT, caller);
  const vaultTreasury = await vault.treasury();
  console.log("Vault.treasury() =>", vaultTreasury);

  const provider = hre.ethers.provider;
  const onchainCode = await provider.getCode(vaultTreasury);
  console.log("On-chain bytecode length:", onchainCode.length / 2, "bytes");
  console.log("On-chain bytecode (prefix):", short(onchainCode));

  // load compiled artifact for Treasury
  let compiledRuntime = "";
  try {
    const artifact = await hre.artifacts.readArtifact("Treasury");
    compiledRuntime = artifact.deployedBytecode?.startsWith("0x") ? artifact.deployedBytecode : `0x${artifact.deployedBytecode}`;
    console.log("Compiled Treasury deployedBytecode length:", compiledRuntime.length / 2, "bytes");
    console.log("Compiled Treasury bytecode (prefix):", short(compiledRuntime));
  } catch (err) {
    console.warn("Could not read compiled Treasury artifact:", String(err));
  }

  // compare prefixes
  if (compiledRuntime) {
    const match = onchainCode && compiledRuntime && onchainCode.startsWith(compiledRuntime.slice(0, 200));
    console.log("Compiled runtime prefix matches on-chain prefix:", match ? "YES" : "NO");
  }

  // attempt safe owner() call (if present)
  try {
    const treasuryProbe = new hre.ethers.Contract(vaultTreasury, ["function owner() view returns (address)"], provider);
    const owner = await treasuryProbe.owner();
    console.log("Candidate contract owner():", owner);
  } catch (err) {
    console.warn("owner() call failed (selector mismatch or no owner):", String(err));
  }

  // attempt to call getTreasuryValueUsd() but catch errors
  try {
    const treasuryProbeFull = new hre.ethers.Contract(vaultTreasury, ["function getTreasuryValueUsd() view returns (uint256)"], provider);
    const v = await treasuryProbeFull.getTreasuryValueUsd();
    console.log("getTreasuryValueUsd() returned:", v.toString());
  } catch (err) {
    console.warn("getTreasuryValueUsd() call failed (expected if selector mismatch):", String(err));
  }

  console.log("\nNext steps:");
  console.log("- If on-chain bytecode does not match compiled Treasury, Vault.treasury() points to the wrong contract. Update wiring or addresses.ts.");
  console.log("- If bytecode matches but calls still revert, check ABI mismatch, compiler settings, or redeploy Treasury.");
  console.log("- To fix wiring without redeploy: run scripts/fixVaultTreasury.ts (you already ran it) but ensure addresses.ts contains the correct treasury address.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
