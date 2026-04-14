/**
 * Transfer ownership of all Ownable protocol contracts to a new owner.
 * Run: npx hardhat run scripts/transfer-ownership.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

const NEW_OWNER = "0xc643A9e5780420A939ced80E537f19BbE2D7c500";

// Deployed on Moonbase Alpha
const CONTRACTS: Record<string, string> = {
  Vault:              "0x56CA19417448F5E9E8Ef4fB245330B63D29eb8Bf",
  Treasury:           "0x79910F5CA368Bb466C82dFf296b493bCf0dF1D1c",
  ReserveController:  "0x2776824AAC4D8B800B61aa03706753D9dE9bC1f6",
  InvestmentEscrow:   "0xF645e0edb3a098D0f0ef6233FD338DF4bBE78d7B",
  ReceiptNFT:         "0xc4De25E97594690002707D92a9d2b72a57704DaF",
  GoldOracle:         "0x5932D7140eFFAeb694B56018C95153AF902F63Ef",
};

const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("New owner:", NEW_OWNER);
  console.log();

  for (const [name, address] of Object.entries(CONTRACTS)) {
    try {
      const contract = new ethers.Contract(address, OWNABLE_ABI, signer);
      const currentOwner = await contract.owner();
      console.log(`${name}: current owner = ${currentOwner}`);

      if (currentOwner.toLowerCase() === NEW_OWNER.toLowerCase()) {
        console.log(`  -> already owned by new owner, skipping\n`);
        continue;
      }

      if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
        console.warn(`  -> signer is not the owner, skipping\n`);
        continue;
      }

      const tx = await contract.transferOwnership(NEW_OWNER);
      await tx.wait();
      console.log(`  -> ownership transferred ✓\n`);
    } catch (e: any) {
      console.warn(`  -> ${name} failed: ${e?.message ?? e}\n`);
    }
  }

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
