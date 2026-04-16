/**
 * manage-council.ts
 *
 * Hardhat script to manage ProtocolDAO council membership on any network.
 *
 * Usage (env vars drive the action):
 *
 *   # Add one or more addresses
 *   COUNCIL_ACTION=add COUNCIL_ADDRESSES=0xABC...,0xDEF... \
 *     npx hardhat run scripts/manage-council.ts --network moonbase
 *
 *   # Remove an address
 *   COUNCIL_ACTION=remove COUNCIL_ADDRESSES=0xABC... \
 *     npx hardhat run scripts/manage-council.ts --network moonbase
 *
 *   # List current council
 *   COUNCIL_ACTION=list \
 *     npx hardhat run scripts/manage-council.ts --network moonbase
 *
 * The script reads the ProtocolDAO address from the compiled addresses.ts.
 * Run `npx hardhat run scripts/deploy.ts --network moonbase` first if the
 * ProtocolDAO address is not yet set.
 */

import hre from "hardhat";
const { ethers } = hre;

// Read the deployed ProtocolDAO address from the generated addresses file.
// This is safe to import as ESM since deploy.ts writes it.
import { CONTRACT_ADDRESSES } from "../frontend/src/lib/addresses.js";

const PROTOCOL_DAO_ABI = [
  "function addCouncilMember(address member) external",
  "function removeCouncilMember(address member) external",
  "function getCouncilMembers() external view returns (address[])",
  "function isCouncilMember(address) external view returns (bool)",
  "function councilCount() external view returns (uint256)",
  "function owner() external view returns (address)",
];

async function main() {
  const action = (process.env.COUNCIL_ACTION ?? "").toLowerCase().trim();
  const rawAddresses = (process.env.COUNCIL_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!["add", "remove", "list"].includes(action)) {
    console.error("COUNCIL_ACTION must be add | remove | list");
    console.error("");
    console.error("Examples:");
    console.error(
      "  COUNCIL_ACTION=add COUNCIL_ADDRESSES=0xABC...,0xDEF... npx hardhat run scripts/manage-council.ts --network moonbase"
    );
    console.error(
      "  COUNCIL_ACTION=remove COUNCIL_ADDRESSES=0xABC... npx hardhat run scripts/manage-council.ts --network moonbase"
    );
    console.error(
      "  COUNCIL_ACTION=list npx hardhat run scripts/manage-council.ts --network moonbase"
    );
    process.exit(1);
  }

  if (action !== "list" && rawAddresses.length === 0) {
    console.error("COUNCIL_ADDRESSES must be set for add/remove actions");
    process.exit(1);
  }

  const daoAddress = (CONTRACT_ADDRESSES as any).ProtocolDAO as string | null;
  if (!daoAddress || !ethers.isAddress(daoAddress)) {
    console.error(
      "ProtocolDAO address not found in addresses.ts. Deploy first:\n" +
      "  npx hardhat run scripts/deploy.ts --network moonbase"
    );
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  console.log("Signer:      ", signer.address);
  console.log("ProtocolDAO: ", daoAddress);

  const dao = new ethers.Contract(daoAddress, PROTOCOL_DAO_ABI, signer);

  const onChainOwner: string = await dao.owner();
  console.log("DAO owner:   ", onChainOwner);

  if (action !== "list" && signer.address.toLowerCase() !== onChainOwner.toLowerCase()) {
    console.error(`Signer (${signer.address}) is not the DAO owner (${onChainOwner}). Cannot write.`);
    process.exit(1);
  }

  // ── List ──────────────────────────────────────────────────────────────────
  if (action === "list") {
    const members: string[] = await dao.getCouncilMembers();
    if (members.length === 0) {
      console.log("\nDAO council is empty. Contract owner approves proposals solo.");
    } else {
      console.log(`\nDAO council (${members.length} member${members.length === 1 ? "" : "s"}):`);
      members.forEach((m) => console.log(" ", m));
    }
    return;
  }

  // ── Validate addresses ────────────────────────────────────────────────────
  const addresses: string[] = [];
  for (const raw of rawAddresses) {
    if (!ethers.isAddress(raw)) {
      console.error(`Invalid address: ${raw}`);
      process.exit(1);
    }
    addresses.push(ethers.getAddress(raw));
  }

  // ── Add ───────────────────────────────────────────────────────────────────
  if (action === "add") {
    for (const member of addresses) {
      const already: boolean = await dao.isCouncilMember(member);
      if (already) {
        console.log(`  ${member} — already a member, skipping`);
        continue;
      }
      const tx = await dao.addCouncilMember(member);
      console.log(`  Adding ${member} — tx ${tx.hash}`);
      await tx.wait();
      console.log(`  ${member} added ✓`);
    }
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  if (action === "remove") {
    for (const member of addresses) {
      const isMember: boolean = await dao.isCouncilMember(member);
      if (!isMember) {
        console.log(`  ${member} — not a member, skipping`);
        continue;
      }
      const tx = await dao.removeCouncilMember(member);
      console.log(`  Removing ${member} — tx ${tx.hash}`);
      await tx.wait();
      console.log(`  ${member} removed ✓`);
    }
  }

  // ── Final state ───────────────────────────────────────────────────────────
  const final: string[] = await dao.getCouncilMembers();
  console.log(`\nCouncil now has ${final.length} member${final.length === 1 ? "" : "s"}:`);
  final.forEach((m) => console.log(" ", m));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
