// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockDOT is ERC20 {
    uint8 private _decimals;

    constructor() ERC20("Mock Polkadot", "mDOT") {
        _decimals = 10; // DOT uses 10 decimals
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (for testing only)
    /// @param to Address to receive the minted tokens
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mint tokens to the caller (convenience function)
    /// @param amount Amount of tokens to mint
    function mintTo(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
