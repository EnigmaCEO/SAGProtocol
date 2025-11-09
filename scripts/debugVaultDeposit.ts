import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers as Ethers } from "ethers"; // plain ethers v6
const { ethers } = hre;

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load ABI JSON
function loadAbi(relPath: string) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), "utf8"));
}

async function main() {
  // --- CONFIG ---
  // Replace these with your actual deployed addresses or leave placeholders and let the script load ../deployments.json
  let VAULT_ADDRESS = "<VAULT_ADDRESS>";
  let MDOT_ADDRESS = "<MDOT_ADDRESS>";
  let TREASURY_ADDRESS = "<TREASURY_ADDRESS>";
  let ORACLE_ADDRESS = "<ORACLE_ADDRESS>";

  // Use a private key for the test wallet (Hardhat default #0)
  const TEST_PRIVATE_KEY = process.env.DEBUG_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  // RPC URL: prefer network config, fallback to localhost
  const RPC_URL = (hre.network.config as any).url ?? "http://127.0.0.1:8545";

  // --- Auto-load addresses from frontend/src/lib/addresses.ts OR deployments.json if placeholders present ---
  const addressesTsPath = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");

  function looksLikePlaceholder(v: string) {
    return !v || v.startsWith("<") || v.includes("PLACEHOLDER");
  }

  async function loadFromAddressesTs(): Promise<Record<string, any> | null> {
    if (!fs.existsSync(addressesTsPath)) return null;
    try {
      const src = fs.readFileSync(addressesTsPath, "utf8");
      // match: export const CONTRACT_ADDRESSES = { ... } as const;
      const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
      if (!m) return null;
      const objText = m[1].trim();
      // try JSON.parse first (most generated files are JSON-like)
      try {
        return JSON.parse(objText);
      } catch {
        // fallback: evaluate the object literal safely
        // wrap in parentheses to allow top-level object literal
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (${objText});`);
        return fn();
      }
    } catch (err) {
      console.error("Failed to read/parse addresses.ts:", err);
      return null;
    }
  }

  if (looksLikePlaceholder(VAULT_ADDRESS) || looksLikePlaceholder(MDOT_ADDRESS) || looksLikePlaceholder(TREASURY_ADDRESS) || looksLikePlaceholder(ORACLE_ADDRESS)) {
    // Prefer addresses.ts if present
    const addrs = await loadFromAddressesTs();
    if (addrs) {
      VAULT_ADDRESS = VAULT_ADDRESS.startsWith("<") ? (addrs.Vault ?? VAULT_ADDRESS) : VAULT_ADDRESS;
      MDOT_ADDRESS = MDOT_ADDRESS.startsWith("<") ? (addrs.MockDOT ?? addrs.MockDOT ?? MDOT_ADDRESS) : MDOT_ADDRESS;
      TREASURY_ADDRESS = TREASURY_ADDRESS.startsWith("<") ? (addrs.Treasury ?? TREASURY_ADDRESS) : TREASURY_ADDRESS;
      ORACLE_ADDRESS = ORACLE_ADDRESS.startsWith("<") ? (addrs.MockOracle ?? addrs.MockOracle ?? ORACLE_ADDRESS) : ORACLE_ADDRESS;
      console.log("Loaded addresses from frontend/src/lib/addresses.ts");
    } else if (fs.existsSync(deploymentsPath)) {
      try {
        const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
        VAULT_ADDRESS = VAULT_ADDRESS.startsWith("<") ? (dep.Vault ?? VAULT_ADDRESS) : VAULT_ADDRESS;
        MDOT_ADDRESS = MDOT_ADDRESS.startsWith("<") ? (dep.MockDOT ?? MDOT_ADDRESS) : MDOT_ADDRESS;
        TREASURY_ADDRESS = TREASURY_ADDRESS.startsWith("<") ? (dep.Treasury ?? TREASURY_ADDRESS) : TREASURY_ADDRESS;
        ORACLE_ADDRESS = ORACLE_ADDRESS.startsWith("<") ? (dep.MockOracle ?? ORACLE_ADDRESS) : ORACLE_ADDRESS;
        console.log("Loaded addresses from deployments.json");
      } catch (err) {
        console.error("Failed to parse deployments.json:", err);
      }
    }
  }

  // --- Basic address validation to avoid ENS resolution attempts ---
  const isHexAddress = (a: string) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
  const invalid = [];
  if (!isHexAddress(VAULT_ADDRESS)) invalid.push({ name: "VAULT_ADDRESS", value: VAULT_ADDRESS });
  if (!isHexAddress(MDOT_ADDRESS)) invalid.push({ name: "MDOT_ADDRESS", value: MDOT_ADDRESS });
  if (!isHexAddress(TREASURY_ADDRESS)) invalid.push({ name: "TREASURY_ADDRESS", value: TREASURY_ADDRESS });
  if (!isHexAddress(ORACLE_ADDRESS)) invalid.push({ name: "ORACLE_ADDRESS", value: ORACLE_ADDRESS });

  if (invalid.length > 0) {
    console.error("One or more contract addresses are invalid/non-hex. This would trigger ENS resolution and fail on a non-ENS network.");
    invalid.forEach(i => console.error(`${i.name}: ${i.value}`));
    console.error("Options:\n - Update the script constants with the deployed 0x... addresses,\n - OR create ../deployments.json (output by your deploy script) with keys: Vault, MockDOT, Treasury, MockOracle\n - OR pass DEBUG_PRIVATE_KEY env var if you want to use a different signer.");
    process.exit(1);
  }

  // Normalize addresses to checksummed hex to avoid any ENS resolution
  try {
    VAULT_ADDRESS = Ethers.getAddress(VAULT_ADDRESS);
    MDOT_ADDRESS = Ethers.getAddress(MDOT_ADDRESS);
    TREASURY_ADDRESS = Ethers.getAddress(TREASURY_ADDRESS);
    ORACLE_ADDRESS = Ethers.getAddress(ORACLE_ADDRESS);
  } catch (err) {
    console.error("Address normalization failed (invalid hex address):", err);
    process.exit(1);
  }

  console.log("RPC URL:", RPC_URL);
  // provide explicit network info to avoid 'unknown' network name
  const provider = new Ethers.JsonRpcProvider(RPC_URL, { name: "localhost", chainId: 1337 });
  const net = await provider.getNetwork();
  console.log("Provider network:", { chainId: net.chainId, name: net.name });

  // --- Load ABIs from disk ---
  const VaultABI = loadAbi("../frontend/src/lib/abis/Vault.json"); // pure array
  const MockDOTABI = loadAbi("../frontend/src/lib/abis/MockDOT.json"); // pure array
  const TreasuryABI = loadAbi("../frontend/src/lib/abis/Treasury.json").abi; // object with .abi
  const MockOracleABI = loadAbi("../frontend/src/lib/abis/MockOracle.json").abi; // object with .abi

  // --- Create a standalone ethers provider + wallet (bypass hardhat-ethers plugin) ---
  const wallet = new Ethers.Wallet(TEST_PRIVATE_KEY, provider);

  // --- Construct contracts with ethers.Contract (use wallet for read/write) ---
  const vault = new Ethers.Contract(VAULT_ADDRESS, VaultABI, wallet);
  const mdot = new Ethers.Contract(MDOT_ADDRESS, MockDOTABI, wallet);
  const treasury = new Ethers.Contract(TREASURY_ADDRESS, TreasuryABI, wallet);
  const oracle = new Ethers.Contract(ORACLE_ADDRESS, MockOracleABI, wallet);

  // --- Check Vault ABI compatibility ---
  try {
    const owner = await vault.owner();
    console.log("Vault owner:", owner);
  } catch (e) {
    console.error("Vault ABI/address mismatch:", e);
    return;
  }

  // --- Check mDOT asset registration ---
  const assetInfo = await vault.assets(MDOT_ADDRESS);
  console.log("mDOT assetInfo in Vault:", assetInfo);
  if (!assetInfo.enabled) {
    console.error("mDOT is not enabled in Vault. Call setAsset(mdot, true, 6, oracle) as owner.");
    return;
  }
  if (Number(assetInfo.decimals) !== 6) {
    console.error("mDOT decimals in Vault are not 6. Fix with setAsset.");
    return;
  }
  if (assetInfo.oracle.toLowerCase() !== ORACLE_ADDRESS.toLowerCase()) {
    console.error("Vault mDOT oracle address mismatch.");
    return;
  }

  // --- Check Treasury wiring ---
  const vaultTreasury = await vault.treasury();
  if (vaultTreasury.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    console.error("Vault treasury address mismatch.");
    return;
  }
  const treasuryVault = await treasury.vault();
  if (treasuryVault.toLowerCase() !== VAULT_ADDRESS.toLowerCase()) {
    console.error("Treasury vault address mismatch.");
    return;
  }

  // --- Check Treasury funding ---
  // Probe treasury internals to diagnose failing getTreasuryValueUsd()
  try {
    const sagAddr = await treasury.sag();
    const usdcAddr = await treasury.usdc();
    const goldAddr = await treasury.gold();
    const priceOracleAddr = await treasury.priceOracle();
    console.log("Treasury tokens/oracle:", { sagAddr, usdcAddr, goldAddr, priceOracleAddr });

    const erc20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)"
    ];
    const sagToken = new Ethers.Contract(sagAddr, erc20Abi, provider);
    const usdcToken = new Ethers.Contract(usdcAddr, erc20Abi, provider);

    // Use the validated TREASURY_ADDRESS string (avoid treasury.address which may be undefined)
    const sagBal = await sagToken.balanceOf(TREASURY_ADDRESS);
    const usdcBal = await usdcToken.balanceOf(TREASURY_ADDRESS);
    console.log("Treasury balances:", { sagBal: sagBal.toString(), usdcBal: usdcBal.toString() });

    // Probe oracle for SAG price using several possible method names
    const oracleProbe = new Ethers.Contract(
      priceOracleAddr,
      [
        "function getSagPriceUsd() view returns (uint256)",
        "function getPrice() view returns (uint256)",
        "function getPriceUsd() view returns (uint256)",
        "function latestAnswer() view returns (int256)"
      ],
      provider
    );
    let sagPrice: bigint | null = null;
    try { sagPrice = await oracleProbe.getSagPriceUsd(); console.log("Oracle: getSagPriceUsd() ->", sagPrice.toString()); } catch {}
    if (sagPrice === null) {
      try { sagPrice = await oracleProbe.getPrice(); console.log("Oracle: getPrice() ->", sagPrice.toString()); } catch {}
    }
    if (sagPrice === null) {
      try { sagPrice = await oracleProbe.getPriceUsd(); console.log("Oracle: getPriceUsd() ->", sagPrice.toString()); } catch {}
    }
    if (sagPrice === null) {
      if (typeof oracleProbe.latestAnswer === "function") {
        try { const ans = await oracleProbe.latestAnswer(); sagPrice = BigInt(ans.toString()); console.log("Oracle: latestAnswer() ->", sagPrice.toString()); } catch {}
      }
    }
    if (sagPrice === null) {
      console.error("Failed to read SAG price from oracle at", priceOracleAddr, ". Oracle does not expose expected methods.");
      return;
    }

    // Compute SAG USD6 value: sagBal (18) * sagPrice(1e18) -> convert to 6 decimals
    // Use native BigInt for arithmetic
    const sagBalBig = BigInt(sagBal.toString());
    const sagPriceBig = BigInt(sagPrice.toString());
    const ONE_E18 = BigInt("1000000000000000000");
    const ONE_E12 = BigInt("1000000000000");
    const sagValueUsd6 = (sagBalBig * sagPriceBig) / ONE_E18 / ONE_E12;
    console.log("Computed SAG value (USD6):", sagValueUsd6.toString());

    const usdcBalBig = BigInt(usdcBal.toString());
    const treasuryValue = sagValueUsd6 + usdcBalBig;
    console.log("Treasury USD value (USD6):", treasuryValue.toString());
    if (treasuryValue < Ethers.parseUnits("1", 6)) {
      console.error("Treasury appears underfunded. Mint USDC to Treasury.");
      return;
    }
  } catch (err) {
    console.error("Error probing treasury internals:", err);
    return;
  }

  // --- Check Oracle price ---
  const price = await oracle.getPrice();
  console.log("Oracle price for mDOT:", price.toString());
  if (BigInt(price.toString()) === 0n) {
    console.error("Oracle price is zero. Set a valid price in MockOracle.");
    return;
  }

  // --- Check allowance ---
  const depositAmount = Ethers.parseUnits("10", 6); // 10 mDOT
  const allowance = await mdot.allowance(wallet.address, VAULT_ADDRESS);
  console.log("mDOT allowance for Vault:", allowance.toString());
  // allowance and depositAmount are bigints; compare directly
  if (BigInt(allowance.toString()) < BigInt(depositAmount.toString())) {
    console.log("Approving Vault to spend mDOT...");
    const tx = await mdot.approve(VAULT_ADDRESS, depositAmount);
    await tx.wait();
    console.log("Approved.");
  }

  // --- Try deposit ---
  try {
    console.log("Attempting deposit...");
    const tx = await vault.deposit(MDOT_ADDRESS, depositAmount);
    const receipt = await tx.wait();
    console.log("Deposit successful. Tx hash:", receipt.transactionHash);
  } catch (e: any) {
    console.error("Deposit failed:", e?.error?.message || e?.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
