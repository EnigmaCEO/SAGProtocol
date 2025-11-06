import hre from "hardhat";
import { CONTRACT_ADDRESSES } from "../frontend/src/lib/addresses";

async function main() {
  const { ethers, network } = hre;
  const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
  const RECEIPT_NFT_ADDRESS = CONTRACT_ADDRESSES.ReceiptNFT;

  if (!ethers.isAddress(VAULT_ADDRESS) || !ethers.isAddress(RECEIPT_NFT_ADDRESS)) {
    throw new Error("Set Vault and ReceiptNFT in addresses file.");
  }

  const vault = await ethers.getContractAt("Vault", VAULT_ADDRESS);
  const receiptNFT = await ethers.getContractAt("SagittaVaultReceipt", RECEIPT_NFT_ADDRESS);

  // Get current EVM time
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;
  console.log(`Current EVM time: ${now} (${new Date(now! * 1000).toISOString()})`);

  // Collect all tokenIds before processing
  const total = await receiptNFT.totalSupply();
  const tokenIds: bigint[] = [];
  console.log(`Found ${total} NFT receipts:`);
  for (let i = 0; i < total; i++) {
    const tokenId = await receiptNFT.tokenByIndex(i);
    tokenIds.push(tokenId);
    const receipt = await vault.depositInfo(tokenId);
    const lockUntil = Number(receipt.lockUntil);
    const withdrawn = receipt.withdrawn;
    console.log(
      `  tokenId: ${tokenId.toString().padEnd(4)} | withdrawn: ${withdrawn ? "yes" : "no"} | lockUntil: ${lockUntil} (${new Date(lockUntil * 1000).toISOString()})`
    );
  }

  // Fast forward time
  const FAST_FORWARD_SECONDS = Number(process.env.FAST_FORWARD_SECONDS || 366 * 24 * 60 * 60);
  console.log(`Fast forwarding EVM time by ${FAST_FORWARD_SECONDS} seconds...`);
  await network.provider.send("evm_increaseTime", [FAST_FORWARD_SECONDS]);
  await network.provider.send("evm_mine");

  // Get new EVM time after fast forward
  const newBlock = await ethers.provider.getBlock("latest");
  const newNow = newBlock!.timestamp;
  console.log(`New EVM time: ${newNow} (${new Date(newNow * 1000).toISOString()})`);

  // Process matured receipts using EVM time
  let processed = 0;
  for (const tokenId of tokenIds) {
    const receipt = await vault.depositInfo(tokenId);
    if (
      receipt.lockUntil > 0 &&
      !receipt.withdrawn &&
      Number(receipt.lockUntil) <= newNow
    ) {
      try {
        const tx = await vault.autoReturn(tokenId);
        await tx.wait();
        console.log(`autoReturn successful for tokenId: ${tokenId}`);
        processed++;
      } catch (e) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        console.warn(`autoReturn failed for tokenId: ${tokenId}:`, msg);
      }
    }
  }

  if (processed === 0) {
    console.log("No matured receipts found for auto-return.");
  } else {
    console.log(`Auto-return processed for ${processed} receipts.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
