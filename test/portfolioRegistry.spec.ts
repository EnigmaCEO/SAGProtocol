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

  it("stores approved destinations and persists a matching default destination ID", async function () {
    const [owner, stakingContract, otherToken] = await ethers.getSigners();
    const PortfolioRegistry = await ethers.getContractFactory("PortfolioRegistry");
    const registry = await PortfolioRegistry.deploy();
    await registry.waitForDeployment();

    await expect(
      registry.addDestination(
        "OUSG Staking",
        "OUSG",
        ethers.ZeroAddress,
        1,
        stakingContract.address,
        true
      )
    ).to.emit(registry, "DestinationAdded");

    const destination = await registry.getDestination(1);
    expect(destination.destinationId).to.equal(1);
    expect(destination.name).to.equal("OUSG Staking");
    expect(destination.assetSymbol).to.equal("OUSG");
    expect(destination.destinationAddress).to.equal(stakingContract.address);
    expect(destination.active).to.equal(true);

    await registry["addAsset(string,string,address,address,uint8,uint8,uint256,uint256)"](
      "OUSG",
      "Ondo US Government Bond",
      otherToken.address,
      ethers.ZeroAddress,
      6,
      3,
      0,
      1
    );

    const asset = await registry.getAsset("OUSG");
    expect(asset.defaultDestinationId).to.equal(1);
    expect(asset.destination).to.equal(stakingContract.address);
    expect(asset.destinationType).to.equal(1);

    await registry.updateDestination(
      1,
      "OUSG Staking v2",
      "",
      otherToken.address,
      2,
      owner.address,
      true
    );

    const updatedAsset = await registry.getAsset("OUSG");
    expect(updatedAsset.defaultDestinationId).to.equal(1);
    expect(updatedAsset.destination).to.equal(owner.address);
    expect(updatedAsset.destinationType).to.equal(2);

    await registry.setDestinationActive(1, false);
    expect((await registry.getDestination(1)).active).to.equal(false);
    expect(await registry.getAllDestinations()).to.have.length(1);
  });

  it("rejects inactive or mismatched default destinations", async function () {
    const [owner, stakingContract] = await ethers.getSigners();
    const PortfolioRegistry = await ethers.getContractFactory("PortfolioRegistry");
    const registry = await PortfolioRegistry.deploy();
    await registry.waitForDeployment();

    await registry.addDestination(
      "USDC Staking",
      "USDC",
      ethers.ZeroAddress,
      1,
      stakingContract.address,
      true
    );

    await expect(
      registry["addAsset(string,string,address,address,uint8,uint8,uint256,uint256)"](
        "OUSG",
        "Ondo US Government Bond",
        owner.address,
        ethers.ZeroAddress,
        6,
        3,
        0,
        1
      )
    ).to.be.revertedWith("PortfolioRegistry: destination asset mismatch");

    await registry.setDestinationActive(1, false);
    await expect(
      registry["addAsset(string,string,address,address,uint8,uint8,uint256,uint256)"](
        "USDC",
        "USD Coin",
        owner.address,
        ethers.ZeroAddress,
        1,
        1,
        0,
        1
      )
    ).to.be.revertedWith("PortfolioRegistry: destination inactive");
  });
});
