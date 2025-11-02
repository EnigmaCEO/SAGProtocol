// scripts/deploy_full.ts
import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function wait(d: any) {
  if (d.waitForDeployment) return d.waitForDeployment();
  if (d.deployed) return d.deployed();
}

function addr(d: any): string {
  return (d.target ?? d.address) as string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "Chain ID:", network.chainId.toString());
  
  if (Number(network.chainId) !== 1337 && Number(network.chainId) !== 31337) {
    console.warn("⚠️ Warning: Not deploying to localhost. Chain ID:", network.chainId.toString());
  }

  // 1) Core tokens
  console.log("\n=== Deploying MockUSDC ===");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await wait(usdc);
  console.log("MockUSDC:", addr(usdc));

  console.log("\n=== Deploying SAGToken ===");
  const SAGToken = await ethers.getContractFactory("SAGToken");
  const sag = await SAGToken.deploy();
  await wait(sag);
  console.log("SAGToken:", addr(sag));

  console.log("\n=== Deploying MockGOLD ===");
  const MockGOLD = await ethers.getContractFactory("MockGOLD");
  const gold = await MockGOLD.deploy();
  await wait(gold);
  console.log("MockGOLD:", addr(gold));

  // 2) Core protocol contracts
  console.log("\n=== Deploying Vault ===");
  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy();
  await wait(vault);
  console.log("Vault:", addr(vault));

  console.log("\n=== Deploying Treasury ===");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(addr(usdc));
  await wait(treasury);
  console.log("Treasury:", addr(treasury));

  console.log("\n=== Deploying ReserveController ===");
  const ReserveController = await ethers.getContractFactory("ReserveController");
  const reserve = await ReserveController.deploy(addr(treasury));
  await wait(reserve);
  console.log("ReserveController:", addr(reserve));

  // 3) Oracle
  console.log("\n=== Deploying MockOracle ===");
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const oracle = await MockOracle.deploy();
  await wait(oracle);
  await (await oracle.setPrice(BigInt(2000 * 1e8))).wait();
  console.log("MockOracle (GOLD/USD):", addr(oracle));

  // 4) AMM pools
  console.log("\n=== Deploying AMM Pairs ===");
  const Pair = await ethers.getContractFactory("MockAmmPair");
  
  const ammSAGUSDC = await Pair.deploy();
  await wait(ammSAGUSDC);
  console.log("AMM SAG/USDC:", addr(ammSAGUSDC));

  const ammUSDCGOLD = await Pair.deploy();
  await wait(ammUSDCGOLD);
  console.log("AMM USDC/GOLD:", addr(ammUSDCGOLD));

  // 5) Investment Escrow
  console.log("\n=== Deploying InvestmentEscrow ===");
  const InvestmentEscrow = await ethers.getContractFactory("InvestmentEscrow");
  const escrow = await InvestmentEscrow.deploy(addr(treasury), addr(usdc));
  await wait(escrow);
  console.log("InvestmentEscrow:", addr(escrow));

  // 6) Wire relationships
  console.log("\n=== Configuring contracts ===");
  try { await (await vault.setTreasury(addr(treasury))).wait(); } catch (e) { console.log("Skip vault.setTreasury"); }
  try { await (await treasury.setVault(addr(vault))).wait(); } catch (e) { console.log("Skip treasury.setVault"); }
  try { await (await treasury.setReserveController(addr(reserve))).wait(); } catch (e) { console.log("Skip treasury.setReserveController"); }
  // try { await (await reserve.setOracle(addr(oracle))).wait(); } catch (e) { console.log("Skip reserve.setOracle"); }
  // try { await (await reserve.setGOLD(addr(gold))).wait(); } catch (e) { console.log("Skip reserve.setGOLD"); }
  // try { await (await reserve.setAmmPair(addr(ammUSDCGOLD))).wait(); } catch (e) { console.log("Skip reserve.setAmmPair"); }

  // 6.5) Fund demo account
  console.log("\n=== Funding demo account ===");
  const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat account #0
  const fundAmount = BigInt(1000 * 1e6); // 1000 USDC
  try {
    await (await usdc.mint(demoAddress, fundAmount)).wait();
    console.log(`Minted ${fundAmount / BigInt(1e6)} USDC to demo account:`, demoAddress);
  } catch (e) {
    console.log("Failed to fund demo account:", e);
  }

  // 7) Write deployment info
  const deployments = {
    network: "localhost",
    chainId: 1337,
    SAGToken: addr(sag),
    MockUSDC: addr(usdc),
    MockGOLD: addr(gold),
    Vault: addr(vault),
    Treasury: addr(treasury),
    ReserveController: addr(reserve),
    InvestmentEscrow: addr(escrow),
    MockOracle: addr(oracle),
    AmmSAGUSDC: addr(ammSAGUSDC),
    AmmUSDCGOLD: addr(ammUSDCGOLD),
  };

  fs.writeFileSync(
    path.join(__dirname, "../deployments.json"),
    JSON.stringify(deployments, null, 2)
  );

  const content =
`// AUTO-GENERATED. DO NOT EDIT.
export const CONTRACT_ADDRESSES = ${JSON.stringify(deployments, null, 2)} as const;
`;
  
  // Write to src/lib directory
  const srcLibDir = path.join(__dirname, "../src/lib");
  if (!fs.existsSync(srcLibDir)) {
    fs.mkdirSync(srcLibDir, { recursive: true });
  }
  fs.writeFileSync(path.join(srcLibDir, "addresses.ts"), content);
  
  // Also write to frontend if it exists
  const frontendDir = path.join(__dirname, "../frontend/src/lib");
  if (fs.existsSync(frontendDir)) {
    fs.writeFileSync(path.join(frontendDir, "addresses.ts"), content);
  }

  console.log("\n✅ Deployment complete");
  console.log("📝 Saved to deployments.json");
  console.log("📝 Saved to src/lib/addresses.ts");
  console.log("\n🎮 Demo Account:", demoAddress);
  console.log("💰 USDC Balance: 1000");
  console.log("\n⚠️ IMPORTANT: If using Hardhat node, these addresses are only valid for this session.");
  console.log("Restart Hardhat node = need to redeploy!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
