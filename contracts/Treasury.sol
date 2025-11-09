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

    event Collateralized(uint256 amountUsd);
    event Rebalanced(uint256 treasuryUsd, uint256 reserveUsd);
    event GoldBought(uint256 usdAmount);
    event GoldSold(uint256 usdAmount);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
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
        require(usdc.balanceOf(address(this)) >= depositValueUsd, "Insufficient USDC");
        totalCollateralUsd += depositValueUsd;
        emit Collateralized(depositValueUsd);
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
        // goldAmount = usdAmount * 1e18 / goldPrice
        uint256 goldAmount = usdAmount * 1e18 / goldPrice;
        // Transfer gold to reserve
        require(gold.transfer(reserveAddress, goldAmount), "Gold transfer failed");
        // Burn/spend USDC (MVP simulation)
        require(usdc.transfer(address(0xdead), usdAmount), "USDC burned for MVP");
        emit GoldBought(usdAmount);
    }

    function _sellGoldForUsdc(uint256 usdAmount) internal {
        uint256 goldPrice = goldOracle.getPrice(); // 8-decimals
        uint256 goldAmount = usdAmount * 1e18 / goldPrice;
        require(gold.balanceOf(reserveAddress) >= goldAmount, "Not enough GOLD at reserve");
        // For MVP: pull GOLD from reserve back to treasury and emit event.
        // In a more advanced flow you may swap GOLD->USDC via AMM; keep existing transfer logic here.
        require(gold.transferFrom(reserveAddress, address(this), goldAmount), "Gold transferFrom failed");
        emit GoldSold(usdAmount);
    }
}
