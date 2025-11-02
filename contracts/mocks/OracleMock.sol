// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OracleMock {
    uint256 private price;

    constructor(uint256 initialPrice) {
        price = initialPrice;
    }

    function getPrice() external view returns (uint256) {
        return price;
    }

    function setPrice(uint256 newPrice) external {
        price = newPrice;
    }
}
