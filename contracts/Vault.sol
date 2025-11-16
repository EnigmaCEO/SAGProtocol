// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IPriceOracle {
    function getPrice() external view returns (uint256); // returns price in USD with 8 decimals
}

interface IReceiptNFT {
    function mint(address to, uint256 tokenId) external;
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IEscrow {
    function registerDeposit(uint256 receiptTokenId, uint256 amountUsd6, uint256 shares) external;
}

// Minimal Treasury interface used by Vault to request collateralization
interface ITreasury {
    // legacy:
    function collateralize(uint256 depositValueUsd) external;
    // idempotent entrypoint keyed by deposit/receipt id
    function collateralizeForReceipt(uint256 receiptId, uint256 depositValueUsd) external;
}

contract Vault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Treasury address (set by owner/deployer)
    address public treasury;

    event TreasurySet(address indexed treasury);
    event TreasuryCollateralizeAttempt(uint256 indexed depositId, uint256 amountUsd6);
    event TreasuryCollateralizeFailed(uint256 indexed depositId, string reason);
    event TreasuryCollateralizeSucceeded(uint256 indexed depositId, uint256 amountUsd6);

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

    address public escrow;
    uint64 public lockDuration = 365 days;
    address public receiptNFT; // ERC-721 receipt contract

    // New: mDOT token address (Vault only handles mDOT)
    address public mdot;
    event MDotSet(address indexed mdot);

    mapping(address => AssetInfo) public assets;
    mapping(uint256 => DepositReceipt) public deposits;
    mapping(address => uint256[]) public userDeposits;
    mapping(address => uint256) public totalPrincipalByAsset;
    mapping(address => uint256) public totalSharesByAsset;
    mapping(address => mapping(address => uint256)) public sharesOf;
    mapping(address => Credit[]) public credits;
    
    uint256 public nextDepositId;

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
    event ReceiptNFTSet(address indexed nft);
    event Deposited(address indexed user, uint256 indexed tokenId, address asset, uint256 principal, uint256 unlockTimestamp);
    event Redeemed(address indexed user, uint256 indexed tokenId, address asset, uint256 principal);
    event AutoReturned(address indexed user, uint256 indexed tokenId, uint256 principal);
    event EscrowSet(address indexed escrow);

