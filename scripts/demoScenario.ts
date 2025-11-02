import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Running demo scenario with deployer:", deployer.address);

  // Load deployed contract addresses
  const addresses = require("../frontend/src/lib/addresses");

  // Attach to deployed contracts
  const Vault = await ethers.getContractFactory("Vault");
  const vault = Vault.attach(addresses.Vault);

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = Treasury.attach(addresses.Treasury);

  const ReserveController = await ethers.getContractFactory("ReserveController");
  const reserve = ReserveController.attach(addresses.ReserveController);

  // Step 1: Mint mock USDC and deposit into the Vault
  console.log("Minting mock USDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(addresses.MockUSDC);
  const mintTx = await usdc.mint(deployer.address, ethers.utils.parseUnits("1000", 6));
  await mintTx.wait();
  console.log("USDC minted.");

  console.log("Depositing USDC into the Vault...");
  const depositTx = await treasury.admitDeposit(deployer.address, ethers.utils.parseUnits("1000", 6));
  await depositTx.wait();
  console.log("Deposit successful.");

  // Step 2: Harvest profits and split them
  console.log("Calling harvest() to split profits...");
  const harvestTx = await treasury.harvest();
  await harvestTx.wait();
  console.log("Harvest completed.");

  // Step 3: Execute a buyback operation
  console.log("Starting buyback operation...");
  const buybackTx = await treasury.startBuyback();
  await buybackTx.wait();
  console.log("Buyback operation completed.");

  // Step 4: Update the reserve balance
  console.log("Updating reserve balance...");
  const updateReserveTx = await reserve.rebalance();
  await updateReserveTx.wait();
  console.log("Reserve updated.");

  // Step 5: Claim profit credits
  console.log("Claiming profit credits...");
  const claimTx = await vault.claimCredits();
  await claimTx.wait();
  console.log("Profit credits claimed.");

  // Final Summary
  console.log("Fetching final metrics...");
  const coverageRatio = await treasury.getCoverageRatio();
  const reserveRatio = await reserve.getReserveRatio();
  const userCredits = await vault.getUserCredits(deployer.address);

  console.log("Final Metrics:");
  console.log("Coverage Ratio:", ethers.utils.formatUnits(coverageRatio, 4));
  console.log("Reserve Ratio:", ethers.utils.formatUnits(reserveRatio, 4));
  console.log("User Profit Credits:", ethers.utils.formatUnits(userCredits, 6));

  console.log("Demo scenario completed successfully.");
}

main().catch((error) => {
  console.error("Error running demo scenario:", error);
  process.exitCode = 1;
});
