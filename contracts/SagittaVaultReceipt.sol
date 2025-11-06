// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SagittaVaultReceipt is ERC721Enumerable, Ownable {
    address public minter;

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {}

    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "invalid minter");
        minter = _minter;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "not minter");
        _;
    }

    function mint(address to, uint256 tokenId) external onlyMinter {
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external onlyMinter {
        _burn(tokenId);
    }
}