    // only callable by the registered Escrow contract
    modifier onlyEscrowOrTreasury() {
        require(msg.sender == escrow || msg.sender == treasury, "Only escrow or treasury");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // NEW: require Treasury.collateralize to succeed (production default = true)
    // keep legacy default: best-effort collateralize (do not revert deposits) unless owner flips this on
    bool public requireCollateralizeSuccess = false;
    event RequireCollateralizeSuccessSet(bool v);
    function setRequireCollateralizeSuccess(bool v) external onlyOwner {
        requireCollateralizeSuccess = v;
        emit RequireCollateralizeSuccessSet(v);
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
        // no special-case hardcoded assets here; caller should pass correct decimals/oracle

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

    /// @notice Set the Receipt NFT contract address
    function setReceiptNFT(address _nft) external onlyOwner {
        require(_nft != address(0), "invalid NFT");
        receiptNFT = _nft;
        emit ReceiptNFTSet(_nft);
    }

    /// @notice Set the Escrow contract address (used for batching)
    function setEscrow(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Escrow address cannot be zero");
        escrow = _escrow;
        emit EscrowSet(_escrow);
    }

    /// @notice Set the mDOT token contract address (Vault operates only in mDOT)
    function setMDot(address _mdot) external onlyOwner {
        require(_mdot != address(0), "invalid mdot");
        mdot = _mdot;
        emit MDotSet(_mdot);
    }

    /// @notice Set the Treasury contract address. Vault will call treasury.collateralize(...) after deposits.
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "invalid treasury");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /// @notice Deposit tokens into the vault
    /// @param asset Address of the token to deposit
    /// @param amount Amount of tokens to deposit
    function deposit(address asset, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Deposit amount must be greater than 0");
        
        AssetInfo memory assetInfo = assets[asset];
        require(assetInfo.enabled, "The specified asset is not enabled for deposits");
        // Accept any enabled asset; mdot-specific payout functions still require mdot to be configured.
        
        // Convert to USD6
        uint256 amountUsd6 = _usd6(asset, amount, assetInfo);
        
        // Transfer tokens from user
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate shares (18 decimals)
        // shares = (amount * price * 1e12) / (10^(assetDecimals + 2))
        uint256 price = IPriceOracle(assetInfo.oracle).getPrice();
        require(price > 0, "The oracle returned an invalid price");
        uint256 shares = (amount * price * 1e12) / (10 ** (assetInfo.decimals + 2));
        
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

        // --- NEW: register deposit with Escrow batching (if configured)
        if (escrow != address(0)) {
            IEscrow(escrow).registerDeposit(depositId, amountUsd6, shares);
        }
        
        // Mint receipt NFT (tokenId == depositId)
        if (receiptNFT != address(0)) {
            IReceiptNFT(receiptNFT).mint(msg.sender, depositId);
        }
        
        emit DepositAccepted(depositId, msg.sender, asset, amount, amountUsd6, shares, lockUntil);
        emit Deposited(msg.sender, depositId, asset, amount, lockUntil);

        // --- NEW: Best-effort notify Treasury to collateralize the USD value for this deposit ---
        // Do not revert the deposit if treasury call fails; just emit events for observability.
        if (treasury != address(0)) {
            emit TreasuryCollateralizeAttempt(depositId, amountUsd6);
            if (requireCollateralizeSuccess) {
                // production mode: bubble any revert so deposit cannot create unsecured collateral
                ITreasury(treasury).collateralize(amountUsd6);
                emit TreasuryCollateralizeSucceeded(depositId, amountUsd6);
            } else {
                // best-effort (legacy/testing): do not revert deposit
                try ITreasury(treasury).collateralize(amountUsd6) {
                    emit TreasuryCollateralizeSucceeded(depositId, amountUsd6);
                } catch Error(string memory reason) {
                    emit TreasuryCollateralizeFailed(depositId, reason);
                } catch {
                    emit TreasuryCollateralizeFailed(depositId, "unknown");
                }
            }
        }
    }

    /// @notice Redeem principal using the receipt NFT
    function redeem(uint256 tokenId) external nonReentrant whenNotPaused {
        require(receiptNFT != address(0), "receipt NFT not set");
        require(IReceiptNFT(receiptNFT).ownerOf(tokenId) == msg.sender, "not NFT owner");

        DepositReceipt storage receipt = deposits[tokenId];
        require(!receipt.withdrawn, "Already withdrawn");
        require(block.timestamp >= receipt.lockUntil, "Lock period not expired");

        // Mark as withdrawn
        receipt.withdrawn = true;

        // Update tracking
        totalPrincipalByAsset[receipt.asset] -= receipt.amount;
        totalSharesByAsset[receipt.asset] -= receipt.shares;
        sharesOf[receipt.user][receipt.asset] -= receipt.shares;

        // Update historical record to current NFT owner
        receipt.user = msg.sender;

        // Burn NFT and transfer principal
        IReceiptNFT(receiptNFT).burn(tokenId);
        IERC20(receipt.asset).safeTransfer(msg.sender, receipt.amount);

        emit PrincipalWithdrawn(tokenId, msg.sender, receipt.asset, receipt.amount);
        emit Redeemed(msg.sender, tokenId, receipt.asset, receipt.amount);
    }

    /// @notice Finalize a payout for a receipt. Vault pays out in mDOT by converting payoutUsd6 -> mDOT token amount.
    function finalizePayout(uint256 tokenId, uint256 payoutUsd6) external nonReentrant onlyEscrowOrTreasury {
        require(receiptNFT != address(0), "receipt NFT not set");
        require(mdot != address(0), "mDOT not configured");

        DepositReceipt storage receipt = deposits[tokenId];
        require(!receipt.withdrawn, "Already withdrawn");

        // Determine current NFT owner
        address nftOwner = IReceiptNFT(receiptNFT).ownerOf(tokenId);
        require(nftOwner != address(0), "NFT owner invalid");

        // Compute required token amount for payoutUsd6 using asset info of mDOT
        AssetInfo memory info = assets[mdot];
        require(info.enabled, "mDOT asset not enabled");
        uint256 price = IPriceOracle(info.oracle).getPrice();
        require(price > 0, "Invalid oracle price for mDOT");
        // amountTokens = payoutUsd6 * 10^(decimals+2) / price8  (reverse of _usd6)
        uint256 tokenAmount = (payoutUsd6 * (10 ** (uint256(info.decimals) + 2))) / price;

        // Confirm Vault holds enough mDOT (Escrow should transfer prior to calling or Vault funded)
        uint256 vaultTokenBal = IERC20(mdot).balanceOf(address(this));
        require(vaultTokenBal >= tokenAmount, "Vault lacks mDOT for payout");

        // Mark withdrawn and burn NFT (best-effort)
        receipt.withdrawn = true;
        try IReceiptNFT(receiptNFT).burn(tokenId) {} catch {}

        // Transfer mDOT to NFT owner
        IERC20(mdot).safeTransfer(nftOwner, tokenAmount);

        // Update tracking (principal/shares bookkeeping remains for historical)
        totalPrincipalByAsset[receipt.asset] -= receipt.amount;
        totalSharesByAsset[receipt.asset] -= receipt.shares;
        sharesOf[receipt.user][receipt.asset] -= receipt.shares;

        emit PrincipalWithdrawn(tokenId, nftOwner, receipt.asset, receipt.amount);
        emit Redeemed(nftOwner, tokenId, receipt.asset, receipt.amount);
    }

    /// @notice Automatically return matured deposits
    /// @param tokenId Receipt token ID
    function autoReturn(uint256 tokenId) public nonReentrant whenNotPaused {
        require(receiptNFT != address(0), "receipt NFT not set");
        DepositReceipt storage receipt = deposits[tokenId];
        require(receipt.lockUntil > 0, "Invalid receipt");
        //require(block.timestamp >= receipt.lockUntil, "Deposit still locked");
        require(!receipt.withdrawn, "Already withdrawn");

        address nftOwner;
        // Try/catch to provide a clear error if NFT does not exist
        try IReceiptNFT(receiptNFT).ownerOf(tokenId) returns (address _nftOwner) {
            nftOwner = _nftOwner;
        } catch {
            revert("NFT does not exist");
        }
        require(msg.sender == nftOwner, "not NFT owner");

        uint256 principal = receipt.amount;

        // Update historical record to current NFT owner
        receipt.user = nftOwner;

        receipt.withdrawn = true;
        IReceiptNFT(receiptNFT).burn(tokenId);

        // Transfer principal to owner
        IERC20(receipt.asset).safeTransfer(nftOwner, principal);

        emit AutoReturned(nftOwner, tokenId, principal);
    }

    /// @notice Owner-only emergency: force return of a deposit regardless of lock.
    /// @dev For admin/recovery/testing only. Transfers the principal back to current NFT owner.
    function adminForceReturn(uint256 tokenId) external onlyOwner nonReentrant {
        require(receiptNFT != address(0), "receipt NFT not set");
        DepositReceipt storage receipt = deposits[tokenId];
        require(!receipt.withdrawn, "Already withdrawn");

        address nftOwner;
        // Try to read NFT owner; revert if NFT doesn't exist
        try IReceiptNFT(receiptNFT).ownerOf(tokenId) returns (address _nftOwner) {
            nftOwner = _nftOwner;
        } catch {
            revert("NFT does not exist");
        }

        // Update historical record to current NFT owner
        receipt.user = nftOwner;

        receipt.withdrawn = true;
        // Best-effort burn
        try IReceiptNFT(receiptNFT).burn(tokenId) {} catch {}

        // Transfer principal to owner
        IERC20(receipt.asset).safeTransfer(nftOwner, receipt.amount);

        emit AutoReturned(nftOwner, tokenId, receipt.amount);
    }

    /// @notice Batch process expired receipts
    /// @param tokenIds Array of receipt token IDs
    function processExpiredReceipts(uint256[] calldata tokenIds) external nonReentrant whenNotPaused {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            // try/catch to skip already returned or not yet matured
            try this.autoReturn(tokenIds[i]) {} catch {}
        }
    }

