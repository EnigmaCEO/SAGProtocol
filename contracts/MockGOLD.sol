// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockGOLD is ERC20 {
    constructor() ERC20("Mock GOLD", "mGOLD") {}

    function faucetMint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
