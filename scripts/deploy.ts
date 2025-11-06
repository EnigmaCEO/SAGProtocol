// scripts/deploy_full.ts
import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";

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

  console.log("\n=== Deploying Treasury ===");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await deployAndVerify(Treasury, addr(usdc));
  console.log("Treasury:", addr(treasury));

  console.log("\n=== Deploying ReserveController ===");
  const ReserveController = await ethers.getContractFactory("ReserveController");
  const reserve = await deployAndVerify(ReserveController, addr(treasury));
  console.log("ReserveController:", addr(reserve));

  // 3) Oracle
  console.log("\n=== Deploying MockOracle ===");
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const oracle = await deployAndVerify(MockOracle);
  // Set price = $7.00 (8 decimals)
  await (await oracle.setPrice(BigInt("700000000"))).wait();
  console.log("MockOracle (GOLD/USD):", addr(oracle));

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
  try { await (await vault.setTreasury(addr(treasury))).wait(); } catch (e) { console.log("Skip vault.setTreasury"); }
  try { await (await treasury.setVault(addr(vault))).wait(); } catch (e) { console.log("Skip treasury.setVault"); }
  try { await (await treasury.setReserveController(addr(reserve))).wait(); } catch (e) { console.log("Skip treasury.setReserveController"); }

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
    await (await vault.setAsset(addr(sag), true, Number(sagDecimals), addr(oracle))).wait();
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
    await (await vault.setAsset(addr(mdot), true, Number(mdotDecimals), addr(oracle))).wait();
    // Set 12 months lock (MVP)
    try { await (await vault.setLockDuration(365 * 24 * 60 * 60)).wait(); } catch (_) {}
    console.log("Vault asset configured:", { asset: addr(mdot), decimals: mdotDecimals.toString(), oracle: addr(oracle) });
  } catch (e) {
    console.log("Skip vault.setAsset:", e);
  }

  // Fund Treasury with USDC so canAdmit() passes
    try {
      const usdcToTreasury = BigInt("1000000000000"); // 1,000,000 USDC (6 decimals)
      await (await usdc.mint(addr(treasury), usdcToTreasury)).wait();
      console.log("Funded Treasury with USDC:", usdcToTreasury.toString());
    } catch (e) {
      console.log("Skip funding Treasury USDC:", e);
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
      const sagDecimals = await sag.decimals();
      const sagToDemo = BigInt("100000") * BigInt(10) * sagDecimals; // 100k SAG
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
    MockOracle: addr(oracle),
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

  fs.writeFileSync(
    path.join(__dirname, "../deployments.json"),
    JSON.stringify(deployments, null, 2)
  );

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
