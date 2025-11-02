// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ReserveController is Ownable {
    IERC20 public immutable gold;
    address public treasury;

    uint256 public reserveFloorBps = 1200; // 12%
    uint256 public reserveCeilBps = 2500; // 25%
    uint256 public reserveRatio;
    uint256 public goldPriceUsd6; // Gold price in USD with 6 decimals
    mapping(address => uint256) public reserves;

    event ReserveFilled(uint256 amount);
    event ReserveDrained(uint256 amount);
    event ReserveRatioUpdated(uint256 newRatio);
    event ReservesAdded(address indexed asset, uint256 amount);
    event GoldPriceUpdated(uint256 newPrice);

    constructor(IERC20 _gold) Ownable(msg.sender) {
        gold = _gold;
        reserveRatio = 2000; // 20% default
        goldPriceUsd6 = 2000_000000; // Default $2000 per GOLD
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury address cannot be zero");
        treasury = _treasury;
    }

    function setGoldPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Price must be positive");
        goldPriceUsd6 = newPrice;
        emit GoldPriceUpdated(newPrice);
    }

    function manageReserve(uint256 currentRatio) external onlyOwner {
        if (currentRatio < reserveFloorBps) {
            uint256 amountToFill = reserveFloorBps - currentRatio;
            require(gold.transferFrom(treasury, address(this), amountToFill), "Reserve fill failed");
            emit ReserveFilled(amountToFill);
        } else if (currentRatio > reserveCeilBps) {
            uint256 amountToDrain = currentRatio - reserveCeilBps;
            require(gold.transfer(treasury, amountToDrain), "Reserve drain failed");
            emit ReserveDrained(amountToDrain);
        }
    }

    function setReserveRatio(uint256 newRatio) external onlyOwner {
        require(newRatio <= 10000, "Invalid ratio");
        reserveRatio = newRatio;
        emit ReserveRatioUpdated(newRatio);
    }

    function getReserveRatio() external view returns (uint256) {
        return reserveRatio;
    }

    function addReserves(address asset, uint256 amount) external onlyOwner {
        reserves[asset] += amount;
        emit ReservesAdded(asset, amount);
    }

    function totalReserves(address asset) external view returns (uint256) {
        return reserves[asset];
    }

    /// @notice Get the Net Asset Value of reserves in USD (6 decimals)
    /// @return Total USD value of all reserves
    function navReserveUsd() external view returns (uint256) {
        uint256 goldBal = gold.balanceOf(address(this));
        // Convert GOLD balance (18 decimals) to USD value (6 decimals)
        // goldBal * goldPriceUsd6 / 1e18
        return (goldBal * goldPriceUsd6) / 1e18;
    }

    /// @notice Calculate coverage ratio in basis points
    /// @return Coverage ratio (0-10000 = 0%-100%)
    function coverageRatio() external view returns (uint256) {
        // This is a simplified version - in production would compare reserve value to liabilities
        return reserveRatio;
    }
}
