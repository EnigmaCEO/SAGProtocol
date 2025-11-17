import { expect } from "chai";
import hre from "hardhat";
const ethers = hre.ethers;

describe("Coverage stubs: Treasury/Vault/SAGToken", function () {
  it("deploys and exercises TreasuryStub, VaultStub, SAGTokenStub", async function () {
    const [deployer, user] = await ethers.getSigners();

    const TreasuryFactory = await ethers.getContractFactory("TreasuryStub");
    const treasury = await ethers.deployContract("TreasuryStub");
    await treasury.waitForDeployment();

    const VaultFactory = await ethers.getContractFactory("VaultStub");
    const vault = await ethers.deployContract("VaultStub");
    await vault.waitForDeployment();

    const SagFactory = await ethers.getContractFactory("SAGTokenStub");
    const sag = await ethers.deployContract("SAGTokenStub");
    await sag.waitForDeployment();

    // call Treasury functions
    await treasury.fundEscrowBatch(7, 1000);
    expect(await treasury.lastFundedBatch()).to.equal(7);
    expect(await treasury.lastFundedAmount()).to.equal(1000);
    await treasury.reportBatchResult(7, 1000, 100, 25, ethers.parseEther("1"));
    expect(await treasury.lastReportedBatch()).to.equal(7);
    // poke helper
    expect(await treasury.poke()).to.equal(true);

    // vault deposit + readback
    await vault.setDeposit(1, await user.getAddress(), "0x0000000000000000000000000000000000000000", 0, 123456, ethers.parseEther("1"), 0, 0, false);
    const info = await vault.depositInfo(1);
    expect(info[3]).to.equal(123456);

    // sag token mint/transfer/burn
    await sag.faucetMint(await user.getAddress(), ethers.parseEther("10"));
    expect(await sag.balanceOf(await user.getAddress())).to.equal(ethers.parseEther("10"));
    // use a signer to transfer
    await sag.connect(user).transfer(await deployer.getAddress(), ethers.parseEther("1"));
    expect(await sag.balanceOf(await deployer.getAddress())).to.equal(ethers.parseEther("1"));
    await sag.burn(await user.getAddress(), ethers.parseEther("1"));
    // balance decreased
    expect((await sag.balanceOf(await user.getAddress())).toString()).to.not.equal(ethers.parseEther("10").toString());
  });
});
