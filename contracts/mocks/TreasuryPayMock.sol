// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Minimal treasury mock for tests:
 * - canAdmit() returns a configurable boolean (default true)
 * - payOut() transfers USDC to recipient
 */
contract TreasuryPayMock {
    IERC20 public immutable usdc;
    bool public admit = true;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    // --- Coverage gate used by Vault.deposit(...) ---
    function canAdmit(uint256 /*usd6*/) external view returns (bool) {
        return admit;
    }
    function setAdmit(bool v) external { admit = v; } // use in tests to simulate coverage failure

    // --- Payout used by Vault.claimCredit(...) ---
    function payOut(address to, uint256 usd6) external returns (bool) {
        require(to != address(0), "to=0");
        require(usdc.transfer(to, usd6), "transfer failed");
        return true;
    }

    // Optional alias if your Vault calls a different name
    function payOutUsd6(address to, uint256 usd6) external returns (bool) {
        return this.payOut(to, usd6);
    }

    // --- Fallback to accept any other calls from Vault ---
    fallback() external payable {}
    receive() external payable {}
}
