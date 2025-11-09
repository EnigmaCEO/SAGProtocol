// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IGoldOracle {
    function getGoldPrice() external view returns (uint256);
}

contract ReserveController is Ownable {
    IERC20 public immutable gold;
    address public treasury;

    uint256 public reserveFloorBps = 1200; // 12%
    uint256 public reserveCeilBps = 2500; // 25%
    uint256 public reserveRatio;
    address public goldOracle; // authoritative oracle address (returns USD*1e6)
    mapping(address => uint256) public reserves;

    event ReserveFilled(uint256 amount);
    event ReserveDrained(uint256 amount);
    event ReserveRatioUpdated(uint256 newRatio);
    event ReservesAdded(address indexed asset, uint256 amount);
    event GoldPriceUpdated(uint256 newPrice);

    constructor(IERC20 _gold, address _goldOracle) Ownable(msg.sender) {
        gold = _gold;
        reserveRatio = 2000; // 20% default
        goldOracle = _goldOracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury address cannot be zero");
        treasury = _treasury;
    }

    // set the external oracle address (owner only) to support migration
    function setGoldOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "oracle cannot be zero");
        goldOracle = _oracle;
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
        // Read authoritative price from GoldOracle (expected usd * 1e6)
        uint256 priceUsd6 = 0;
        if (goldOracle != address(0)) {
            priceUsd6 = IGoldOracle(goldOracle).getGoldPrice();
        }
        // Convert GOLD balance (18 decimals) to USD value (6 decimals): goldBal * priceUsd6 / 1e18
        return (goldBal * priceUsd6) / 1e18;
    }

    /// @notice Calculate coverage ratio in basis points
    /// @return Coverage ratio (0-10000 = 0%-100%)
    function coverageRatio() external view returns (uint256) {
        // This is a simplified version - in production would compare reserve value to liabilities
        return reserveRatio;
    }
}
