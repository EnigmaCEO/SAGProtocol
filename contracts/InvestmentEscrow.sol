// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Minimal Treasury interface used by Escrow
interface ITreasury {
    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external;
    // include finalNavPerShare so Treasury can compute per-receipt payouts
    function reportBatchResult(uint256 batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd, uint256 finalNavPerShare) external;
}

// Minimal Vault interface for depositInfo
interface IVault {
    function depositInfo(uint256 id) external view returns (
        address user,
        address asset,
        uint256 amount,
        uint256 amountUsd6,
        uint256 shares,
        uint64 createdAt,
        uint64 lockUntil,
        bool withdrawn
    );
}

contract InvestmentEscrow is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    ITreasury public treasury;

    // Authorities
    address public vault; // Vault contract registers deposits
    address public keeper; // keeper or owner may roll/close

    // Batching parameters
    uint256 public constant BATCH_INTERVAL = 7 days;
    uint256 public currentBatchId; // default pending batch id used by registerDeposit()
    uint256 public lastBatchRollTime;
    uint256 public nextBatchCounter; // for generating new batch ids

    // NOTE: appended Invested last to avoid changing numeric values of existing statuses
    enum BatchStatus { Pending, Running, Closed, Distributed, Invested }

    struct Batch {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 totalCollateralUsd; // USD value in 6 decimals
        uint256 totalShares;        // 1e18-based share units
        uint256 finalNavPerShare;   // 1e18-based NAV
        BatchStatus status;
        bool distributed;          // whether batch payouts were distributed to investors
    }

    mapping(uint256 => Batch) public batches;
    // tokenId (receipt) -> batchId
    mapping(uint256 => uint256) public receiptBatchId;

    // NEW event: created pending batch
    event BatchCreated(uint256 indexed batchId, uint256 createdAt);
    // Events
    event DepositRegistered(uint256 indexed tokenId, uint256 indexed batchId, uint256 amountUsd, uint256 shares);
    event BatchRolled(uint256 indexed batchId, uint256 amountUsd);
    event BatchClosed(uint256 indexed batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd, uint256 finalNavPerShare);
    // Emitted when returned USDC is deposited into escrow for a closed batch
    event BatchReturnDeposited(uint256 indexed batchId, uint256 amountUsd);
    // Emitted when escrow distributes returned USDC to investors (simulation)
    event BatchDistributed(uint256 indexed batchId, uint256 totalDistributedUsd);
    // NEW: event when a batch is invested (escrow USDC burned / invested)
    event BatchInvested(uint256 indexed batchId, uint256 burnedUsd);
    // NEW diagnostic event emitted immediately before attempting the USDC burn
    event PreInvestDiagnostics(uint256 indexed batchId, uint256 principalUsd, uint256 escrowUsdcBalance, address usdcToken);
    // NEW: admin-only emergency burn event
    event AdminBatchBurned(uint256 indexed batchId, uint256 burnedUsd, address executor);

    // NEW owner toggle to allow marking Invested without successfully burning USDC (test/dev convenience)
    bool public allowMarkInvestedWithoutBurn;
    event TransferFailedMarkedInvested(uint256 indexed batchId, uint256 principalUsd, string reason);

    function setAllowMarkInvestedWithoutBurn(bool v) external onlyOwner {
        allowMarkInvestedWithoutBurn = v;
    }

    // NEW owner toggle to allow public marking Invested without burn (test/dev convenience)
    bool public allowPublicMarkInvested;

    function setAllowPublicMarkInvested(bool v) external onlyOwner {
        allowPublicMarkInvested = v;
    }

    // Pass deploying account as initial owner to OpenZeppelin Ownable (compatible with current Ownable impl)
    constructor(address _usdc, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0) && _treasury != address(0), "zero address");
        usdc = IERC20(_usdc);
        treasury = ITreasury(_treasury);

        // Initialize first pending batch
        currentBatchId = 1;
        nextBatchCounter = 2;
        batches[currentBatchId] = Batch({
            id: currentBatchId,
            startTime: 0,
            endTime: 0,
            totalCollateralUsd: 0,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Pending,
            distributed: false
        });
        emit BatchCreated(currentBatchId, block.timestamp);
        lastBatchRollTime = block.timestamp;
    }

    // --- Admin setters ---
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "zero vault");
        vault = _vault;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    // --- Modifiers ---
    modifier onlyVaultOrTreasury() {
        require(msg.sender == vault || msg.sender == address(treasury), "Only vault or treasury");
        _;
    }

    modifier onlyKeeperOrOwner() {
        require(msg.sender == owner() || msg.sender == keeper, "Only keeper or owner");
        _;
    }

    // --- Deposit registration (called by Vault or Treasury when deposit is collateralized) ---
    function registerDeposit(uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        Batch storage b = batches[currentBatchId];
        require(b.status == BatchStatus.Pending, "Batch not pending");
        b.totalCollateralUsd += amountUsd6;
        b.totalShares += shares;
        receiptBatchId[tokenId] = currentBatchId;
        emit DepositRegistered(tokenId, currentBatchId, amountUsd6, shares);
    }

    /// @notice Register deposit into a specific pending batch (optional, Vault keeps using registerDeposit default)
    function registerDepositTo(uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        Batch storage b = batches[batchId];
        require(b.id == batchId, "Batch not found");
        require(b.status == BatchStatus.Pending, "Batch not pending");
        b.totalCollateralUsd += amountUsd6;
        b.totalShares += shares;
        receiptBatchId[tokenId] = batchId;
        emit DepositRegistered(tokenId, batchId, amountUsd6, shares);
    }

    /// @notice Create a new pending batch. Keeper/owner can create several pending batches concurrently.
    function createPendingBatch() external onlyKeeperOrOwner returns (uint256) {
        // Prevent creating another empty pending batch while the current default pending batch has zero deposits.
        // This avoids proliferation of batches with no collateral.
        require(batches[currentBatchId].totalCollateralUsd > 0, "Current pending batch has no deposits");

        uint256 id = nextBatchCounter++;
        batches[id] = Batch({
            id: id,
            startTime: 0,
            endTime: 0,
            totalCollateralUsd: 0,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Pending,
            distributed: false
        });
        emit BatchCreated(id, block.timestamp);
        return id;
    }

    /// @notice Set which pending batch is the default destination for registerDeposit()
    function setCurrentPendingBatch(uint256 batchId) external onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        require(batches[batchId].status == BatchStatus.Pending, "Batch not pending");
        currentBatchId = batchId;
    }

    // --- Weekly roll: move pending batch to running and request funds from Treasury ---
    /// @notice Roll the default current pending batch into Running and create a new default pending batch (backward-compatible)
    function rollToNewBatch() public onlyKeeperOrOwner {
        Batch storage cur = batches[currentBatchId];

        // If no collateral in current batch, just advance time (no-op)
        if (cur.totalCollateralUsd == 0) {
            lastBatchRollTime = block.timestamp;
            return;
        }

        // Activate current pending batch
        cur.status = BatchStatus.Running;
        cur.startTime = block.timestamp;

        uint256 amountUsd = cur.totalCollateralUsd;
        treasury.fundEscrowBatch(currentBatchId, amountUsd);
        emit BatchRolled(currentBatchId, amountUsd);

        // Create a new default pending batch and switch currentBatchId to it
        uint256 newId = nextBatchCounter++;
        batches[newId] = Batch({
            id: newId,
            startTime: 0,
            endTime: 0,
            totalCollateralUsd: 0,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Pending,
            distributed: false
        });
        emit BatchCreated(newId, block.timestamp);
        currentBatchId = newId;
        lastBatchRollTime = block.timestamp;
    }

    /// @notice Roll a specific pending batch (does not change current default pending batch)
    function rollBatch(uint256 batchId) external onlyKeeperOrOwner {
        Batch storage b = batches[batchId];
        require(b.id == batchId, "Batch not found");
        require(b.status == BatchStatus.Pending, "Batch not pending");
        require(b.totalCollateralUsd > 0, "Empty batch");

        b.status = BatchStatus.Running;
        b.startTime = block.timestamp;
        uint256 amountUsd = b.totalCollateralUsd;
        treasury.fundEscrowBatch(batchId, amountUsd);
        emit BatchRolled(batchId, amountUsd);
        lastBatchRollTime = block.timestamp;
    }

    // --- Close a running batch: compute P&L, transfer USDC back to Treasury, and report result ---
    // finalNavPerShare is 1e18-based (1e18 == no change)
    function closeBatch(uint256 batchId, uint256 finalNavPerShare) internal {
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Invested, "Batch not invested");

        b.status = BatchStatus.Closed;
        b.finalNavPerShare = finalNavPerShare;
        b.endTime = block.timestamp;

        uint256 principalUsd = b.totalCollateralUsd; // 6 decimals
        // finalValueUsd = principalUsd * nav / 1e18
        uint256 finalValueUsd = (principalUsd * finalNavPerShare) / 1e18;
        uint256 profitUsd = finalValueUsd > principalUsd ? finalValueUsd - principalUsd : 0;

        uint256 userProfitUsd = (profitUsd * 80) / 100; // 80%
        uint256 feeUsd = profitUsd - userProfitUsd;     // 20%

        uint256 totalReturnUsd = principalUsd + profitUsd;

        // Expect that investments returned funds to this contract prior to calling closeBatch.
        require(usdc.balanceOf(address(this)) >= totalReturnUsd, "Escrow lacks returned USDC");

        // Transfer all USDC back to Treasury
        usdc.safeTransfer(address(treasury), totalReturnUsd);

        // Notify Treasury about principal, userProfit, fee and final NAV so Treasury can pay users (protocol profit prioritized)
        treasury.reportBatchResult(batchId, principalUsd, userProfitUsd, feeUsd, finalNavPerShare);

        emit BatchClosed(batchId, principalUsd, userProfitUsd, feeUsd, finalNavPerShare);
    }

    /// @notice Deposit returned USDC into Escrow for a batch and set final NAV per share (keeper/owner).
    /// @dev Caller must approve USDC to this contract for transferFrom OR the USDC mock must expose mint() for local fallback.
    function depositReturnForBatch(uint256 batchId, uint256 finalNavPerShare) external onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Invested, "Batch not invested");

        // compute totalReturnUsd = principalUsd * finalNavPerShare / 1e18
        uint256 principalUsd = b.totalCollateralUsd;
        uint256 totalReturnUsd = (principalUsd * finalNavPerShare) / 1e18;
        require(totalReturnUsd > 0, "Invalid return amount");

        // Try transferFrom caller; caller should approve USDC to this contract
        bool transferred = false;
        try usdc.transferFrom(msg.sender, address(this), totalReturnUsd) returns (bool ok) {
            transferred = ok;
        } catch {
            transferred = false;
        }

        if (!transferred) {
            // Best-effort test-only fallback: try to mint to this contract if MockUSDC exposes mint()
            (bool okMint, ) = address(usdc).call(abi.encodeWithSignature("mint(address,uint256)", address(this), totalReturnUsd));
            require(okMint, "funding escrow failed");
        }

        emit BatchReturnDeposited(batchId, totalReturnUsd);

        // Instantly close batch and transfer funds to Treasury
        closeBatch(batchId, finalNavPerShare);
    }

    /// @notice Simulate distribution of returned USDC to investors for a closed batch.
    /// @param batchId id of the closed batch
    /// @param tokenIds list of receipt tokenIds to distribute for this batch (only those mapped to this batch will be paid)
    /// @dev Must be called by keeper/owner. Transfers USDC from escrow balance to receipt owners.
    function distributeBatch(uint256 batchId, uint256[] calldata tokenIds) external onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Closed, "Batch not closed");
        require(!b.distributed, "Already distributed");
        require(b.finalNavPerShare > 0, "finalNavPerShare not set");

        uint256 totalDistributed = 0;
        IVault vaultContract = IVault(vault);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tid = tokenIds[i];
            // only pay receipts that belong to this batch (best-effort check)
            if (receiptBatchId[tid] != batchId) continue;

            // read deposit info from Vault to obtain user and amountUsd6
            try vaultContract.depositInfo(tid) returns (
                address user,
                address /*asset*/,
                uint256 /*amount*/,
                uint256 amountUsd6,
                uint256 /*shares*/,
                uint64 /*createdAt*/,
                uint64 /*lockUntil*/,
                bool /*withdrawn*/
            ) {
                if (user == address(0)) continue;
                uint256 payoutUsd6 = (amountUsd6 * b.finalNavPerShare) / 1e18;
                if (payoutUsd6 == 0) continue;

                // Directly transfer USDC to the receipt owner (original behavior).
                // Best-effort: continue on individual transfer failures rather than revert entire loop.
                try usdc.transfer(user, payoutUsd6) {
                    totalDistributed += payoutUsd6;
                } catch {
                    // fallback: try a low-level ERC20 transfer call (does not use SafeERC20 internal wrapper)
                    // this avoids using `try` on an internal/library function and prevents a full revert on failure
                    (bool ok, ) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, user, payoutUsd6));
                    if (ok) {
                        totalDistributed += payoutUsd6;
                    } else {
                        // give up on this token and continue
                        continue;
                    }
                }
            } catch {
                // skip receipts that fail to read
                continue;
            }
        }

        b.distributed = true;
        b.status = BatchStatus.Distributed;
        emit BatchDistributed(batchId, totalDistributed);
    }

    // New: canonical invest action. Burns the escrow USDC for a Running batch and marks it Invested.
    function investBatch(uint256 batchId) public onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        require(!b.distributed, "Already distributed/invested");

        uint256 principalUsd = b.totalCollateralUsd;
        require(principalUsd > 0, "No collateral");

        uint256 escrowBal = usdc.balanceOf(address(this));
        require(escrowBal >= principalUsd, "Escrow lacks USDC to invest");

        // Emit pre-transfer diagnostics so off-chain logs show balances and token address
        emit PreInvestDiagnostics(batchId, principalUsd, escrowBal, address(usdc));

        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        // Low-level transfer call and robust return-data handling (supports tokens that return no data)
        (bool ok, bytes memory returnData) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, burnAddr, principalUsd));
        if (!ok) {
            // fallback: if owner enabled the test convenience, mark Invested despite transfer failure
            if (allowMarkInvestedWithoutBurn) {
                b.distributed = true;
                b.status = BatchStatus.Invested;
                emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer call reverted - marked Invested per owner flag");
                emit BatchInvested(batchId, principalUsd);
                return;
            }
            revert("USDC transfer call reverted");
        }
        // if returnData is non-empty, attempt to decode bool and ensure true
        if (returnData.length > 0) {
            // expect a single bool (32 bytes)
            if (returnData.length >= 32) {
                bool success = abi.decode(returnData, (bool));
                if (!success) {
                    if (allowMarkInvestedWithoutBurn) {
                        b.distributed = true;
                        b.status = BatchStatus.Invested;
                        emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer returned false - marked Invested per owner flag");
                        emit BatchInvested(batchId, principalUsd);
                        return;
                    }
                    revert("USDC transfer returned false");
                }
            } else {
                if (allowMarkInvestedWithoutBurn) {
                    b.distributed = true;
                    b.status = BatchStatus.Invested;
                    emit TransferFailedMarkedInvested(batchId, principalUsd, "unexpected return data - marked Invested per owner flag");
                    emit BatchInvested(batchId, principalUsd);
                    return;
                }
                revert("USDC transfer returned unexpected data");
            }
        }

        b.distributed = true;
        b.status = BatchStatus.Invested;
        emit BatchInvested(batchId, principalUsd);
    }

    /// @notice Public helper: if Escrow already holds the required USDC for a Running batch, anyone may call to mark Invested and burn.
    /// @dev This is a safe permissive fallback: it only succeeds when the contract already holds the exact funds (pre-funded).
    function investBatchIfFunded(uint256 batchId) external {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        require(!b.distributed, "Already distributed/invested");

        uint256 principalUsd = b.totalCollateralUsd;
        require(principalUsd > 0, "No collateral");

        uint256 escrowBal = usdc.balanceOf(address(this));
        require(escrowBal >= principalUsd, "Escrow lacks USDC to invest");

        emit PreInvestDiagnostics(batchId, principalUsd, escrowBal, address(usdc));

        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        (bool ok, bytes memory returnData) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, burnAddr, principalUsd));
        if (!ok) {
            if (allowMarkInvestedWithoutBurn) {
                b.distributed = true;
                b.status = BatchStatus.Invested;
                emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer call reverted - marked Invested per owner flag");
                emit BatchInvested(batchId, principalUsd);
                return;
            }
            revert("USDC transfer call reverted");
        }
        if (returnData.length > 0) {
            if (returnData.length >= 32) {
                bool success = abi.decode(returnData, (bool));
                if (!success) {
                    if (allowMarkInvestedWithoutBurn) {
                        b.distributed = true;
                        b.status = BatchStatus.Invested;
                        emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer returned false - marked Invested per owner flag");
                        emit BatchInvested(batchId, principalUsd);
                        return;
                    }
                    revert("USDC transfer returned false");
                }
            } else {
                if (allowMarkInvestedWithoutBurn) {
                    b.distributed = true;
                    b.status = BatchStatus.Invested;
                    emit TransferFailedMarkedInvested(batchId, principalUsd, "unexpected return data - marked Invested per owner flag");
                    emit BatchInvested(batchId, principalUsd);
                    return;
                }
                revert("USDC transfer returned unexpected data");
            }
        }

        b.distributed = true;
        b.status = BatchStatus.Invested;
        emit BatchInvested(batchId, principalUsd);
    }

    /// @notice Owner-only emergency: burn escrow USDC assigned to a running batch and mark Invested.
    /// @dev Useful for admin recovery/testing when token behaves unexpectedly.
    function adminBurnBatch(uint256 batchId) external onlyOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        require(!b.distributed, "Already distributed/invested");

        uint256 principalUsd = b.totalCollateralUsd;
        require(principalUsd > 0, "No collateral");
        uint256 escrowBal = usdc.balanceOf(address(this));
        require(escrowBal >= principalUsd, "Escrow lacks USDC to burn");

        emit PreInvestDiagnostics(batchId, principalUsd, escrowBal, address(usdc));

        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        (bool ok, bytes memory returnData) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, burnAddr, principalUsd));
        if (!ok) {
            // fallback: if owner enabled the test convenience, mark Invested despite transfer failure
            if (allowMarkInvestedWithoutBurn) {
                b.distributed = true;
                b.status = BatchStatus.Invested;
                emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer call reverted - marked Invested per owner flag");
                emit AdminBatchBurned(batchId, principalUsd, msg.sender);
                emit BatchInvested(batchId, principalUsd);
                return;
            }
            revert("USDC transfer call reverted (admin)");
        }
        if (returnData.length > 0) {
            bool success = abi.decode(returnData, (bool));
            if (!success) {
                if (allowMarkInvestedWithoutBurn) {
                    b.distributed = true;
                    b.status = BatchStatus.Invested;
                    emit TransferFailedMarkedInvested(batchId, principalUsd, "transfer returned false - marked Invested per owner flag");
                    emit AdminBatchBurned(batchId, principalUsd, msg.sender);
                    emit BatchInvested(batchId, principalUsd);
                    return;
                }
                revert("USDC transfer returned false (admin)");
            }
        }

        b.distributed = true;
        b.status = BatchStatus.Invested;
        emit AdminBatchBurned(batchId, principalUsd, msg.sender);
        emit BatchInvested(batchId, principalUsd);
    }

    // Keep a compatibility wrapper named distributeBatchBurn that routes to investBatch for Running batches
    function distributeBatchBurn(uint256 batchId) external onlyKeeperOrOwner {
        // If running -> invest (burn) using canonical function
        if (batches[batchId].id != batchId) revert("Batch not found");
        Batch storage b = batches[batchId];
        if (b.status == BatchStatus.Running) {
            investBatch(batchId);
            return;
        }
        // For other statuses instruct to use distributeBatch (payouts) or closeBatch flows
        revert("Use distributeBatch for closed payouts");
    }

    /// @notice Mark a running batch as Invested (keeps funds in Escrow / moves to investment state)
    /// @dev Only keeper or owner. Useful to acknowledge that Rolling/Investment step happened without closing.
    function setBatchInvested(uint256 batchId) external onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        b.status = BatchStatus.Invested;
        // emit a BatchDistributed event with zero payout to signal state change (frontend listens)
        emit BatchDistributed(batchId, 0);
    }

    /// @notice Owner-only emergency: force a batch into Invested state.
    /// @dev Use only for migration/admin recovery. This bypasses status checks.
    function forceSetBatchInvested(uint256 batchId) external onlyOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        b.status = BatchStatus.Invested;
        emit BatchDistributed(batchId, 0);
    }

    /// @notice Mark a running batch Invested without performing the USDC transfer/burn.
    /// @dev Allowed when Escrow already holds the required USDC. Caller must be owner/keeper OR allowPublicMarkInvested must be true.
    function markBatchInvestedWithoutTransfer(uint256 batchId) external {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        require(!b.distributed, "Already distributed/invested");

        uint256 principalUsd = b.totalCollateralUsd;
        require(principalUsd > 0, "No collateral");

        uint256 escrowBal = usdc.balanceOf(address(this));
        require(escrowBal >= principalUsd, "Escrow lacks USDC to invest");

        // authorize: keeper/owner OR owner-enabled public path
        if (!(msg.sender == owner() || msg.sender == keeper || allowPublicMarkInvested)) {
            revert("Not authorized to mark invested without transfer");
        }

        // Mark Invested (accounting-only, no token movement)
        b.distributed = true;
        b.status = BatchStatus.Invested;

        emit TransferFailedMarkedInvested(batchId, principalUsd, "Marked Invested without token transfer");
        emit BatchInvested(batchId, principalUsd);
    }

    /// @notice Dev: public helper to burn Escrow USDC for a Running batch (NO AUTH). Test/dev only.
    /// @dev Use only on local/test networks. Checks that Escrow already holds required USDC.
    function publicBurnBatch(uint256 batchId) external {
        require(batches[batchId].id == batchId, "Batch not found");
        Batch storage b = batches[batchId];
        require(b.status == BatchStatus.Running, "Batch not running");
        require(!b.distributed, "Already distributed/invested");

        uint256 principalUsd = b.totalCollateralUsd;
        require(principalUsd > 0, "No collateral");

        uint256 escrowBal = usdc.balanceOf(address(this));
        require(escrowBal >= principalUsd, "Escrow lacks USDC to burn");

        emit PreInvestDiagnostics(batchId, principalUsd, escrowBal, address(usdc));

        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        (bool ok, bytes memory returnData) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, burnAddr, principalUsd));
        if (!ok) {
            revert("publicBurnBatch: USDC transfer call reverted");
        }
        if (returnData.length > 0) {
            if (returnData.length >= 32) {
                bool success = abi.decode(returnData, (bool));
                require(success, "publicBurnBatch: USDC transfer returned false");
            } else {
                revert("publicBurnBatch: USDC transfer returned unexpected data");
            }
        }

        b.distributed = true;
        b.status = BatchStatus.Invested;
        emit BatchInvested(batchId, principalUsd);
    }

    // --- Helpers for view (optional) ---
    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }
}
