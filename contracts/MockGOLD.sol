// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockGOLD is ERC20, Ownable {
    constructor() ERC20("Mock GOLD", "mGOLD") Ownable(msg.sender) {}

    // Standard mint function, onlyOwner
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Faucet mint for testing/dev, public
    function faucetMint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
