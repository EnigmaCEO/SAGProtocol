// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPriceOracle {
    /// @notice Returns the asset price in USD with 8 decimals
    /// @return price The current price (e.g., 1 USDC = 100000000 = $1.00)
    function getPrice() external view returns (uint256 price);
}
