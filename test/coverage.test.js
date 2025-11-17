import { expect } from "chai";
import hre from "hardhat";
const ethers = hre.ethers;

describe("Full coverage test suite", function () {
  let deployer, owner, keeper, user, other;
  let MockUSDC, MockGOLD, MockDOT, MockOracle, MockAmmPair, SagittaVaultReceipt, ReserveController, PriceOracleRouter, InvestmentEscrow, GoldOracle;
  let usdc, gold, dot, oracle, ammPair, receipt, reserve, router, escrow, goldOracle;
  let TestTreasury, TestVault, treasury, vault;

  before(async function () {
    [deployer, owner, keeper, user, other] = await ethers.getSigners();

    // Deploy core mocks and contracts using Hardhat / ethers v6 helper and read addresses explicitly
    usdc = await ethers.deployContract("MockUSDC");
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();

    gold = await ethers.deployContract("MockGOLD");
    await gold.waitForDeployment();
    const goldAddr = await gold.getAddress();

    dot = await ethers.deployContract("MockDOT");
    await dot.waitForDeployment();
    const dotAddr = await dot.getAddress();

    oracle = await ethers.deployContract("MockOracle");
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();

    goldOracle = await ethers.deployContract("GoldOracle", [123456]); // initial price
    await goldOracle.waitForDeployment();
    const goldOracleAddr = await goldOracle.getAddress();

    // deploy router / reserve with explicit address values to prevent null/target resolution issues
    router = await ethers.deployContract("PriceOracleRouter", [oracleAddr, goldOracleAddr]);
    await router.waitForDeployment();
    const routerAddr = await router.getAddress();

    reserve = await ethers.deployContract("ReserveController", [goldAddr, goldOracleAddr]);
    await reserve.waitForDeployment();
    const reserveAddr = await reserve.getAddress();

    receipt = await ethers.deployContract("SagittaVaultReceipt", ["Sagitta Receipt", "SREC"]);
    await receipt.waitForDeployment();
    const receiptAddr = await receipt.getAddress();

    ammPair = await ethers.deployContract("MockAmmPair", [usdcAddr, dotAddr]);
    await ammPair.waitForDeployment();
    const ammPairAddr = await ammPair.getAddress();

    treasury = await ethers.deployContract("TestTreasury", [usdcAddr]);
    await treasury.waitForDeployment();
    const treasuryAddr = await treasury.getAddress();

    vault = await ethers.deployContract("TestVault");
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();

    escrow = await ethers.deployContract("InvestmentEscrow", [usdcAddr, treasuryAddr]);
    await escrow.waitForDeployment();
    const escrowAddr = await escrow.getAddress();

    // expose frequently used addresses for the rest of the test via local bindings
    this.addrs = {
      usdcAddr, goldAddr, dotAddr, oracleAddr, goldOracleAddr, routerAddr, reserveAddr, receiptAddr, ammPairAddr, treasuryAddr, vaultAddr, escrowAddr
    };
  });

  it("Mock token basics", async function () {
    expect(await usdc.decimals()).to.equal(6);
    // test mint and faucet
    const userAddr = await user.getAddress();
    await usdc.faucetMint(userAddr, ethers.parseUnits("1", 6)); // 1 USDC (6 decimals)
    expect(await usdc.balanceOf(userAddr)).to.equal(ethers.parseUnits("1", 6));

    // MockGOLD faucet and owner mint
    const ownerAddr = await owner.getAddress();
    const deployerAddr = await deployer.getAddress();
    await gold.faucetMint(ownerAddr, ethers.parseEther("1000"));
    await gold.connect(owner).mint(deployerAddr, ethers.parseEther("10")).catch(() => {});
    // decimals and mint behavior
    expect(await dot.decimals()).to.equal(6); // intentional implementation quirk
    await dot.mint(userAddr, 1000);
    expect(await dot.balanceOf(userAddr)).to.equal(1000);
  });

  it("Price router and oracle", async function () {
    // MockOracle price setter and router reads
    await oracle.setPrice(777);
    expect(await router.getSagPriceUsd()).to.equal(777);
    expect(await router.getGoldPriceUsd()).to.equal(123456); // from deployed GoldOracle
    // direct goldOracle getter
    expect(await goldOracle.getGoldPrice()).to.equal(123456);
  });

  it("ReserveController nav and manage", async function () {
    // set treasury and ensure transfers work in both branches
    const treasuryAddr = this.addrs.treasuryAddr;
    await reserve.setTreasury(treasuryAddr);
    // mint gold to treasury and approve reserve for transferFrom scenario
    await gold.faucetMint(treasuryAddr, ethers.parseEther("100"));
    // TestTreasury is a contract; use its approve helper to set allowance for ReserveController
    await treasury.approveToken(await gold.getAddress(), this.addrs.reserveAddr, ethers.parseEther("50")).catch(() => {});
    // simulate manageReserve fill (currentRatio < reserveFloorBps)
    await reserve.manageReserve(1000); // less than reserveFloorBps (1200) -> calls transferFrom
    // credits/evts asserted by not reverting
    // populate reserve controller with some gold to allow drain
    const reserveAddr = this.addrs.reserveAddr;
    await gold.faucetMint(reserveAddr, ethers.parseEther("20"));
    await reserve.manageReserve(3000); // greater than reserveCeilBps (2500) -> will transfer to treasury
  });

  it("SagittaVaultReceipt: minter, mint, metadata, batch setters, burn", async function () {
    // initially only owner can set minter
    const keeperAddr = await keeper.getAddress();
    await receipt.setMinter(keeperAddr);
    expect(await receipt.minter()).to.equal(keeperAddr);

    // keeper can mint
    const userAddr = await user.getAddress();
    await receipt.connect(keeper).mint(userAddr, 42);
    expect(await receipt.ownerOf(42)).to.equal(userAddr);

    // set batch and aliases
    await receipt.connect(keeper).setBatch(42, 7);
    expect(await receipt.tokenBatchId(42)).to.equal(7);
    await receipt.connect(keeper).setTokenBatch(42, 8);
    expect(await receipt.tokenBatchId(42)).to.equal(8);
    await receipt.connect(keeper).setReceiptBatch(42, 9);
    expect(await receipt.tokenBatchId(42)).to.equal(9);

    // metadata update and read
    await receipt.connect(keeper).updateMetadata(42, " {\"batch\":9} ");
    expect(await receipt.tokenMetadata(42)).to.equal(" {\"batch\":9} ");

    // burn by minter
    await receipt.connect(keeper).burn(42);
    await expect(receipt.ownerOf(42)).to.be.reverted;
  });

  it("MockAmmPair addLiquidity, getReserves, swap (approve and pre-funded fallback)", async function () {
    // add liquidity: transfer tokens to provider and approve pair
    const otherAddr = await other.getAddress();
    const ammPairAddr = this.addrs.ammPairAddr;
    await usdc.faucetMint(otherAddr, ethers.parseUnits("1000000", 6));
    await dot.mint(otherAddr, 10000);
    await usdc.connect(other).approve(ammPairAddr, 500000);
    await dot.connect(other).approve(ammPairAddr, 5000);
    await ammPair.connect(other).addLiquidity(500000, 5000);
    const r = await ammPair.getReserves();
    expect(r[0]).to.equal(500000);
    expect(r[1]).to.equal(5000);

    // swap via approve path
    // give user tokens and approve
    const userAddr = await user.getAddress();
    await usdc.faucetMint(userAddr, ethers.parseUnits("100000", 6));
    await usdc.connect(user).approve(ammPairAddr, 10000);
    // swap USDC -> DOT
    const amountIn = 10000;
    const beforeDot = await dot.balanceOf(userAddr);
    await ammPair.connect(user).swapExactTokensForTokens(amountIn, this.addrs.usdcAddr, this.addrs.dotAddr, userAddr);
    const afterDot = await dot.balanceOf(userAddr);
    expect(afterDot).to.be.gt(beforeDot);

    // pre-funded fallback: transfer tokens into pair and call swap without approval
    const preFundAmount = 5000;
    // user mints usdc and transfers directly to pair (no approve)
    await usdc.faucetMint(userAddr, ethers.parseUnits(String(preFundAmount), 6));
    await usdc.connect(user).transfer(ammPairAddr, preFundAmount);
    // call swap without approve - transferFrom will revert but afterBalance check will accept
    await ammPair.connect(user).swapExactTokensForTokens(preFundAmount, this.addrs.usdcAddr, this.addrs.dotAddr, userAddr);
  });

  it("InvestmentEscrow batch lifecycle: register, roll, invest (burn), deposit return, close, distribute", async function () {
    // set vault and keeper for escrow (use addresses captured in before())
    const escrowAddr = this.addrs.escrowAddr;
    const vaultAddr = this.addrs.vaultAddr;
    const keeperAddr = await keeper.getAddress();
    await escrow.setVault(vaultAddr);
    await escrow.setKeeper(keeperAddr);

    // create deposit in TestVault for tokenId 1
    const tokenId = 1;
    // amountUsd6 uses 6 decimals (e.g., 100 USDC -> 100 * 1e6)
    const amountUsd6 = ethers.parseUnits("100", 6); // 100 USDC with 6 decimals
    const userAddr = await user.getAddress();
    await vault.setDeposit(tokenId, userAddr, this.addrs.usdcAddr, 0, amountUsd6, ethers.parseEther("1"), 0, 0, false);

    // register deposit (vault or treasury can call)
    // forward registration via Vault contract so msg.sender == vault
    await vault.forwardRegisterDeposit(escrowAddr, tokenId, amountUsd6, ethers.parseEther("1"));

    // roll to new batch: escrow will call treasury.fundEscrowBatch -> TestTreasury mints USDC to escrow
    // ensure there are funds in the current pending batch before creating new one
    await escrow.rollToNewBatch();

    // find previous batch id (1) and invest it
    const investedBatchId = 1;
    // now escrow should have received minted USDC from TestTreasury; investBatch will burn (transfer to dead)
    await escrow.connect(keeper).investBatch(investedBatchId);

    // mark invested and then deposit return flow (simulate investment returned funds)
    // Create a new running batch to test depositReturnForBatch path
    // create pending batch, register deposit into it, roll it
    await escrow.createPendingBatch();
    const newPending = 2;
    // register deposit to new pending explicitly
    await vault.forwardRegisterDepositTo(escrowAddr, newPending, 2, amountUsd6, ethers.parseEther("1"));
    // roll this batch
    await escrow.rollBatch(newPending);
    // For depositReturnForBatch, call with finalNavPerShare = 1e18 (no change)
    // Attempt depositReturnForBatch: it will try transferFrom caller -> fallback to mint since MockUSDC exposes mint()
    const ownerAddr = await owner.getAddress();
    await usdc.faucetMint(ownerAddr, amountUsd6); // approve not required because mint fallback will be used
    // depositReturnForBatch is restricted to keeper or owner; call as keeper (we set keeper earlier)
    await escrow.connect(keeper).depositReturnForBatch(newPending, ethers.parseEther("1"));

    // After depositReturn, closeBatch triggered and TestTreasury.reportBatchResult should have been called
    expect(await treasury.lastReportedBatch()).to.equal(newPending);

    // Distribute for closed batch (simulate: set some deposits and then call distributeBatch)
    // create pending, register deposit, roll, ensure escrow has funds and then depositReturnForBatch to close
    await escrow.createPendingBatch();
    const distrBatch = 3;
    await vault.forwardRegisterDepositTo(escrowAddr, distrBatch, 3, amountUsd6, ethers.parseEther("1"));
    await escrow.rollBatch(distrBatch);
    // provide USDC to escrow (TestTreasury won't be called here) - mint to escrow directly
    await usdc.mint(escrowAddr, amountUsd6);
    await escrow.connect(keeper).depositReturnForBatch(distrBatch, ethers.parseEther("1"));
    // closeBatch transfers funds to Treasury; to exercise Escrow.distributeBatch (test-only simulation)
    // replenish escrow so distributeBatch can pay investors from escrow balance
    await usdc.mint(escrowAddr, amountUsd6);

    // now distribute by passing tokenIds array (only tokenId 3 belongs to batch 3)
    // set deposit in vault for token 3 to map to user and amountUsd6
    await vault.setDeposit(3, userAddr, this.addrs.usdcAddr, 0, amountUsd6, ethers.parseEther("1"), 0, 0, false);
    await escrow.connect(keeper).distributeBatch(distrBatch, [3]);
    // confirm distributed flag
    const batch = await escrow.getBatch(distrBatch);
    expect(batch.status).to.equal(3); // BatchStatus.Distributed (enum index = 3)
  });

  it("InvestmentEscrow recovery & helpers: set/force invested, mark without transfer, public/admin burns", async function () {
    // create and roll a batch to Running
    // register a deposit into the current pending batch via Vault, then create a new pending and roll the target
    const escrowAddr = this.addrs.escrowAddr;
    const vaultAddr = this.addrs.vaultAddr;
    // create a fresh pending batch and parse the BatchCreated event to get the id (ethers v6 compatible)
    const txCreate = await escrow.createPendingBatch();
    const receiptCreate = await txCreate.wait();
    let newBatchId = undefined;
    for (const log of receiptCreate.logs) {
      try {
        const parsed = escrow.interface.parseLog(log);
        if (parsed.name === "BatchCreated") {
          newBatchId = Number(parsed.args[0].toString());
          break;
        }
      } catch {}
    }
    if (newBatchId === undefined) throw new Error("BatchCreated not found");
    // set deposit info and register into that explicit pending batch via vault forward helper
    const userAddr = await user.getAddress();
    await vault.setDeposit(4, userAddr, this.addrs.usdcAddr, 0, ethers.parseUnits("100", 6), ethers.parseEther("1"), 0, 0, false);
    await vault.forwardRegisterDepositTo(escrowAddr, newBatchId, 4, ethers.parseUnits("100", 6), ethers.parseEther("1"));
    await escrow.rollBatch(newBatchId);

    // test setBatchInvested and forceSetBatchInvested on the freshly-created/rolled batch
    await escrow.setBatchInvested(newBatchId);
    await escrow.forceSetBatchInvested(newBatchId);

    // create and roll another to test markBatchInvestedWithoutTransfer
    // create explicit pending batch for this flow and register into it
    const txCreateB5 = await escrow.createPendingBatch();
    const rB5 = await txCreateB5.wait();
    let batch5Id = undefined;
    for (const log of rB5.logs) {
      try {
        const parsed = escrow.interface.parseLog(log);
        if (parsed.name === "BatchCreated") {
          batch5Id = Number(parsed.args[0].toString());
          break;
        }
      } catch {}
    }
    if (batch5Id === undefined) throw new Error("BatchCreated (b5) not found");
    const userAddr2 = await user.getAddress();
    await vault.setDeposit(5, userAddr2, this.addrs.usdcAddr, 0, ethers.parseUnits("100", 6), ethers.parseEther("1"), 0, 0, false);
    await vault.forwardRegisterDepositTo(escrowAddr, batch5Id, 5, ethers.parseUnits("100", 6), ethers.parseEther("1"));
    await escrow.rollBatch(batch5Id);

    // mint USDC to escrow so balances are sufficient
    await usdc.mint(escrowAddr, ethers.parseUnits("100", 6));
    // allow keeper to mark invested without transfer
    await escrow.setAllowPublicMarkInvested(true);
    await escrow.connect(other).markBatchInvestedWithoutTransfer(batch5Id);
    // admin burn path: create/roll another batch and test adminBurnBatch
    // create explicit pending batch for admin burn test
    const txCreateB6 = await escrow.createPendingBatch();
    const rB6 = await txCreateB6.wait();
    let batch6Id = undefined;
    for (const log of rB6.logs) {
      try {
        const parsed = escrow.interface.parseLog(log);
        if (parsed.name === "BatchCreated") {
          batch6Id = Number(parsed.args[0].toString());
          break;
        }
      } catch {}
    }
    if (batch6Id === undefined) throw new Error("BatchCreated (b6) not found");
    const userAddr3 = await user.getAddress();
    await vault.setDeposit(6, userAddr3, this.addrs.usdcAddr, 0, ethers.parseUnits("50", 6), ethers.parseEther("1"), 0, 0, false);
    await vault.forwardRegisterDepositTo(escrowAddr, batch6Id, 6, ethers.parseUnits("50", 6), ethers.parseEther("1"));
    await escrow.rollBatch(batch6Id);
    // ensure escrow has USDC
    await usdc.mint(escrowAddr, ethers.parseUnits("50", 6));
    await escrow.connect(deployer).adminBurnBatch(batch6Id);
    // publicBurnBatch dev helper
    const txCreateB7 = await escrow.createPendingBatch();
    const rB7 = await txCreateB7.wait();
    let batch7Id = undefined;
    for (const log of rB7.logs) {
      try {
        const parsed = escrow.interface.parseLog(log);
        if (parsed.name === "BatchCreated") {
          batch7Id = Number(parsed.args[0].toString());
          break;
        }
      } catch {}
    }
    if (batch7Id === undefined) throw new Error("BatchCreated (b7) not found");
    const userAddr4 = await user.getAddress();
    await vault.setDeposit(7, userAddr4, this.addrs.usdcAddr, 0, ethers.parseUnits("10", 6), ethers.parseEther("1"), 0, 0, false);
    await vault.forwardRegisterDepositTo(escrowAddr, batch7Id, 7, ethers.parseUnits("10", 6), ethers.parseEther("1"));
    await escrow.rollBatch(batch7Id);
    await usdc.mint(escrowAddr, ethers.parseUnits("10", 6));
    await escrow.publicBurnBatch(batch7Id);
  });
});