    /// @notice Issue a profit credit to a user (Treasury only)
    /// @param user Address of the user receiving the credit
    /// @param amountUsd6 Amount in USD with 6 decimals
    /// @param unlockAt Timestamp when the credit can be claimed
    function issueCredit(address user, uint256 amountUsd6, uint64 unlockAt) external onlyOwner {
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

        require(mdot != address(0), "mDOT not configured for claim payout");
        AssetInfo memory info = assets[mdot];
        require(info.enabled, "mDOT asset not enabled");
        uint256 price = IPriceOracle(info.oracle).getPrice();
        require(price > 0, "Invalid oracle price for mDOT");

        // Mark as claimed
        credit.claimed = true;

        // Convert USD6 -> mDOT token amount
        uint256 tokenAmount = (credit.amountUsd6 * (10 ** (uint256(info.decimals) + 2))) / price;
        uint256 vaultBal = IERC20(mdot).balanceOf(address(this));
        require(vaultBal >= tokenAmount, "Vault has insufficient mDOT for payout");
        IERC20(mdot).safeTransfer(msg.sender, tokenAmount);

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

    /// View helper: returns receipt details by tokenId
    function getReceipt(uint256 tokenId)
        external
        view
        returns (
            address receiptOwner,
            address asset,
            uint256 principal,
            uint256 entryValueUsd,
            uint256 depositTimestamp,
            uint256 unlockTimestamp,
            bool withdrawn
        )
    {
        DepositReceipt memory r = deposits[tokenId];
        receiptOwner = r.user;
        asset = r.asset;
        principal = r.amount;
        entryValueUsd = r.amountUsd6;
        depositTimestamp = r.createdAt;
        unlockTimestamp = r.lockUntil;
        withdrawn = r.withdrawn;
    }

    /// Convenience: list of tokenIds (receiptIds) for user
    function getUserReceipts(address user) external view returns (uint256[] memory) {
        return userDeposits[user];
    }

    /// Aggregates for dashboard
    function getUserTotals(address user)
        external
        view
        returns (
            uint256 totalPrincipalLocked,
            uint256 totalUnlockedPrincipal,
            uint256 activeCount,
            uint256 nextUnlockTimestamp
        )
    {
        uint256[] memory ids = userDeposits[user];
        uint256 nextUnlock = 0;
        uint64 now64 = uint64(block.timestamp);

        for (uint256 i = 0; i < ids.length; i++) {
            DepositReceipt memory r = deposits[ids[i]];
            if (!r.withdrawn) {
                if (now64 < r.lockUntil) {
                    totalPrincipalLocked += r.amountUsd6; // USD6 locked
                    activeCount += 1;
                    if (nextUnlock == 0 || r.lockUntil < nextUnlock) {
                        nextUnlock = r.lockUntil;
                    }
                } else {
                    totalUnlockedPrincipal += r.amountUsd6; // USD6 unlocked
                }
            }
        }
        nextUnlockTimestamp = nextUnlock;
    }

    // Add this function for compatibility with scripts and frontend
    function owner() public view override returns (address) {
        return Ownable.owner();
    }
}
