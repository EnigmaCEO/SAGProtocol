// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Treasury is Ownable {
    constructor(IERC20 _usdc) Ownable(msg.sender) {
        usdc = _usdc;
    }
    IERC20 public immutable usdc;
    address public vault;
    address public reserveController;

    uint256 public crMinBps = 10500; // Minimum coverage ratio (1.05x)

    event Harvested(uint256 profit, uint256 toVault, uint256 toReserve, uint256 toBuyback);
    event BuybackStarted(uint256 amount);
    event BuybackCompleted(uint256 amount);

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Vault address cannot be zero");
        vault = _vault;
    }

    function setReserveController(address _reserveController) external onlyOwner {
        require(_reserveController != address(0), "ReserveController address cannot be zero");
        reserveController = _reserveController;
    }

    function harvest(uint256 profit) external {
        // Implement harvest logic
        uint256 toVault = profit * 50 / 100;
        uint256 toReserve = profit * 30 / 100;
        uint256 toBuyback = profit * 20 / 100;

        require(usdc.transfer(vault, toVault), "USDC transfer to vault failed");
        require(usdc.transfer(reserveController, toReserve), "USDC transfer to reserve failed");
        // Implement buyback logic
        startBuyback(toBuyback);

        emit Harvested(profit, toVault, toReserve, toBuyback);
    }

    function startBuyback(uint256 amount) internal {
        require(usdc.transfer(owner(), amount), "USDC transfer for buyback failed");
        emit BuybackStarted(amount);
    }

    function completeBuyback(uint256 amount) external onlyOwner {
        // Placeholder for actual buyback completion logic
        emit BuybackCompleted(amount);
    }

    function canAdmit(uint256 amountUsd6) external pure returns (bool) {
        // Example logic: always admit for testing
        amountUsd6; // silence unused warning
        return true;
    }
}
