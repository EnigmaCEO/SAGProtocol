/**
 * Transfer DEV from deployer wallet to a target address.
 * Run: npx hardhat run scripts/transfer-dev.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

const TO      = "0x9b75bA9E397Ea020fd7CCAd644a4c5F6395285EB";
const AMOUNT  = ethers.parseEther("0.5");   // 0.5 DEV — plenty for governance txs

async function main() {
  const signers = await ethers.getSigners();
  // Use index 1 (MOONBASE_PRIVATE_KEY_1) — the original deployer with DEV balance
  const signer  = signers[1] ?? signers[0];
  const balance  = await ethers.provider.getBalance(signer.address);

  console.log("From:    ", signer.address);
  console.log("To:      ", TO);
  console.log("Amount:  ", ethers.formatEther(AMOUNT), "DEV");
  console.log("Balance: ", ethers.formatEther(balance), "DEV");

  if (balance < AMOUNT + ethers.parseEther("0.01")) {
    throw new Error(`Insufficient balance: ${ethers.formatEther(balance)} DEV`);
  }

  const tx = await signer.sendTransaction({ to: TO, value: AMOUNT });
  console.log("Tx sent: ", tx.hash);
  await tx.wait();
  console.log("Done ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
