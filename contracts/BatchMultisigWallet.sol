// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal 2-of-3 multisig wallet deployed per batch after Batch Authority Binding anchor.
/// Owners are exactly the three on-chain role authority signers: Treasury/Vault, Escrow, Continuity/SCE.
/// Threshold is fixed at 2. Each transaction requires 2-of-3 owner confirmations before execution.
contract BatchMultisigWallet {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────────

    uint8 public constant threshold = 2;

    // ─── Immutable binding ───────────────────────────────────────────────────────

    uint256 public immutable sourceBatchId;
    bytes32 public immutable batchAuthorityBindingHash;

    // ─── Owners (Treasury, Escrow, Continuity/SCE) ───────────────────────────────

    address[3] private _owners;
    mapping(address => bool) private _isOwner;

    // ─── Transaction management ───────────────────────────────────────────────────

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint8 confirmationCount;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    // ─── Events ───────────────────────────────────────────────────────────────────

    event TransactionSubmitted(uint256 indexed txIndex, address indexed submitter, address to, uint256 value);
    event TransactionConfirmed(uint256 indexed txIndex, address indexed owner);
    event TransactionExecuted(uint256 indexed txIndex, address indexed executor);
    event ConfirmationRevoked(uint256 indexed txIndex, address indexed owner);
    event Received(address indexed sender, uint256 value);

    // ─── Errors ───────────────────────────────────────────────────────────────────

    error NotOwner();
    error TransactionDoesNotExist(uint256 txIndex);
    error AlreadyExecuted(uint256 txIndex);
    error AlreadyConfirmed(uint256 txIndex);
    error NotConfirmed(uint256 txIndex);
    error InsufficientConfirmations(uint256 txIndex, uint8 have, uint8 need);
    error ExecutionFailed(uint256 txIndex);
    error ZeroAddress();
    error DuplicateOwner();

    // ─── Constructor ──────────────────────────────────────────────────────────────

    constructor(
        address[3] memory owners_,
        uint256 sourceBatchId_,
        bytes32 batchAuthorityBindingHash_
    ) {
        for (uint8 i = 0; i < 3; i++) {
            if (owners_[i] == address(0)) revert ZeroAddress();
        }
        if (
            owners_[0] == owners_[1] ||
            owners_[1] == owners_[2] ||
            owners_[0] == owners_[2]
        ) revert DuplicateOwner();

        _owners = owners_;
        for (uint8 i = 0; i < 3; i++) {
            _isOwner[owners_[i]] = true;
        }

        sourceBatchId = sourceBatchId_;
        batchAuthorityBindingHash = batchAuthorityBindingHash_;
    }

    // ─── View ─────────────────────────────────────────────────────────────────────

    function getOwners() external view returns (address[3] memory) {
        return _owners;
    }

    function isOwner(address account) external view returns (bool) {
        return _isOwner[account];
    }

    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }

    // ─── Multisig execution ───────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (!_isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier txExists(uint256 txIndex) {
        if (txIndex >= transactions.length) revert TransactionDoesNotExist(txIndex);
        _;
    }

    modifier notExecuted(uint256 txIndex) {
        if (transactions[txIndex].executed) revert AlreadyExecuted(txIndex);
        _;
    }

    /// @notice Submit a transaction for multi-signature approval.
    function submitTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 txIndex)
    {
        txIndex = transactions.length;
        transactions.push(Transaction({ to: to, value: value, data: data, executed: false, confirmationCount: 0 }));
        emit TransactionSubmitted(txIndex, msg.sender, to, value);
    }

    /// @notice Confirm a pending transaction. Execution happens automatically when threshold is reached.
    function confirmTransaction(uint256 txIndex)
        external
        onlyOwner
        txExists(txIndex)
        notExecuted(txIndex)
    {
        if (confirmed[txIndex][msg.sender]) revert AlreadyConfirmed(txIndex);
        confirmed[txIndex][msg.sender] = true;
        transactions[txIndex].confirmationCount++;
        emit TransactionConfirmed(txIndex, msg.sender);

        if (transactions[txIndex].confirmationCount >= threshold) {
            _execute(txIndex);
        }
    }

    /// @notice Revoke a previously submitted confirmation.
    function revokeConfirmation(uint256 txIndex)
        external
        onlyOwner
        txExists(txIndex)
        notExecuted(txIndex)
    {
        if (!confirmed[txIndex][msg.sender]) revert NotConfirmed(txIndex);
        confirmed[txIndex][msg.sender] = false;
        transactions[txIndex].confirmationCount--;
        emit ConfirmationRevoked(txIndex, msg.sender);
    }

    /// @notice Manually trigger execution of a transaction that has already reached threshold.
    function executeTransaction(uint256 txIndex)
        external
        onlyOwner
        txExists(txIndex)
        notExecuted(txIndex)
    {
        if (transactions[txIndex].confirmationCount < threshold) {
            revert InsufficientConfirmations(txIndex, transactions[txIndex].confirmationCount, threshold);
        }
        _execute(txIndex);
    }

    function _execute(uint256 txIndex) internal {
        Transaction storage t = transactions[txIndex];
        t.executed = true;
        (bool ok, ) = t.to.call{ value: t.value }(t.data);
        if (!ok) revert ExecutionFailed(txIndex);
        emit TransactionExecuted(txIndex, msg.sender);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
