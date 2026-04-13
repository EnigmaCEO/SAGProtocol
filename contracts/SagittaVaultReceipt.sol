// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SagittaVaultReceipt
 * @notice ERC-721 receipt NFT issued by the Vault on each user deposit.
 * @dev Each token represents an outstanding deposit and carries the batch ID and
 *      optional off-chain metadata URI. The Vault (set as minter) is the primary minter
 *      and burner; the owner may also mint/burn for admin recovery.
 *
 *      Token ID == Vault deposit ID (set at mint time), enabling Treasury and Escrow to
 *      look up deposit details directly from the Vault using the token ID as a key.
 */
contract SagittaVaultReceipt is ERC721Enumerable, Ownable {
    using Strings for uint256;
    // --- NEW state: batch + metadata support ---
    // tokenId -> batchId (0 = none)
    mapping(uint256 => uint256) public tokenBatchId;
    // tokenId -> arbitrary metadata (freeform JSON / string)
    mapping(uint256 => string) private _tokenMetadata;
    // minter address (Vault typically set as minter)
    address public minter;
    // base URI used for off-chain metadata endpoint routing
    string private _baseTokenURI;

    // NEW events
    event ReceiptBatchSet(uint256 indexed tokenId, uint256 indexed batchId);
    event ReceiptMetadataUpdated(uint256 indexed tokenId, string metadata);
    event MinterSet(address indexed minter);
    event BaseTokenURISet(string baseTokenURI);

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

    /// @notice Set metadata base URI (e.g. https://app.sagitta.xyz/api/metadata/).
    /// @dev tokenURI will resolve to `${baseURI}${tokenId}` when this value is set.
    function setBaseTokenURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseTokenURISet(baseURI_);
    }

    function baseTokenURI() external view returns (string memory) {
        return _baseTokenURI;
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
        // ownerOf() reverts with ERC721NonexistentToken if the token does not exist
        ownerOf(tokenId);
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

    /// @notice Store arbitrary metadata for a token (e.g. '{"batch":123,"type":"deposit"}').
    /// @param tokenId   The receipt token ID (must exist).
    /// @param metadata  Arbitrary UTF-8 string, typically a JSON object or IPFS CID.
    function updateMetadata(uint256 tokenId, string calldata metadata) external onlyMinterOrOwner {
        ownerOf(tokenId); // reverts if token does not exist
        _tokenMetadata[tokenId] = metadata;
        emit ReceiptMetadataUpdated(tokenId, metadata);
    }

    /// @notice Return the stored metadata string for a token.
    /// @param tokenId The receipt token ID (must exist).
    function tokenMetadata(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId); // reverts if token does not exist
        return _tokenMetadata[tokenId];
    }

    /// @notice ERC-721 metadata URI.
    /// @dev Priority:
    /// 1) baseTokenURI + tokenId (for API-backed live metadata)
    /// 2) stored tokenMetadata string (if manually set)
    /// 3) empty string (fallback)
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // ensure token exists
        ownerOf(tokenId);

        if (bytes(_baseTokenURI).length > 0) {
            return string.concat(_baseTokenURI, tokenId.toString());
        }

        string memory metadata_ = _tokenMetadata[tokenId];
        if (bytes(metadata_).length > 0) {
            return metadata_;
        }

        return "";
    }
}
