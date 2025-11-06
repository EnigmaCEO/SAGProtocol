import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const vaultAddress = "0x7bc06c482DEAd17c0e297aFbC32f6e63d3846650";
  const Vault = await ethers.getContractFactory("Vault");
  const vault = Vault.attach(vaultAddress) as any;
  try {
    const owner = await vault.owner();
    console.log("Vault owner:", owner);
  } catch (e) {
    console.error("Not a Vault contract at this address.", e);
  }
  try {
    const functions = Vault.interface.fragments
      .filter(f => f.type === "function")
      .map(f => (f as any).name);
    console.log("Functions on Vault ABI:", functions);
  } catch (e) {
    console.error("Could not enumerate functions.", e);
  }
}

main();
