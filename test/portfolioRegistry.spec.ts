import { expect } from "chai";
import hre from "hardhat";

const ethers = hre.ethers;

describe("PortfolioRegistry", function () {
  it("stores minimum investment amounts when assets are added and updated", async function () {
    const [owner] = await ethers.getSigners();
    const PortfolioRegistry = await ethers.getContractFactory("PortfolioRegistry");
    const registry = await PortfolioRegistry.deploy();
    await registry.waitForDeployment();

    const initialMinimumUsd6 = ethers.parseUnits("25000", 6);
    await registry.addAsset(
      "OUSG",
      "Ondo US Government Bond",
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      6,
      3,
      initialMinimumUsd6
    );

    const asset = await registry.getAsset("OUSG");
    expect(asset.symbol).to.equal("OUSG");
    expect(asset.minimumInvestmentUsd6).to.equal(initialMinimumUsd6);

    const updatedMinimumUsd6 = ethers.parseUnits("50000", 6);
    await registry.updateAsset(
      "OUSG",
      "Ondo Short-Term US Government Bond",
      owner.address,
      ethers.ZeroAddress,
      6,
      5,
      updatedMinimumUsd6
    );

    const updatedAsset = await registry.getAsset("OUSG");
    expect(updatedAsset.name).to.equal("Ondo Short-Term US Government Bond");
    expect(updatedAsset.token).to.equal(owner.address);
    expect(updatedAsset.role).to.equal(5);
    expect(updatedAsset.minimumInvestmentUsd6).to.equal(updatedMinimumUsd6);

    const allAssets = await registry.getAllAssets();
    expect(allAssets).to.have.length(1);
    expect(allAssets[0].minimumInvestmentUsd6).to.equal(updatedMinimumUsd6);
  });
});
