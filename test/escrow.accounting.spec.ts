import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("Escrow Accounting and Compliance v1", function () {
  async function deployFixture() {
    const [owner, keeper] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockGOLD = await ethers.getContractFactory("MockGOLD");
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const Treasury = await ethers.getContractFactory("Treasury");
    const InvestmentEscrow = await ethers.getContractFactory("InvestmentEscrow");
    const ExecutionRouteRegistry = await ethers.getContractFactory("ExecutionRouteRegistry");

    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const gold = await MockGOLD.deploy();
    await gold.waitForDeployment();

    const oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();
    await oracle.setPrice(100_000_000n);

    const treasury = await Treasury.deploy(
      await usdc.getAddress(),
      await gold.getAddress(),
      owner.address,
      owner.address,
      await oracle.getAddress()
    );
    await treasury.waitForDeployment();

    const escrow = await InvestmentEscrow.deploy(await usdc.getAddress(), await treasury.getAddress());
    await escrow.waitForDeployment();

    const routeRegistry = await ExecutionRouteRegistry.deploy();
    await routeRegistry.waitForDeployment();

    await treasury.setEscrow(await escrow.getAddress());
    await escrow.setVault(owner.address);
    await escrow.setKeeper(keeper.address);
    await escrow.setRouteRegistry(await routeRegistry.getAddress());

    await usdc.mint(await treasury.getAddress(), ethers.parseUnits("1000000", 6));

    return { owner, keeper, usdc, treasury, escrow, routeRegistry };
  }

  async function seedRunningBatch(fixture: Awaited<ReturnType<typeof deployFixture>>, batchId: number, amountUsd6: bigint) {
    const { owner, escrow } = fixture;
    await escrow.connect(owner).registerDepositTo(batchId, batchId, amountUsd6, ethers.parseEther("1"));
    await escrow.connect(owner).rollBatch(batchId);
  }

  it("blocks external routes from the next batch until compliance checklist is complete", async function () {
    const fixture = await deployFixture();
    const { owner, keeper, escrow, treasury, routeRegistry } = fixture;
    const amountUsd6 = ethers.parseUnits("100", 6);

    await seedRunningBatch(fixture, 1, amountUsd6);

    await routeRegistry.addRoute(
      "SPC",
      3,
      ethers.id("counterparty-1"),
      ethers.id("jurisdiction-1"),
      ethers.id("custody-1"),
      false,
      false,
      false,
      "",
      true,
      true
    );

    await expect(
      treasury.authorizeEscrowBatch(1, 1_900_000_000, ethers.encodeBytes32String("USD6"), [
        { routeId: 1, maxAllocationUsd6: ethers.parseUnits("60", 6) },
      ])
    ).to.be.revertedWith("Route not compliant");

    await routeRegistry.updateRoute(
      1,
      "SPC",
      3,
      ethers.id("counterparty-1"),
      ethers.id("jurisdiction-1"),
      ethers.id("custody-1"),
      true,
      true,
      true,
      "https://api.sagitta.test/spc/pnl",
      true,
      true
    );

    await treasury.authorizeEscrowBatch(1, 1_900_000_000, ethers.encodeBytes32String("USD6"), [
      { routeId: 1, maxAllocationUsd6: ethers.parseUnits("60", 6) },
    ]);

    await escrow.connect(keeper).openPosition(
      1,
      1,
      "SPC",
      ethers.parseUnits("50", 6),
      ethers.parseEther("1"),
      ethers.id("ext-ref"),
      ethers.parseUnits("1", 6)
    );

    const accounting = await escrow.getBatchAccounting(1);
    expect(accounting.principalCommittedUsd6).to.equal(ethers.parseUnits("50", 6));
    expect(await escrow.getBatchRouteCommittedUsd6(1, 1)).to.equal(ethers.parseUnits("50", 6));

    await expect(
      escrow.connect(keeper).openPosition(
        1,
        1,
        "SPC",
        ethers.parseUnits("20", 6),
        ethers.parseEther("1"),
        ethers.id("ext-ref-2"),
        0
      )
    ).to.be.revertedWith("Route allocation exceeded");
  });

  it("allows creating a pending batch while the current batch awaits allocation, but blocks rolling it active", async function () {
    const fixture = await deployFixture();
    const { owner, escrow, treasury, routeRegistry } = fixture;
    const amountUsd6 = ethers.parseUnits("100", 6);

    await seedRunningBatch(fixture, 1, amountUsd6);

    await routeRegistry.addRoute(
      "OUSG",
      2,
      ethers.id("counterparty-pending"),
      ethers.id("jurisdiction-pending"),
      ethers.id("custody-pending"),
      false,
      false,
      false,
      "",
      true,
      true
    );

    await escrow.connect(owner).createPendingBatch();
    await escrow.connect(owner).registerDepositTo(2, 2001, ethers.parseUnits("25", 6), ethers.parseEther("1"));

    await expect(
      escrow.connect(owner).rollBatch(2)
    ).to.be.revertedWith("Allocate current batch first");

    await treasury.authorizeEscrowBatch(1, 1_900_000_000, ethers.encodeBytes32String("USD6"), [
      { routeId: 1, maxAllocationUsd6: amountUsd6 },
    ]);

    await escrow.connect(owner).rollBatch(2);
    const batchTwo = await escrow.getBatch(2);
    expect(batchTwo.status).to.equal(1);
  });

  it("updates unrealized PnL on marks, freezes execution, and allows owner write-down recovery", async function () {
    const fixture = await deployFixture();
    const { keeper, escrow, treasury, routeRegistry } = fixture;
    const amountUsd6 = ethers.parseUnits("80", 6);

    await seedRunningBatch(fixture, 1, amountUsd6);

    await routeRegistry.addRoute(
      "OUSG",
      2,
      ethers.id("counterparty-2"),
      ethers.id("jurisdiction-2"),
      ethers.id("custody-2"),
      false,
      false,
      false,
      "",
      true,
      true
    );

    await treasury.authorizeEscrowBatch(1, 1_900_000_000, ethers.encodeBytes32String("USD6"), [
      { routeId: 1, maxAllocationUsd6: ethers.parseUnits("80", 6) },
    ]);

    await escrow.connect(keeper).openPosition(
      1,
      1,
      "OUSG",
      ethers.parseUnits("60", 6),
      ethers.parseEther("1"),
      ethers.id("open-ref"),
      ethers.parseUnits("1", 6)
    );

    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await escrow.connect(keeper).markPosition(1, ethers.parseUnits("55", 6), ethers.id("mark-1"), Number(now + 60n));
    const afterMark = await escrow.getBatchAccounting(1);
    expect(afterMark.unrealizedPnlUsd6).to.equal(-5n * 10n ** 6n);

    await treasury.freezeEscrowBatch(1, true);

    await expect(
      escrow.connect(keeper).markPosition(1, ethers.parseUnits("54", 6), ethers.id("mark-2"), Number(now + 120n))
    ).to.be.revertedWith("Batch frozen");

    await expect(
      escrow.connect(keeper).closePosition(1, ethers.parseUnits("58", 6), ethers.id("close-ref"), 0)
    ).to.be.revertedWith("Batch frozen");

    await escrow.writeDownPosition(1, ethers.id("write-down"), 0);
    await escrow.finalizeBatchSettlement(1, ethers.id("settlement-1"), ethers.id("compliance-1"));

    const settlement = await escrow.getBatchSettlement(1);
    expect(settlement.finalValueUsd6).to.equal(ethers.parseUnits("20", 6));
    expect(settlement.settlementReportHash).to.equal(ethers.id("settlement-1"));
    expect(settlement.complianceDigestHash).to.equal(ethers.id("compliance-1"));
  });

  it("closes positions, finalizes deterministic settlement, and Treasury stores settlement hashes", async function () {
    const fixture = await deployFixture();
    const { keeper, escrow, treasury, routeRegistry } = fixture;
    const amountUsd6 = ethers.parseUnits("100", 6);

    await seedRunningBatch(fixture, 1, amountUsd6);

    await routeRegistry.addRoute(
      "SPC",
      3,
      ethers.id("counterparty-3"),
      ethers.id("jurisdiction-3"),
      ethers.id("custody-3"),
      true,
      true,
      true,
      "https://api.sagitta.test/spc/pnl",
      true,
      true
    );

    await treasury.authorizeEscrowBatch(1, 1_900_000_000, ethers.encodeBytes32String("USD6"), [
      { routeId: 1, maxAllocationUsd6: amountUsd6 },
    ]);

    await escrow.connect(keeper).openPosition(
      1,
      1,
      "SPC",
      ethers.parseUnits("60", 6),
      ethers.parseEther("1"),
      ethers.id("open-3"),
      ethers.parseUnits("1", 6)
    );

    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await escrow.connect(keeper).markPosition(1, ethers.parseUnits("70", 6), ethers.id("mark-3"), Number(now + 60n));
    await escrow.connect(keeper).closePosition(
      1,
      ethers.parseUnits("72", 6),
      ethers.id("close-3"),
      ethers.parseUnits("2", 6)
    );

    const settlementHash = ethers.id("settlement-3");
    const complianceHash = ethers.id("compliance-3");
    await escrow.finalizeBatchSettlement(1, settlementHash, complianceHash);

    const settlement = await escrow.getBatchSettlement(1);
    expect(settlement.finalValueUsd6).to.equal(ethers.parseUnits("110", 6));
    expect(settlement.userProfitUsd6).to.equal(ethers.parseUnits("8", 6));
    expect(settlement.protocolFeeUsd6).to.equal(ethers.parseUnits("2", 6));

    expect(await treasury.batchProfitUsd(1)).to.equal(ethers.parseUnits("8", 6));
    expect(await treasury.batchFinalNavPerShare(1)).to.equal(ethers.parseEther("1.1"));
    expect(await treasury.batchSettlementReportHash(1)).to.equal(settlementHash);
    expect(await treasury.batchComplianceDigestHash(1)).to.equal(complianceHash);

    await expect(escrow.distributeBatch(1, [1])).to.be.revertedWith("Escrow no longer settles users directly");
  });
});
