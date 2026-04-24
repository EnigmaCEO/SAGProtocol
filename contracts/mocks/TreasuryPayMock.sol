// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TreasuryPayMock {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    uint256 public totalCollateralized;
    mapping(uint256 => bool) public processedReceipts;

    constructor(address usdc_) {
        usdc = IERC20(usdc_);
    }

    receive() external payable {}

    function collateralize(uint256 amountUsd6) external {
        totalCollateralized += amountUsd6;
    }

    function collateralizeForReceipt(uint256 receiptId, uint256 amountUsd6) external {
        if (processedReceipts[receiptId]) return;
        processedReceipts[receiptId] = true;
        totalCollateralized += amountUsd6;
    }

    function registerVaultOriginLot(
        uint256 receiptId,
        uint256 amountUsd6,
        uint64
    ) external returns (uint256) {
        if (!processedReceipts[receiptId]) {
            processedReceipts[receiptId] = true;
            totalCollateralized += amountUsd6;
        }
        return receiptId + 1;
    }

    function fundVault(address vault, uint256 amount) external {
        usdc.safeTransfer(vault, amount);
    }
}
