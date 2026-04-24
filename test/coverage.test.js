import { expect } from "chai";
import hre from "hardhat";

const ethers = hre.ethers;

describe("Core smoke coverage", function () {
  let deployer, keeper, user, other;
  let usdc, gold, oracle, goldOracle, reserve, receipt, ammPair, treasury, escrow, routeRegistry;

  beforeEach(async function () {
    [deployer, keeper, user, other] = await ethers.getSigners();

    usdc = await ethers.deployContract("MockUSDC");
    gold = await ethers.deployContract("MockGOLD");
    oracle = await ethers.deployContract("MockOracle");
    await oracle.setPrice(100_000_000n);
    goldOracle = await ethers.deployContract("GoldOracle", [123456]);

    reserve = await ethers.deployContract("ReserveController", [await gold.getAddress(), await goldOracle.getAddress()]);
    receipt = await ethers.deployContract("SagittaVaultReceipt", ["Sagitta Receipt", "SREC"]);
    ammPair = await ethers.deployContract("MockAmmPair", [await usdc.getAddress(), await gold.getAddress()]);

    treasury = await ethers.deployContract("Treasury", [
      await usdc.getAddress(),
      await gold.getAddress(),
      await reserve.getAddress(),
      deployer.address,
      await oracle.getAddress(),
    ]);
    escrow = await ethers.deployContract("InvestmentEscrow", [await usdc.getAddress(), await treasury.getAddress()]);
    routeRegistry = await ethers.deployContract("ExecutionRouteRegistry");

    await treasury.setEscrow(await escrow.getAddress());
    await escrow.setVault(deployer.address);
    await escrow.setKeeper(keeper.address);
    await escrow.setRouteRegistry(await routeRegistry.getAddress());
    await usdc.mint(await treasury.getAddress(), ethers.parseUnits("1000000", 6));
  });

  it("covers token mocks, receipt metadata, reserve, and AMM basics", async function () {
    expect(await usdc.decimals()).to.equal(6);
    await usdc.faucetMint(user.address, ethers.parseUnits("1", 6));
    expect(await usdc.balanceOf(user.address)).to.equal(ethers.parseUnits("1", 6));

    await gold.faucetMint(user.address, ethers.parseEther("10"));
    expect(await gold.balanceOf(user.address)).to.equal(ethers.parseEther("10"));

    await receipt.setMinter(keeper.address);
    await receipt.connect(keeper).mint(user.address, 42);
    await receipt.connect(keeper).setReceiptBatch(42, 9);
    await receipt.connect(keeper).updateMetadata(42, "{\"batch\":9}");
    expect(await receipt.tokenBatchId(42)).to.equal(9);
    expect(await receipt.tokenMetadata(42)).to.equal("{\"batch\":9}");

    await reserve.setTreasury(deployer.address);
    await gold.faucetMint(await reserve.getAddress(), ethers.parseEther("20"));
    expect(await reserve.navReserveUsd()).to.be.gt(0);

    await usdc.faucetMint(other.address, ethers.parseUnits("1000", 6));
    await gold.faucetMint(other.address, ethers.parseEther("100"));
    await usdc.connect(other).approve(await ammPair.getAddress(), ethers.parseUnits("1000", 6));
    await gold.connect(other).approve(await ammPair.getAddress(), ethers.parseEther("100"));
    await ammPair.connect(other).addLiquidity(ethers.parseUnits("1000", 6), ethers.parseEther("100"));
    const reserves = await ammPair.getReserves();
    expect(reserves[0]).to.equal(ethers.parseUnits("1000", 6));
    expect(reserves[1]).to.equal(ethers.parseEther("100"));
  });

  it("keeps Escrow downstream of Treasury-owned batch creation", async function () {
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const amountUsd6 = ethers.parseUnits("100", 6);

    await treasury.registerBankOriginLot(ethers.id("bank-smoke"), amountUsd6, now + 40n * 24n * 60n * 60n);
    await treasury.createAndFundBatch(
      2,
      [1],
      now + 30n * 24n * 60n * 60n,
      now + 35n * 24n * 60n * 60n
    );

    const batch = await treasury.getTreasuryBatch(1);
    const position = await escrow.escrowBatchPositions(1);
    expect(batch.originType).to.equal(2);
    expect(batch.status).to.equal(2);
    expect(position.deployedPrincipal).to.equal(amountUsd6);

    await expect(escrow.createPendingBatch()).to.be.revertedWith("Treasury owns batches");
    await expect(escrow.registerDeposit(1, amountUsd6, ethers.parseEther("1"))).to.be.revertedWith("Treasury owns origin lots");
  });

  it("settles a Treasury-owned batch through Escrow positions", async function () {
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const amountUsd6 = ethers.parseUnits("100", 6);

    await treasury.registerBankOriginLot(ethers.id("bank-settle"), amountUsd6, now + 40n * 24n * 60n * 60n);
    await treasury.createAndFundBatch(
      2,
      [1],
      now + 30n * 24n * 60n * 60n,
      now + 35n * 24n * 60n * 60n
    );

    await routeRegistry.addRoute(
      "SPC",
      3,
      ethers.id("counterparty"),
      ethers.id("jurisdiction"),
      ethers.id("custody"),
      true,
      true,
      true,
      "https://api.sagitta.test/spc/pnl",
      true,
      true
    );

    await treasury.authorizeEscrowBatch(1, Number(now + 30n * 24n * 60n * 60n), ethers.encodeBytes32String("USD6"), [
      { routeId: 1, maxAllocationUsd6: ethers.parseUnits("60", 6) },
    ]);

    await escrow.connect(keeper).openPosition(
      1,
      1,
      "SPC",
      ethers.parseUnits("60", 6),
      ethers.parseEther("1"),
      ethers.id("open"),
      0
    );
    await escrow.connect(keeper).closePosition(1, ethers.parseUnits("66", 6), ethers.id("close"), 0);
    await escrow.finalizeBatchSettlement(1, ethers.id("settlement"), ethers.id("compliance"));

    expect((await escrow.escrowBatchPositions(1)).status).to.equal(2);
    expect((await treasury.getTreasuryBatch(1)).status).to.equal(3);
    expect((await treasury.originLots(1)).status).to.equal(3);
  });
});
