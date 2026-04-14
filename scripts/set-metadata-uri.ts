/**
 * Update the ReceiptNFT base token URI to the canonical domain.
 * Must be run with the current owner's private key.
 *
 * Run: npx hardhat run scripts/set-metadata-uri.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

const RECEIPT_NFT   = "0x658Ea3E7B328aED1dF8C1cDedBD2a0f3278A97d1";
const NEW_BASE_URI  = "https://protocol.sagitta.systems/api/metadata/";

const ABI = [
  "function owner() view returns (address)",
  "function setBaseTokenURI(string calldata baseURI) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:   ", signer.address);
  console.log("Contract: ", RECEIPT_NFT);
  console.log("New URI:  ", NEW_BASE_URI);

  const nft = new ethers.Contract(RECEIPT_NFT, ABI, signer);

  const owner = await nft.owner();
  console.log("Owner:    ", owner);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the owner. Owner is ${owner}`);
  }

  const tx = await nft.setBaseTokenURI(NEW_BASE_URI);
  console.log("Tx sent:  ", tx.hash);
  await tx.wait();
  console.log("Done ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
