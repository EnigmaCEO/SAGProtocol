/**
 * Update the ReceiptNFT base token URI to the canonical domain.
 * Must be run with the current owner's private key.
 *
 * Run: npx hardhat run scripts/set-metadata-uri.ts --network moonbase
 */
import hre from "hardhat";
const { ethers } = hre;

const RECEIPT_NFT   = "0x658Ea3E7B328aED1dF8C1cDedBD2a0f3278A97d1";
// New owner after browser reset: 0xc643A9e5780420A939ced80E537f19BbE2D7c500
const NEW_BASE_URI  = "https://protocol.sagitta.systems/api/metadata/";

const ABI = [
  "function owner() view returns (address)",
  "function setBaseTokenURI(string calldata baseURI) external",
  "function baseTokenURI() view returns (string)",
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

  // Check if already set — a pending tx may have already updated it
  try {
    const current = await nft.baseTokenURI();
    if (current === NEW_BASE_URI) {
      console.log("URI already set correctly ✓");
      return;
    }
    console.log("Current URI:", current);
  } catch {
    // baseTokenURI() may not exist on older deployments — proceed anyway
  }

  // Check balance — this call fails with a confusing error if the wallet is empty
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:  ", ethers.formatEther(balance), "DEV");
  if (balance < ethers.parseEther("0.0001")) {
    throw new Error(
      `Insufficient DEV balance (${ethers.formatEther(balance)} DEV).\n` +
      `Get DEV from: https://faucet.moonbase.moonbeam.network/`
    );
  }

  // Get current nonce and bump gas to replace any stuck pending tx
  const nonce = await signer.getNonce("pending");
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice
    ? (feeData.gasPrice * 130n) / 100n   // 30% bump to replace stuck tx
    : undefined;

  console.log("Nonce:    ", nonce);
  console.log("Gas price:", gasPrice?.toString() ?? "auto");

  const tx = await nft.setBaseTokenURI(NEW_BASE_URI, {
    nonce,
    gasLimit: 100_000n,   // explicit limit — skip estimation which fails on low balance
    ...(gasPrice ? { gasPrice } : {}),
  });
  console.log("Tx sent:  ", tx.hash);
  await tx.wait();
  console.log("Done ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
