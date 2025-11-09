// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract GoldOracle {
    uint256 public goldPrice;

    event GoldPriceSet(uint256 price);

    constructor(uint256 initialPrice) {
        goldPrice = initialPrice;
    }

    function setGoldPrice(uint256 price) external {
        goldPrice = price;
        emit GoldPriceSet(price);
    }

    function getGoldPrice() external view returns (uint256) {
        return goldPrice;
    }
}
