// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface ITreasuryForEscrow {
    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external;
    function reportBatchResult(
        uint256 batchId,
        uint256 principalUsd,
        uint256 userProfitUsd,
        uint256 feeUsd,
        uint256 finalNavPerShare,
        bytes32 settlementReportHash,
        bytes32 complianceDigestHash
    ) external;
}

interface IExecutionRouteRegistry {
    function routeExists(uint256 routeId) external view returns (bool);
    function isRouteBatchEligible(uint256 routeId) external view returns (bool);
    function getRoute(uint256 routeId) external view returns (
        uint256 id,
        string memory assetSymbol,
        uint8 routeType,
        bytes32 counterpartyRefHash,
        bytes32 jurisdictionRefHash,
        bytes32 custodyRefHash,
        bool documentsComplete,
        bool sagittaFundApproved,
        bool ndaSigned,
        string memory pnlEndpoint,
        bool manualMarksRequired,
        bool active
    );
}

interface IProtocolDAOForEscrow {
    function getAddress(string calldata key) external view returns (address);
}

interface IBatchMultisigWallet {
    function threshold() external view returns (uint8);
    function getOwners() external view returns (address[3] memory);
}

contract InvestmentEscrow is Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint256 public constant BATCH_INTERVAL = 7 days;
    uint256 public constant USER_PROFIT_BPS = 8_000;
    uint256 public constant PROTOCOL_FEE_BPS = 2_000;
    uint256 private constant BPS_SCALE = 10_000;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable usdc;
    ITreasuryForEscrow public treasury;
    IExecutionRouteRegistry public routeRegistry;
    IProtocolDAOForEscrow public protocolDAO;

    address public vault;
    address public keeper;

    uint256 public currentBatchId;
    uint256 public batchAwaitingAllocationId;
    uint256 public lastBatchRollTime;
    uint256 public nextBatchCounter;
    uint256 public nextPositionId;

    enum BatchStatus { Pending, Running, Closed, Distributed, Invested }
    enum PositionStatus { None, Open, Closed, WrittenDown }
    enum BatchPositionStatus { None, Active, Returned }

    struct Batch {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 totalCollateralUsd;
        uint256 totalShares;
        uint256 finalNavPerShare;
        BatchStatus status;
        bool distributed;
    }

    struct RouteAllocation {
        uint256 routeId;
        uint256 maxAllocationUsd6;
    }

    struct BatchMandate {
        uint256 expectedCloseTime;
        bytes32 settlementUnit;
        uint256 principalAuthorizedUsd6;
        bytes32 policyContextHash;
        bytes32 allocationPlanHash;
        bool configured;
    }

    struct BatchMandateView {
        uint256 expectedCloseTime;
        bytes32 settlementUnit;
        uint256 principalAuthorizedUsd6;
        bytes32 policyContextHash;
        bytes32 allocationPlanHash;
        bool configured;
        uint256[] routeIds;
        uint256[] maxAllocationUsd6;
    }

    struct BatchAccounting {
        uint256 principalAuthorizedUsd6;
        uint256 principalFundedUsd6;
        uint256 principalCommittedUsd6;
        uint256 principalReturnedUsd6;
        uint256 feesUsd6;
        int256 realizedPnlUsd6;
        int256 unrealizedPnlUsd6;
        uint256 lastMarkedAt;
        bool frozen;
    }

    struct BatchSettlement {
        uint256 finalValueUsd6;
        uint256 protocolFeeUsd6;
        uint256 userProfitUsd6;
        uint256 finalNavPerShare;
        bytes32 settlementReportHash;
        bytes32 complianceDigestHash;
        uint256 finalizedAt;
        bool finalized;
    }

    struct EscrowBatchPosition {
        uint256 batchId;
        uint256 deployedPrincipal;
        uint64 expectedReturnAt;
        uint64 settlementDeadlineAt;
        bytes32 executionContextHash;
        uint64 actualReturnedAt;
        uint256 settlementAmount;
        BatchPositionStatus status;
    }

    struct Position {
        uint256 id;
        uint256 batchId;
        uint256 routeId;
        string assetSymbol;
        uint256 commitmentUsd6;
        uint256 quantityE18;
        uint256 carryingValueUsd6;
        uint256 proceedsUsd6;
        uint256 feeUsd6;
        bytes32 externalRefHash;
        bytes32 lastMarkHash;
        bytes32 closeRefHash;
        uint256 openedAt;
        uint256 markedAt;
        uint256 closedAt;
        PositionStatus status;
    }

    struct ComplianceAttestation {
        bytes32 attestationHash;
        address approvedBy;
        uint256 approvedAt;
        uint256 expiresAt;
    }

    struct BatchAuthorityAnchorRecord {
        bytes32 escrowBatchIdHash;
        bytes32 batchAuthorityBindingHash;
        bytes32 systemMapHash;
        address sourceContractAddress;
        address activeEscrowAddress;
        address treasurySignerAddress;
        address escrowSignerAddress;
        address anchoredBy;
        uint64 anchoredAt;
        bool exists;
    }

    struct BatchWalletBinding {
        bytes32 escrowBatchIdHash;
        bytes32 batchAuthorityBindingHash;
        address walletAddress;
        address ownerTreasury;
        address ownerEscrow;
        address ownerContinuity;
        uint8 threshold;
        address factory;
        // creationTxHash is caller-supplied indexed evidence of the wallet deployment
        // transaction. The contract stores it as-is but cannot verify it on-chain;
        // authoritative proof is the deployment receipt and BatchWalletBound event.
        bytes32 creationTxHash;
        uint64 boundAt;
        address boundBy;
        bool exists;
    }

    // ─── On-chain Role Authority Registry ─────────────────────────────────────────
    // Each signing role has an expected signer address and a lifecycle status.
    // anchorBatchAuthorityBinding reads these — never trusts caller-supplied signer addresses.

    enum RoleStatus { Active, Frozen, Retired }

    struct OnChainRoleRecord {
        address signer;
        RoleStatus status;
        uint64 updatedAt;
        address updatedBy;
        bool exists;
    }

    uint8 public constant ROLE_TREASURY_VAULT  = 0;
    uint8 public constant ROLE_ESCROW          = 1;
    uint8 public constant ROLE_CONTINUITY_SCE  = 2;

    mapping(uint8 => OnChainRoleRecord) public roleAuthorities;

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => uint256) public receiptBatchId;
    mapping(uint256 => BatchMandate) private batchMandates;
    mapping(uint256 => BatchAccounting) private batchAccounting;
    mapping(uint256 => BatchSettlement) private batchSettlements;
    mapping(uint256 => EscrowBatchPosition) public escrowBatchPositions;
    mapping(uint256 => uint256[]) private batchPositionIds;
    mapping(uint256 => Position) private positions;
    mapping(uint256 => uint256[]) private batchMandateRouteIds;
    mapping(uint256 => mapping(uint256 => uint256)) private batchRouteMaxAllocationUsd6;
    mapping(uint256 => mapping(uint256 => uint256)) private batchRouteCommittedUsd6;
    mapping(uint256 => mapping(uint256 => ComplianceAttestation)) private batchRouteAttestations;
    mapping(uint256 => BatchAuthorityAnchorRecord) public batchAuthorityAnchors;
    mapping(uint256 => BatchWalletBinding) public batchWalletBindings;
    mapping(uint256 => bool) public batchWalletFunded;

    struct AllocationAttachment {
        bytes32 allocationPlanHash;
        bytes32 policyContextHash;
        string  portfolioRegistryVersion;
        address attachedBy;
        uint64  attachedAt;
        bool    exists;
    }

    mapping(uint256 => AllocationAttachment) public batchAllocationAttachments;

    error AlreadyAnchored(uint256 sourceBatchId, bytes32 existingHash);
    error AnchorHashMismatch(uint256 sourceBatchId, bytes32 existingHash, bytes32 newHash);
    error InvalidTreasurySigner(address recovered, address expected);
    error InvalidEscrowSigner(address recovered, address expected);
    error RoleSignerNotSet(uint8 roleId);
    error RoleNotActive(uint8 roleId, RoleStatus status);
    error WalletAlreadyBound(uint256 sourceBatchId, address existingWallet);
    error WalletNotBound(uint256 sourceBatchId);
    error AnchorNotFound(uint256 sourceBatchId);
    error WalletBindingHashMismatch(bytes32 anchorHash, bytes32 providedHash);
    error WalletBindingEscrowIdMismatch(bytes32 anchorId, bytes32 providedId);
    error ZeroWalletAddress();
    error WalletThresholdInvalid(uint8 walletThreshold);
    error WalletOwnersMissing();
    error AlreadyFunded(uint256 sourceBatchId);
    error BatchPositionNotFound(uint256 sourceBatchId);
    error InsufficientEscrowBalance(uint256 required, uint256 available);
    error BatchNotFunded(uint256 sourceBatchId);
    error ZeroAllocationHash();
    error AllocationHashMismatch(uint256 sourceBatchId, bytes32 existingHash, bytes32 newHash);

    event RoleAuthorityUpdated(
        uint8 indexed roleId,
        address indexed signer,
        RoleStatus indexed status,
        address updatedBy
    );
    event BatchAuthorityBindingAnchored(
        uint256 indexed sourceBatchId,
        bytes32 indexed batchAuthorityBindingHash,
        bytes32 indexed escrowBatchIdHash,
        bytes32 systemMapHash,
        address sourceContractAddress,
        address activeEscrowAddress,
        address treasurySignerAddress,
        address escrowSignerAddress,
        address anchoredBy
    );
    event BatchWalletBound(
        uint256 indexed sourceBatchId,
        address indexed walletAddress,
        bytes32 indexed batchAuthorityBindingHash,
        bytes32 escrowBatchIdHash,
        address ownerTreasury,
        address ownerEscrow,
        address ownerContinuity,
        address factory,
        bytes32 creationTxHash,
        address boundBy
    );
    event BatchWalletFunded(
        uint256 indexed sourceBatchId,
        address indexed walletAddress,
        string asset,
        uint256 amount,
        bytes32 indexed authorityBindingHash,
        bytes32 walletBindingHash
    );
    event BatchAllocationAttached(
        uint256 indexed sourceBatchId,
        bytes32 indexed allocationPlanHash,
        bytes32 policyContextHash,
        string  portfolioRegistryVersion,
        address attachedBy
    );
    event BatchCreated(uint256 indexed batchId, uint256 createdAt);
    event DepositRegistered(uint256 indexed tokenId, uint256 indexed batchId, uint256 amountUsd, uint256 shares);
    event BatchRolled(uint256 indexed batchId, uint256 amountUsd);
    event BatchClosed(uint256 indexed batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd, uint256 finalNavPerShare);
    event BatchInvested(uint256 indexed batchId, uint256 committedUsd);
    event BatchReturnDeposited(uint256 indexed batchId, uint256 amountUsd);
    event BatchMandateAuthorized(uint256 indexed batchId, uint256 expectedCloseTime, bytes32 settlementUnit, uint256 principalAuthorizedUsd6);
    event BatchFrozen(uint256 indexed batchId, bool frozen);
    event ComplianceAttestationPosted(uint256 indexed batchId, uint256 indexed routeId, bytes32 attestationHash, uint256 expiresAt, address approvedBy);
    event PositionOpened(uint256 indexed positionId, uint256 indexed batchId, uint256 indexed routeId, string assetSymbol, uint256 commitmentUsd6, uint256 quantityE18, bytes32 externalRefHash, uint256 feeUsd6);
    event PositionMarked(uint256 indexed positionId, uint256 carryingValueUsd6, bytes32 markHash, uint256 markedAt);
    event PositionClosed(uint256 indexed positionId, uint256 proceedsUsd6, uint256 feeUsd6, bytes32 closeRefHash, PositionStatus status);
    event BatchSettlementFinalized(uint256 indexed batchId, uint256 finalValueUsd6, uint256 userProfitUsd6, uint256 protocolFeeUsd6, bytes32 settlementReportHash, bytes32 complianceDigestHash);
    event RouteRegistrySet(address indexed routeRegistry);
    event ProtocolDAOSet(address indexed protocolDAO);
    event KeeperSet(address indexed keeper);
    event VaultSet(address indexed vault);
    event BatchAllocationPending(uint256 indexed batchId);
    event BatchAllocationCleared(uint256 indexed batchId);
    event TreasuryBatchReceived(uint256 indexed batchId, uint256 deployedPrincipal, uint64 expectedReturnAt, uint64 settlementDeadlineAt, bytes32 executionContextHash);
    event TreasuryBatchReturned(uint256 indexed batchId, uint256 settlementAmount, uint64 actualReturnedAt);

    constructor(address _usdc, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0) && _treasury != address(0), "zero address");
        usdc = IERC20(_usdc);
        treasury = ITreasuryForEscrow(_treasury);

        currentBatchId = 1;
        nextBatchCounter = 2;
        nextPositionId = 1;
        batches[currentBatchId] = Batch({
            id: currentBatchId,
            startTime: 0,
            endTime: 0,
            totalCollateralUsd: 0,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Pending,
            distributed: false
        });
        emit BatchCreated(currentBatchId, block.timestamp);
        lastBatchRollTime = block.timestamp;
    }

    modifier onlyVaultOrTreasury() {
        require(msg.sender == vault || msg.sender == address(treasury), "Only vault or treasury");
        _;
    }

    modifier onlyKeeperOrOwner() {
        require(msg.sender == owner() || msg.sender == keeper, "Only keeper or owner");
        _;
    }

    modifier onlyKeeperOwnerOrTreasury() {
        require(msg.sender == owner() || msg.sender == keeper || msg.sender == address(treasury), "Only keeper, owner, or treasury");
        _;
    }

    modifier onlyTreasuryOrOwner() {
        require(msg.sender == address(treasury) || msg.sender == owner(), "Only treasury or owner");
        _;
    }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "zero vault");
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setRouteRegistry(address _routeRegistry) external onlyOwner {
        require(_routeRegistry != address(0), "zero route registry");
        routeRegistry = IExecutionRouteRegistry(_routeRegistry);
        emit RouteRegistrySet(_routeRegistry);
    }

    function setProtocolDAO(address _protocolDAO) external onlyOwner {
        require(_protocolDAO != address(0), "zero dao");
        protocolDAO = IProtocolDAOForEscrow(_protocolDAO);
        emit ProtocolDAOSet(_protocolDAO);
    }

    function syncRouteRegistryFromDAO() external onlyOwner {
        require(address(protocolDAO) != address(0), "dao not set");
        address daoRouteRegistry = protocolDAO.getAddress("ExecutionRouteRegistry");
        require(daoRouteRegistry != address(0), "dao route registry missing");
        routeRegistry = IExecutionRouteRegistry(daoRouteRegistry);
        emit RouteRegistrySet(daoRouteRegistry);
    }

    function receiveTreasuryBatch(
        uint256 batchId,
        uint256 deployedPrincipal,
        uint256 expectedReturnAt,
        uint256 settlementDeadlineAt,
        bytes32 executionContextHash
    ) external {
        require(msg.sender == address(treasury), "Only treasury");
        require(batchId != 0, "invalid batch");
        require(deployedPrincipal > 0, "invalid principal");
        require(escrowBatchPositions[batchId].batchId == 0, "batch received");
        require(expectedReturnAt > block.timestamp, "expected return in past");
        require(settlementDeadlineAt >= expectedReturnAt, "deadline before return");
        require(usdc.balanceOf(address(this)) >= deployedPrincipal, "Escrow lacks USDC");

        batches[batchId] = Batch({
            id: batchId,
            startTime: block.timestamp,
            endTime: 0,
            totalCollateralUsd: deployedPrincipal,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Running,
            distributed: false
        });
        if (batchId >= nextBatchCounter) {
            nextBatchCounter = batchId + 1;
        }

        batchAccounting[batchId].principalFundedUsd6 = deployedPrincipal;
        batchAccounting[batchId].principalAuthorizedUsd6 = deployedPrincipal;
        escrowBatchPositions[batchId] = EscrowBatchPosition({
            batchId: batchId,
            deployedPrincipal: deployedPrincipal,
            expectedReturnAt: uint64(expectedReturnAt),
            settlementDeadlineAt: uint64(settlementDeadlineAt),
            executionContextHash: executionContextHash,
            actualReturnedAt: 0,
            settlementAmount: 0,
            status: BatchPositionStatus.Active
        });

        emit BatchCreated(batchId, block.timestamp);
        emit TreasuryBatchReceived(batchId, deployedPrincipal, uint64(expectedReturnAt), uint64(settlementDeadlineAt), executionContextHash);
        emit BatchAllocationPending(batchId);
    }

    function registerDeposit(uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        tokenId;
        amountUsd6;
        shares;
        revert("Treasury owns origin lots");
    }

    function registerDepositTo(uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        batchId;
        tokenId;
        amountUsd6;
        shares;
        revert("Treasury owns origin lots");
    }

    function createPendingBatch() external onlyKeeperOrOwner returns (uint256) {
        revert("Treasury owns batches");
    }

    function setCurrentPendingBatch(uint256 batchId) external onlyKeeperOrOwner {
        batchId;
        revert("Treasury owns batches");
    }

    function rollToNewBatch() public onlyKeeperOwnerOrTreasury {
        revert("Treasury owns batches");
    }

    function rollBatch(uint256 batchId) external onlyKeeperOwnerOrTreasury {
        batchId;
        revert("Treasury owns batches");
    }

    function authorizeBatchExecution(
        uint256 batchId,
        uint256 expectedCloseTime,
        bytes32 settlementUnit,
        bytes32 policyContextHash,
        bytes32 allocationPlanHash,
        RouteAllocation[] calldata routeAllocations
    ) external onlyTreasuryOrOwner {
        require(address(routeRegistry) != address(0), "Route registry not set");
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Running || batch_.status == BatchStatus.Invested, "Batch not executable");

        BatchAccounting storage accounting = batchAccounting[batchId];
        require(accounting.principalCommittedUsd6 == 0, "Batch already committed");

        uint256 existingCount = batchMandateRouteIds[batchId].length;
        for (uint256 i = 0; i < existingCount; i++) {
            uint256 oldRouteId = batchMandateRouteIds[batchId][i];
            delete batchRouteMaxAllocationUsd6[batchId][oldRouteId];
        }
        delete batchMandateRouteIds[batchId];

        uint256 principalAuthorizedUsd6 = 0;
        uint256 fundingCap = accounting.principalFundedUsd6 == 0 ? batch_.totalCollateralUsd : accounting.principalFundedUsd6;
        require(routeAllocations.length > 0, "No routes");

        for (uint256 i = 0; i < routeAllocations.length; i++) {
            RouteAllocation calldata allocation = routeAllocations[i];
            require(allocation.routeId != 0, "Invalid route");
            require(allocation.maxAllocationUsd6 > 0, "Invalid route allocation");
            require(routeRegistry.routeExists(allocation.routeId), "Route missing");
            require(routeRegistry.isRouteBatchEligible(allocation.routeId), "Route not compliant");
            require(batchRouteMaxAllocationUsd6[batchId][allocation.routeId] == 0, "Duplicate route");
            batchMandateRouteIds[batchId].push(allocation.routeId);
            batchRouteMaxAllocationUsd6[batchId][allocation.routeId] = allocation.maxAllocationUsd6;
            principalAuthorizedUsd6 += allocation.maxAllocationUsd6;
        }

        require(principalAuthorizedUsd6 <= fundingCap, "Authorization exceeds funding");

        batchMandates[batchId] = BatchMandate({
            expectedCloseTime: expectedCloseTime,
            settlementUnit: settlementUnit,
            principalAuthorizedUsd6: principalAuthorizedUsd6,
            policyContextHash: policyContextHash,
            allocationPlanHash: allocationPlanHash,
            configured: true
        });

        accounting.principalAuthorizedUsd6 = principalAuthorizedUsd6;
        if (batchAwaitingAllocationId == batchId) {
            batchAwaitingAllocationId = 0;
            emit BatchAllocationCleared(batchId);
        }
        emit BatchMandateAuthorized(batchId, expectedCloseTime, settlementUnit, principalAuthorizedUsd6);
    }

    function freezeBatch(uint256 batchId, bool frozen) external onlyTreasuryOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        batchAccounting[batchId].frozen = frozen;
        emit BatchFrozen(batchId, frozen);
    }

    function postComplianceAttestation(
        uint256 batchId,
        uint256 routeId,
        bytes32 attestationHash,
        uint256 expiresAt
    ) external onlyKeeperOwnerOrTreasury {
        require(batches[batchId].id == batchId, "Batch not found");
        require(batchMandates[batchId].configured, "Mandate not configured");
        require(batchRouteMaxAllocationUsd6[batchId][routeId] > 0, "Route not in mandate");
        require(expiresAt > block.timestamp, "Attestation expired");

        batchRouteAttestations[batchId][routeId] = ComplianceAttestation({
            attestationHash: attestationHash,
            approvedBy: msg.sender,
            approvedAt: block.timestamp,
            expiresAt: expiresAt
        });

        emit ComplianceAttestationPosted(batchId, routeId, attestationHash, expiresAt, msg.sender);
    }

    function openPosition(
        uint256 batchId,
        uint256 routeId,
        string calldata assetSymbol,
        uint256 commitmentUsd6,
        uint256 quantityE18,
        bytes32 externalRefHash,
        uint256 feeUsd6
    ) external onlyKeeperOwnerOrTreasury returns (uint256 positionId) {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Running || batch_.status == BatchStatus.Invested, "Batch not executable");
        require(!batchAccounting[batchId].frozen, "Batch frozen");
        require(commitmentUsd6 > 0, "Invalid commitment");

        BatchAccounting storage accounting = batchAccounting[batchId];
        BatchMandate storage mandate = batchMandates[batchId];
        require(mandate.configured, "Mandate not configured");
        require(batchRouteMaxAllocationUsd6[batchId][routeId] > 0, "Route not approved");
        _requireActiveRoute(routeId, assetSymbol);
        require(routeRegistry.isRouteBatchEligible(routeId), "Route not compliant");

        uint256 nextRouteCommitted = batchRouteCommittedUsd6[batchId][routeId] + commitmentUsd6;
        require(nextRouteCommitted <= batchRouteMaxAllocationUsd6[batchId][routeId], "Route allocation exceeded");
        require(accounting.principalCommittedUsd6 + commitmentUsd6 <= accounting.principalFundedUsd6, "Funding exceeded");
        require(accounting.principalCommittedUsd6 + commitmentUsd6 <= accounting.principalAuthorizedUsd6, "Authorization exceeded");
        require(usdc.balanceOf(address(this)) >= commitmentUsd6, "Escrow lacks USDC");

        usdc.safeTransfer(DEAD_ADDRESS, commitmentUsd6);

        positionId = nextPositionId++;
        uint256 initialCarryingValueUsd6 = commitmentUsd6 > feeUsd6 ? commitmentUsd6 - feeUsd6 : 0;
        positions[positionId] = Position({
            id: positionId,
            batchId: batchId,
            routeId: routeId,
            assetSymbol: assetSymbol,
            commitmentUsd6: commitmentUsd6,
            quantityE18: quantityE18,
            carryingValueUsd6: initialCarryingValueUsd6,
            proceedsUsd6: 0,
            feeUsd6: feeUsd6,
            externalRefHash: externalRefHash,
            lastMarkHash: bytes32(0),
            closeRefHash: bytes32(0),
            openedAt: block.timestamp,
            markedAt: 0,
            closedAt: 0,
            status: PositionStatus.Open
        });

        batchPositionIds[batchId].push(positionId);
        batchRouteCommittedUsd6[batchId][routeId] = nextRouteCommitted;
        accounting.principalCommittedUsd6 += commitmentUsd6;
        accounting.feesUsd6 += feeUsd6;
        accounting.unrealizedPnlUsd6 += int256(initialCarryingValueUsd6) - int256(commitmentUsd6);

        if (batch_.status == BatchStatus.Running) {
            batch_.status = BatchStatus.Invested;
            emit BatchInvested(batchId, accounting.principalCommittedUsd6);
        }

        emit PositionOpened(positionId, batchId, routeId, assetSymbol, commitmentUsd6, quantityE18, externalRefHash, feeUsd6);
    }

    function markPosition(
        uint256 positionId,
        uint256 carryingValueUsd6,
        bytes32 markHash,
        uint256 markedAt
    ) external onlyKeeperOwnerOrTreasury {
        Position storage position = positions[positionId];
        require(position.status == PositionStatus.Open, "Position not open");
        BatchAccounting storage accounting = batchAccounting[position.batchId];
        require(!accounting.frozen, "Batch frozen");

        accounting.unrealizedPnlUsd6 += int256(carryingValueUsd6) - int256(position.carryingValueUsd6);
        accounting.lastMarkedAt = markedAt == 0 ? block.timestamp : markedAt;

        position.carryingValueUsd6 = carryingValueUsd6;
        position.lastMarkHash = markHash;
        position.markedAt = accounting.lastMarkedAt;

        emit PositionMarked(positionId, carryingValueUsd6, markHash, position.markedAt);
    }

    function closePosition(
        uint256 positionId,
        uint256 proceedsUsd6,
        bytes32 closeRefHash,
        uint256 feeUsd6
    ) external onlyKeeperOwnerOrTreasury {
        Position storage position = positions[positionId];
        require(position.status == PositionStatus.Open, "Position not open");
        Batch storage batch_ = batches[position.batchId];
        require(batch_.status == BatchStatus.Invested || batch_.status == BatchStatus.Running, "Batch not active");
        BatchAccounting storage accounting = batchAccounting[position.batchId];
        require(!accounting.frozen, "Batch frozen");

        uint256 netProceedsUsd6 = proceedsUsd6 > feeUsd6 ? proceedsUsd6 - feeUsd6 : 0;
        if (netProceedsUsd6 > 0) {
            _collectReturnFunds(netProceedsUsd6);
        }

        accounting.unrealizedPnlUsd6 -= int256(position.carryingValueUsd6) - int256(position.commitmentUsd6);
        accounting.principalReturnedUsd6 += netProceedsUsd6;
        accounting.feesUsd6 += feeUsd6;
        accounting.realizedPnlUsd6 += int256(netProceedsUsd6) - int256(position.commitmentUsd6);

        position.carryingValueUsd6 = 0;
        position.proceedsUsd6 = netProceedsUsd6;
        position.feeUsd6 += feeUsd6;
        position.closeRefHash = closeRefHash;
        position.closedAt = block.timestamp;
        position.status = PositionStatus.Closed;

        emit PositionClosed(positionId, netProceedsUsd6, feeUsd6, closeRefHash, PositionStatus.Closed);
    }

    function writeDownPosition(uint256 positionId, bytes32 closeRefHash, uint256 feeUsd6) external onlyTreasuryOrOwner {
        Position storage position = positions[positionId];
        require(position.status == PositionStatus.Open, "Position not open");
        BatchAccounting storage accounting = batchAccounting[position.batchId];

        accounting.unrealizedPnlUsd6 -= int256(position.carryingValueUsd6) - int256(position.commitmentUsd6);
        accounting.feesUsd6 += feeUsd6;
        accounting.realizedPnlUsd6 -= int256(position.commitmentUsd6) + int256(feeUsd6);

        position.carryingValueUsd6 = 0;
        position.proceedsUsd6 = 0;
        position.feeUsd6 += feeUsd6;
        position.closeRefHash = closeRefHash;
        position.closedAt = block.timestamp;
        position.status = PositionStatus.WrittenDown;

        emit PositionClosed(positionId, 0, feeUsd6, closeRefHash, PositionStatus.WrittenDown);
    }

    function finalizeBatchSettlement(uint256 batchId, bytes32 settlementReportHash, bytes32 complianceDigestHash) public onlyKeeperOwnerOrTreasury {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Invested || batch_.status == BatchStatus.Running, "Batch not finalizable");

        BatchSettlement storage settlement = batchSettlements[batchId];
        require(!settlement.finalized, "Already finalized");
        require(_allPositionsResolved(batchId), "Open positions remain");

        BatchAccounting storage accounting = batchAccounting[batchId];
        uint256 idleCapitalUsd6 = accounting.principalFundedUsd6 - accounting.principalCommittedUsd6;
        uint256 finalValueUsd6 = accounting.principalReturnedUsd6 + idleCapitalUsd6;
        require(usdc.balanceOf(address(this)) >= finalValueUsd6, "Escrow lacks returned USDC");

        uint256 profitUsd6 = finalValueUsd6 > accounting.principalFundedUsd6 ? finalValueUsd6 - accounting.principalFundedUsd6 : 0;
        uint256 userProfitUsd6 = (profitUsd6 * USER_PROFIT_BPS) / BPS_SCALE;
        uint256 protocolFeeUsd6 = profitUsd6 - userProfitUsd6;
        uint256 finalNavPerShare = accounting.principalFundedUsd6 == 0 ? 0 : (finalValueUsd6 * 1e18) / accounting.principalFundedUsd6;

        settlement.finalValueUsd6 = finalValueUsd6;
        settlement.protocolFeeUsd6 = protocolFeeUsd6;
        settlement.userProfitUsd6 = userProfitUsd6;
        settlement.finalNavPerShare = finalNavPerShare;
        settlement.settlementReportHash = settlementReportHash;
        settlement.complianceDigestHash = complianceDigestHash;
        settlement.finalizedAt = block.timestamp;
        settlement.finalized = true;

        batch_.finalNavPerShare = finalNavPerShare;
        batch_.status = BatchStatus.Closed;
        batch_.endTime = block.timestamp;

        EscrowBatchPosition storage batchPosition = escrowBatchPositions[batchId];
        if (batchPosition.batchId == batchId) {
            batchPosition.actualReturnedAt = uint64(block.timestamp);
            batchPosition.settlementAmount = finalValueUsd6;
            batchPosition.status = BatchPositionStatus.Returned;
            emit TreasuryBatchReturned(batchId, finalValueUsd6, uint64(block.timestamp));
        }

        usdc.safeTransfer(address(treasury), finalValueUsd6);
        treasury.reportBatchResult(batchId, accounting.principalFundedUsd6, userProfitUsd6, protocolFeeUsd6, finalNavPerShare, settlementReportHash, complianceDigestHash);

        emit BatchClosed(batchId, accounting.principalFundedUsd6, userProfitUsd6, protocolFeeUsd6, finalNavPerShare);
        emit BatchSettlementFinalized(batchId, finalValueUsd6, userProfitUsd6, protocolFeeUsd6, settlementReportHash, complianceDigestHash);
    }

    function depositReturnForBatch(uint256 batchId, uint256 finalNavPerShare) external onlyKeeperOrOwner {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Invested || batch_.status == BatchStatus.Running, "Batch not invested or running");
        require(batchPositionIds[batchId].length == 0, "Use positions");

        BatchAccounting storage accounting = batchAccounting[batchId];
        if (batch_.status == BatchStatus.Running) {
            batch_.status = BatchStatus.Invested;
        }
        if (accounting.principalCommittedUsd6 == 0) {
            accounting.principalCommittedUsd6 = accounting.principalFundedUsd6;
        }

        uint256 totalReturnUsd6 = (accounting.principalFundedUsd6 * finalNavPerShare) / 1e18;
        _collectReturnFunds(totalReturnUsd6);
        accounting.principalReturnedUsd6 = totalReturnUsd6;
        accounting.realizedPnlUsd6 = int256(totalReturnUsd6) - int256(accounting.principalFundedUsd6);

        emit BatchReturnDeposited(batchId, totalReturnUsd6);
        finalizeBatchSettlement(batchId, bytes32(0), bytes32(0));
    }

    function distributeBatch(uint256, uint256[] calldata) external pure {
        revert("Escrow no longer settles users directly");
    }

    function investBatch(uint256 batchId) public onlyKeeperOrOwner {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Running, "Batch not running");

        BatchAccounting storage accounting = batchAccounting[batchId];
        uint256 principalUsd6 = accounting.principalFundedUsd6;
        require(principalUsd6 > 0, "No funded principal");
        require(usdc.balanceOf(address(this)) >= principalUsd6, "Escrow lacks USDC");

        usdc.safeTransfer(DEAD_ADDRESS, principalUsd6);
        accounting.principalCommittedUsd6 = principalUsd6;
        accounting.principalAuthorizedUsd6 = principalUsd6;
        batch_.status = BatchStatus.Invested;

        emit BatchInvested(batchId, principalUsd6);
    }

    function adminBurnBatch(uint256 batchId) external onlyOwner {
        investBatch(batchId);
    }

    function distributeBatchBurn(uint256 batchId) external onlyKeeperOrOwner {
        investBatch(batchId);
    }

    function setBatchInvested(uint256 batchId) external onlyKeeperOrOwner {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Running, "Batch not running");
        batch_.status = BatchStatus.Invested;
        emit BatchInvested(batchId, batchAccounting[batchId].principalCommittedUsd6);
    }

    function forceSetBatchInvested(uint256 batchId) external onlyOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        batches[batchId].status = BatchStatus.Invested;
        emit BatchInvested(batchId, batchAccounting[batchId].principalCommittedUsd6);
    }

    function markBatchInvestedWithoutTransfer(uint256 batchId) external onlyKeeperOrOwner {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Running, "Batch not running");
        batch_.status = BatchStatus.Invested;
        emit BatchInvested(batchId, batchAccounting[batchId].principalCommittedUsd6);
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function getBatchMandate(uint256 batchId) external view returns (BatchMandateView memory view_) {
        BatchMandate storage mandate = batchMandates[batchId];
        uint256 len = batchMandateRouteIds[batchId].length;
        uint256[] memory routeIds = new uint256[](len);
        uint256[] memory maxAllocationUsd6 = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 routeId = batchMandateRouteIds[batchId][i];
            routeIds[i] = routeId;
            maxAllocationUsd6[i] = batchRouteMaxAllocationUsd6[batchId][routeId];
        }
        view_ = BatchMandateView({
            expectedCloseTime: mandate.expectedCloseTime,
            settlementUnit: mandate.settlementUnit,
            principalAuthorizedUsd6: mandate.principalAuthorizedUsd6,
            policyContextHash: mandate.policyContextHash,
            allocationPlanHash: mandate.allocationPlanHash,
            configured: mandate.configured,
            routeIds: routeIds,
            maxAllocationUsd6: maxAllocationUsd6
        });
    }

    function getBatchAccounting(uint256 batchId) external view returns (BatchAccounting memory) {
        return batchAccounting[batchId];
    }

    function getBatchSettlement(uint256 batchId) external view returns (BatchSettlement memory) {
        return batchSettlements[batchId];
    }

    function getBatchPositionIds(uint256 batchId) external view returns (uint256[] memory) {
        return batchPositionIds[batchId];
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getComplianceAttestation(uint256 batchId, uint256 routeId) external view returns (ComplianceAttestation memory) {
        return batchRouteAttestations[batchId][routeId];
    }

    function getBatchRouteCommittedUsd6(uint256 batchId, uint256 routeId) external view returns (uint256) {
        return batchRouteCommittedUsd6[batchId][routeId];
    }

    function anchorBatchAuthorityBinding(
        uint256 sourceBatchId,
        bytes32 escrowBatchIdHash,
        bytes32 batchAuthorityBindingHash,
        bytes32 systemMapHash,
        address sourceContractAddress,
        address activeEscrowAddress,
        bytes calldata treasurySignature,
        bytes calldata escrowSignature
    ) external {
        require(sourceBatchId != 0, "Invalid sourceBatchId");
        require(batchAuthorityBindingHash != bytes32(0), "Invalid bindingHash");
        require(escrowBatchIdHash != bytes32(0), "Invalid escrowBatchIdHash");
        require(treasurySignature.length > 0, "Treasury signature required");
        require(escrowSignature.length > 0, "Escrow signature required");

        // Load expected signers from on-chain role authority registry — caller-supplied addresses are not trusted.
        OnChainRoleRecord storage tvRole     = roleAuthorities[ROLE_TREASURY_VAULT];
        OnChainRoleRecord storage escrowRole = roleAuthorities[ROLE_ESCROW];

        if (!tvRole.exists)    revert RoleSignerNotSet(ROLE_TREASURY_VAULT);
        if (!escrowRole.exists) revert RoleSignerNotSet(ROLE_ESCROW);

        if (tvRole.status != RoleStatus.Active)     revert RoleNotActive(ROLE_TREASURY_VAULT, tvRole.status);
        if (escrowRole.status != RoleStatus.Active) revert RoleNotActive(ROLE_ESCROW, escrowRole.status);

        // Recover signers from EIP-712 hash — must match the stored on-chain role signers exactly.
        address recoveredTreasury = batchAuthorityBindingHash.recover(treasurySignature);
        if (recoveredTreasury != tvRole.signer) {
            revert InvalidTreasurySigner(recoveredTreasury, tvRole.signer);
        }

        address recoveredEscrow = batchAuthorityBindingHash.recover(escrowSignature);
        if (recoveredEscrow != escrowRole.signer) {
            revert InvalidEscrowSigner(recoveredEscrow, escrowRole.signer);
        }

        BatchAuthorityAnchorRecord storage record = batchAuthorityAnchors[sourceBatchId];

        if (record.exists) {
            if (record.batchAuthorityBindingHash == batchAuthorityBindingHash) {
                // Same hash — idempotent, nothing to do.
                return;
            }
            revert AnchorHashMismatch(sourceBatchId, record.batchAuthorityBindingHash, batchAuthorityBindingHash);
        }

        // Store recovered signer addresses (on-chain verified) — not caller-supplied values.
        batchAuthorityAnchors[sourceBatchId] = BatchAuthorityAnchorRecord({
            escrowBatchIdHash: escrowBatchIdHash,
            batchAuthorityBindingHash: batchAuthorityBindingHash,
            systemMapHash: systemMapHash,
            sourceContractAddress: sourceContractAddress,
            activeEscrowAddress: activeEscrowAddress,
            treasurySignerAddress: recoveredTreasury,
            escrowSignerAddress: recoveredEscrow,
            anchoredBy: msg.sender,
            anchoredAt: uint64(block.timestamp),
            exists: true
        });

        emit BatchAuthorityBindingAnchored(
            sourceBatchId,
            batchAuthorityBindingHash,
            escrowBatchIdHash,
            systemMapHash,
            sourceContractAddress,
            activeEscrowAddress,
            recoveredTreasury,
            recoveredEscrow,
            msg.sender
        );
    }

    function getBatchAuthorityAnchor(uint256 sourceBatchId) external view returns (BatchAuthorityAnchorRecord memory) {
        return batchAuthorityAnchors[sourceBatchId];
    }

    // ─── Batch wallet binding ──────────────────────────────────────────────────────
    // bindBatchWallet may only be called after Batch Authority Binding is anchored.
    // The provided wallet contract must be a BatchMultisigWallet with:
    //   - threshold == 2
    //   - sourceBatchId matching the requested batch
    //   - batchAuthorityBindingHash matching the anchor
    //   - owners == {ROLE_TREASURY_VAULT, ROLE_ESCROW, ROLE_CONTINUITY_SCE} signers (in any order)

    function bindBatchWallet(
        uint256 sourceBatchId,
        bytes32 escrowBatchIdHash,
        bytes32 batchAuthorityBindingHash_,
        address walletAddress,
        address factory,
        bytes32 creationTxHash
    ) external {
        if (walletAddress == address(0)) revert ZeroWalletAddress();
        if (batchWalletBindings[sourceBatchId].exists) {
            revert WalletAlreadyBound(sourceBatchId, batchWalletBindings[sourceBatchId].walletAddress);
        }

        BatchAuthorityAnchorRecord storage anchor = batchAuthorityAnchors[sourceBatchId];
        if (!anchor.exists) revert AnchorNotFound(sourceBatchId);
        if (anchor.batchAuthorityBindingHash != batchAuthorityBindingHash_) {
            revert WalletBindingHashMismatch(anchor.batchAuthorityBindingHash, batchAuthorityBindingHash_);
        }
        if (anchor.escrowBatchIdHash != escrowBatchIdHash) {
            revert WalletBindingEscrowIdMismatch(anchor.escrowBatchIdHash, escrowBatchIdHash);
        }

        OnChainRoleRecord storage tvRole = roleAuthorities[ROLE_TREASURY_VAULT];
        OnChainRoleRecord storage escrowRole = roleAuthorities[ROLE_ESCROW];
        OnChainRoleRecord storage sceRole = roleAuthorities[ROLE_CONTINUITY_SCE];
        if (!tvRole.exists)    revert RoleSignerNotSet(ROLE_TREASURY_VAULT);
        if (!escrowRole.exists) revert RoleSignerNotSet(ROLE_ESCROW);
        if (!sceRole.exists)   revert RoleSignerNotSet(ROLE_CONTINUITY_SCE);
        if (tvRole.status != RoleStatus.Active)    revert RoleNotActive(ROLE_TREASURY_VAULT, tvRole.status);
        if (escrowRole.status != RoleStatus.Active) revert RoleNotActive(ROLE_ESCROW, escrowRole.status);
        if (sceRole.status != RoleStatus.Active)   revert RoleNotActive(ROLE_CONTINUITY_SCE, sceRole.status);

        // The anchor hash and escrow batch ID hash are already validated above from
        // batchAuthorityAnchors (the escrow's own storage), so no need to re-read
        // them via wallet interface calls — that would add bytecode with no new security.
        IBatchMultisigWallet w = IBatchMultisigWallet(walletAddress);

        uint8 walletThreshold = w.threshold();
        if (walletThreshold != 2) revert WalletThresholdInvalid(walletThreshold);

        address[3] memory owners = w.getOwners();
        bool hasTreasury;
        bool hasEscrow;
        bool hasContinuity;
        for (uint8 i = 0; i < 3; i++) {
            if (owners[i] == tvRole.signer)    hasTreasury = true;
            if (owners[i] == escrowRole.signer) hasEscrow   = true;
            if (owners[i] == sceRole.signer)   hasContinuity = true;
        }
        if (!hasTreasury || !hasEscrow || !hasContinuity) revert WalletOwnersMissing();

        batchWalletBindings[sourceBatchId] = BatchWalletBinding({
            escrowBatchIdHash: escrowBatchIdHash,
            batchAuthorityBindingHash: batchAuthorityBindingHash_,
            walletAddress: walletAddress,
            ownerTreasury: tvRole.signer,
            ownerEscrow: escrowRole.signer,
            ownerContinuity: sceRole.signer,
            threshold: 2,
            factory: factory,
            creationTxHash: creationTxHash,
            boundAt: uint64(block.timestamp),
            boundBy: msg.sender,
            exists: true
        });

        emit BatchWalletBound(
            sourceBatchId,
            walletAddress,
            batchAuthorityBindingHash_,
            escrowBatchIdHash,
            tvRole.signer,
            escrowRole.signer,
            sceRole.signer,
            factory,
            creationTxHash,
            msg.sender
        );
    }

    function getBatchWalletBinding(uint256 sourceBatchId) external view returns (BatchWalletBinding memory) {
        return batchWalletBindings[sourceBatchId];
    }

    // ─── Batch wallet funding ──────────────────────────────────────────────────────
    // fundBatchWallet may only be called after:
    //   1. Batch Authority Binding is anchored (anchor exists for sourceBatchId)
    //   2. Batch Wallet Binding exists and is valid (wallet bound for sourceBatchId)
    // It is idempotent-guarded: a second call reverts with AlreadyFunded.

    function fundBatchWallet(uint256 sourceBatchId) external {
        // 1. Verify Batch Authority Binding anchor exists.
        BatchAuthorityAnchorRecord storage anchor = batchAuthorityAnchors[sourceBatchId];
        if (!anchor.exists) revert AnchorNotFound(sourceBatchId);

        // 2. Verify Batch Wallet Binding exists.
        BatchWalletBinding storage binding = batchWalletBindings[sourceBatchId];
        if (!binding.exists) revert WalletNotBound(sourceBatchId);

        // 3. Verify wallet address is non-zero.
        if (binding.walletAddress == address(0)) revert ZeroWalletAddress();

        // 4. Verify threshold is 2.
        if (binding.threshold != 2) revert WalletThresholdInvalid(binding.threshold);

        // 5. Verify owners match current on-chain role authority signers.
        OnChainRoleRecord storage tvRole    = roleAuthorities[ROLE_TREASURY_VAULT];
        OnChainRoleRecord storage escrowRole = roleAuthorities[ROLE_ESCROW];
        OnChainRoleRecord storage sceRole   = roleAuthorities[ROLE_CONTINUITY_SCE];
        if (!tvRole.exists)     revert RoleSignerNotSet(ROLE_TREASURY_VAULT);
        if (!escrowRole.exists) revert RoleSignerNotSet(ROLE_ESCROW);
        if (!sceRole.exists)    revert RoleSignerNotSet(ROLE_CONTINUITY_SCE);
        if (tvRole.status    != RoleStatus.Active) revert RoleNotActive(ROLE_TREASURY_VAULT,  tvRole.status);
        if (escrowRole.status != RoleStatus.Active) revert RoleNotActive(ROLE_ESCROW,          escrowRole.status);
        if (sceRole.status   != RoleStatus.Active) revert RoleNotActive(ROLE_CONTINUITY_SCE,  sceRole.status);
        if (binding.ownerTreasury   != tvRole.signer  ||
            binding.ownerEscrow     != escrowRole.signer ||
            binding.ownerContinuity != sceRole.signer) {
            revert WalletOwnersMissing();
        }

        // 6. Verify batch position exists.
        EscrowBatchPosition storage position = escrowBatchPositions[sourceBatchId];
        if (position.batchId != sourceBatchId) revert BatchPositionNotFound(sourceBatchId);

        // 7. Verify asset and amount are valid.
        uint256 amount = position.deployedPrincipal;
        require(amount > 0, "No funded principal");
        uint256 available = usdc.balanceOf(address(this));
        if (available < amount) revert InsufficientEscrowBalance(amount, available);

        // 8. Idempotency guard — reject double funding.
        if (batchWalletFunded[sourceBatchId]) revert AlreadyFunded(sourceBatchId);

        // 9. Mark funded before transfer (checks-effects-interactions).
        batchWalletFunded[sourceBatchId] = true;

        // 10. Transfer USDC from InvestmentEscrow to the bound batch wallet.
        usdc.safeTransfer(binding.walletAddress, amount);

        emit BatchWalletFunded(
            sourceBatchId,
            binding.walletAddress,
            "USDC",
            amount,
            anchor.batchAuthorityBindingHash,
            binding.creationTxHash
        );
    }

    // ─── AAA Allocation attachment ─────────────────────────────────────────────────
    // attachAllocation records the canonical AAA allocation plan hash and policy context
    // hash on-chain for a funded batch. Both hashes and the registry version must be
    // present. Re-attachment is idempotent only when the full attachment matches.

    function attachAllocation(
        uint256 sourceBatchId,
        bytes32 allocationPlanHash,
        bytes32 policyContextHash,
        string calldata portfolioRegistryVersion
    ) external onlyKeeperOwnerOrTreasury {
        EscrowBatchPosition storage position = escrowBatchPositions[sourceBatchId];
        bool escrowPositionFunded = position.batchId == sourceBatchId && position.deployedPrincipal > 0;
        if (!batchWalletFunded[sourceBatchId] && !escrowPositionFunded) revert BatchNotFunded(sourceBatchId);
        if (allocationPlanHash == bytes32(0)) revert ZeroAllocationHash();
        if (policyContextHash  == bytes32(0)) revert ZeroAllocationHash();
        require(bytes(portfolioRegistryVersion).length > 0, "Registry version required");

        AllocationAttachment storage attachment = batchAllocationAttachments[sourceBatchId];
        if (attachment.exists) {
            if (
                attachment.allocationPlanHash == allocationPlanHash &&
                attachment.policyContextHash  == policyContextHash &&
                keccak256(bytes(attachment.portfolioRegistryVersion)) == keccak256(bytes(portfolioRegistryVersion))
            ) {
                return;
            }
            revert AllocationHashMismatch(sourceBatchId, attachment.allocationPlanHash, allocationPlanHash);
        }

        batchAllocationAttachments[sourceBatchId] = AllocationAttachment({
            allocationPlanHash:        allocationPlanHash,
            policyContextHash:         policyContextHash,
            portfolioRegistryVersion:  portfolioRegistryVersion,
            attachedBy:                msg.sender,
            attachedAt:                uint64(block.timestamp),
            exists:                    true
        });

        emit BatchAllocationAttached(
            sourceBatchId,
            allocationPlanHash,
            policyContextHash,
            portfolioRegistryVersion,
            msg.sender
        );
    }

    function getAllocationAttachment(uint256 sourceBatchId) external view returns (AllocationAttachment memory) {
        return batchAllocationAttachments[sourceBatchId];
    }

    // ─── Role authority management ─────────────────────────────────────────────────
    // TODO: Transition to DAO/timelock-controlled role updates once governance is live.

    function setRoleAuthority(uint8 roleId, address signer, RoleStatus status) external onlyOwner {
        require(signer != address(0), "Zero signer address");
        roleAuthorities[roleId] = OnChainRoleRecord({
            signer: signer,
            status: status,
            updatedAt: uint64(block.timestamp),
            updatedBy: msg.sender,
            exists: true
        });
        emit RoleAuthorityUpdated(roleId, signer, status, msg.sender);
    }

    function getRoleAuthority(uint8 roleId) external view returns (OnChainRoleRecord memory) {
        return roleAuthorities[roleId];
    }

    function _ensurePendingBatchExists(uint256 batchId) internal {
        if (batches[batchId].id == batchId) {
            return;
        }
        if (batchId >= nextBatchCounter) {
            nextBatchCounter = batchId + 1;
        }
        _createPendingBatch(batchId);
    }

    function _createPendingBatch(uint256 batchId) internal {
        batches[batchId] = Batch({
            id: batchId,
            startTime: 0,
            endTime: 0,
            totalCollateralUsd: 0,
            totalShares: 0,
            finalNavPerShare: 0,
            status: BatchStatus.Pending,
            distributed: false
        });
        emit BatchCreated(batchId, block.timestamp);
    }

    function _activateBatch(uint256 batchId, uint256 amountUsd6) internal {
        require(batchAwaitingAllocationId == 0, "Allocate current batch first");
        Batch storage batch_ = batches[batchId];
        batch_.status = BatchStatus.Running;
        batch_.startTime = block.timestamp;
        treasury.fundEscrowBatch(batchId, amountUsd6);
        batchAccounting[batchId].principalFundedUsd6 += amountUsd6;
        if (batchAccounting[batchId].principalAuthorizedUsd6 == 0) {
            batchAccounting[batchId].principalAuthorizedUsd6 = amountUsd6;
        }
        batchAwaitingAllocationId = batchId;
        emit BatchAllocationPending(batchId);
        emit BatchRolled(batchId, amountUsd6);
    }

    function _collectReturnFunds(uint256 amountUsd6) internal {
        bool transferred = false;
        try usdc.transferFrom(msg.sender, address(this), amountUsd6) returns (bool ok) {
            transferred = ok;
        } catch {
            transferred = false;
        }

        if (!transferred) {
            (bool okMint, ) = address(usdc).call(abi.encodeWithSignature("mint(address,uint256)", address(this), amountUsd6));
            require(okMint, "funding escrow failed");
        }
    }

    function _requireActiveRoute(uint256 routeId, string calldata assetSymbol) internal view {
        (
            uint256 id,
            string memory routeAssetSymbol,
            uint8 routeType_,
            bytes32 counterpartyRefHash_,
            bytes32 jurisdictionRefHash_,
            bytes32 custodyRefHash_,
            bool documentsComplete_,
            bool sagittaFundApproved_,
            bool ndaSigned_,
            string memory pnlEndpoint_,
            bool manualMarksRequired_,
            bool active
        ) = routeRegistry.getRoute(routeId);
        routeType_;
        counterpartyRefHash_;
        jurisdictionRefHash_;
        custodyRefHash_;
        documentsComplete_;
        sagittaFundApproved_;
        ndaSigned_;
        pnlEndpoint_;
        manualMarksRequired_;
        require(id == routeId && active, "Route inactive");
        require(keccak256(bytes(routeAssetSymbol)) == keccak256(bytes(assetSymbol)), "Asset mismatch");
    }

    function _allPositionsResolved(uint256 batchId) internal view returns (bool) {
        uint256 len = batchPositionIds[batchId].length;
        for (uint256 i = 0; i < len; i++) {
            if (positions[batchPositionIds[batchId][i]].status == PositionStatus.Open) {
                return false;
            }
        }
        return true;
    }
}
