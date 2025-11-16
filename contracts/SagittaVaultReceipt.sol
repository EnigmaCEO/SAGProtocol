// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SagittaVaultReceipt is ERC721Enumerable, Ownable {
    // --- NEW state: batch + metadata support ---
    // tokenId -> batchId (0 = none)
    mapping(uint256 => uint256) public tokenBatchId;
    // tokenId -> arbitrary metadata (freeform JSON / string)
    mapping(uint256 => string) private _tokenMetadata;
    // minter address (Vault typically set as minter)
    address public minter;

    // NEW events
    event ReceiptBatchSet(uint256 indexed tokenId, uint256 indexed batchId);
    event ReceiptMetadataUpdated(uint256 indexed tokenId, string metadata);
    event MinterSet(address indexed minter);

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {
        // owner is set via Ownable(msg.sender)
    }

    // NEW modifier: only minter or owner
    modifier onlyMinterOrOwner() {
        require(msg.sender == owner() || msg.sender == minter, "Only owner or minter");
        _;
    }

    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "invalid minter");
        minter = _minter;
        emit MinterSet(_minter);
    }

    // Keep mint function compatible with existing Vault calls (onlyMinterOrOwner)
    function mint(address to, uint256 tokenId) external onlyMinterOrOwner {
        // defer to ERC721 mint implementation
        _safeMint(to, tokenId);
    }

    // Keep burn if present (owner/minter control) — preserve if already implemented
    function burn(uint256 tokenId) external onlyMinterOrOwner {
        _burn(tokenId);
    }

    // --- NEW: batch setters (aliases) ---
    // setBatch(uint256 tokenId, uint256 batchId)
    function setBatch(uint256 tokenId, uint256 batchId) public onlyMinterOrOwner {
        // Use external ownerOf check to ensure token exists (ownerOf reverts if not)
        try this.ownerOf(tokenId) returns (address) {
            // exists
        } catch {
            revert("nonexistent token");
        }
        tokenBatchId[tokenId] = batchId;
        emit ReceiptBatchSet(tokenId, batchId);
    }

    // setTokenBatch(uint256 tokenId, uint256 batchId) alias
    function setTokenBatch(uint256 tokenId, uint256 batchId) external onlyMinterOrOwner {
        setBatch(tokenId, batchId);
    }

    // setReceiptBatch(uint256 tokenId, uint256 batchId) alias
    function setReceiptBatch(uint256 tokenId, uint256 batchId) external onlyMinterOrOwner {
        setBatch(tokenId, batchId);
    }

    // --- NEW: metadata updater ---
    // updateMetadata(uint256 tokenId, string metadata) - stores arbitrary metadata (e.g. '{"batch":123}')
    function updateMetadata(uint256 tokenId, string calldata metadata) external onlyMinterOrOwner {
        try this.ownerOf(tokenId) returns (address) {
            // exists
        } catch {
            revert("nonexistent token");
        }
        _tokenMetadata[tokenId] = metadata;
        emit ReceiptMetadataUpdated(tokenId, metadata);
    }

    // view helper for metadata
    function tokenMetadata(uint256 tokenId) external view returns (string memory) {
        // ownerOf will revert if token doesn't exist; propagate that revert to caller
        try this.ownerOf(tokenId) returns (address) {
            return _tokenMetadata[tokenId];
        } catch {
            revert("nonexistent token");
        }
    }

    // Optionally override tokenURI to include metadata pointer if desired.
    // Leave existing tokenURI behavior unchanged unless you want on-chain tokenURI generation here.
}
