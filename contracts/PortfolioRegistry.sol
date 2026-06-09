// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioRegistry
/// @notice On-chain registry of accepted portfolio assets and DAO-approved destinations.
contract PortfolioRegistry {
    enum RiskClass {
        WealthManagement,
        Stablecoin,
        DefiBluechip,
        FundOfFunds,
        LargeCap,
        PrivateCreditFund,
        RealWorldAsset,
        ExternalProtocol
    }

    enum AssetRole {
        Core,
        Liquidity,
        Satellite,
        Defensive,
        Speculative,
        YieldFund,
        External
    }

    enum DestinationType {
        BatchWalletHold,
        StakingContract,
        InvestmentHandoff,
        Purchase
    }

    struct PortfolioAsset {
        string symbol;
        string name;
        address token;
        address oracle;
        RiskClass riskClass;
        AssetRole role;
        uint256 minimumInvestmentUsd6;
        uint256 defaultDestinationId;
        address destination;
        DestinationType destinationType;
        uint256 addedAt;
    }

    struct ApprovedDestination {
        uint256 destinationId;
        string name;
        string assetSymbol;
        address assetAddress;
        DestinationType destinationType;
        address destinationAddress;
        bool active;
    }

    address public owner;
    uint256 public nextDestinationId = 1;

    string[] private _symbolList;
    mapping(bytes32 => PortfolioAsset) private _assets;
    mapping(bytes32 => bool) private _active;

    uint256[] private _destinationIds;
    mapping(uint256 => ApprovedDestination) private _destinations;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AssetAdded(
        string symbol,
        address token,
        RiskClass riskClass,
        AssetRole role,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId,
        address destination,
        DestinationType destinationType
    );
    event AssetRemoved(string symbol);
    event AssetUpdated(
        string symbol,
        string name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole role,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId,
        address destination,
        DestinationType destinationType
    );
    event DestinationAdded(
        uint256 indexed destinationId,
        string name,
        string assetSymbol,
        address assetAddress,
        DestinationType destinationType,
        address destinationAddress,
        bool active
    );
    event DestinationUpdated(
        uint256 indexed destinationId,
        string name,
        string assetSymbol,
        address assetAddress,
        DestinationType destinationType,
        address destinationAddress,
        bool active
    );
    event DestinationActiveSet(uint256 indexed destinationId, bool active);

    modifier onlyOwner() {
        require(msg.sender == owner, "PortfolioRegistry: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PortfolioRegistry: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _key(string memory symbol) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(symbol));
    }

    function _destinationExists(uint256 destinationId) internal view returns (bool) {
        return destinationId != 0 && _destinations[destinationId].destinationId == destinationId;
    }

    function _validateDestination(
        string memory name,
        string memory assetSymbol,
        address assetAddress,
        DestinationType destinationType,
        address destinationAddress
    ) internal pure {
        require(bytes(name).length > 0, "PortfolioRegistry: empty destination name");
        require(
            bytes(assetSymbol).length > 0 || assetAddress != address(0),
            "PortfolioRegistry: destination asset required"
        );
        if (destinationType == DestinationType.StakingContract || destinationType == DestinationType.InvestmentHandoff) {
            require(destinationAddress != address(0), "PortfolioRegistry: destination address required");
        }
    }

    function _destinationMatchesAsset(
        ApprovedDestination storage approved,
        string memory symbol,
        address token
    ) internal view returns (bool) {
        bool symbolMatches = bytes(approved.assetSymbol).length > 0 && _key(approved.assetSymbol) == _key(symbol);
        bool addressMatches = approved.assetAddress != address(0) && token != address(0) && approved.assetAddress == token;
        return symbolMatches || addressMatches;
    }

    function _setAssetDestination(PortfolioAsset storage asset, uint256 destinationId) internal {
        if (destinationId == 0) {
            asset.defaultDestinationId = 0;
            asset.destination = address(0);
            asset.destinationType = DestinationType.BatchWalletHold;
            return;
        }

        require(_destinationExists(destinationId), "PortfolioRegistry: destination not found");
        ApprovedDestination storage approved = _destinations[destinationId];
        require(approved.active, "PortfolioRegistry: destination inactive");
        require(_destinationMatchesAsset(approved, asset.symbol, asset.token), "PortfolioRegistry: destination asset mismatch");

        asset.defaultDestinationId = destinationId;
        asset.destination = approved.destinationAddress;
        asset.destinationType = approved.destinationType;
    }

    function addDestination(
        string calldata name,
        string calldata assetSymbol,
        address assetAddress,
        DestinationType destinationType,
        address destinationAddress,
        bool active
    ) external onlyOwner returns (uint256 destinationId) {
        _validateDestination(name, assetSymbol, assetAddress, destinationType, destinationAddress);

        destinationId = nextDestinationId++;
        _destinations[destinationId] = ApprovedDestination({
            destinationId: destinationId,
            name: name,
            assetSymbol: assetSymbol,
            assetAddress: assetAddress,
            destinationType: destinationType,
            destinationAddress: destinationAddress,
            active: active
        });
        _destinationIds.push(destinationId);

        emit DestinationAdded(destinationId, name, assetSymbol, assetAddress, destinationType, destinationAddress, active);
    }

    function updateDestination(
        uint256 destinationId,
        string calldata name,
        string calldata assetSymbol,
        address assetAddress,
        DestinationType destinationType,
        address destinationAddress,
        bool active
    ) external onlyOwner {
        require(_destinationExists(destinationId), "PortfolioRegistry: destination not found");
        _validateDestination(name, assetSymbol, assetAddress, destinationType, destinationAddress);

        ApprovedDestination storage approved = _destinations[destinationId];
        approved.name = name;
        approved.assetSymbol = assetSymbol;
        approved.assetAddress = assetAddress;
        approved.destinationType = destinationType;
        approved.destinationAddress = destinationAddress;
        approved.active = active;

        uint256 len = _symbolList.length;
        for (uint256 i = 0; i < len; i++) {
            PortfolioAsset storage asset = _assets[_key(_symbolList[i])];
            if (asset.defaultDestinationId != destinationId) continue;
            require(_destinationMatchesAsset(approved, asset.symbol, asset.token), "PortfolioRegistry: assigned asset mismatch");
            asset.destination = destinationAddress;
            asset.destinationType = destinationType;
        }

        emit DestinationUpdated(destinationId, name, assetSymbol, assetAddress, destinationType, destinationAddress, active);
    }

    function setDestinationActive(uint256 destinationId, bool active) external onlyOwner {
        require(_destinationExists(destinationId), "PortfolioRegistry: destination not found");
        _destinations[destinationId].active = active;
        emit DestinationActiveSet(destinationId, active);
    }

    function addAsset(
        string calldata symbol,
        string calldata name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId
    ) external onlyOwner {
        _addAsset(symbol, name, token, oracle, riskClass, assetRole, minimumInvestmentUsd6, defaultDestinationId);
    }

    /// @notice Backward-compatible add without a configured destination.
    function addAsset(
        string calldata symbol,
        string calldata name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6
    ) external onlyOwner {
        _addAsset(symbol, name, token, oracle, riskClass, assetRole, minimumInvestmentUsd6, 0);
    }

    function _addAsset(
        string memory symbol,
        string memory name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId
    ) internal {
        require(bytes(symbol).length > 0, "PortfolioRegistry: empty symbol");
        bytes32 k = _key(symbol);
        require(!_active[k], "PortfolioRegistry: symbol already in portfolio");

        _assets[k] = PortfolioAsset({
            symbol: symbol,
            name: name,
            token: token,
            oracle: oracle,
            riskClass: riskClass,
            role: assetRole,
            minimumInvestmentUsd6: minimumInvestmentUsd6,
            defaultDestinationId: 0,
            destination: address(0),
            destinationType: DestinationType.BatchWalletHold,
            addedAt: block.timestamp
        });
        _setAssetDestination(_assets[k], defaultDestinationId);
        _active[k] = true;
        _symbolList.push(symbol);

        PortfolioAsset storage asset = _assets[k];
        emit AssetAdded(
            symbol,
            token,
            riskClass,
            assetRole,
            minimumInvestmentUsd6,
            defaultDestinationId,
            asset.destination,
            asset.destinationType
        );
    }

    function removeAsset(string calldata symbol) external onlyOwner {
        bytes32 k = _key(symbol);
        require(_active[k], "PortfolioRegistry: symbol not in portfolio");

        _active[k] = false;

        uint256 len = _symbolList.length;
        for (uint256 i = 0; i < len; i++) {
            if (_key(_symbolList[i]) == k) {
                _symbolList[i] = _symbolList[len - 1];
                _symbolList.pop();
                break;
            }
        }

        emit AssetRemoved(symbol);
    }

    function updateAsset(
        string calldata symbol,
        string calldata name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId
    ) external onlyOwner {
        _updateAsset(symbol, name, token, oracle, riskClass, assetRole, minimumInvestmentUsd6, defaultDestinationId);
    }

    /// @notice Backward-compatible update that clears the configured destination.
    function updateAsset(
        string calldata symbol,
        string calldata name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6
    ) external onlyOwner {
        _updateAsset(symbol, name, token, oracle, riskClass, assetRole, minimumInvestmentUsd6, 0);
    }

    function _updateAsset(
        string memory symbol,
        string memory name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole assetRole,
        uint256 minimumInvestmentUsd6,
        uint256 defaultDestinationId
    ) internal {
        bytes32 k = _key(symbol);
        require(_active[k], "PortfolioRegistry: symbol not in portfolio");
        PortfolioAsset storage asset = _assets[k];
        asset.name = name;
        asset.token = token;
        asset.oracle = oracle;
        asset.riskClass = riskClass;
        asset.role = assetRole;
        asset.minimumInvestmentUsd6 = minimumInvestmentUsd6;
        _setAssetDestination(asset, defaultDestinationId);

        emit AssetUpdated(
            symbol,
            name,
            token,
            oracle,
            riskClass,
            assetRole,
            minimumInvestmentUsd6,
            defaultDestinationId,
            asset.destination,
            asset.destinationType
        );
    }

    function getActiveSymbols() external view returns (string[] memory) {
        return _symbolList;
    }

    function getAsset(string calldata symbol) external view returns (PortfolioAsset memory) {
        return _assets[_key(symbol)];
    }

    function isInPortfolio(string calldata symbol) external view returns (bool) {
        return _active[_key(symbol)];
    }

    function assetCount() external view returns (uint256) {
        return _symbolList.length;
    }

    function getAllAssets() external view returns (PortfolioAsset[] memory result) {
        uint256 len = _symbolList.length;
        result = new PortfolioAsset[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _assets[_key(_symbolList[i])];
        }
    }

    function getDestination(uint256 destinationId) external view returns (ApprovedDestination memory) {
        require(_destinationExists(destinationId), "PortfolioRegistry: destination not found");
        return _destinations[destinationId];
    }

    function getAllDestinations() external view returns (ApprovedDestination[] memory result) {
        uint256 len = _destinationIds.length;
        result = new ApprovedDestination[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _destinations[_destinationIds[i]];
        }
    }
}
