// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProtocolDAO
 * @notice On-chain registry for Sagitta DAO governance.
 *
 * Two responsibilities:
 *   1. Council membership — addresses that can approve off-chain DAO proposals
 *      in the Sagitta frontend. Approval is the voting layer; execution of approved
 *      proposals still requires the contract owner's signature for any on-chain
 *      state change.
 *
 *   2. Contract address registry — canonical mapping of protocol contract names
 *      (e.g. "Vault", "Treasury") to their deployed addresses. Any participant who
 *      connects to the frontend reads the same set of addresses from this contract,
 *      eliminating per-browser localStorage dependency.
 *
 * Both reads (council list, address lookups) are public and require no special role.
 * All writes are restricted to the contract owner.
 */
contract ProtocolDAO is Ownable {

    // ── Council ──────────────────────────────────────────────────────────────

    address[] private _council;
    mapping(address => bool) public isCouncilMember;

    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);

    // ── Address Registry ─────────────────────────────────────────────────────

    string[]                    private _keys;
    mapping(bytes32 => address) private _registry;
    mapping(bytes32 => bool)    private _keyExists;
    mapping(bytes32 => string)  private _keyStrings;

    event AddressSet(string key, address indexed addr);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Council: writes (owner only) ─────────────────────────────────────────

    /// @notice Add an address to the DAO council.
    function addCouncilMember(address member) external onlyOwner {
        require(member != address(0), "ProtocolDAO: zero address");
        require(!isCouncilMember[member], "ProtocolDAO: already a member");
        isCouncilMember[member] = true;
        _council.push(member);
        emit CouncilMemberAdded(member);
    }

    /// @notice Remove an address from the DAO council.
    function removeCouncilMember(address member) external onlyOwner {
        require(isCouncilMember[member], "ProtocolDAO: not a member");
        isCouncilMember[member] = false;
        uint256 len = _council.length;
        for (uint256 i = 0; i < len; i++) {
            if (_council[i] == member) {
                _council[i] = _council[len - 1];
                _council.pop();
                break;
            }
        }
        emit CouncilMemberRemoved(member);
    }

    // ── Council: reads ───────────────────────────────────────────────────────

    /// @notice Returns the full council member list.
    function getCouncilMembers() external view returns (address[] memory) {
        return _council;
    }

    /// @notice Returns the number of council members.
    function councilCount() external view returns (uint256) {
        return _council.length;
    }

    // ── Address registry: writes (owner only) ────────────────────────────────

    /// @notice Set a single protocol contract address by name key.
    function setAddress(string calldata key, address addr) external onlyOwner {
        _setAddress(key, addr);
    }

    /// @notice Batch-set protocol contract addresses. Keys and addrs must be the same length.
    function setAddresses(
        string[] calldata keys,
        address[] calldata addrs
    ) external onlyOwner {
        require(keys.length == addrs.length, "ProtocolDAO: length mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            _setAddress(keys[i], addrs[i]);
        }
    }

    function _setAddress(string calldata key, address addr) internal {
        bytes32 h = keccak256(bytes(key));
        if (!_keyExists[h]) {
            _keyExists[h]    = true;
            _keyStrings[h]   = key;
            _keys.push(key);
        }
        _registry[h] = addr;
        emit AddressSet(key, addr);
    }

    // ── Address registry: reads ──────────────────────────────────────────────

    /// @notice Look up a single contract address by name key. Returns address(0) if not set.
    function getAddress(string calldata key) external view returns (address) {
        return _registry[keccak256(bytes(key))];
    }

    /// @notice Returns all registered keys and their addresses.
    function getAllAddresses()
        external
        view
        returns (string[] memory keys, address[] memory addrs)
    {
        uint256 len = _keys.length;
        keys  = _keys;
        addrs = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            addrs[i] = _registry[keccak256(bytes(_keys[i]))];
        }
    }

    /// @notice Total number of registered address keys.
    function keyCount() external view returns (uint256) {
        return _keys.length;
    }
}
