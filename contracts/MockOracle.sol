// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    int256 private price;

    function setPrice(int256 _price) external {
        price = _price;
    }

    function latestAnswer() external view returns (int256) {
        return price;
    }
}
