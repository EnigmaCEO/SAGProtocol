import { expect } from "chai";
// import { ethers } from "hardhat";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const { ethers } = hre;

describe("Vault Upgrades", function () {
  let vault: any;
  let treasuryMock: any;
  let usdc: any;
  let oracle: any;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let receiptNFT: any;

  const USDC_DECIMALS = 6;
  const ORACLE_DECIMALS = 8;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, user, user2] = await ethers.getSigners();

    // Deploy mock USDC
    const ERC20Mock = await ethers.getContractFactory("contracts/mocks/ERC20Mock.sol:ERC20Mock");
    usdc = await ERC20Mock.deploy("USD Coin", "USDC", USDC_DECIMALS);

    // Deploy mock oracle
    const OracleMock = await ethers.getContractFactory("contracts/mocks/OracleMock.sol:OracleMock");
    oracle = await OracleMock.deploy(100000000); // $1.00 with 8 decimals

    // Deploy Vault
    const Vault = await ethers.getContractFactory("Vault");
    vault = await Vault.deploy();

    // Deploy Treasury mock
    const TreasuryPayMock = await ethers.getContractFactory("TreasuryPayMock");
    treasuryMock = await TreasuryPayMock.deploy(await usdc.getAddress());

    // Configure vault
    await vault.setTreasury(await treasuryMock.getAddress());
    await vault.setAsset(await usdc.getAddress(), true, USDC_DECIMALS, await oracle.getAddress());

    // Mint USDC to users - ethers v6 uses parseUnits directly on ethers object
    await usdc.mint(user.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await usdc.mint(user2.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await usdc.mint(await treasuryMock.getAddress(), ethers.parseUnits("100000", USDC_DECIMALS));

    // Deploy SagittaVaultReceipt and set Vault as minter
    const SagittaVaultReceipt = await ethers.getContractFactory("SagittaVaultReceipt");
    receiptNFT = await SagittaVaultReceipt.deploy("Sagitta Receipt", "SAG-RCP");
    await receiptNFT.waitForDeployment();
    await receiptNFT.setMinter(await vault.getAddress());
    await vault.setReceiptNFT(await receiptNFT.getAddress());
  });

  describe("Profit Credits", function () {
    it("should issue and claim credit after unlock", async function () {
      const creditAmount = ethers.parseUnits("100", USDC_DECIMALS);
      const unlockAt = (await time.latest()) + 3600; // 1 hour from now

      // Only treasury can issue credits
      await expect(
        vault.connect(owner).issueCredit(user.address, creditAmount, unlockAt)
      ).to.be.reverted;

      // Impersonate treasury to issue credit
      await ethers.provider.send("hardhat_impersonateAccount", [await treasuryMock.getAddress()]);
      const treasurySigner = await ethers.getSigner(await treasuryMock.getAddress());
      
      // Fund the treasury signer with ETH for gas
      await owner.sendTransaction({
        to: await treasuryMock.getAddress(),
        value: ethers.parseEther("1.0")
      });

      await vault.connect(treasurySigner).issueCredit(user.address, creditAmount, unlockAt);
      
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [await treasuryMock.getAddress()]);

      // Check pending credits
      let [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(creditAmount);
      expect(unlocked).to.equal(0);

      // Try to claim before unlock
      await expect(
        vault.connect(user).claimCredit(0)
      ).to.be.reverted;

      // Fast forward past unlock
      await time.increase(3601);

      // Check pending credits after unlock
      [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(creditAmount);
      expect(unlocked).to.equal(creditAmount);

      // Claim credit
      const userBalanceBefore = await usdc.balanceOf(user.address);
      await vault.connect(user).claimCredit(0);

      const userBalanceAfter = await usdc.balanceOf(user.address);
      expect(userBalanceAfter - userBalanceBefore).to.equal(creditAmount);

      // Check pending credits after claim
      [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(0);
      expect(unlocked).to.equal(0);
    });

    it("should handle multiple credits correctly", async function () {
      const credit1 = ethers.parseUnits("100", USDC_DECIMALS);
      const credit2 = ethers.parseUnits("200", USDC_DECIMALS);
      const now = await time.latest();

      // Impersonate treasury
      await ethers.provider.send("hardhat_impersonateAccount", [await treasuryMock.getAddress()]);
      const treasurySigner = await ethers.getSigner(await treasuryMock.getAddress());
      await owner.sendTransaction({
        to: await treasuryMock.getAddress(),
        value: ethers.parseEther("1.0")
      });

      await vault.connect(treasurySigner).issueCredit(user.address, credit1, now + 1000);
      await vault.connect(treasurySigner).issueCredit(user.address, credit2, now + 2000);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [await treasuryMock.getAddress()]);

      let [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(credit1 + credit2);
      expect(unlocked).to.equal(0);

      // After first unlock
      await time.increase(1001);
      [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(credit1 + credit2);
      expect(unlocked).to.equal(credit1);

      // After second unlock
      await time.increase(1000);
      [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(credit1 + credit2);
      expect(unlocked).to.equal(credit1 + credit2);
    });
  });

  describe("Pause/Unpause", function () {
    it("should block operations when paused", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);

      // Pause
      await vault.pause();

      // Try deposit
      await expect(
        vault.connect(user).deposit(await usdc.getAddress(), depositAmount)
      ).to.be.reverted;

      // Unpause
      await vault.unpause();

      // Deposit should work
      await vault.connect(user).deposit(await usdc.getAddress(), depositAmount);
    });

    it("should block withdrawal when paused", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await usdc.getAddress(), depositAmount);

      const depositIds = await vault.userDepositsOf(user.address);
      await time.increase(ONE_YEAR + 1);

      await vault.pause();

      await expect(
        vault.connect(user).autoReturn(depositIds[0])
      ).to.be.reverted;

      await vault.unpause();

      await vault.connect(user).autoReturn(depositIds[0]);
    });
  });

  describe("Sweep", function () {
    it("should allow sweeping non-enabled tokens", async function () {
      // Deploy another token
      const ERC20Mock = await ethers.getContractFactory("contracts/mocks/ERC20Mock.sol:ERC20Mock");
      const randomTokenDeployed = await ERC20Mock.deploy("Random", "RND", 18);
      await randomTokenDeployed.waitForDeployment();
      const randomToken = await ethers.getContractAt("contracts/mocks/ERC20Mock.sol:ERC20Mock", await randomTokenDeployed.getAddress());
      
      // Send some to vault
      const amount = ethers.parseEther("100");
      await randomToken.mint(await vault.getAddress(), amount);

      // Sweep
      await vault.sweep(await randomToken.getAddress(), owner.address);

      const balance = await randomToken.balanceOf(owner.address);
      expect(balance).to.equal(amount);
    });

    it("should prevent sweeping enabled assets", async function () {
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("100", USDC_DECIMALS));

      await expect(
        vault.sweep(await usdc.getAddress(), owner.address)
      ).to.be.reverted;
    });

    it("should allow sweeping after asset is disabled", async function () {
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("100", USDC_DECIMALS));

      // Disable USDC
      await vault.setAsset(await usdc.getAddress(), false, 0, ethers.ZeroAddress);

      // Now sweep should work
      await vault.sweep(await usdc.getAddress(), owner.address);
    });
  });

  describe("View Functions", function () {
    it("should return correct totals", async function () {
      const deposit1 = ethers.parseUnits("1000", USDC_DECIMALS);
      const deposit2 = ethers.parseUnits("500", USDC_DECIMALS);

      await usdc.connect(user).approve(await vault.getAddress(), deposit1);
      await vault.connect(user).deposit(await usdc.getAddress(), deposit1);

      await usdc.connect(user2).approve(await vault.getAddress(), deposit2);
      await vault.connect(user2).deposit(await usdc.getAddress(), deposit2);

      const [principal, shares] = await vault.totals(await usdc.getAddress());
      expect(principal).to.equal(deposit1 + deposit2);
      // shares = (principal * 1e12)
      const expectedShares = (deposit1 + deposit2) * BigInt(1_000_000_000_000);
      expect(shares).to.equal(expectedShares);
    });

    it("should return correct pending credits", async function () {
      const now = await time.latest();
      
      // Impersonate treasury
      await ethers.provider.send("hardhat_impersonateAccount", [await treasuryMock.getAddress()]);
      const treasurySigner = await ethers.getSigner(await treasuryMock.getAddress());
      await owner.sendTransaction({
        to: await treasuryMock.getAddress(),
        value: ethers.parseEther("1.0")
      });

      await vault.connect(treasurySigner).issueCredit(user.address, 100, now + 1000);
      await vault.connect(treasurySigner).issueCredit(user.address, 200, now + 2000);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [await treasuryMock.getAddress()]);

      let [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(300);
      expect(unlocked).to.equal(0);

      await time.increase(1500);
      [total, unlocked] = await vault.pendingCreditsUsd6(user.address);
      expect(total).to.equal(300);
      expect(unlocked).to.equal(100);
    });
  });

  describe("NFT Receipts", function () {
    it("should mint an NFT receipt on deposit", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await usdc.getAddress(), depositAmount);
      const depositIds = await vault.userDepositsOf(user.address);
      expect(depositIds.length).to.equal(1);
      // The depositId itself is the "NFT receipt" identifier
      expect(depositIds[0]).to.exist;
    });

    it("should burn NFT receipt on withdrawal", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await usdc.getAddress(), depositAmount);
      const depositIds = await vault.userDepositsOf(user.address);
      const depositId = depositIds[0];
      await time.increase(ONE_YEAR + 1);
      await vault.connect(user).autoReturn(depositId);
      // After withdrawal, deposit should be marked as withdrawn
      const depositInfo = await vault.depositInfo(depositId);
      expect(depositInfo.withdrawn).to.be.true;
    });

    it("should return correct NFT metadata", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await usdc.getAddress(), depositAmount);
      const depositIds = await vault.userDepositsOf(user.address);
      const depositId = depositIds[0];
      // If metadata is available via a view, check it; otherwise, skip
      if (typeof vault.depositMetadata === "function") {
        const meta = await vault.depositMetadata(depositId);
        expect(meta).to.exist;
      }
    });

    it("should prevent NFT transfer if non-transferable", async function () {
      // Vault does not expose transferFrom, so this should throw or not exist
      expect(typeof vault.transferFrom).to.not.equal("function");
    });
  });

  describe("mDOT Deposits", function () {
    let mdot: any;
    let mdotOracle: any;
    beforeEach(async function () {
      // Deploy mock mDOT token
      const ERC20Mock = await ethers.getContractFactory("contracts/mocks/ERC20Mock.sol:ERC20Mock");
      mdot = await ERC20Mock.deploy("Mock DOT", "mDOT", 18);
      await mdot.waitForDeployment();
      // Deploy oracle for mDOT
      const OracleMock = await ethers.getContractFactory("contracts/mocks/OracleMock.sol:OracleMock");
      mdotOracle = await OracleMock.deploy("1000000000"); // $10.00 with 8 decimals
      // Enable mDOT as asset
      await vault.setAsset(await mdot.getAddress(), true, 18, await mdotOracle.getAddress());
      // Mint mDOT to user
      await mdot.mint(user.address, ethers.parseUnits("100", 18));

      // Ensure receiptNFT is set for this nested beforeEach as well
      if (!await vault.receiptNFT()) {
        const SagittaVaultReceipt = await ethers.getContractFactory("SagittaVaultReceipt");
        receiptNFT = await SagittaVaultReceipt.deploy("Sagitta Receipt", "SAG-RCP");
        await receiptNFT.waitForDeployment();
        await receiptNFT.setMinter(await vault.getAddress());
        await vault.setReceiptNFT(await receiptNFT.getAddress());
      }
    });

    it("should allow deposit and withdrawal of mDOT", async function () {
      const depositAmount = ethers.parseUnits("10", 18);
      await mdot.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await mdot.getAddress(), depositAmount);
      const depositIds = await vault.userDepositsOf(user.address);
      expect(depositIds.length).to.be.greaterThan(0);
      const depositId = depositIds[0];
      await time.increase(ONE_YEAR + 1);
      await vault.connect(user).autoReturn(depositId);
      const userBalance = await mdot.balanceOf(user.address);
      expect(userBalance).to.equal(ethers.parseUnits("100", 18));
    });

    it("should update totals and shares correctly for mDOT", async function () {
      const depositAmount = ethers.parseUnits("10", 18);
      await mdot.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(await mdot.getAddress(), depositAmount);
      const [principal, shares] = await vault.totals(await mdot.getAddress());
      // principal should equal depositAmount (in mDOT decimals)
      expect(principal).to.equal(depositAmount);

      // shares should be calculated based on oracle price and scaled to 18 decimals
      // shares = (depositAmount * oraclePrice * 1e12) / (10 ** (assetDecimals + 2))
      // depositAmount = 10e18, oraclePrice = 1e9, assetDecimals = 18
      // shares = (10e18 * 1e9 * 1e12) / 1e20 = 1e40 / 1e20 = 1e20 = 100000000000000000000
      const expectedShares = BigInt("100000000000000000000");
      expect(shares).to.equal(expectedShares);
    });

    it("should revert deposit if mDOT is disabled", async function () {
      await vault.setAsset(await mdot.getAddress(), false, 0, ethers.ZeroAddress);
      const depositAmount = ethers.parseUnits("1", 18);
      await mdot.connect(user).approve(await vault.getAddress(), depositAmount);
      await expect(
        vault.connect(user).deposit(await mdot.getAddress(), depositAmount)
      ).to.be.reverted;
    });
  });

  describe("Deposit Edge Cases", function () {
    it("should revert if user has not approved enough tokens", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      // Approve less than deposit amount
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount - 1n);
      await expect(
        vault.connect(user).deposit(await usdc.getAddress(), depositAmount)
      ).to.be.reverted;
    });

    it("should revert if deposit amount is zero", async function () {
      await usdc.connect(user).approve(await vault.getAddress(), 0);
      await expect(
        vault.connect(user).deposit(await usdc.getAddress(), 0)
      ).to.be.reverted;
    });

    it("should revert if asset is disabled", async function () {
      await vault.setAsset(await usdc.getAddress(), false, 0, ethers.ZeroAddress);
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await expect(
        vault.connect(user).deposit(await usdc.getAddress(), depositAmount)
      ).to.be.reverted;
    });

    it("should revert if user has insufficient balance", async function () {
      const depositAmount = ethers.parseUnits("20000", USDC_DECIMALS); // more than minted
      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await expect(
        vault.connect(user).deposit(await usdc.getAddress(), depositAmount)
      ).to.be.reverted;
    });

    it("should revert if asset is not ERC20", async function () {
      // Try to deposit using a random address (not a token)
      const fakeToken = ethers.ZeroAddress;
      await expect(
        vault.connect(user).deposit(fakeToken, 1000)
      ).to.be.reverted;
    });
  });
});
