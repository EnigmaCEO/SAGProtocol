// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface ITreasury {
    function canAdmit(uint256 amountUsd6) external view returns (bool);
}

interface ITreasuryPay {
    function payOut(address to, uint256 usd6) external;
}

interface IPriceOracle {
    function getPrice() external view returns (uint256); // returns price in USD with 8 decimals
}

contract Vault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct AssetInfo {
        bool enabled;
        uint8 decimals;
        address oracle;
    }

    struct DepositReceipt {
        address user;
        address asset;
        uint256 amount;
        uint256 amountUsd6;
        uint256 shares;
        uint64 createdAt;
        uint64 lockUntil;
        bool withdrawn;
    }

    struct Credit {
        uint256 amountUsd6;
        uint64 unlockAt;
        bool claimed;
    }

    address public treasury;
    uint64 public lockDuration = 365 days;

    mapping(address => AssetInfo) public assets;
    mapping(uint256 => DepositReceipt) public deposits;
    mapping(address => uint256[]) public userDeposits;
    mapping(address => uint256) public totalPrincipalByAsset;
    mapping(address => uint256) public totalSharesByAsset;
    mapping(address => mapping(address => uint256)) public sharesOf;
    mapping(address => Credit[]) public credits;
    
    uint256 public nextDepositId;

    event TreasurySet(address indexed treasury);
    event LockSecondsSet(uint64 seconds_);
    event AssetSet(address indexed asset, bool enabled, uint8 decimals, address oracle);
    event DepositAccepted(
        uint256 indexed id,
        address indexed user,
        address indexed asset,
        uint256 amount,
        uint256 usd6,
        uint256 shares,
        uint64 lockUntil
    );
    event PrincipalWithdrawn(
        uint256 indexed id,
        address indexed user,
        address indexed asset,
        uint256 amount
    );
    event ProfitCreditIssued(address indexed user, uint256 amountUsd6, uint64 unlockAt);
    event ProfitCreditClaimed(address indexed user, uint256 amountUsd6);

    modifier onlyTreasury() {
        require(msg.sender == treasury, "not treasury");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice Set the Treasury contract address
    /// @param _treasury Address of the Treasury contract
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury address cannot be zero");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /// @notice Set the lock duration for deposits
    /// @param _duration Lock duration in seconds
    function setLockDuration(uint64 _duration) external onlyOwner {
        lockDuration = _duration;
        emit LockSecondsSet(_duration);
    }

    /// @notice Configure an asset for deposits
    /// @param asset Address of the ERC20 token
    /// @param enabled Whether the asset is enabled for deposits
    /// @param decimals Number of decimals the token uses
    /// @param oracle Address of the price oracle for this asset
    function setAsset(
        address asset,
        bool enabled,
        uint8 decimals,
        address oracle
    ) external onlyOwner {
        require(asset != address(0), "Invalid asset address");
        if (enabled) {
            require(oracle != address(0), "Oracle required for enabled asset");
            require(decimals > 0 && decimals <= 18, "Invalid decimals");
        }
        
        assets[asset] = AssetInfo({
            enabled: enabled,
            decimals: decimals,
            oracle: oracle
        });
        
        emit AssetSet(asset, enabled, decimals, oracle);
    }

    /// @notice Deposit tokens into the vault
    /// @param asset Address of the token to deposit
    /// @param amount Amount of tokens to deposit
    function deposit(address asset, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        
        AssetInfo memory assetInfo = assets[asset];
        require(assetInfo.enabled, "Asset not enabled");
        
        // Convert to USD6
        uint256 amountUsd6 = _usd6(asset, amount, assetInfo);
        
        // Check Treasury coverage
        require(treasury != address(0), "Treasury not set");
        require(ITreasury(treasury).canAdmit(amountUsd6), "Treasury coverage insufficient");
        
        // Transfer tokens from user
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate shares (1:1 with USD6 value for simplicity)
        uint256 shares = amountUsd6;
        
        // Create deposit receipt
        uint64 now64 = uint64(block.timestamp);
        uint64 lockUntil = now64 + lockDuration;
        
        uint256 depositId = nextDepositId++;
        deposits[depositId] = DepositReceipt({
            user: msg.sender,
            asset: asset,
            amount: amount,
            amountUsd6: amountUsd6,
            shares: shares,
            createdAt: now64,
            lockUntil: lockUntil,
            withdrawn: false
        });
        
        // Update tracking
        userDeposits[msg.sender].push(depositId);
        totalPrincipalByAsset[asset] += amount;
        totalSharesByAsset[asset] += shares;
        sharesOf[msg.sender][asset] += shares;
        
        emit DepositAccepted(depositId, msg.sender, asset, amount, amountUsd6, shares, lockUntil);
    }

    /// @notice Withdraw principal after lock period expires
    /// @param id Deposit receipt ID
    /// @param to Address to receive the withdrawn tokens
    function withdrawPrincipal(uint256 id, address to) external nonReentrant whenNotPaused {
        require(to != address(0), "Invalid recipient");
        
        DepositReceipt storage receipt = deposits[id];
        require(receipt.user == msg.sender, "Not deposit owner");
        require(!receipt.withdrawn, "Already withdrawn");
        require(block.timestamp >= receipt.lockUntil, "Lock period not expired");
        
        // Mark as withdrawn
        receipt.withdrawn = true;
        
        // Update tracking
        totalPrincipalByAsset[receipt.asset] -= receipt.amount;
        totalSharesByAsset[receipt.asset] -= receipt.shares;
        sharesOf[msg.sender][receipt.asset] -= receipt.shares;
        
        // Transfer tokens
        IERC20(receipt.asset).safeTransfer(to, receipt.amount);
        
        emit PrincipalWithdrawn(id, msg.sender, receipt.asset, receipt.amount);
    }

    /// @notice Issue a profit credit to a user (Treasury only)
    /// @param user Address of the user receiving the credit
    /// @param amountUsd6 Amount in USD with 6 decimals
    /// @param unlockAt Timestamp when the credit can be claimed
    function issueCredit(address user, uint256 amountUsd6, uint64 unlockAt) external onlyTreasury {
        require(user != address(0), "Invalid user");
        require(amountUsd6 > 0, "Invalid amount");
        
        credits[user].push(Credit({
            amountUsd6: amountUsd6,
            unlockAt: unlockAt,
            claimed: false
        }));
        
        emit ProfitCreditIssued(user, amountUsd6, unlockAt);
    }

    /// @notice Claim a profit credit
    /// @param index Index of the credit in the user's credits array
    function claimCredit(uint256 index) external nonReentrant whenNotPaused {
        Credit[] storage userCredits = credits[msg.sender];
        require(index < userCredits.length, "Invalid credit index");
        
        Credit storage credit = userCredits[index];
        require(!credit.claimed, "Credit already claimed");
        require(block.timestamp >= credit.unlockAt, "Credit not unlocked");
        
        // Mark as claimed
        credit.claimed = true;
        
        // Request payout from Treasury
        ITreasuryPay(treasury).payOut(msg.sender, credit.amountUsd6);
        
        emit ProfitCreditClaimed(msg.sender, credit.amountUsd6);
    }

    /// @notice Pause the contract (owner only)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract (owner only)
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sweep accidentally sent tokens (owner only)
    /// @param token Address of the token to sweep
    /// @param to Address to receive the tokens
    function sweep(address token, address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(!assets[token].enabled, "Cannot sweep enabled asset");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance to sweep");
        
        IERC20(token).safeTransfer(to, balance);
    }

    function _usd6(
        address /* asset */,
        uint256 amount,
        AssetInfo memory assetInfo
    ) internal view returns (uint256) {
        // Get price from oracle (8 decimals USD)
        uint256 price = IPriceOracle(assetInfo.oracle).getPrice();
        require(price > 0, "Invalid oracle price");
        
        // Formula: (amount * price) / (10^assetDecimals * 10^8) * 10^6
        // Simplifies to: (amount * price) / (10^(assetDecimals + 2))
        uint256 usd6 = (amount * price) / (10 ** (assetInfo.decimals + 2));
        
        return usd6;
    }

    /// @notice Get principal balance for a user and asset
    /// @param user Address of the user
    /// @param asset Address of the asset
    /// @return total Total principal (non-withdrawn deposits)
    function principalOf(address user, address asset) external view returns (uint256) {
        uint256 total = 0;
        uint256[] memory depositIds = userDeposits[user];
        
        for (uint256 i = 0; i < depositIds.length; i++) {
            DepositReceipt memory receipt = deposits[depositIds[i]];
            if (receipt.asset == asset && !receipt.withdrawn) {
                total += receipt.amount;
            }
        }
        
        return total;
    }

    /// @notice Get all deposit IDs for a user
    /// @param user Address of the user
    /// @return Array of deposit IDs
    function userDepositsOf(address user) external view returns (uint256[] memory) {
        return userDeposits[user];
    }

    /// @notice Get deposit information by ID
    /// @param id Deposit receipt ID
    /// @return Deposit receipt details
    function depositInfo(uint256 id) external view returns (DepositReceipt memory) {
        return deposits[id];
    }

    /// @notice Get total principal and shares for an asset
    /// @param asset Address of the asset
    /// @return principal Total principal amount
    /// @return shares Total shares issued
    function totals(address asset) external view returns (uint256 principal, uint256 shares) {
        return (totalPrincipalByAsset[asset], totalSharesByAsset[asset]);
    }

    /// @notice Get pending credits for a user
    /// @param user Address of the user
    /// @return total Total USD6 value of all unclaimed credits
    /// @return unlocked USD6 value of unlocked unclaimed credits
    function pendingCreditsUsd6(address user) external view returns (uint256 total, uint256 unlocked) {
        Credit[] memory userCredits = credits[user];
        uint64 now64 = uint64(block.timestamp);
        
        for (uint256 i = 0; i < userCredits.length; i++) {
            if (!userCredits[i].claimed) {
                total += userCredits[i].amountUsd6;
                if (now64 >= userCredits[i].unlockAt) {
                    unlocked += userCredits[i].amountUsd6;
                }
            }
        }
        
        return (total, unlocked);
    }

    /// @notice Get all credits for a user
    /// @param user Address of the user
    /// @return Array of credits
    function getUserCredits(address user) external view returns (Credit[] memory) {
        return credits[user];
    }

    /// @notice Get the total USD deposited by a user
    /// @param user The user address
    /// @return Total USD deposited
    function depositedUsd(address user) external view returns (uint256) {
        uint256 total = 0;
        uint256[] memory depositIds = userDeposits[user];
        for (uint256 i = 0; i < depositIds.length; i++) {
            DepositReceipt memory receipt = deposits[depositIds[i]];
            if (!receipt.withdrawn) {
                total += receipt.amountUsd6;
            }
        }
        return total;
    }

    /// @notice Get the number of receipts for a user
    /// @param user The user address
    /// @return Number of deposit receipts
    function receiptCount(address user) external view returns (uint256) {
        return userDeposits[user].length;
    }

    /// @notice Get the number of credits for a user
    /// @param user The user address
    /// @return Number of credits
    function creditCount(address user) external view returns (uint256) {
        return credits[user].length;
    }

    /// @notice Get receipts by index (alias for deposits via userDeposits)
    /// @param user The user address
    /// @param index The index in the user's deposits array
    /// @return The deposit receipt
    function receipts(address user, uint256 index) external view returns (DepositReceipt memory) {
        require(index < userDeposits[user].length, "Invalid receipt index");
        uint256 depositId = userDeposits[user][index];
        return deposits[depositId];
    }

    /// @notice Get the share balance of a user for a specific asset
    /// @param user The user address
    /// @param asset The asset address (ignored for now, returns total shares)
    /// @return Share balance
    function balanceOf(address user, address asset) external view returns (uint256) {
        return sharesOf[user][asset];
    }

    /// @notice Get the total share balance of a user (for compatibility)
    /// @param user The user address
    /// @return Share balance across all assets
    function balanceOf(address user) external pure returns (uint256) {
        // For simplicity, we'll need to iterate through enabled assets
        // This is a simplified version - in production you may want to track this differently
        // Note: This would need to track all assets the user has shares in
        // For now, return 0 as placeholder - implement based on your needs
        user; // Silence unused parameter warning
        return 0;
    }
}
