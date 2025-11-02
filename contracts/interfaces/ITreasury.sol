// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasury {
    function canAdmit(uint256 amountUsd6) external view returns (bool);
}
