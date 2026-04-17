// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Replace previous IPriceOracle interface that expected 1e18 getters
interface IPriceOracle {
    // Use existing MockOracle.getPrice() which returns price in USD with 8 decimals
    function getPrice() external view returns (uint256); // 8-decimals (e.g. 700000000 => $7.00)
}

interface IGoldOracleLegacy {
    function getGoldPrice() external view returns (uint256); // 6-decimals
}

interface IOracleLatest {
    function latest() external view returns (uint256 price8, uint256 updatedAt, bool valid);
}

interface IOracleUpdatedAt {
    function updatedAt() external view returns (uint256);
}

interface IOracleValidity {
    function valid() external view returns (bool);
}

interface IReserveValuation {
    function navReserveUsd() external view returns (uint256);
}

/// Add the AMM interface at file scope (interfaces cannot be declared inside a contract)
interface IAMMPair {
    function swapExactTokensForTokens(
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        address to
    ) external returns (uint256 amountOut);

    function getReserves() external view returns (uint256, uint256);
}

// Minimal Vault interface used by Treasury to compute payouts & instruct Vault to finalize (burn NFT + send to owner)
interface IVaultForTreasury {
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
    function finalizePayout(uint256 tokenId, uint256 payoutUsd6) external;
    function receiptNFT() external view returns (address);
}

interface IReceiptNFTForTreasury {
    function ownerOf(uint256 tokenId) external view returns (address);
}

// NEW: Minimal Escrow interface so Treasury can validate which batch a receipt belongs to (best-effort)
interface IEscrowForTreasury {
    struct RouteAllocation {
        uint256 routeId;
        uint256 maxAllocationUsd6;
    }

    function receiptBatchId(uint256 tokenId) external view returns (uint256);
    function currentBatchId() external view returns (uint256);
    function lastBatchRollTime() external view returns (uint256);
    function BATCH_INTERVAL() external view returns (uint256);
    function rollToNewBatch() external;
    function authorizeBatchExecution(
        uint256 batchId,
        uint256 expectedCloseTime,
        bytes32 settlementUnit,
        RouteAllocation[] calldata routeAllocations
    ) external;
    function freezeBatch(uint256 batchId, bool frozen) external;
    function batches(uint256 batchId) external view returns (
        uint256 id,
        uint256 startTime,
        uint256 endTime,
        uint256 totalCollateralUsd,
        uint256 totalShares,
        uint256 finalNavPerShare,
        uint8 status,
        bool distributed
    );
}

/**
 * @title Treasury
 * @notice Central accounting and risk-management contract for the Sagitta protocol.
 * @dev Responsibilities:
 *   - Tracks collateral (totalCollateralUsd) against depositor liabilities.
 *   - Runs a stress-state machine (Healthy → Degraded → RecapOnly → Emergency) driven by
 *     on-chain metrics: backing coverage, reserve support, liquidity runway, and stablecoin depeg.
 *   - Funds escrow batches (fundEscrowBatch) and receives batch results (reportBatchResult).
 *   - Distributes user profit pro-rata by shares when batch results include a token list.
 *   - Rebalances the USDC:GOLD reserve ratio toward a 2:1 target via _rebalanceReserve().
 *
 *   SECURITY — allowAutoMintCollateralize:
 *     Defaults to false. When true, the Treasury mints additional USDC from the token contract
 *     to cover a collateralization shortfall. This MUST be false on mainnet — it is a dev/test
 *     escape hatch that bypasses the solvency requirement. Set and verify before deployment.
 *
 *   SECURITY — ORACLE FRESHNESS:
 *     MAX_ORACLE_AGE = 1 day. If any oracle goes stale the stress state escalates to Emergency,
 *     blocking new policy actions. Ensure the GoldOracle updatedAt is refreshed at least daily.
 *
 *   SECURITY — RECOVERY DELAYS:
 *     Downgrade is instant; recovery requires a sustained period (RECOVERY_DELAY = 1 day for
 *     Degraded/RecapOnly, EMERGENCY_RECOVERY_DELAY = 3 days for Emergency). This prevents
 *     a flash-loan from temporarily improving metrics to unblock policy actions.
 */
