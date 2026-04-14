/**
 * One-shot script: wire ReserveController.setTreasury() for the already-deployed contracts.
 * Run: npx hardhat run scripts/wire-reserve.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Signer:", deployer.address);

  // Deployed on Moonbase Alpha — update these if you redeploy.
  const reserveAddress = "0xa715D7C3722Aaf4F8198469C18c4398aE7890441";
  const treasuryAddress = "0x1a4E34797f1951F4037ccCE8E5D2d275fF2a18C8";

  if (!reserveAddress || !treasuryAddress) {
    throw new Error("Addresses missing from frontend/src/lib/addresses.ts — run deploy first");
  }

  console.log("ReserveController:", reserveAddress);
  console.log("Treasury:         ", treasuryAddress);

  const reserve = await ethers.getContractAt("ReserveController", reserveAddress);

  const current = await (reserve as any).treasury();
  console.log("Current treasury link:", current);

  if (current.toLowerCase() === treasuryAddress.toLowerCase()) {
    console.log("Already linked — nothing to do.");
    return;
  }

  const tx = await (reserve as any).setTreasury(treasuryAddress);
  await tx.wait();
  console.log("Done. ReserveController.treasury is now:", await (reserve as any).treasury());
}

main().catch((e) => { console.error(e); process.exit(1); });
