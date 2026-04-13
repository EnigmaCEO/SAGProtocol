const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Treasury stress state machine", function () {
  const HEALTHY = 0;
  const DEGRADED = 1;
  const RECAP_ONLY = 2;
  const EMERGENCY = 3;

  const FLAG_DEPEG = 8;
  const FLAG_ORACLE = 16;

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function deployFixture() {
    const [owner, vault] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockGOLD = await ethers.getContractFactory("MockGOLD");
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const ReserveController = await ethers.getContractFactory("ReserveController");
    const Treasury = await ethers.getContractFactory("Treasury");

    const usdc = await MockUSDC.deploy();
    const gold = await MockGOLD.deploy();
    const stableOracle = await MockOracle.deploy();
    const goldOracle = await MockOracle.deploy();

    await stableOracle.setPrice(100_000_000n);
    await goldOracle.setPrice(400_000_000_000n);

    const reserve = await ReserveController.deploy(await gold.getAddress(), await goldOracle.getAddress());
    const treasury = await Treasury.deploy(
      await usdc.getAddress(),
      await gold.getAddress(),
      await reserve.getAddress(),
      vault.address,
      await stableOracle.getAddress()
    );

    await treasury.setGoldOracle(await goldOracle.getAddress());

    await usdc.mint(await treasury.getAddress(), 1_000_000n * 10n ** 6n);
    await gold.mint(await reserve.getAddress(), 125n * 10n ** 18n);
    await treasury.adminCollateralize(800_000n * 10n ** 6n);

    return { treasury, stableOracle, goldOracle };
  }

  it("starts healthy when backing, liquidity, and oracle freshness are intact", async function () {
    const { treasury } = await deployFixture();

    const metrics = await treasury.getStressMetrics();
    expect(metrics.oracleFresh).to.equal(true);

    const [state, flags] = await treasury.getStressState();
    expect(state).to.equal(HEALTHY);
    expect(flags).to.equal(0n);
  });

  it("switches to recap-only on stable depeg without forcing emergency", async function () {
    const { treasury, stableOracle } = await deployFixture();

    await stableOracle.setPrice(97_000_000n);

    const [state, flags] = await treasury.getStressState();
    expect(state).to.equal(RECAP_ONLY);
    expect(flags).to.equal(BigInt(FLAG_DEPEG));
  });

  it("uses delayed recovery after emergency", async function () {
    const { treasury, stableOracle, goldOracle } = await deployFixture();

    let tx = await treasury.refreshStressState();
    await tx.wait();

    await stableOracle.setValid(false);
    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(EMERGENCY);

    await stableOracle.setValid(true);
    await stableOracle.setPrice(100_000_000n);

    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(EMERGENCY);

    await increaseTime(3 * 24 * 60 * 60);
    await stableOracle.setPrice(100_000_000n);
    await goldOracle.setPrice(400_000_000_000n);
    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(RECAP_ONLY);

    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(RECAP_ONLY);

    await increaseTime(24 * 60 * 60);
    await stableOracle.setPrice(100_000_000n);
    await goldOracle.setPrice(400_000_000_000n);
    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(DEGRADED);

    await increaseTime(24 * 60 * 60);
    await stableOracle.setPrice(100_000_000n);
    await goldOracle.setPrice(400_000_000_000n);
    tx = await treasury.refreshStressState();
    await tx.wait();
    expect(await treasury.stressState()).to.equal(HEALTHY);

    const [, flags] = await treasury.getStressState();
    expect(flags).to.equal(0n);
  });

  it("forces emergency when oracle freshness is invalid", async function () {
    const { treasury, stableOracle } = await deployFixture();

    await stableOracle.setValid(false);

    const [state, flags] = await treasury.getStressState();
    expect(state).to.equal(EMERGENCY);
    expect(flags & BigInt(FLAG_ORACLE)).to.equal(BigInt(FLAG_ORACLE));
  });
});