contract Treasury is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_SCALE = 10_000;
    uint256 public constant PRICE_SCALE = 1e8;
    uint256 public constant USD6_SCALE = 1e6;

    uint256 public constant FLAG_COVERAGE = 1;
    uint256 public constant FLAG_RESERVE = 2;
    uint256 public constant FLAG_LIQUIDITY = 4;
    uint256 public constant FLAG_DEPEG = 8;
    uint256 public constant FLAG_ORACLE = 16;

    uint256 public constant STABLE_ASSET_HAIRCUT_BPS = 9_950;
    uint256 public constant RESERVE_ASSET_HAIRCUT_BPS = 9_000;

    uint256 public constant DEGRADED_COVERAGE_MIN_BPS = 10_300;
    uint256 public constant DEGRADED_RESERVE_MIN_BPS = 4_000;
    uint256 public constant DEGRADED_LIQUIDITY_MIN_BPS = 11_000;
    uint256 public constant DEGRADED_DEPEG_MAX_BPS = 100;

    uint256 public constant RECAP_COVERAGE_MIN_BPS = 10_000;
    uint256 public constant RECAP_RESERVE_MIN_BPS = 3_500;
    uint256 public constant RECAP_LIQUIDITY_MIN_BPS = 10_000;
    uint256 public constant RECAP_DEPEG_MAX_BPS = 200;

    uint256 public constant EMERGENCY_COVERAGE_MIN_BPS = 9_500;
    uint256 public constant EMERGENCY_RESERVE_MIN_BPS = 2_500;
    uint256 public constant EMERGENCY_LIQUIDITY_MIN_BPS = 8_000;
    uint256 public constant EMERGENCY_DEPEG_MAX_BPS = 500;

    uint256 public constant RECOVERY_DELAY = 1 days;
    uint256 public constant EMERGENCY_RECOVERY_DELAY = 3 days;
    uint256 public constant MAX_ORACLE_AGE = 1 days;

    enum StressState {
        Healthy,
        Degraded,
        RecapOnly,
        Emergency
    }

    enum PolicyCategory {
        Liquidity,
        Incentives,
        Recapitalization,
        BuybackBurn,
        IdleBurn
    }

    /*
     * Canonical stress-metric definitions:
     * - safeBackingUsd: post-haircut value of assets permitted to back obligations.
     * - treasuryUsd: marked value of Treasury-controlled non-reserve assets.
     * - reserveUsd: marked value of reserve assets under the unified reserve definition.
     * - liabilitiesUsd: all outstanding Treasury-side dollar liabilities that matter to coverage.
     * - immediateObligationsUsd: obligations callable inside the current execution horizon.
     * - liquidStableUsd: stable assets actually usable now, not merely accounted for.
     *
     * Contract philosophy:
     * - Math tells the truth.
     * - State interprets the truth.
     * - Policy obeys the state.
     * - Admins do not override the machine.
     */
    struct StressMetrics {
        uint256 safeBackingUsd;
        uint256 liabilitiesUsd;
        uint256 treasuryUsd;
        uint256 reserveUsd;
        uint256 liquidStableUsd;
        uint256 immediateObligationsUsd;
        uint256 backingCoverageBps;
        uint256 reserveSupportBps;
        uint256 liquidityRunwayBps;
        uint256 stableDepegBps;
        uint256 primaryStablePrice8;
        uint256 secondaryStablePrice8;
        uint256 goldPrice8;
        uint256 primaryStableUpdatedAt;
        uint256 secondaryStableUpdatedAt;
        uint256 goldOracleUpdatedAt;
        bool oracleFresh;
    }

    error PolicyCategoryNotAllowed(PolicyCategory category, StressState state, uint256 flags);

    // AMM pair address (retained for compatibility with existing tooling)
    address public ammPair;

    IERC20 public immutable usdc;
    IERC20 public immutable gold;

    address public reserveAddress;
    address public vault;
    // Primary stable oracle used for depeg detection. Existing name retained for ABI compatibility.
    IPriceOracle public priceOracle;
    address public secondaryStableOracle;

    // Per-asset oracle for reserve valuation
    IPriceOracle public goldOracle;

    StressState public stressState;
    uint256 public stressStateSince;
    uint256 public degradedRecoveryWindowStartedAt;
    uint256 public recapOnlyRecoveryWindowStartedAt;
    uint256 public emergencyRecoveryWindowStartedAt;

    uint256 public totalCollateralUsd;

    // ------------------ NEW STATE ------------------
    // Escrow contract address (set by owner)
    address public escrow;
    // protocol-level profit accrued (USD with 6 decimals)
    uint256 public protocolProfitUsd;
    // per-batch user profit record (optional)
    mapping(uint256 => uint256) public batchProfitUsd;
    // per-batch stored final NAV (1e18)
    mapping(uint256 => uint256) public batchFinalNavPerShare;
    mapping(uint256 => bytes32) public batchSettlementReportHash;
    mapping(uint256 => bytes32) public batchComplianceDigestHash;
    // per-batch, per-receipt cumulative profit already paid (USD6)
    mapping(uint256 => mapping(uint256 => uint256)) public receiptBatchProfitPaidUsd;
    // Track processed deposit/receipt IDs to make collateralizeForReceipt idempotent
    mapping(uint256 => bool) public processedReceipts;
    // ------------------ END NEW STATE ------------------

    // SECURITY: dev/test escape hatch — allows Treasury to self-mint USDC to cover
    // collateralization shortfalls. MUST be false on mainnet. Verify before deployment.
    bool public allowAutoMintCollateralize;

    // NEW: slippage tolerance for AMM swaps (basis points). Default 50 = 0.5%.
    uint16 public slippageBps = 50;
    event SlippageBpsUpdated(uint16 bps);
    event SecondaryStableOracleSet(address indexed oracle);
    event StressStateTransition(
        StressState indexed previousState,
        StressState indexed nextState,
        uint256 flags,
        uint256 effectiveAt,
        uint256 degradedRecoveryWindowStartedAt,
        uint256 recapOnlyRecoveryWindowStartedAt,
        uint256 emergencyRecoveryWindowStartedAt
    );
    event StressRecoveryWindowsUpdated(
        StressState indexed currentState,
        uint256 flags,
        uint256 degradedRecoveryWindowStartedAt,
        uint256 recapOnlyRecoveryWindowStartedAt,
        uint256 emergencyRecoveryWindowStartedAt
    );

    function setSlippageBps(uint16 bps) external onlyOwner {
        require(bps <= 1000, "slippage too large"); // max 10%
        slippageBps = bps;
        emit SlippageBpsUpdated(bps);
    }

    // EVENTS
    event Collateralized(uint256 amountUsd);
    event CollateralizeAttempt(uint256 requestedUsd, uint256 usdcBefore, uint256 usdcNeeded);
    event CollateralizeSucceeded(uint256 requestedUsd, uint256 usdcAfter);
    // Diagnostic: indicates we auto-minted USDC to cover a shortfall in test environments
    event CollateralizeMintFallback(uint256 mintedUsd);

    event Rebalanced(uint256 treasuryUsd, uint256 reserveUsd);
    event GoldBought(uint256 usdAmount);
    event GoldSold(uint256 usdAmount);

    // NEW EVENTS
    event BatchFunded(uint256 indexed batchId, uint256 amountUsd);
    event BatchResult(uint256 indexed batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd);
    event BatchResultExtended(
        uint256 indexed batchId,
        bytes32 settlementReportHash,
        bytes32 complianceDigestHash
    );
    event ReceiptProfitPaid(uint256 indexed receiptId, address indexed recipient, uint256 amountUsd);
    event ReceiptProfitPaidDetailed(
        uint256 indexed batchId,
        uint256 indexed receiptId,
        address indexed recipient,
        uint256 amountUsd,
        uint256 paidTotalUsd,
        uint256 dueTotalUsd
    );
    event RollProcessed(
        bool batchDue,
        bool rebalanceDue,
        bool batchRolled,
        bool reserveRebalanced
    );

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    // Allow owner OR vault to invoke certain helper entrypoints (dev/admin convenience)
    modifier onlyVaultOrOwner() {
        require(msg.sender == vault || msg.sender == owner(), "Only vault or owner");
        _;
    }

    // NEW modifier: only calls originating from the Escrow contract
    modifier onlyEscrow() {
        require(msg.sender == escrow, "Only escrow");
        _;
    }

    constructor(
        IERC20 _usdc,
        IERC20 _gold,
        address _reserveAddress,
        address _vault,
        IPriceOracle _priceOracle
    ) Ownable(msg.sender) {
        usdc = _usdc;
        gold = _gold;
        reserveAddress = _reserveAddress;
        vault = _vault;
        priceOracle = _priceOracle;
        stressState = StressState.Healthy;
        stressStateSince = block.timestamp;
    }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Vault address cannot be zero");
        vault = _vault;
    }

    function setReserveAddress(address _reserve) external onlyOwner {
        require(_reserve != address(0), "Reserve address cannot be zero");
        reserveAddress = _reserve;
    }

    function setPriceOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Oracle address cannot be zero");
        priceOracle = IPriceOracle(_oracle);
    }

    function setSecondaryStableOracle(address _oracle) external onlyOwner {
        secondaryStableOracle = _oracle;
        emit SecondaryStableOracleSet(_oracle);
    }

    function setGoldOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Oracle address cannot be zero");
        goldOracle = IPriceOracle(_oracle);
    }

    /// @notice Set the AMM pair contract address (owner)
    function setAmmPair(address _pair) external onlyOwner {
        ammPair = _pair;
    }

    // NEW: register escrow contract
    function setEscrow(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Escrow cannot be zero");
        escrow = _escrow;
    }

    function authorizeEscrowBatch(
        uint256 batchId,
        uint256 expectedCloseTime,
        bytes32 settlementUnit,
        IEscrowForTreasury.RouteAllocation[] calldata routeAllocations
    ) external onlyOwner {
        require(escrow != address(0), "escrow not set");
        IEscrowForTreasury(escrow).authorizeBatchExecution(batchId, expectedCloseTime, settlementUnit, routeAllocations);
    }

    function freezeEscrowBatch(uint256 batchId, bool frozen) external onlyOwner {
        require(escrow != address(0), "escrow not set");
        IEscrowForTreasury(escrow).freezeBatch(batchId, frozen);
    }

    /// @notice Toggle the dev/test USDC auto-mint fallback. MUST remain false on mainnet.
    function setAllowAutoMintCollateralize(bool v) external onlyOwner {
        allowAutoMintCollateralize = v;
    }

    // --- View functions ---

    /// @notice Marked value of Treasury-controlled non-reserve assets.
    /// @dev Current implementation only models immediately-usable USDC, so treasuryUsd == liquidStableUsd.
    function getTreasuryValueUsd() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice Marked value of reserve assets under the unified reserve definition.
    /// @dev Prefers ReserveController.navReserveUsd() and only falls back to direct gold valuation if unavailable.
    function getReserveValueUsd() public view returns (uint256) {
        if (reserveAddress == address(0)) {
            return 0;
        }

        try IReserveValuation(reserveAddress).navReserveUsd() returns (uint256 reserveUsd6) {
            return reserveUsd6;
        } catch {}

        uint256 goldBal = gold.balanceOf(reserveAddress); // 18 decimals
        (uint256 goldPrice8,, bool isValid) = _readOraclePrice8(address(goldOracle), true);
        if (!isValid || goldPrice8 == 0) {
            return 0;
        }
        return (goldBal * goldPrice8) / 1e20;
    }

    function getGrossBackingUsd() public view returns (uint256) {
        return getTreasuryValueUsd() + getReserveValueUsd();
    }

    /// @notice Post-haircut value of assets permitted to back obligations.
    function getSafeBackingUsd() public view returns (uint256) {
        uint256 treasurySafeUsd = _applyHaircut(getTreasuryValueUsd(), STABLE_ASSET_HAIRCUT_BPS);
        uint256 reserveSafeUsd = _applyHaircut(getReserveValueUsd(), RESERVE_ASSET_HAIRCUT_BPS);
        return treasurySafeUsd + reserveSafeUsd;
    }

    /// @notice All outstanding Treasury-side dollar liabilities that matter to coverage.
    function getLiabilitiesUsd() public view returns (uint256) {
        return totalCollateralUsd;
    }

    /// @notice Obligations callable inside the current execution horizon.
    /// @dev Conservative by design until the protocol distinguishes maturities on-chain.
    function getImmediateObligationsUsd() public view returns (uint256) {
        return totalCollateralUsd;
    }

    /// @notice Stable assets actually usable now, not merely accounted for.
    function getLiquidStableUsd() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function getRecoveryWindows()
        external
        view
        returns (
            uint256 degradedStartedAt,
            uint256 recapOnlyStartedAt,
            uint256 emergencyStartedAt
        )
    {
        return (
            degradedRecoveryWindowStartedAt,
            recapOnlyRecoveryWindowStartedAt,
            emergencyRecoveryWindowStartedAt
        );
    }

    function getTargetReserveUsd() public view returns (uint256) {
        return getTreasuryValueUsd() / 2;
    }

    function getCoverageRatio(uint256 totalDepositsUsd) public view returns (uint256) {
        uint256 treasuryUsd = getTreasuryValueUsd();
        uint256 reserveUsd = getReserveValueUsd();
        if (totalDepositsUsd == 0) return 0;
        return (treasuryUsd + reserveUsd) * 1e18 / totalDepositsUsd;
    }

    function canAdmit(uint256 amountUsd6) external view returns (bool) {
        // Example logic: admit if Treasury Value >= amountUsd6
        return getTreasuryValueUsd() >= amountUsd6;
    }

    function getStressMetrics() external view returns (StressMetrics memory) {
        return _computeStressMetrics();
    }

    function getStressState() public view returns (StressState state, uint256 flags) {
        StressMetrics memory metrics = _computeStressMetrics();
        uint256 ignored1;
        uint256 ignored2;
        uint256 ignored3;
        (state, flags, ignored1, ignored2, ignored3) = _previewStressState(metrics);
    }

    function isPolicyCategoryAllowed(PolicyCategory category)
        external
        view
        returns (bool allowed, StressState state, uint256 flags)
    {
        (state, flags) = getStressState();
        allowed = _isCategoryAllowed(category, state);
    }

    function refreshStressState() external returns (StressState state, uint256 flags) {
        return _syncStressState();
    }

    /// @notice Returns whether Treasury has any due roll actions.
    /// @dev batchDue: Escrow weekly batch roll; rebalanceDue: reserve ratio drift.
    function canRoll() public view returns (bool batchDue, bool rebalanceDue, bool anyDue) {
        batchDue = _isBatchRollDue();
        rebalanceDue = _isReserveRebalanceDue();
        anyDue = batchDue || rebalanceDue;
    }

    // --- Collateralization ---

    function collateralize(uint256 depositValueUsd) external onlyVault {
        _doCollateralize(depositValueUsd);
    }

    /**
     * @notice Collateralize a specific deposit/receipt id (idempotent).
     * @dev Callable by the Vault (normal flow) or by the owner (manual recovery). Multiple calls
     *      for the same receiptId are safe — subsequent calls return without double-counting.
     * @param receiptId   The Vault receipt (deposit) token ID.
     * @param depositValueUsd  Deposit value in USD with 6 decimals.
     */
    function collateralizeForReceipt(uint256 receiptId, uint256 depositValueUsd) external onlyVaultOrOwner {
        // If already processed, do nothing (idempotent)
        if (processedReceipts[receiptId]) {
            return;
        }
        // attempt to collateralize (will revert on fatal errors)
        _doCollateralize(depositValueUsd);
        // mark processed to avoid duplicate accounting
        processedReceipts[receiptId] = true;
        // emit a lightweight event for observability (Collateralized is emitted inside _doCollateralize)
        // but keep explicit trace linking to receiptId using an indexed event via CollateralizeAttempt/Collateralized logs
    }

    /// @notice Owner-only helper to run collateralization for an amount (useful for admins/keepers)
    function adminCollateralize(uint256 depositValueUsd) external onlyOwner {
        _doCollateralize(depositValueUsd);
    }

    /// @dev shared implementation used by vault and admin entrypoints
    function _doCollateralize(uint256 depositValueUsd) internal {
        uint256 usdcBal = usdc.balanceOf(address(this));
        emit CollateralizeAttempt(depositValueUsd, usdcBal, depositValueUsd);

        // USDC-only collateralization path.
        if (usdcBal < depositValueUsd) {
            uint256 shortfall = depositValueUsd - usdcBal;
            if (allowAutoMintCollateralize) {
                (bool minted, ) = address(usdc).call(
                    abi.encodeWithSignature("mint(address,uint256)", address(this), shortfall)
                );
                if (minted) {
                    emit CollateralizeMintFallback(shortfall);
                    usdcBal = usdc.balanceOf(address(this));
                }
            }
            require(usdcBal >= depositValueUsd, "Not enough USDC for collateralization");
        }
        emit CollateralizeSucceeded(depositValueUsd, usdcBal);

        // Record collateral (single accounting spot to avoid double-counting in collateralizeForReceipt fast-path)
        totalCollateralUsd += depositValueUsd;
        emit Collateralized(depositValueUsd);
    }

    // Legacy swap helpers removed in testnet USDC-only mode.

    // --- Reserve Rebalancing ---

    function rebalanceReserve() external {
        _rebalanceReserve();
    }

    /// @notice Keeper-style roll executor. Runs due Treasury actions and skips non-due ones.
    /// @dev Non-reverting by design: failed branches are swallowed and reported in event output.
    function rollIfDue() external returns (bool batchRolled, bool reserveRebalanced) {
        (bool batchDue, bool rebalanceDue, ) = canRoll();

        if (batchDue && escrow != address(0)) {
            try IEscrowForTreasury(escrow).rollToNewBatch() {
                batchRolled = true;
            } catch {
                batchRolled = false;
            }
        }

        if (rebalanceDue) {
            try this.rebalanceReserve() {
                reserveRebalanced = true;
            } catch {
                reserveRebalanced = false;
            }
        }

        emit RollProcessed(batchDue, rebalanceDue, batchRolled, reserveRebalanced);
    }

    function _rebalanceReserve() internal {
        require(address(goldOracle) != address(0), "goldOracle not set");
        uint256 treasuryUsdc6 = usdc.balanceOf(address(this)); // 6 decimals
        uint256 goldBal = gold.balanceOf(reserveAddress); // 18 decimals
        uint256 goldPrice8 = _requireGoldPrice8();
        uint256 goldValueUsd6 = (goldBal * goldPrice8) / (10 ** 20);

        // Target TreasuryUSDC:GOLD ratio is 2:1.
        uint256 ratio = goldValueUsd6 == 0 ? type(uint256).max : (treasuryUsdc6 * 1e6) / goldValueUsd6; // scaled by 1e6

        uint256 targetRatio = 2 * 1e6; // 2.00 scaled by 1e6
        uint256 lower = targetRatio * 195 / 200; // 1.95
        uint256 upper = targetRatio * 205 / 200; // 2.05

        if (ratio > upper) {
            // Too much Treasury USDC, need more GOLD: buy GOLD.
            uint256 desiredGoldValueUsd6 = treasuryUsdc6 / 2;
            uint256 goldToBuyUsd = desiredGoldValueUsd6 > goldValueUsd6 ? desiredGoldValueUsd6 - goldValueUsd6 : 0;
            if (goldToBuyUsd > 0) {
                _buyGoldWithUsdc(goldToBuyUsd);
            }
        } else if (ratio < lower) {
            // Too much GOLD, need less GOLD: sell GOLD.
            uint256 desiredGoldValueUsd6 = treasuryUsdc6 / 2;
            uint256 goldToSellUsd = goldValueUsd6 > desiredGoldValueUsd6 ? goldValueUsd6 - desiredGoldValueUsd6 : 0;
            if (goldToSellUsd > 0) {
                _sellGoldForUsdc(goldToSellUsd);
            }
        }
        emit Rebalanced(treasuryUsdc6, goldValueUsd6);
    }

    function _isBatchRollDue() internal view returns (bool) {
        if (escrow == address(0)) return false;
        IEscrowForTreasury escrowContract = IEscrowForTreasury(escrow);

        uint256 lastRoll;
        try escrowContract.lastBatchRollTime() returns (uint256 t) {
            lastRoll = t;
        } catch {
            return false;
        }

        uint256 interval = 7 days;
        try escrowContract.BATCH_INTERVAL() returns (uint256 configured) {
            if (configured > 0) interval = configured;
        } catch {
            // keep default
        }
        if (block.timestamp < lastRoll + interval) return false;

        // Best-effort: only signal batch roll due if the default pending batch has collateral.
        uint256 pendingBatchId;
        try escrowContract.currentBatchId() returns (uint256 id) {
            pendingBatchId = id;
        } catch {
            return true;
        }

        try escrowContract.batches(pendingBatchId) returns (
            uint256 /*id*/,
            uint256 /*startTime*/,
            uint256 /*endTime*/,
            uint256 pendingCollateralUsd,
            uint256 /*totalShares*/,
            uint256 /*finalNavPerShare*/,
            uint8 status,
            bool /*distributed*/
        ) {
            // BatchStatus.Pending == 0
            return status == 0 && pendingCollateralUsd > 0;
        } catch {
            return true;
        }
    }

    function _isReserveRebalanceDue() internal view returns (bool) {
        if (address(goldOracle) == address(0)) return false;
        (uint256 goldPrice8,, bool isValid) = _readOraclePrice8(address(goldOracle), true);
        if (!isValid || goldPrice8 == 0) return false;

        uint256 treasuryUsdc6 = usdc.balanceOf(address(this));
        uint256 reserveUsd6 = getReserveValueUsd();
        if (reserveUsd6 == 0) return treasuryUsdc6 > 0;

        uint256 ratio = (treasuryUsdc6 * 1e6) / reserveUsd6; // scaled by 1e6
        uint256 targetRatio = 2 * 1e6; // 2.00 scaled by 1e6
        uint256 lower = targetRatio * 195 / 200; // 1.95
        uint256 upper = targetRatio * 205 / 200; // 2.05
        return ratio > upper || ratio < lower;
    }

    // --- Internal book-keeping for MVP ---

    /**
     * @dev MVP simulation of a USDC → GOLD swap for reserve rebalancing.
     *      Transfers the equivalent GOLD amount from the Treasury balance to the ReserveController,
     *      and burns (sends to 0xdead) the corresponding USDC.
     *
     *      PRODUCTION NOTE: Replace this function with a real AMM swap (e.g. via ammPair) or a
     *      custodian bridge before mainnet deployment. Burning USDC to 0xdead is irreversible.
     *
     * @param usdAmount USDC amount in 6 decimals to spend on GOLD.
     */
    function _buyGoldWithUsdc(uint256 usdAmount) internal {
        uint256 usdcBal = usdc.balanceOf(address(this));
        require(usdcBal >= usdAmount, "Not enough USDC");

        uint256 goldPrice = _requireGoldPrice8();
        // token wei conversion (USD6 -> token wei): goldWei = usd6 * 1e20 / price8
        uint256 goldAmount = (usdAmount * (10 ** 20)) / goldPrice;
        // Transfer gold to reserve
        require(gold.transfer(reserveAddress, goldAmount), "Gold transfer failed");
        // Simulate USDC outflow by sending to dead address (MVP — replace with real swap in prod)
        require(usdc.transfer(address(0xdead), usdAmount), "USDC transfer failed");
        emit GoldBought(usdAmount);
    }

    function _sellGoldForUsdc(uint256 usdAmount) internal {
        uint256 goldPrice = _requireGoldPrice8();
        uint256 goldAmount = (usdAmount * (10 ** 20)) / goldPrice;
        require(gold.balanceOf(reserveAddress) >= goldAmount, "Not enough GOLD at reserve");
        // For MVP: pull GOLD from reserve back to treasury and emit event.
        // In a more advanced flow you may swap GOLD->USDC via AMM; keep existing transfer logic here.
        require(gold.transferFrom(reserveAddress, address(this), goldAmount), "Gold transferFrom failed");
        emit GoldSold(usdAmount);
    }

    // NEW: fund an escrow batch (called by Escrow contract)
    // Transfers USDC from Treasury to msg.sender (the escrow contract)
    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external onlyEscrow {
        require(usdc.balanceOf(address(this)) >= amountUsd, "Not enough USDC");
        // Transfer USDC to escrow (msg.sender)
        usdc.safeTransfer(msg.sender, amountUsd);
        emit BatchFunded(batchId, amountUsd);
    }

    function reportBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare
    ) external onlyEscrow {
        _recordBatchResult(batchId, principalUsd, userProfitUsd, feeUsd, finalNavPerShare, bytes32(0), bytes32(0));
    }

    function reportBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare,
        bytes32 settlementReportHash,
        bytes32 complianceDigestHash
    ) external onlyEscrow {
        _recordBatchResult(
            batchId,
            principalUsd,
            userProfitUsd,
            feeUsd,
            finalNavPerShare,
            settlementReportHash,
            complianceDigestHash
        );
    }

    // Overloaded: reportBatchResult + immediate distribution to Vault per-token (by share).
    // Called by Escrow when it knows the list of receipts (tokenIds) that belong to this batch.
    function reportBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare,
        uint256[] calldata tokenIds
    ) external onlyEscrow {
        _recordBatchResult(batchId, principalUsd, userProfitUsd, feeUsd, finalNavPerShare, bytes32(0), bytes32(0));

        // If there's no user profit or no receipts, nothing to distribute
        if (userProfitUsd == 0 || tokenIds.length == 0) {
            return;
        }

        IVaultForTreasury vaultContract = IVaultForTreasury(vault);
        IEscrowForTreasury escrowContract = IEscrowForTreasury(escrow);

        // 1) Sum total shares for provided receipts that belong to this batch.
        uint256 totalShares = 0;
        uint256 n = tokenIds.length;
        uint256[] memory shares = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            uint256 tid = tokenIds[i];
            // Best-effort: skip receipts that don't map to this batch (protects callers passing mixed lists)
            bool belongs = true;
            try escrowContract.receiptBatchId(tid) returns (uint256 bid) {
                if (bid != batchId) belongs = false;
            } catch {
                belongs = false;
            }
            if (!belongs) {
                shares[i] = 0;
                continue;
            }

            try vaultContract.depositInfo(tid) returns (
                address /*user*/,
                address /*asset*/,
                uint256 /*amount*/,
                uint256 /*amountUsd6*/,
                uint256 s,
                uint64 /*createdAt*/,
                uint64 /*lockUntil*/,
                bool /*withdrawn*/
            ) {
                shares[i] = s;
                totalShares += s;
            } catch {
                // If depositInfo fails for a token, treat it as zero share and continue
                shares[i] = 0;
                continue;
            }
        }

        if (totalShares == 0) {
            // Nothing to distribute (no valid shares among provided tokenIds)
            return;
        }

        // 2) Allocate userProfitUsd pro-rata by shares.
        // Move heavy per-token work into an internal helper to avoid "stack too deep".
        // Copy calldata arrays into memory and call helper.
        require(usdc.balanceOf(address(this)) >= userProfitUsd, "Treasury lacks USDC for payouts");
        uint256[] memory tokenIdsMem = new uint256[](n);
        for (uint256 i = 0; i < n; i++) tokenIdsMem[i] = tokenIds[i];
        _distributeUserProfit(userProfitUsd, tokenIdsMem, shares, totalShares);
    }

    // Internal helper to distribute userProfitUsd pro-rata by shares to receipt owners.
    // Keeps distribution logic isolated and reduces caller stack usage.
    function _distributeUserProfit(
        uint256 userProfitUsd,
        uint256[] memory tokenIdsMem,
        uint256[] memory shares,
        uint256 totalShares
    ) internal {
        IVaultForTreasury vaultContract = IVaultForTreasury(vault);

        uint256 n = tokenIdsMem.length;
        // Find last non-zero share index to allocate remainder there
        int256 lastNonZero = -1;
        for (uint256 i = 0; i < n; i++) {
            if (shares[i] > 0) lastNonZero = int256(i);
        }

        uint256 distributed = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 tid = tokenIdsMem[i];
            uint256 s = shares[i];
            if (s == 0) continue;

            uint256 payout = (userProfitUsd * s) / totalShares;
            // if this is the last non-zero slot, give remainder
            if (int256(i) == lastNonZero) {
                if (distributed < userProfitUsd) {
                    payout = userProfitUsd - distributed;
                }
            }
            distributed += payout;

            // Resolve recipient and transfer USDC (best-effort)
            try vaultContract.depositInfo(tid) returns (
                address user,
                address /*asset*/,
                uint256 /*amount*/,
                uint256 /*amountUsd6*/,
                uint256 /*shares*/,
                uint64 /*createdAt*/,
                uint64 /*lockUntil*/,
                bool /*withdrawn*/
            ) {
                if (user == address(0) || payout == 0) continue;
                // Best-effort low-level transfer, skip on failure
                (bool ok, ) = address(usdc).call(abi.encodeWithSelector(IERC20.transfer.selector, user, payout));
                if (!ok) {
                    // skip failing recipient; funds remain in Treasury
                    continue;
                }
            } catch {
                // skip receipts that fail to read
                continue;
            }
        }
    }

    /// @notice Manual admin payout of profit to the current receipt NFT owner (or deposit owner fallback).
    /// @dev Sends USDC from Treasury to recipient without touching Vault principal state / NFT burn state.
    /// @param receiptId Vault receipt token id
    /// @param amountUsd USD amount in 6 decimals (e.g. $112.50 => 112500000)
    function payProfitToReceiptOwner(uint256 receiptId, uint256 amountUsd) external onlyOwner {
        require(amountUsd > 0, "amount must be > 0");
        require(vault != address(0), "vault not set");
        require(usdc.balanceOf(address(this)) >= amountUsd, "Treasury lacks USDC");

        (uint256 batchId, uint256 dueUsd, uint256 alreadyPaidUsd, uint256 unpaidUsd, address recipient) =
            previewReceiptProfitUsd(receiptId);
        require(recipient != address(0), "recipient not found");

        if (batchId != 0 && dueUsd > 0) {
            require(amountUsd <= unpaidUsd, "amount exceeds unpaid batch profit");
            uint256 newPaid = alreadyPaidUsd + amountUsd;
            receiptBatchProfitPaidUsd[batchId][receiptId] = newPaid;
            emit ReceiptProfitPaidDetailed(batchId, receiptId, recipient, amountUsd, newPaid, dueUsd);
        }

        usdc.safeTransfer(recipient, amountUsd);
        emit ReceiptProfitPaid(receiptId, recipient, amountUsd);
    }

    /// @notice Preview exact batch-derived profit allocation for a receipt.
    /// @dev due/unpaid are in USD6. If no batch mapping is found, returns zeros.
    function previewReceiptProfitUsd(uint256 receiptId)
        public
        view
        returns (
            uint256 batchId,
            uint256 dueUsd,
            uint256 alreadyPaidUsd,
            uint256 unpaidUsd,
            address recipient
        )
    {
        if (vault == address(0)) return (0, 0, 0, 0, address(0));
        IVaultForTreasury vaultContract = IVaultForTreasury(vault);
        recipient = _resolveProfitRecipient(vaultContract, receiptId);

        if (escrow == address(0)) return (0, 0, 0, 0, recipient);
        IEscrowForTreasury escrowContract = IEscrowForTreasury(escrow);

        // Resolve receipt -> batch mapping.
        try escrowContract.receiptBatchId(receiptId) returns (uint256 bid) {
            batchId = bid;
        } catch {
            return (0, 0, 0, 0, recipient);
        }
        if (batchId == 0) return (0, 0, 0, 0, recipient);

        uint256 userProfitUsd = batchProfitUsd[batchId];
        alreadyPaidUsd = receiptBatchProfitPaidUsd[batchId][receiptId];
        if (userProfitUsd == 0) {
            return (batchId, 0, alreadyPaidUsd, 0, recipient);
        }

        uint256 totalShares = 0;
        try escrowContract.batches(batchId) returns (
            uint256 /*id*/,
            uint256 /*startTime*/,
            uint256 /*endTime*/,
            uint256 /*totalCollateralUsd*/,
            uint256 sharesTotal,
            uint256 /*finalNavPerShare*/,
            uint8 /*status*/,
            bool /*distributed*/
        ) {
            totalShares = sharesTotal;
        } catch {
            return (batchId, 0, alreadyPaidUsd, 0, recipient);
        }
        if (totalShares == 0) return (batchId, 0, alreadyPaidUsd, 0, recipient);

        uint256 receiptShares = 0;
        try vaultContract.depositInfo(receiptId) returns (
            address /*user*/,
            address /*asset*/,
            uint256 /*amount*/,
            uint256 /*amountUsd6*/,
            uint256 shares,
            uint64 /*createdAt*/,
            uint64 /*lockUntil*/,
            bool /*withdrawn*/
        ) {
            receiptShares = shares;
        } catch {
            return (batchId, 0, alreadyPaidUsd, 0, recipient);
        }
        if (receiptShares == 0) return (batchId, 0, alreadyPaidUsd, 0, recipient);

        dueUsd = (userProfitUsd * receiptShares) / totalShares;
        unpaidUsd = dueUsd > alreadyPaidUsd ? dueUsd - alreadyPaidUsd : 0;
        return (batchId, dueUsd, alreadyPaidUsd, unpaidUsd, recipient);
    }

    /// @notice Pay exact unpaid batch-derived profit to the current receipt owner.
    /// @dev Uses previewReceiptProfitUsd() and updates per-receipt paid tracking.
    function payReceiptProfit(uint256 receiptId) external onlyOwner {
        require(vault != address(0), "vault not set");
        require(escrow != address(0), "escrow not set");

        (uint256 batchId, uint256 dueUsd, uint256 alreadyPaidUsd, uint256 unpaidUsd, address recipient) =
            previewReceiptProfitUsd(receiptId);
        require(batchId != 0, "receipt batch not found");
        require(recipient != address(0), "recipient not found");
        require(unpaidUsd > 0, "no unpaid profit");
        require(usdc.balanceOf(address(this)) >= unpaidUsd, "Treasury lacks USDC");

        uint256 newPaid = alreadyPaidUsd + unpaidUsd;
        receiptBatchProfitPaidUsd[batchId][receiptId] = newPaid;
        usdc.safeTransfer(recipient, unpaidUsd);

        emit ReceiptProfitPaid(receiptId, recipient, unpaidUsd);
        emit ReceiptProfitPaidDetailed(batchId, receiptId, recipient, unpaidUsd, newPaid, dueUsd);
    }

    function _recordBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare,
        bytes32 settlementReportHash,
        bytes32 complianceDigestHash
    ) internal {
        protocolProfitUsd += feeUsd;
        batchProfitUsd[batchId] = userProfitUsd;
        batchFinalNavPerShare[batchId] = finalNavPerShare;
        batchSettlementReportHash[batchId] = settlementReportHash;
        batchComplianceDigestHash[batchId] = complianceDigestHash;

        if (totalCollateralUsd >= principalUsd) {
            totalCollateralUsd -= principalUsd;
        } else {
            totalCollateralUsd = 0;
        }

        emit BatchResult(batchId, principalUsd, userProfitUsd, feeUsd);
        emit BatchResultExtended(batchId, settlementReportHash, complianceDigestHash);
    }

    function _resolveProfitRecipient(IVaultForTreasury vaultContract, uint256 receiptId) internal view returns (address recipient) {
        // Fallback: deposit owner from Vault storage (works even if receipt NFT is not configured).
        try vaultContract.depositInfo(receiptId) returns (
            address user,
            address /*asset*/,
            uint256 /*amount*/,
            uint256 /*amountUsd6*/,
            uint256 /*shares*/,
            uint64 /*createdAt*/,
            uint64 /*lockUntil*/,
            bool /*withdrawn*/
        ) {
            recipient = user;
        } catch {
            recipient = address(0);
        }

        // Preferred recipient: current NFT owner.
        try vaultContract.receiptNFT() returns (address nft) {
            if (nft != address(0)) {
                try IReceiptNFTForTreasury(nft).ownerOf(receiptId) returns (address nftOwner) {
                    if (nftOwner != address(0)) {
                        recipient = nftOwner;
                    }
                } catch {
                    // keep fallback recipient from depositInfo
                }
            }
        } catch {
            // keep fallback recipient from depositInfo
        }
    }

    function _syncStressState() internal returns (StressState state, uint256 flags) {
        StressMetrics memory metrics = _computeStressMetrics();
        StressState previousState = stressState;
        uint256 previousDegradedRecovery = degradedRecoveryWindowStartedAt;
        uint256 previousRecapRecovery = recapOnlyRecoveryWindowStartedAt;
        uint256 previousEmergencyRecovery = emergencyRecoveryWindowStartedAt;
        uint256 nextDegradedRecovery;
        uint256 nextRecapRecovery;
        uint256 nextEmergencyRecovery;
        (
            state,
            flags,
            nextDegradedRecovery,
            nextRecapRecovery,
            nextEmergencyRecovery
        ) = _previewStressState(metrics);

        if (state != previousState) {
            stressState = state;
            stressStateSince = block.timestamp;
        }

        degradedRecoveryWindowStartedAt = nextDegradedRecovery;
        recapOnlyRecoveryWindowStartedAt = nextRecapRecovery;
        emergencyRecoveryWindowStartedAt = nextEmergencyRecovery;

        if (state != previousState) {
            emit StressStateTransition(
                previousState,
                state,
                flags,
                block.timestamp,
                nextDegradedRecovery,
                nextRecapRecovery,
                nextEmergencyRecovery
            );
            return (state, flags);
        }

        if (
            nextDegradedRecovery != previousDegradedRecovery
                || nextRecapRecovery != previousRecapRecovery
                || nextEmergencyRecovery != previousEmergencyRecovery
        ) {
            emit StressRecoveryWindowsUpdated(
                state,
                flags,
                nextDegradedRecovery,
                nextRecapRecovery,
                nextEmergencyRecovery
            );
        }
    }

    function _previewStressState(StressMetrics memory metrics)
        internal
        view
        returns (
            StressState nextState,
            uint256 flags,
            uint256 nextDegradedRecovery,
            uint256 nextRecapRecovery,
            uint256 nextEmergencyRecovery
        )
    {
        (StressState instantaneousState, uint256 instantaneousFlags) = _deriveInstantaneousStressState(metrics);
        StressState currentState = stressState;
        nextDegradedRecovery = degradedRecoveryWindowStartedAt;
        nextRecapRecovery = recapOnlyRecoveryWindowStartedAt;
        nextEmergencyRecovery = emergencyRecoveryWindowStartedAt;

        if (_severity(instantaneousState) > _severity(currentState)) {
            nextDegradedRecovery = 0;
            nextRecapRecovery = 0;
            nextEmergencyRecovery = 0;
            return (instantaneousState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
        }

        if (instantaneousState == currentState) {
            if (currentState == StressState.Degraded) {
                nextDegradedRecovery = 0;
            } else if (currentState == StressState.RecapOnly) {
                nextRecapRecovery = 0;
            } else if (currentState == StressState.Emergency) {
                nextEmergencyRecovery = 0;
            }
            return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
        }

        if (currentState == StressState.Emergency) {
            nextDegradedRecovery = 0;
            nextRecapRecovery = 0;
            if (nextEmergencyRecovery == 0) {
                nextEmergencyRecovery = block.timestamp;
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            if (block.timestamp < nextEmergencyRecovery + EMERGENCY_RECOVERY_DELAY) {
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            nextEmergencyRecovery = 0;
            nextRecapRecovery = block.timestamp;
            return (StressState.RecapOnly, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
        }

        if (currentState == StressState.RecapOnly) {
            nextDegradedRecovery = 0;
            nextEmergencyRecovery = 0;
            if (nextRecapRecovery == 0) {
                nextRecapRecovery = block.timestamp;
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            if (block.timestamp < nextRecapRecovery + RECOVERY_DELAY) {
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            nextRecapRecovery = 0;
            nextDegradedRecovery = block.timestamp;
            return (StressState.Degraded, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
        }

        if (currentState == StressState.Degraded) {
            nextRecapRecovery = 0;
            nextEmergencyRecovery = 0;
            if (nextDegradedRecovery == 0) {
                nextDegradedRecovery = block.timestamp;
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            if (block.timestamp < nextDegradedRecovery + RECOVERY_DELAY) {
                return (currentState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
            }
            nextDegradedRecovery = 0;
            return (StressState.Healthy, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
        }

        return (instantaneousState, instantaneousFlags, nextDegradedRecovery, nextRecapRecovery, nextEmergencyRecovery);
    }

    function _deriveInstantaneousStressState(StressMetrics memory metrics)
        internal
        pure
        returns (StressState state, uint256 flags)
    {
        flags = _collectStressFlags(
            metrics,
            EMERGENCY_COVERAGE_MIN_BPS,
            EMERGENCY_RESERVE_MIN_BPS,
            EMERGENCY_LIQUIDITY_MIN_BPS,
            EMERGENCY_DEPEG_MAX_BPS
        );
        if (!metrics.oracleFresh) {
            return (StressState.Emergency, flags | FLAG_ORACLE);
        }
        if (flags != 0) {
            return (StressState.Emergency, flags);
        }

        flags = _collectStressFlags(
            metrics,
            RECAP_COVERAGE_MIN_BPS,
            RECAP_RESERVE_MIN_BPS,
            RECAP_LIQUIDITY_MIN_BPS,
            RECAP_DEPEG_MAX_BPS
        );
        if (flags != 0) {
            return (StressState.RecapOnly, flags);
        }

        flags = _collectStressFlags(
            metrics,
            DEGRADED_COVERAGE_MIN_BPS,
            DEGRADED_RESERVE_MIN_BPS,
            DEGRADED_LIQUIDITY_MIN_BPS,
            DEGRADED_DEPEG_MAX_BPS
        );
        if (flags != 0) {
            return (StressState.Degraded, flags);
        }

        return (StressState.Healthy, 0);
    }

    function _computeStressMetrics() internal view returns (StressMetrics memory metrics) {
        metrics.treasuryUsd = getTreasuryValueUsd();
        metrics.reserveUsd = getReserveValueUsd();
        metrics.safeBackingUsd = getSafeBackingUsd();
        metrics.liquidStableUsd = getLiquidStableUsd();
        metrics.liabilitiesUsd = getLiabilitiesUsd();
        metrics.immediateObligationsUsd = getImmediateObligationsUsd();

        bool primaryValid;
        bool secondaryValid;
        bool goldValid;

        (metrics.primaryStablePrice8, metrics.primaryStableUpdatedAt, primaryValid) =
            _readOraclePrice8(address(priceOracle), false);
        (metrics.goldPrice8, metrics.goldOracleUpdatedAt, goldValid) =
            _readOraclePrice8(address(goldOracle), true);

        if (secondaryStableOracle != address(0)) {
            (metrics.secondaryStablePrice8, metrics.secondaryStableUpdatedAt, secondaryValid) =
                _readOraclePrice8(secondaryStableOracle, false);
        } else {
            metrics.secondaryStablePrice8 = PRICE_SCALE;
            metrics.secondaryStableUpdatedAt = block.timestamp;
            secondaryValid = true;
        }

        metrics.backingCoverageBps = _ratioBps(metrics.safeBackingUsd, metrics.liabilitiesUsd);
        metrics.reserveSupportBps = _ratioBps(metrics.reserveUsd, metrics.treasuryUsd);
        metrics.liquidityRunwayBps = _ratioBps(metrics.liquidStableUsd, metrics.immediateObligationsUsd);

        uint256 primaryDiff = _absDiff(metrics.primaryStablePrice8, PRICE_SCALE);
        uint256 secondaryDiff = secondaryStableOracle == address(0)
            ? 0
            : _absDiff(metrics.secondaryStablePrice8, PRICE_SCALE);
        metrics.stableDepegBps = (_max(primaryDiff, secondaryDiff) * BPS_SCALE) / PRICE_SCALE;

        bool primaryFresh = _isOracleFresh(primaryValid, metrics.primaryStableUpdatedAt);
        bool secondaryFresh = secondaryStableOracle == address(0)
            ? true
            : _isOracleFresh(secondaryValid, metrics.secondaryStableUpdatedAt);
        bool goldFresh_ = _isOracleFresh(goldValid, metrics.goldOracleUpdatedAt);
        metrics.oracleFresh = primaryFresh && secondaryFresh && goldFresh_;
    }

    function _collectStressFlags(
        StressMetrics memory metrics,
        uint256 minCoverageBps,
        uint256 minReserveSupportBps,
        uint256 minLiquidityRunwayBps,
        uint256 maxStableDepegBps
    ) internal pure returns (uint256 flags) {
        if (metrics.backingCoverageBps < minCoverageBps) {
            flags |= FLAG_COVERAGE;
        }
        if (metrics.reserveSupportBps < minReserveSupportBps) {
            flags |= FLAG_RESERVE;
        }
        if (metrics.liquidityRunwayBps < minLiquidityRunwayBps) {
            flags |= FLAG_LIQUIDITY;
        }
        if (metrics.stableDepegBps > maxStableDepegBps) {
            flags |= FLAG_DEPEG;
        }
    }

    function _readOraclePrice8(address oracle, bool preferGoldLegacy)
        internal
        view
        returns (uint256 price8, uint256 updatedAt_, bool isValid)
    {
        if (oracle == address(0)) {
            return (0, 0, false);
        }

        try IOracleLatest(oracle).latest() returns (uint256 latestPrice8, uint256 ts, bool valid_) {
            return (latestPrice8, ts, valid_ && latestPrice8 > 0);
        } catch {}

        try IOracleUpdatedAt(oracle).updatedAt() returns (uint256 ts) {
            updatedAt_ = ts;
        } catch {
            updatedAt_ = 0;
        }

        try IOracleValidity(oracle).valid() returns (bool valid_) {
            isValid = valid_;
        } catch {
            isValid = true;
        }

        if (price8 == 0) {
            try IPriceOracle(oracle).getPrice() returns (uint256 latestPrice8) {
                price8 = latestPrice8;
            } catch {}
        }

        if (price8 == 0 && preferGoldLegacy) {
            try IGoldOracleLegacy(oracle).getGoldPrice() returns (uint256 price6) {
                price8 = price6 * 100;
            } catch {}
        }

        if (updatedAt_ == 0 || price8 == 0) {
            isValid = false;
        }

        return (price8, updatedAt_, isValid);
    }

    function _requireGoldPrice8() internal view returns (uint256 goldPrice8) {
        bool isValid;
        (goldPrice8,, isValid) = _readOraclePrice8(address(goldOracle), true);
        require(isValid && goldPrice8 > 0, "goldOracle invalid");
    }

    function _isOracleFresh(bool isValid, uint256 updatedAt_) internal view returns (bool) {
        if (!isValid || updatedAt_ == 0) {
            return false;
        }
        return block.timestamp <= updatedAt_ + MAX_ORACLE_AGE;
    }

    function _ratioBps(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        if (denominator == 0) {
            return type(uint256).max;
        }
        return (numerator * BPS_SCALE) / denominator;
    }

    function _applyHaircut(uint256 value, uint256 haircutBps) internal pure returns (uint256) {
        return (value * haircutBps) / BPS_SCALE;
    }

    function _severity(StressState state) internal pure returns (uint8) {
        return uint8(state);
    }

    function _assertCategoryAllowed(PolicyCategory category, StressState state, uint256 flags) internal pure {
        if (!_isCategoryAllowed(category, state)) {
            revert PolicyCategoryNotAllowed(category, state, flags);
        }
    }

    function _isCategoryAllowed(PolicyCategory category, StressState state) internal pure returns (bool) {
        if (state == StressState.Healthy || state == StressState.Degraded) {
            return true;
        }
        if (state == StressState.RecapOnly) {
            return category == PolicyCategory.Recapitalization
                || category == PolicyCategory.BuybackBurn
                || category == PolicyCategory.IdleBurn;
        }
        return false;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

}
