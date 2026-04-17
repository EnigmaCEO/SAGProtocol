// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

contract InvestmentEscrow is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BATCH_INTERVAL = 7 days;
    uint256 public constant USER_PROFIT_BPS = 8_000;
    uint256 public constant PROTOCOL_FEE_BPS = 2_000;
    uint256 private constant BPS_SCALE = 10_000;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable usdc;
    ITreasuryForEscrow public treasury;
    IExecutionRouteRegistry public routeRegistry;

    address public vault;
    address public keeper;

    uint256 public currentBatchId;
    uint256 public batchAwaitingAllocationId;
    uint256 public lastBatchRollTime;
    uint256 public nextBatchCounter;
    uint256 public nextPositionId;

    enum BatchStatus { Pending, Running, Closed, Distributed, Invested }
    enum PositionStatus { None, Open, Closed, WrittenDown }

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
        bool configured;
    }

    struct BatchMandateView {
        uint256 expectedCloseTime;
        bytes32 settlementUnit;
        uint256 principalAuthorizedUsd6;
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

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => uint256) public receiptBatchId;
    mapping(uint256 => BatchMandate) private batchMandates;
    mapping(uint256 => BatchAccounting) private batchAccounting;
    mapping(uint256 => BatchSettlement) private batchSettlements;
    mapping(uint256 => uint256[]) private batchPositionIds;
    mapping(uint256 => Position) private positions;
    mapping(uint256 => uint256[]) private batchMandateRouteIds;
    mapping(uint256 => mapping(uint256 => uint256)) private batchRouteMaxAllocationUsd6;
    mapping(uint256 => mapping(uint256 => uint256)) private batchRouteCommittedUsd6;
    mapping(uint256 => mapping(uint256 => ComplianceAttestation)) private batchRouteAttestations;

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
    event KeeperSet(address indexed keeper);
    event VaultSet(address indexed vault);
    event BatchAllocationPending(uint256 indexed batchId);
    event BatchAllocationCleared(uint256 indexed batchId);

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

    function registerDeposit(uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        Batch storage batch_ = batches[currentBatchId];
        require(batch_.status == BatchStatus.Pending, "Batch not pending");
        batch_.totalCollateralUsd += amountUsd6;
        batch_.totalShares += shares;
        receiptBatchId[tokenId] = currentBatchId;
        emit DepositRegistered(tokenId, currentBatchId, amountUsd6, shares);
    }

    function registerDepositTo(uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external onlyVaultOrTreasury {
        _ensurePendingBatchExists(batchId);
        Batch storage batch_ = batches[batchId];
        require(batch_.status == BatchStatus.Pending, "Batch not pending");
        batch_.totalCollateralUsd += amountUsd6;
        batch_.totalShares += shares;
        receiptBatchId[tokenId] = batchId;
        emit DepositRegistered(tokenId, batchId, amountUsd6, shares);
    }

    function createPendingBatch() external onlyKeeperOrOwner returns (uint256) {
        uint256 id = nextBatchCounter;
        nextBatchCounter = id + 1;
        _createPendingBatch(id);
        return id;
    }

    function setCurrentPendingBatch(uint256 batchId) external onlyKeeperOrOwner {
        require(batches[batchId].id == batchId, "Batch not found");
        require(batches[batchId].status == BatchStatus.Pending, "Batch not pending");
        currentBatchId = batchId;
    }

    function rollToNewBatch() public onlyKeeperOwnerOrTreasury {
        Batch storage current = batches[currentBatchId];
        if (current.totalCollateralUsd == 0) {
            lastBatchRollTime = block.timestamp;
            return;
        }

        _activateBatch(currentBatchId, current.totalCollateralUsd);

        uint256 newId = nextBatchCounter;
        nextBatchCounter = newId + 1;
        _createPendingBatch(newId);
        currentBatchId = newId;
        lastBatchRollTime = block.timestamp;
    }

    function rollBatch(uint256 batchId) external onlyKeeperOwnerOrTreasury {
        Batch storage batch_ = batches[batchId];
        require(batch_.id == batchId, "Batch not found");
        require(batch_.status == BatchStatus.Pending, "Batch not pending");
        require(batch_.totalCollateralUsd > 0, "Empty batch");
        _activateBatch(batchId, batch_.totalCollateralUsd);
        lastBatchRollTime = block.timestamp;
    }

    function authorizeBatchExecution(
        uint256 batchId,
        uint256 expectedCloseTime,
        bytes32 settlementUnit,
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
