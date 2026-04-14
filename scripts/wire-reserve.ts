/**
 * One-shot script: wire ReserveController links for the already-deployed contracts.
 *   1. setTreasury()    — links Reserve → Treasury
 *   2. setGoldOracle()  — fixes the oracle address (deploy script set it to MockGOLD by mistake)
 *
 * Run: npx hardhat run scripts/wire-reserve.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Signer:", deployer.address);

  // Deployed on Moonbase Alpha — update these if you redeploy.
  const reserveAddress  = "0xa715D7C3722Aaf4F8198469C18c4398aE7890441";
  const treasuryAddress = "0x1a4E34797f1951F4037ccCE8E5D2d275fF2a18C8";
  const goldOracleAddress = "0x85bcD72B49f3CFABCF3682E0a847e92EeC77F0e3"; // MockOracle for gold

  console.log("ReserveController:", reserveAddress);
  console.log("Treasury:         ", treasuryAddress);
  console.log("GoldOracle:       ", goldOracleAddress);

  const reserve = await ethers.getContractAt("ReserveController", reserveAddress);

  // 1. Fix goldOracle
  const currentOracle = await (reserve as any).goldOracle();
  console.log("\nCurrent goldOracle:", currentOracle);
  if (currentOracle.toLowerCase() !== goldOracleAddress.toLowerCase()) {
    const tx1 = await (reserve as any).setGoldOracle(goldOracleAddress);
    await tx1.wait();
    console.log("goldOracle updated to:", await (reserve as any).goldOracle());
  } else {
    console.log("goldOracle already correct — skipping");
  }

  // 2. Fix treasury link
  const currentTreasury = await (reserve as any).treasury();
  console.log("\nCurrent treasury link:", currentTreasury);
  if (currentTreasury.toLowerCase() !== treasuryAddress.toLowerCase()) {
    const tx2 = await (reserve as any).setTreasury(treasuryAddress);
    await tx2.wait();
    console.log("treasury linked to:", await (reserve as any).treasury());
  } else {
    console.log("treasury already linked — skipping");
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
