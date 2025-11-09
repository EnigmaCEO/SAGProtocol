// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SAGToken is ERC20, Ownable {
    // Event emitted when the treasury address is set
    event TreasurySet(address indexed treasury);

    // Address of the treasury
    address public treasury;

    // Constructor to initialize the token name and symbol
    constructor() ERC20("SAG Token", "SAG") Ownable(msg.sender) {}

    // Function to set the treasury address, callable only by the owner
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury address cannot be zero");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    // Function to mint new tokens, callable only by the owner
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Cannot mint to the zero address");
        require(amount > 0, "Mint amount must be greater than zero");
        _mint(to, amount);
    }

    // Function to burn tokens, callable only by the owner
    function burn(address from, uint256 amount) external onlyOwner {
        require(from != address(0), "Cannot burn from the zero address");
        require(amount > 0, "Burn amount must be greater than zero");
        _burn(from, amount);
    }

    // Function to mint tokens for testing or development purposes
    function faucetMint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
