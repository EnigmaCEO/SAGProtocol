// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    uint256 public price;

    function setPrice(uint256 _price) external {
        price = _price;
    }

    // Compatibility wrappers expected by Treasury
    // Treasury expects getSagPriceUsd() and getGoldPriceUsd() returning price with 8 decimals
    function getSagPriceUsd() external view returns (uint256) {
        return price;
    }

    function getGoldPriceUsd() external view returns (uint256) {
        return price;
    }

    function getPrice() external view returns (uint256) {
        return price;
    }

    // Added wrappers for different oracle interfaces used in tests/contracts
    // PriceOracleRouter expects ISagOracle.getSagPrice() and IGoldOracle.getGoldPrice()
    function getSagPrice() external view returns (uint256) {
        return price;
    }

    function getGoldPrice() external view returns (uint256) {
        return price;
    }
}
