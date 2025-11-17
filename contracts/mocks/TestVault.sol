// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// --- move interface to file scope ---
interface IEscrow {
    function registerDeposit(uint256 tokenId, uint256 amountUsd6, uint256 shares) external;
    function registerDepositTo(uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external;
}

contract TestVault {
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

    // Set deposit info for a tokenId (test-only)
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

    // --- Test helpers: forward registration calls to Escrow contract so msg.sender == vault (this contract) ---
    // (IEscrow is declared at file scope above)

    // Call Escrow.registerDeposit as the Vault (msg.sender == this contract)
    function forwardRegisterDeposit(address escrow, uint256 tokenId, uint256 amountUsd6, uint256 shares) external {
        IEscrow(escrow).registerDeposit(tokenId, amountUsd6, shares);
    }

    // Call Escrow.registerDepositTo as the Vault (msg.sender == this contract)
    function forwardRegisterDepositTo(address escrow, uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external {
        IEscrow(escrow).registerDepositTo(batchId, tokenId, amountUsd6, shares);
    }
}
