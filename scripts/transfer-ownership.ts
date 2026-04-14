/**
 * Transfer ownership of all Ownable protocol contracts to a new owner.
 * Run: npx hardhat run scripts/transfer-ownership.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

const NEW_OWNER = "0x9b75ba9e397ea020fd7ccad644a4c5f6395285eb";

// Deployed on Moonbase Alpha
const CONTRACTS: Record<string, string> = {
  Vault:              "0x6724FD4AbaD94551dec470278E2e1bC388360Ba2",
  Treasury:           "0x1a4E34797f1951F4037ccCE8E5D2d275fF2a18C8",
  ReserveController:  "0xa715D7C3722Aaf4F8198469C18c4398aE7890441",
  InvestmentEscrow:   "0x84933929d92Bf33074FA8EC3fE25a5798454F0fa",
  ReceiptNFT:         "0x658Ea3E7B328aED1dF8C1cDedBD2a0f3278A97d1",
  GoldOracle:         "0x85bcD72B49f3CFABCF3682E0a847e92EeC77F0e3",
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
