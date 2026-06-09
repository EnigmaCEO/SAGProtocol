import { expect } from 'chai';
import hre from 'hardhat';

const { ethers } = hre;

describe('InvestmentEscrow allocation attachments', function () {
  async function deployFixture() {
    const [owner, outsider] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    const MockGOLD = await ethers.getContractFactory('MockGOLD');
    const MockOracle = await ethers.getContractFactory('MockOracle');
    const Treasury = await ethers.getContractFactory('Treasury');
    const InvestmentEscrow = await ethers.getContractFactory('InvestmentEscrow');

    const usdc = await MockUSDC.deploy();
    const gold = await MockGOLD.deploy();
    const oracle = await MockOracle.deploy();
    await oracle.setPrice(100_000_000n);

    const treasury = await Treasury.deploy(
      await usdc.getAddress(),
      await gold.getAddress(),
      owner.address,
      owner.address,
      await oracle.getAddress(),
    );
    const escrow = await InvestmentEscrow.deploy(await usdc.getAddress(), await treasury.getAddress());
    await treasury.setEscrow(await escrow.getAddress());
    await escrow.setVault(owner.address);
    await usdc.mint(await treasury.getAddress(), ethers.parseUnits('1000', 6));

    return { treasury, escrow, outsider };
  }

  it('attaches the full allocation context only after the source batch is funded', async function () {
    const { treasury, escrow, outsider } = await deployFixture();
    const planHash = ethers.id('allocation-plan');
    const policyHash = ethers.id('policy-context');

    await expect(
      escrow.attachAllocation(1, planHash, policyHash, 'portfolio-registry-v1'),
    ).to.be.revertedWithCustomError(escrow, 'BatchNotFunded');

    const now = BigInt((await ethers.provider.getBlock('latest'))!.timestamp);
    await treasury.registerBankOriginLot(
      ethers.id('bank-lot'),
      ethers.parseUnits('100', 6),
      now + 40n * 24n * 60n * 60n,
    );
    await treasury.createAndFundBatch(
      2,
      [1],
      now + 30n * 24n * 60n * 60n,
      now + 35n * 24n * 60n * 60n,
    );

    await expect(
      escrow.connect(outsider).attachAllocation(1, planHash, policyHash, 'portfolio-registry-v1'),
    ).to.be.revertedWith('Only keeper, owner, or treasury');
    await escrow.attachAllocation(1, planHash, policyHash, 'portfolio-registry-v1');
    const attachment = await escrow.getAllocationAttachment(1);
    expect(attachment.allocationPlanHash).to.equal(planHash);
    expect(attachment.policyContextHash).to.equal(policyHash);
    expect(attachment.portfolioRegistryVersion).to.equal('portfolio-registry-v1');
    expect(attachment.exists).to.equal(true);

    await expect(
      escrow.attachAllocation(1, planHash, policyHash, 'portfolio-registry-v1'),
    ).not.to.be.reverted;
    await expect(
      escrow.attachAllocation(1, planHash, policyHash, 'portfolio-registry-v2'),
    ).to.be.revertedWithCustomError(escrow, 'AllocationHashMismatch');
  });

});
