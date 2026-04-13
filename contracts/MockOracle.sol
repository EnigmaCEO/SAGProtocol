// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    uint256 public price;
    uint256 public updatedAt;
    bool public valid = true;

    event PriceSet(uint256 price, uint256 updatedAt);
    event OracleValiditySet(bool valid);

    function setPrice(uint256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
        emit PriceSet(_price, updatedAt);
    }

    function setValid(bool _valid) external {
        valid = _valid;
        emit OracleValiditySet(_valid);
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
    // ISagOracle / IGoldOracle legacy compatibility wrappers
    function getSagPrice() external view returns (uint256) {
        return price;
    }

    function getGoldPrice() external view returns (uint256) {
        return price;
    }

    function latest() external view returns (uint256 price8, uint256 timestamp, bool isValid) {
        return (price, updatedAt, valid);
    }
}
