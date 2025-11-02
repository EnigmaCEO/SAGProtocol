import { ethers } from "hardhat";
import * as addresses from "../frontend/src/lib/addresses";

async function main() {
  const [signer] = await ethers.getSigners();
  
  const args = process.argv.slice(2);
  const userAddress = args[0] || signer.address;
  const amountUsd = args[1] || "100";
  const daysLocked = args[2] || "365";

  const vault = await ethers.getContractAt("SAGVault", addresses.CONTRACT_ADDRESSES.Vault, signer);
  
  const amount = ethers.parseUnits(amountUsd, 6);
  const unlockAt = Math.floor(Date.now() / 1000) + parseInt(daysLocked) * 24 * 60 * 60;

  console.log(`Issuing credit:`);
  console.log(`  User: ${userAddress}`);
  console.log(`  Amount: ${amountUsd} USDC`);
  console.log(`  Unlock: ${new Date(unlockAt * 1000).toLocaleString()}`);

  const tx = await vault.issueCredit(userAddress, amount, unlockAt);
  await tx.wait();

  console.log("✅ Credit issued successfully");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
