// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SAGTokenStub {
    string public name = "SAG Test";
    string public symbol = "tSAG";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor() {}

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function faucetMint(address to, uint256 amount) external {
        mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        address from = msg.sender;
        require(balanceOf[from] >= amount, "insuf");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
