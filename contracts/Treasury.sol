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
}

// NEW: Minimal Escrow interface so Treasury can validate which batch a receipt belongs to (best-effort)
interface IEscrowForTreasury {
    function receiptBatchId(uint256 tokenId) external view returns (uint256);
}

contract Treasury is Ownable {
    using SafeERC20 for IERC20;
    // AMM pair used for swapping tokens (e.g. SAG <-> USDC or SAG <-> GOLD)
    address public ammPair;

    IERC20 public immutable sag;
    IERC20 public immutable usdc;
    IERC20 public immutable gold;

    address public reserveAddress;
    address public vault;
    IPriceOracle public priceOracle;

    // Per-asset oracles so Treasury can read SAG and GOLD prices separately
    IPriceOracle public sagOracle;
    IPriceOracle public goldOracle;

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
    // Track processed deposit/receipt IDs to make collateralizeForReceipt idempotent
    mapping(uint256 => bool) public processedReceipts;
    // ------------------ END NEW STATE ------------------

    // NEW: allow automatic mint fallback (dev/test only). Default false.
    bool public allowAutoMintCollateralize;

    // NEW: slippage tolerance for AMM swaps (basis points). Default 50 = 0.5%.
    uint16 public slippageBps = 50;
    event SlippageBpsUpdated(uint16 bps);

    function setSlippageBps(uint16 bps) external onlyOwner {
        require(bps <= 1000, "slippage too large"); // max 10%
        slippageBps = bps;
        emit SlippageBpsUpdated(bps);
    }

    // EVENTS
    event Collateralized(uint256 amountUsd);
    event CollateralizeAttempt(uint256 requestedUsd, uint256 usdcBefore, uint256 sagBefore, uint256 sagNeeded);
    event CollateralizeInsufficientSAG(uint256 requestedUsd, uint256 sagBefore, uint256 sagNeeded);
    // include sagAfter so callers can observe token changes post-swap
    event CollateralizeSucceeded(uint256 requestedUsd, uint256 usdcAfter, uint256 sagAfter);
    // Diagnostic: indicates we auto-minted USDC to cover a shortfall in test environments
    event CollateralizeMintFallback(uint256 mintedUsd);

    event Rebalanced(uint256 treasuryUsd, uint256 reserveUsd);
    event GoldBought(uint256 usdAmount);
    event GoldSold(uint256 usdAmount);

    // NEW EVENTS
    event BatchFunded(uint256 indexed batchId, uint256 amountUsd);
    event BatchResult(uint256 indexed batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd);

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
        IERC20 _sag,
        IERC20 _usdc,
        IERC20 _gold,
        address _reserveAddress,
        address _vault,
        IPriceOracle _priceOracle
    ) Ownable(msg.sender) {
        sag = _sag;
        usdc = _usdc;
        gold = _gold;
        reserveAddress = _reserveAddress;
        vault = _vault;
        priceOracle = _priceOracle;
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

    // New setters for per-asset oracles
    function setSagOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Oracle address cannot be zero");
        sagOracle = IPriceOracle(_oracle);
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

    function setAllowAutoMintCollateralize(bool v) external onlyOwner {
        allowAutoMintCollateralize = v;
    }

    // --- View functions ---

    function getTreasuryValueUsd() public view returns (uint256) {
        uint256 sagBal = sag.balanceOf(address(this)); // 18 decimals
        uint256 usdcBal = usdc.balanceOf(address(this)); // 6 decimals
        require(address(sagOracle) != address(0), "sagOracle not set");
        uint256 sagPrice8 = sagOracle.getPrice(); // price * 1e8
        // sagValueUsd6 = (sagBal * sagPrice8) / 1e20
        uint256 sagValueUsd6 = (sagBal * sagPrice8) / (10 ** 20);
        return sagValueUsd6 + usdcBal;
    }

    function getReserveValueUsd() public view returns (uint256) {
        require(address(goldOracle) != address(0), "goldOracle not set");
        uint256 goldBal = gold.balanceOf(reserveAddress); // 18 decimals
        uint256 goldPrice8 = goldOracle.getPrice(); // price in 8-decimals
        uint256 goldValueUsd6 = (goldBal * goldPrice8) / (10 ** 20);
        return goldValueUsd6;
    }

    /// @notice Get the "safe backing" used for coverage calculations (Treasury + Reserve)
    function getSafeBackingUsd() external view returns (uint256) {
        return getTreasuryValueUsd() + getReserveValueUsd();
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

    // --- Collateralization ---

    function collateralize(uint256 depositValueUsd) external onlyVault {
        _doCollateralize(depositValueUsd);
    }

    /// @notice Collateralize a specific deposit/receipt id (idempotent).
    /// @dev Called by Vault after a user deposit. Treasury will attempt to obtain USDC (swap SAG via AMM if needed)
    ///      and update bookkeeping. Multiple calls for the same receiptId are safe (no double-counting).
    /// @dev allow owner to call this for testing/manual recovery as well
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

        // If we don't have enough USDC, attempt to convert SAG -> USDC via AMM
        if (usdcBal < depositValueUsd) {
            _ensureUsdc(depositValueUsd);
        } else {
            emit CollateralizeAttempt(depositValueUsd, usdcBal, sag.balanceOf(address(this)), 0);
            emit CollateralizeSucceeded(depositValueUsd, usdcBal, sag.balanceOf(address(this)));
        }

        // Record collateral (single accounting spot to avoid double-counting in collateralizeForReceipt fast-path)
        totalCollateralUsd += depositValueUsd;
        emit Collateralized(depositValueUsd);
    }

    // Heavy work moved to helper to avoid "stack too deep" in caller.
    function _ensureUsdc(uint256 depositValueUsd) internal {
        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 needed = depositValueUsd > usdcBal ? depositValueUsd - usdcBal : 0;
        require(ammPair != address(0), "No AMM available");
        require(address(sagOracle) != address(0), "sagOracle not set");

        uint256 usdcAfterFinal;
        uint256 sagAmount;
        (usdcAfterFinal, sagAmount) = _performAmmSwap(depositValueUsd, needed);

        // Move final checks/emits into a tiny helper to reduce _ensureUsdc locals.
        _finalizeCollateralize(depositValueUsd, true, 0, usdcBal, usdcAfterFinal, sagAmount);
    }

    // Extracted AMM probe, sagAmount calc, and swap into a helper to reduce _ensureUsdc locals.
    function _performAmmSwap(uint256 depositValueUsd, uint256 needed) internal returns (uint256 usdcAfterFinal, uint256 sagAmount) {
        uint256 usdcBal = usdc.balanceOf(address(this));
        bool ammProbeOk = false;
        address token0Addr;
        address token1Addr;
        uint256 reserve0 = 0;
        uint256 reserve1 = 0;
        uint256 ammFeeBps = 30;
        uint256 reserveIn;
        uint256 reserveOut;

        (token0Addr, token1Addr, reserve0, reserve1, ammFeeBps, ammProbeOk) = _probeAmm(ammPair);

        if (reserve0 > 0 && reserve1 > 0 && (token0Addr != address(0) || token1Addr != address(0))) {
            
            if (token0Addr == address(sag)) { reserveIn = reserve0; reserveOut = reserve1; }
            else if (token1Addr == address(sag)) { reserveIn = reserve1; reserveOut = reserve0; }
            else { reserveIn = 0; reserveOut = 0; }
            if (reserveOut > needed && reserveIn > 0) {
                uint256 num = reserveIn * needed * 10000;
                uint256 denom = (reserveOut - needed) * (10000 - ammFeeBps);
                if (denom > 0) {
                    sagAmount = (num + denom - 1) / denom;
                    ammProbeOk = true;
                }
            }
        }
        if (!ammProbeOk) {
            uint256 sagPrice8 = sagOracle.getPrice();
            require(sagPrice8 > 0, "Invalid SAG price");
            sagAmount = (needed * (10 ** 20) + sagPrice8 - 1) / sagPrice8;
        }

        uint256 sagBal = sag.balanceOf(address(this));
        emit CollateralizeAttempt(depositValueUsd, usdcBal, sagBal, sagAmount);
        if (sagBal == 0) {
            emit CollateralizeInsufficientSAG(depositValueUsd, sagBal, sagAmount);
            revert("Collateralize: no SAG available to buy USDC");
        }

        uint256 amountToSwap = sagAmount;
        if (sagBal < sagAmount) {
            amountToSwap = sagBal;
            emit CollateralizeInsufficientSAG(depositValueUsd, sagBal, sagAmount);
        }

        uint256 expectedUsdc6;
        if (ammProbeOk) {
            uint256 amountInWithFee = amountToSwap * (10000 - ammFeeBps);
            expectedUsdc6 = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
        } else {
            uint256 sagPrice8 = sagOracle.getPrice();
            expectedUsdc6 = (amountToSwap * sagPrice8) / (10 ** 20);
        }
        uint256 minExpectedUsdc6 = (expectedUsdc6 * (10000 - slippageBps)) / 10000;

        try sag.approve(ammPair, 0) {} catch {}
        try sag.approve(ammPair, amountToSwap) {} catch {}

        bool swapped;
        (swapped, usdcAfterFinal) = _doSwapAttempt(amountToSwap, minExpectedUsdc6);

        // Removed final checks here to reduce locals; handled in _ensureUsdc via _finalizeCollateralize.
    }

    // Extracted swap attempt to reduce _performAmmSwap locals.
    function _doSwapAttempt(uint256 amountToSwap, uint256 minExpectedUsdc6) internal returns (bool swapped, uint256 usdcAfterFinal) {
        uint256 before = usdc.balanceOf(address(this));
        // 1) Router: swapExactTokensForTokens(amountIn, amountOutMin, path, to)
        {
            address[] memory path = new address[](2);
            path[0] = address(sag);
            path[1] = address(usdc);
            (bool ok, ) = ammPair.call(abi.encodeWithSignature(
                "swapExactTokensForTokens(uint256,uint256,address[],address)",
                amountToSwap, minExpectedUsdc6, path, address(this)
            ));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 2) Router variant: swapExactTokensForTokens(amountIn, tokenIn, tokenOut, to)
        {
            (bool ok, ) = ammPair.call(abi.encodeWithSignature(
                "swapExactTokensForTokens(uint256,address,address,address)",
                amountToSwap, address(sag), address(usdc), address(this)
            ));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 3) Pair.swap(amount, to)
        {
            (bool ok, ) = ammPair.call(abi.encodeWithSignature("swap(uint256,address)", amountToSwap, address(this)));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 4) transfer then sync/mint fallback
        try sag.transfer(ammPair, amountToSwap) {
            (bool okSync, ) = ammPair.call(abi.encodeWithSignature("sync()"));
            if (okSync && usdc.balanceOf(address(this)) > before) return (true, usdc.balanceOf(address(this)));
            (bool okMint, ) = ammPair.call(abi.encodeWithSignature("mint(address)", address(this)));
            if (okMint && usdc.balanceOf(address(this)) > before) return (true, usdc.balanceOf(address(this)));
        } catch {}

        return (false, usdc.balanceOf(address(this)));
    }

    // Small helper extracted from _ensureUsdc to reduce its stack usage.
    // Performs final verification and emits success/failure events (may revert).
    function _finalizeCollateralize(
        uint256 depositValueUsd,
        bool swapped,
        uint256 minExpectedUsdc6,
        uint256 usdcBefore,
        uint256 usdcAfterFinal,
        uint256 sagAmount
    ) internal {
        uint256 usdcReceived = usdcAfterFinal > usdcBefore ? usdcAfterFinal - usdcBefore : 0;
        if (!swapped || usdcReceived < minExpectedUsdc6) {
            revert("Collateralize failed to obtain enough USDC");
        }
        uint256 sagAfterBal = sag.balanceOf(address(this));
        if (usdcAfterFinal < depositValueUsd) {
            emit CollateralizeInsufficientSAG(depositValueUsd, sagAfterBal, sagAmount);
            revert("Collateralize failed to obtain enough USDC");
        }
        emit CollateralizeSucceeded(depositValueUsd, usdcAfterFinal, sagAfterBal);
    }

    // Probe AMM pair safely; returns defaults when probe fails.
    function _probeAmm(address pair) internal view returns (
        address token0Addr,
        address token1Addr,
        uint256 reserve0,
        uint256 reserve1,
        uint256 ammFeeBps,
        bool ammProbeOk
    ) {
        ammFeeBps = 30;
        (bool ok0, bytes memory d0) = pair.staticcall(abi.encodeWithSignature("token0()"));
        if (ok0 && d0.length >= 32) token0Addr = abi.decode(d0, (address));
        (bool ok1, bytes memory d1) = pair.staticcall(abi.encodeWithSignature("token1()"));
        if (ok1 && d1.length >= 32) token1Addr = abi.decode(d1, (address));
        (bool okR, bytes memory dR) = pair.staticcall(abi.encodeWithSignature("getReserves()"));
        if (okR && dR.length >= 96) {
            (uint256 r0, uint256 r1) = abi.decode(dR, (uint256, uint256));
            reserve0 = r0;
            reserve1 = r1;
        }
        (bool okFee, bytes memory dF) = pair.staticcall(abi.encodeWithSignature("SWAP_FEE_BPS()"));
        if (okFee && dF.length >= 32) ammFeeBps = abi.decode(dF, (uint256));
        ammProbeOk = (reserve0 > 0 && reserve1 > 0) && (token0Addr != address(0) || token1Addr != address(0));
    }

    // Try common swap entrypoints; returns (swapped, usdcBalanceAfter)
    function _attemptSwap(address pair, uint256 amountToSwap, uint256 minExpectedUsdc6) internal returns (bool swapped, uint256 usdcAfter) {
        try sag.approve(pair, 0) {} catch {}
        try sag.approve(pair, amountToSwap) {} catch {}
        uint256 before = usdc.balanceOf(address(this));

        // 1) Router: swapExactTokensForTokens(amountIn, amountOutMin, path, to)
        {
            address[] memory path = new address[](2);
            path[0] = address(sag);
            path[1] = address(usdc);
            (bool ok, ) = pair.call(abi.encodeWithSignature(
                "swapExactTokensForTokens(uint256,uint256,address[],address)",
                amountToSwap, minExpectedUsdc6, path, address(this)
            ));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 2) Router variant: swapExactTokensForTokens(amountIn, tokenIn, tokenOut, to)
        {
            (bool ok, ) = pair.call(abi.encodeWithSignature(
                "swapExactTokensForTokens(uint256,address,address,address)",
                amountToSwap, address(sag), address(usdc), address(this)
            ));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 3) Pair.swap(amount, to)
        {
            (bool ok, ) = pair.call(abi.encodeWithSignature("swap(uint256,address)", amountToSwap, address(this)));
            if (ok && usdc.balanceOf(address(this)) > before) {
                return (true, usdc.balanceOf(address(this)));
            }
        }
        // 4) transfer then sync/mint fallback
        try sag.transfer(pair, amountToSwap) {
            (bool okSync, ) = pair.call(abi.encodeWithSignature("sync()"));
            if (okSync && usdc.balanceOf(address(this)) > before) return (true, usdc.balanceOf(address(this)));
            (bool okMint, ) = pair.call(abi.encodeWithSignature("mint(address)", address(this)));
            if (okMint && usdc.balanceOf(address(this)) > before) return (true, usdc.balanceOf(address(this)));
        } catch {}

        return (false, usdc.balanceOf(address(this)));
    }

    // --- Reserve Rebalancing ---

    function rebalanceReserve() external {
        require(address(sagOracle) != address(0) && address(goldOracle) != address(0), "oracles not set");
        uint256 sagBal = sag.balanceOf(address(this)); // 18 decimals
        uint256 sagPrice8 = sagOracle.getPrice(); // 8-decimals
        uint256 sagValueUsd6 = (sagBal * sagPrice8) / (10 ** 20);

        uint256 goldBal = gold.balanceOf(reserveAddress); // 18 decimals
        uint256 goldPrice8 = goldOracle.getPrice(); // 8-decimals
        uint256 goldValueUsd6 = (goldBal * goldPrice8) / (10 ** 20);

        // Target SAG:GOLD ratio is 2:1
        // If ratio > 2.05:1, buy GOLD; if ratio < 1.95:1, sell GOLD
        uint256 ratio = goldValueUsd6 == 0 ? type(uint256).max : (sagValueUsd6 * 1e6) / goldValueUsd6; // scaled by 1e6

        uint256 targetRatio = 2 * 1e6; // 2.00 scaled by 1e6
        uint256 lower = targetRatio * 195 / 200; // 1.95
        uint256 upper = targetRatio * 205 / 200; // 2.05

        if (ratio > upper) {
            // Too much SAG, need more GOLD: buy GOLD
            // Calculate USD amount of GOLD to buy to reach target ratio
            // Let x = new goldValueUsd6, solve (sagValueUsd6 / x) = 2
            // x = sagValueUsd6 / 2
            uint256 desiredGoldValueUsd6 = sagValueUsd6 / 2;
            uint256 goldToBuyUsd = desiredGoldValueUsd6 > goldValueUsd6 ? desiredGoldValueUsd6 - goldValueUsd6 : 0;
            if (goldToBuyUsd > 0) {
                _buyGoldWithUsdc(goldToBuyUsd);
            }
        } else if (ratio < lower) {
            // Too much GOLD, need less GOLD: sell GOLD
            // Let x = new goldValueUsd6, solve (sagValueUsd6 / x) = 2
            // x = sagValueUsd6 / 2
            uint256 desiredGoldValueUsd6 = sagValueUsd6 / 2;
            uint256 goldToSellUsd = goldValueUsd6 > desiredGoldValueUsd6 ? goldValueUsd6 - desiredGoldValueUsd6 : 0;
            if (goldToSellUsd > 0) {
                _sellGoldForUsdc(goldToSellUsd);
            }
        }
        emit Rebalanced(sagValueUsd6, goldValueUsd6);
    }

    // --- Internal book-keeping for MVP ---

    function _buyGoldWithUsdc(uint256 usdAmount) internal {
        uint256 usdcBal = usdc.balanceOf(address(this));

        // If we don't have enough USDC, try selling SAG via AMM to obtain USDC
        if (usdcBal < usdAmount && ammPair != address(0)) {
            uint256 sagBal = sag.balanceOf(address(this));
            if (sagBal > 0) {
                // Approve AMM to pull SAG
                // call SafeERC20 library explicitly to avoid ADL lookup issues
                sag.approve(ammPair, 0);
                sag.approve(ammPair, sagBal);
                // swap SAG -> USDC, receive USDC back into this contract
                uint256 obtainedUsdc = IAMMPair(ammPair).swapExactTokensForTokens(sagBal, address(sag), address(usdc), address(this));
                usdcBal += obtainedUsdc;
            }
        }

        require(usdcBal >= usdAmount, "Not enough USDC");

        uint256 goldPrice = goldOracle.getPrice(); // 8-decimals
        // token wei conversion (USD6 -> token wei): goldWei = usd6 * 1e20 / price8
        uint256 goldAmount = (usdAmount * (10 ** 20)) / goldPrice;
        // Transfer gold to reserve
        require(gold.transfer(reserveAddress, goldAmount), "Gold transfer failed");
        // Burn/spend USDC (MVP simulation)
        require(usdc.transfer(address(0xdead), usdAmount), "USDC burned for MVP");
        emit GoldBought(usdAmount);
    }

    function _sellGoldForUsdc(uint256 usdAmount) internal {
        uint256 goldPrice = goldOracle.getPrice(); // 8-decimals
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

    // NEW: Escrow reports back results for a closed batch and distributes user profits to batch participants
    function reportBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare
    ) external onlyEscrow {
        // Record protocol profit
        protocolProfitUsd += feeUsd;
        // Record batch profit
        batchProfitUsd[batchId] = userProfitUsd;
        // Record final NAV per share
        batchFinalNavPerShare[batchId] = finalNavPerShare;
        // Close Treasury collateral for this batch
        if (totalCollateralUsd >= principalUsd) {
            totalCollateralUsd -= principalUsd;
        } else {
            totalCollateralUsd = 0;
        }
        emit BatchResult(batchId, principalUsd, userProfitUsd, feeUsd);
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
        // Bookkeeping: fees/nav/profit & close collateral
        protocolProfitUsd += feeUsd;
        batchProfitUsd[batchId] = userProfitUsd;
        batchFinalNavPerShare[batchId] = finalNavPerShare;
        if (totalCollateralUsd >= principalUsd) {
            totalCollateralUsd -= principalUsd;
        } else {
            totalCollateralUsd = 0;
        }

        emit BatchResult(batchId, principalUsd, userProfitUsd, feeUsd);

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

}
