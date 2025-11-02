const hre = require("hardhat");
import * as addresses from "../lib/addresses";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying ReserveController with account:", deployer.address);

  // Get the MockGold address (or use a placeholder)
  // Replace with your actual MockGold address
  const mockGoldAddress = addresses.CONTRACT_ADDRESSES.mockGoldAddress;

  const ReserveController = await hre.ethers.getContractFactory("ReserveController");
  const reserve = await ReserveController.deploy(mockGoldAddress);
  await reserve.waitForDeployment();

  const reserveAddress = await reserve.getAddress();
  console.log("ReserveController deployed to:", reserveAddress);
  
  console.log("\nUpdate your addresses.ts file with:");
  console.log(`ReserveController: "${reserveAddress}",`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
