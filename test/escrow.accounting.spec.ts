import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("Treasury origin lots and Escrow batch positions", function () {
  async function deployFixture() {
    const [owner, keeper, user] = await ethers.getSigners();

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

    return { owner, keeper, user, usdc, oracle, treasury, escrow, routeRegistry };
  }

  async function registerBankLot(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    ref: string,
    amountUsd6: bigint,
    liabilityUnlockAt: bigint
  ) {
    const { treasury } = fixture;
    await treasury.registerBankOriginLot(ethers.id(ref), amountUsd6, liabilityUnlockAt);
    return Number((await treasury.nextOriginLotId()) - 1n);
  }

  async function seedTreasuryBatch(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    amountUsd6: bigint,
    expectedReturnAt: bigint,
    settlementDeadlineAt: bigint
  ) {
    const { treasury } = fixture;
    const lotId = await registerBankLot(fixture, `bank-lot-${expectedReturnAt}`, amountUsd6, settlementDeadlineAt);
    await treasury.createAndFundBatch(2, [lotId], expectedReturnAt, settlementDeadlineAt);
    return Number((await treasury.nextTreasuryBatchId()) - 1n);
  }

  it("routes BANK-origin lots into Treasury-owned batches and Escrow batch positions", async function () {
    const fixture = await deployFixture();
    const { treasury, escrow } = fixture;
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const amountUsd6 = ethers.parseUnits("100", 6);

    const firstBatchId = await seedTreasuryBatch(fixture, amountUsd6, now + 30n * 24n * 60n * 60n, now + 35n * 24n * 60n * 60n);
    const secondBatchId = await seedTreasuryBatch(fixture, amountUsd6, now + 60n * 24n * 60n * 60n, now + 65n * 24n * 60n * 60n);

    const firstBatch = await treasury.getTreasuryBatch(firstBatchId);
    expect(firstBatch.originType).to.equal(2);
    expect(firstBatch.principalAllocated).to.equal(amountUsd6);
    expect(firstBatch.status).to.equal(2);

    const firstPosition = await escrow.escrowBatchPositions(firstBatchId);
    const secondPosition = await escrow.escrowBatchPositions(secondBatchId);
    expect(firstPosition.deployedPrincipal).to.equal(amountUsd6);
    expect(secondPosition.deployedPrincipal).to.equal(amountUsd6);
    expect(firstPosition.expectedReturnAt).to.not.equal(secondPosition.expectedReturnAt);
    expect(firstPosition.status).to.equal(1);
    expect(secondPosition.status).to.equal(1);
  });

  it("records VAULT-origin lots without sending Vault unlock timing to Escrow", async function () {
    const fixture = await deployFixture();
    const { user, usdc, oracle, treasury, escrow } = fixture;
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const amountUsd6 = ethers.parseUnits("50", 6);
    const expectedReturnAt = now + 90n * 24n * 60n * 60n;

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    await treasury.setVault(await vault.getAddress());
    await vault.setTreasury(await treasury.getAddress());
    await vault.setAsset(await usdc.getAddress(), true, 6, await oracle.getAddress());

    await usdc.mint(user.address, amountUsd6);
    await usdc.connect(user).approve(await vault.getAddress(), amountUsd6);
    await vault.connect(user).deposit(await usdc.getAddress(), amountUsd6);

    await treasury.createAndFundBatch(1, [1], expectedReturnAt, expectedReturnAt + 7n * 24n * 60n * 60n);

    const lot = await treasury.originLots(1);
    const batch = await treasury.getTreasuryBatch(1);
    const escrowPosition = await escrow.escrowBatchPositions(1);

    expect(lot.originType).to.equal(1);
    expect(lot.originRefId).to.equal(ethers.ZeroHash);
    expect(lot.liabilityUnlockAt).to.be.gte(now + 365n * 24n * 60n * 60n);
    expect(batch.expectedReturnAt).to.equal(expectedReturnAt);
    expect(escrowPosition.expectedReturnAt).to.equal(expectedReturnAt);
    expect(escrowPosition.expectedReturnAt).to.not.equal(lot.liabilityUnlockAt);
  });

  it("enforces source-liability eligibility and single-origin batches", async function () {
    const fixture = await deployFixture();
    const { treasury } = fixture;
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const amountUsd6 = ethers.parseUnits("25", 6);
    const expectedReturnAt = now + 90n * 24n * 60n * 60n;

    const bankLotId = await registerBankLot(fixture, "short-bank-lot", amountUsd6, expectedReturnAt - 1n);
    await expect(
      treasury.createAndFundBatch(2, [bankLotId], expectedReturnAt, expectedReturnAt + 1n)
    ).to.be.revertedWith("liability before settlement");

    await treasury.registerVaultOriginLot(11, amountUsd6, expectedReturnAt + 100n);
    const vaultLotId = 2;
    await expect(
      treasury.createAndFundBatch(2, [vaultLotId], expectedReturnAt, expectedReturnAt + 100n)
    ).to.be.revertedWith("mixed origin");
  });

  it("blocks Escrow-origin batch formation APIs", async function () {
    const fixture = await deployFixture();
    const { owner, escrow } = fixture;

    await expect(
      escrow.connect(owner).createPendingBatch()
    ).to.be.revertedWith("Treasury owns batches");

    await expect(
      escrow.connect(owner).registerDeposit(1, ethers.parseUnits("10", 6), ethers.parseEther("1"))
    ).to.be.revertedWith("Treasury owns origin lots");
  });

  it("blocks external routes until compliance checklist is complete", async function () {
    const fixture = await deployFixture();
    const { keeper, escrow, treasury, routeRegistry } = fixture;
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const amountUsd6 = ethers.parseUnits("100", 6);

    await seedTreasuryBatch(fixture, amountUsd6, now + 30n * 24n * 60n * 60n, now + 35n * 24n * 60n * 60n);

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

  it("closes positions, finalizes settlement, and closes Treasury batch lots", async function () {
    const fixture = await deployFixture();
    const { keeper, escrow, treasury, routeRegistry } = fixture;
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const amountUsd6 = ethers.parseUnits("100", 6);

    await seedTreasuryBatch(fixture, amountUsd6, now + 30n * 24n * 60n * 60n, now + 35n * 24n * 60n * 60n);

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
    const escrowPosition = await escrow.escrowBatchPositions(1);
    const treasuryBatch = await treasury.getTreasuryBatch(1);
    const lot = await treasury.originLots(1);

    expect(settlement.finalValueUsd6).to.equal(ethers.parseUnits("110", 6));
    expect(settlement.userProfitUsd6).to.equal(ethers.parseUnits("8", 6));
    expect(settlement.protocolFeeUsd6).to.equal(ethers.parseUnits("2", 6));
    expect(escrowPosition.settlementAmount).to.equal(ethers.parseUnits("110", 6));
    expect(escrowPosition.status).to.equal(2);
    expect(treasuryBatch.status).to.equal(3);
    expect(treasuryBatch.actualReturnedAt).to.be.gt(0);
    expect(lot.status).to.equal(3);

    expect(await treasury.batchProfitUsd(1)).to.equal(ethers.parseUnits("8", 6));
    expect(await treasury.batchFinalNavPerShare(1)).to.equal(ethers.parseEther("1.1"));
    expect(await treasury.batchSettlementReportHash(1)).to.equal(settlementHash);
    expect(await treasury.batchComplianceDigestHash(1)).to.equal(complianceHash);

    await expect(escrow.distributeBatch(1, [1])).to.be.revertedWith("Escrow no longer settles users directly");
  });
});
