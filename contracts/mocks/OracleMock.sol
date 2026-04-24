// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OracleMock {
    uint256 public price;

    constructor(uint256 price_) {
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function getPrice() external view returns (uint256) {
        return price;
    }
}
