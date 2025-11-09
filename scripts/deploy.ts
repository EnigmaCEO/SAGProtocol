import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Add these lines for ESM __dirname support:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function wait(d: any) {
  if (d.waitForDeployment) return d.waitForDeployment();
  if (d.deployed) return d.deployed();
}

function addr(d: any): string {
  return (d.target ?? d.address) as string;
}

async function verifyDeployed(address: string, name: string) {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`Deployment verification failed: ${name} not deployed at ${address}`);
  }
}

async function deployAndVerify(factory: any, ...args: any[]) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = addr(contract);
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    console.error(`❌ Deployment failed: No bytecode at ${address}`);
    process.exit(1);
  }
  return contract;
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
  const usdc = await deployAndVerify(MockUSDC);
  console.log("MockUSDC:", addr(usdc));

  console.log("\n=== Deploying SAGToken ===");
  const SAGToken = await ethers.getContractFactory("SAGToken");
  const sag = await deployAndVerify(SAGToken);
  console.log("SAGToken:", addr(sag));

  console.log("\n=== Deploying MockGOLD ===");
  const MockGOLD = await ethers.getContractFactory("MockGOLD");
  const gold = await deployAndVerify(MockGOLD);
  console.log("MockGOLD:", addr(gold));

  console.log("\n=== Deploying MockDOT ===");
  const MockDOT = await ethers.getContractFactory("MockDOT");
  const mdot = await deployAndVerify(MockDOT);
  const mdotDecimals = await mdot.decimals();
  if (Number(mdotDecimals) !== 6) {
    throw new Error(`MockDOT decimals must be 6, got ${mdotDecimals}`);
  }
  console.log("MockDOT:", addr(mdot));

  // 2) Core protocol contracts
  console.log("\n=== Deploying Vault ===");
  const Vault = await ethers.getContractFactory("Vault");
  const vault = await deployAndVerify(Vault);
  console.log("Vault:", addr(vault));

  console.log("\n=== Deploying ReserveController ===");
  const ReserveController = await ethers.getContractFactory("ReserveController");
  const reserve = await deployAndVerify(ReserveController, addr(gold)); // or correct constructor arg
  console.log("ReserveController:", addr(reserve));

  const MockOracle = await ethers.getContractFactory("MockOracle");
  // Deploy three per-asset oracles (SAG, GOLD, DOT)
  const oracleGold = await deployAndVerify(MockOracle);
  const oracleSag = await deployAndVerify(MockOracle);
  const oracleDot = await deployAndVerify(MockOracle);

  console.log("\n=== Deploying Treasury ===");
  const Treasury = await ethers.getContractFactory("Treasury");
  // Pass one oracle into constructor for backward compatibility (we'll set per-asset oracles below)
  const treasury = await deployAndVerify(
    Treasury,
    addr(sag),
    addr(usdc),
    addr(gold),
    addr(reserve),
    addr(vault),
    addr(oracleGold) // initial priceOracle (legacy); we will set sag/gold oracles explicitly
  );
  console.log("Treasury:", addr(treasury));

  // 3) Oracle
  console.log("\n=== Deploying MockOracle ===");
  
  // Set per-asset prices (8-decimals):
  // SAG = $0.75 -> 0.75 * 1e8 = 75_000_000
  await (await oracleSag.setPrice(BigInt("75000000"))).wait();
  console.log("MockOracle SAG:", addr(oracleSag), "price=75000000 (0.75 USD)");

  // GOLD = $4000 -> 4000 * 1e8 = 400_000_000_000
  await (await oracleGold.setPrice(BigInt("400000000000"))).wait();
  console.log("MockOracle GOLD:", addr(oracleGold), "price=400000000000 (4000 USD)");

  // DOT = $10 -> 10 * 1e8 = 1_000_000_000
  await (await oracleDot.setPrice(BigInt("1000000000"))).wait();
  console.log("MockOracle DOT:", addr(oracleDot), "price=1000000000 (10 USD)");

  console.log("\n=== Deploying Receipt NFT ===");
  const Receipt = await ethers.getContractFactory("SagittaVaultReceipt");
  const receiptNft = await deployAndVerify(Receipt, "Sagitta Vault Receipt", "SVR");
  console.log("ReceiptNFT:", addr(receiptNft));

  // 4) AMM pools
  console.log("\n=== Deploying AMM Pairs ===");
  const Pair = await ethers.getContractFactory("MockAmmPair");
  
  const ammSAGUSDC = await deployAndVerify(Pair);
  console.log("AMM SAG/USDC:", addr(ammSAGUSDC));

  const ammUSDCGOLD = await deployAndVerify(Pair);
  console.log("AMM USDC/GOLD:", addr(ammUSDCGOLD));

  // 5) Investment Escrow
  console.log("\n=== Deploying InvestmentEscrow ===");
  const InvestmentEscrow = await ethers.getContractFactory("InvestmentEscrow");
  const escrow = await deployAndVerify(InvestmentEscrow, addr(treasury), addr(usdc));
  console.log("InvestmentEscrow:", addr(escrow));

  // 6) Wire relationships
  console.log("\n=== Configuring contracts ===");
  // Wire Vault <-> Treasury and verify. Throw on failure so mis-wiring is visible.
  await (await vault.setTreasury(addr(treasury))).wait();
  const wiredTreasury = await vault.treasury();
  if (wiredTreasury.toLowerCase() !== addr(treasury).toLowerCase()) {
    throw new Error(`Wiring failed: vault.treasury() = ${wiredTreasury}, expected ${addr(treasury)}`);
  }
  await (await treasury.setVault(addr(vault))).wait();
  const wiredVault = await treasury.vault();
  if (wiredVault.toLowerCase() !== addr(vault).toLowerCase()) {
    throw new Error(`Wiring failed: treasury.vault() = ${wiredVault}, expected ${addr(vault)}`);
  }
  // Reserve controller wiring: Treasury exposes setReserveAddress(...)
  await (await treasury.setReserveAddress(addr(reserve))).wait();
  const wiredReserve = await treasury.reserveAddress();
  if (wiredReserve.toLowerCase() !== addr(reserve).toLowerCase()) {
    throw new Error(`Wiring failed: treasury.reserveAddress() = ${wiredReserve}, expected ${addr(reserve)}`);
  }
  console.log("Wired Vault <-> Treasury <-> ReserveController");

  // Wire receipt NFT
      try {
        const vaultAddr = addr(vault);
        // Prefer setMinter if present, fallback to AccessControl's MINTER_ROLE
        if ("setMinter" in (receiptNft as any)) {
          await (await (receiptNft as any).setMinter(vaultAddr)).wait();
        } else if ("grantRole" in (receiptNft as any)) {
          let minterRole: string | undefined;
          try {
            const role = (receiptNft as any).MINTER_ROLE;
            minterRole = typeof role === "function" ? await role() : role;
          } catch (_) {}
          if (minterRole) {
            await (await (receiptNft as any).grantRole(minterRole, vaultAddr)).wait();
          } else {
            console.log("MINTER_ROLE not found on Receipt NFT, skipping minter grant");
          }
        } else {
          console.log("Receipt NFT has no setMinter/grantRole, skipping minter wiring");
        }
        if ("setReceiptNFT" in (vault as any)) {
          await (await (vault as any).setReceiptNFT(addr(receiptNft))).wait();
        } else if ("setReceiptToken" in (vault as any)) {
          await (await (vault as any).setReceiptToken(addr(receiptNft))).wait();
        } else {
          console.log("Vault has no setReceiptNFT/setReceiptToken, skipping receipt NFT wiring");
        }
      } catch (e) { console.log("Skip wiring receipt NFT:", e); }

  // Enable SAGToken on Vault with its decimals and the MockOracle
  try {
    const sagDecimals = await sag.decimals();
    await (await vault.setAsset(addr(sag), true, Number(sagDecimals), addr(oracleSag))).wait();
    // Optional: shorten lock duration for local testing (e.g., 5 minutes)
    try { await (await vault.setLockDuration(60 * 5)).wait(); } catch (_) {}
    console.log("Vault asset configured:", { asset: addr(sag), decimals: sagDecimals.toString(), oracle: addr(oracle) });
  } catch (e) {
    console.log("Skip vault.setAsset:", e);
  }

  // Enable MockDOT on Vault with its decimals and the MockOracle
  try {
    const mdotDecimals = await mdot.decimals();
    // Make sure 'oracle' here is the correct MockOracle address
    await (await vault.setAsset(addr(mdot), true, Number(mdotDecimals), addr(oracleDot))).wait();
    // Set 12 months lock (MVP)
    try { await (await vault.setLockDuration(365 * 24 * 60 * 60)).wait(); } catch (_) {}
    console.log("Vault asset configured:", { asset: addr(mdot), decimals: mdotDecimals.toString(), oracle: addr(oracle) });
  } catch (e) {
    console.log("Skip vault.setAsset:", e);
  }

  // Wire Treasury to use per-asset oracles (requires Treasury.setSagOracle/setGoldOracle implemented)
  try {
    await (await treasury.setSagOracle(addr(oracleSag))).wait();
    await (await treasury.setGoldOracle(addr(oracleGold))).wait();
    console.log("Treasury sagOracle ->", addr(oracleSag), "goldOracle ->", addr(oracleGold));
  } catch (e) {
    console.log("Failed to set per-asset oracles on Treasury:", e);
  }

  // 6) Mint initial tokens

  // Mint 1M USD worth of SAG to the Treasury using the Oracle price of 0.75 per SAG to calculate
  console.log("\n=== Minting initial SAG to Treasury ===");
  const sagDecimalsRaw = await sag.decimals();
  const sagDecimalsNum = Number(sagDecimalsRaw);
  const sagPriceRaw = await oracleSag.getPrice();
  const sagPriceBig = BigInt(sagPriceRaw.toString());
  const ONE_MILLION_USD = 1_000_000n;
  const sagToMint = (ONE_MILLION_USD * (10n ** BigInt(8 + sagDecimalsNum))) / sagPriceBig;
  try {
    await (await sag.mint(addr(treasury), sagToMint)).wait();
    console.log(`Minted ${sagToMint.toString()} SAG to Treasury:`, addr(treasury));
  } catch (e) {
    console.log("Failed to mint SAG to Treasury:", e);
  }
  
  // Mint 500k USD worth of GOLD to the ReserveController using the Oracle price of $4000 per GOLD to calculate
  console.log("\n=== Minting initial GOLD to ReserveController ===");
  const goldDecimalsRaw = await gold.decimals();
  const goldDecimalsNum = Number(goldDecimalsRaw);
  const goldPriceRaw = await oracleGold.getPrice();
  const goldPriceBig = BigInt(goldPriceRaw.toString());
  const FIVE_HUNDRED_K_USD = 500_000n;
  const goldToMint = (FIVE_HUNDRED_K_USD * (10n ** BigInt(8 + goldDecimalsNum))) / goldPriceBig;
  try {
    await (await gold.mint(addr(reserve), goldToMint)).wait();
    console.log(`Minted ${goldToMint.toString()} GOLD to ReserveController:`, addr(reserve));
  } catch (e) {
    console.log("Failed to mint GOLD to ReserveController:", e);
  }

  // 6.5) Fund demo account
  console.log("\n=== Funding demo account ===");
  const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat account #0
  const fundAmount = BigInt("1000000000"); // 1000 USDC (6 decimals)
  try {
    await (await usdc.mint(demoAddress, fundAmount)).wait();
    console.log(`Minted 1000 USDC to demo account:`, demoAddress);
  } catch (e) {
    console.log("Failed to fund demo account USDC:", e);
  }

  // Fund demo with SAGToken for deposits
  try {
    const sagDecimalsForDemo = Number(await sag.decimals());
    // 100,000 SAG expressed with token decimals
    const sagToDemo = 100_000n * (10n ** BigInt(sagDecimalsForDemo));
    // mint(address,uint256) if available
    if ("mint" in sag) {
      await (await sag.mint(demoAddress, sagToDemo)).wait();
      console.log(`Minted 100000 SAG to demo account`);
    } else {
      console.log("SAGToken.mint not available, skip funding demo SAG");
    }
  } catch (e) {
    console.log("Failed to fund demo account SAG:", e);
  }

  // Fund demo with MockDOT for deposits
  try {
    const mdotDecimals = await mdot.decimals();
    // Mint 1000 mDOT (or more) for testing
    const mdotToDemo = BigInt("1000") * BigInt(10) ** BigInt(mdotDecimals); // 1000 mDOT
    await (await mdot.mint(demoAddress, mdotToDemo)).wait();
    console.log(`Minted 1000 mDOT to demo account`);
  } catch (e) {
    console.log("Failed to fund demo account mDOT:", e);
  }

  // Fund demo account with ETH for gas
  console.log("\n=== Funding demo account with ETH ===");
  try {
    // Send 10 ETH to demo account for testing
    await deployer.sendTransaction({
      to: demoAddress,
      value: ethers.parseEther("10.0"),
    });
    console.log(`Sent 10 ETH to demo account: ${demoAddress}`);
  } catch (e) {
    console.log("Failed to fund demo account with ETH:", e);
  }

  // 7) Write deployment info
  const deployments = {
    network: "localhost",
    chainId: 1337,
    SAGToken: addr(sag),
    MockUSDC: addr(usdc),
    MockGOLD: addr(gold),
    MockDOT: addr(mdot),
    Vault: addr(vault),
    Treasury: addr(treasury),
    ReserveController: addr(reserve),
    InvestmentEscrow: addr(escrow),
    GoldOracle: addr(oracleGold),
    SagOracle: addr(oracleSag),
    DotOracle: addr(oracleDot),
    ReceiptNFT: addr(receiptNft),
    AmmSAGUSDC: addr(ammSAGUSDC),
    AmmUSDCGOLD: addr(ammUSDCGOLD),
  };

  // --- Verification step ---
  for (const [name, address] of Object.entries(deployments)) {
    if (typeof address === "string" && address.startsWith("0x") && address.length === 42) {
      const code = await ethers.provider.getCode(address);
      if (!code || code === "0x") {
        console.error(`❌ Verification failed: ${name} not deployed at ${address}`);
        process.exit(1);
      }
    }
  }

  const content =
`// AUTO-GENERATED. DO NOT EDIT.
export const CONTRACT_ADDRESSES = ${JSON.stringify(deployments, null, 2)} as const;
`;
  
  // Also write to frontend if it exists
  const frontendDir = path.join(__dirname, "../frontend/src/lib");
  if (fs.existsSync(frontendDir)) {
    fs.writeFileSync(path.join(frontendDir, "addresses.ts"), content);
  }

  console.log("\n✅ Deployment complete");
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
