// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VaultStub {
    struct Deposit {
        address user;
        address asset;
        uint256 amount;
        uint256 amountUsd6;
        uint256 shares;
        uint64 createdAt;
        uint64 lockUntil;
        bool withdrawn;
    }

    mapping(uint256 => Deposit) public deposits;

    // parameterless constructor for tests
    constructor() {}

    // Test helper to set deposit info
    function setDeposit(
        uint256 id,
        address user,
        address asset,
        uint256 amount,
        uint256 amountUsd6,
        uint256 shares,
        uint64 createdAt,
        uint64 lockUntil,
        bool withdrawn
    ) external {
        deposits[id] = Deposit(user, asset, amount, amountUsd6, shares, createdAt, lockUntil, withdrawn);
    }

    // Mirror the real Vault API used by Escrow
    function depositInfo(uint256 id) external view returns (
        address user,
        address asset,
        uint256 amount,
        uint256 amountUsd6,
        uint256 shares,
        uint64 createdAt,
        uint64 lockUntil,
        bool withdrawn
    ) {
        Deposit storage d = deposits[id];
        return (d.user, d.asset, d.amount, d.amountUsd6, d.shares, d.createdAt, d.lockUntil, d.withdrawn);
    }
}
