// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortfolioRegistry
/// @notice On-chain registry of assets accepted in the Escrow allocation portfolio.
///         Assets are keyed by their symbol (unique). The token address is optional —
///         external assets such as fund units or off-chain instruments set it to
///         address(0). Allocation weights are supplied per-batch by the AAA off-chain.
contract PortfolioRegistry {
    // ── Enums ──────────────────────────────────────────────────────────────

    enum RiskClass {
        WealthManagement,  // 0 – managed wealth / SPC
        Stablecoin,        // 1 – USD-pegged stables
        DefiBluechip,      // 2 – established DeFi protocols
        FundOfFunds,       // 3 – on-chain fund aggregators
        LargeCap,          // 4 – large-cap L1/L2 tokens
        PrivateCreditFund, // 5 – tokenized private credit (Maple, Goldfinch, Centrifuge)
        RealWorldAsset,    // 6 – tokenized RWA / T-bills / bonds (Ondo, Backed, etc.)
        ExternalProtocol   // 7 – cross-chain or external-platform positions
    }

    enum AssetRole {
        Core,        // 0 – primary return driver
        Liquidity,   // 1 – liquidity buffer
        Satellite,   // 2 – tactical / thematic
        Defensive,   // 3 – capital preservation / low-vol
        Speculative, // 4 – high-risk / high-reward
        YieldFund,   // 5 – fund allocations generating yield
        External     // 6 – off-chain or cross-chain position
    }

    // ── Structs ────────────────────────────────────────────────────────────

    struct PortfolioAsset {
        string    symbol;                // unique ticker, e.g. "SPC"
        string    name;                  // display name, e.g. "Sagitta SPC"
        address   token;                 // ERC-20 address; address(0) for external/off-chain assets
        address   oracle;                // price oracle; address(0) if not yet wired
        RiskClass riskClass;
        AssetRole role;
        uint256   minimumInvestmentUsd6; // minimum investment in USD, scaled to 6 decimals
        uint256   addedAt;               // block.timestamp when added
    }

    // ── State ──────────────────────────────────────────────────────────────

    address public owner;

    // Internal key = keccak256(abi.encodePacked(symbol))
    string[]                           private _symbolList; // ordered active symbols
    mapping(bytes32 => PortfolioAsset) private _assets;     // symbolKey => asset data
    mapping(bytes32 => bool)           private _active;     // symbolKey => in portfolio

    // ── Events ────────────────────────────────────────────────────────────

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AssetAdded(
        string symbol,
        address token,
        RiskClass riskClass,
        AssetRole role,
        uint256 minimumInvestmentUsd6
    );
    event AssetRemoved(string symbol);
    event AssetUpdated(
        string symbol,
        string name,
        address token,
        address oracle,
        RiskClass riskClass,
        AssetRole role,
        uint256 minimumInvestmentUsd6
    );

    // ── Modifier ──────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "PortfolioRegistry: not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── Ownership ─────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PortfolioRegistry: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    function _key(string memory symbol) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(symbol));
    }

    // ── Portfolio mutations ───────────────────────────────────────────────

    /// @notice Add an asset to the accepted allocation portfolio.
    /// @param symbol     Unique ticker (e.g. "SPC"). Used as the primary key.
    /// @param name       Display name (e.g. "Sagitta SPC").
    /// @param token      ERC-20 address. Pass address(0) for external / off-chain assets.
    /// @param oracle     Price oracle address. Pass address(0) if not yet available.
    /// @param riskClass  Risk classification enum value.
    /// @param assetRole  Portfolio role enum value.
    /// @param minimumInvestmentUsd6 Minimum investment in USD, scaled to 6 decimals.
    function addAsset(
        string   calldata symbol,
        string   calldata name,
        address           token,
        address           oracle,
        RiskClass         riskClass,
        AssetRole         assetRole,
        uint256           minimumInvestmentUsd6
    ) external onlyOwner {
        require(bytes(symbol).length > 0, "PortfolioRegistry: empty symbol");
        bytes32 k = _key(symbol);
        require(!_active[k], "PortfolioRegistry: symbol already in portfolio");

        _assets[k] = PortfolioAsset({
            symbol:    symbol,
            name:      name,
            token:     token,
            oracle:    oracle,
            riskClass: riskClass,
            role:      assetRole,
            minimumInvestmentUsd6: minimumInvestmentUsd6,
            addedAt:   block.timestamp
        });
        _active[k] = true;
        _symbolList.push(symbol);

        emit AssetAdded(symbol, token, riskClass, assetRole, minimumInvestmentUsd6);
    }

    /// @notice Remove an asset from the portfolio by its symbol.
    function removeAsset(string calldata symbol) external onlyOwner {
        bytes32 k = _key(symbol);
        require(_active[k], "PortfolioRegistry: symbol not in portfolio");

        _active[k] = false;

        // Swap-and-pop removal from the symbol list.
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

    /// @notice Update the token address, oracle, or classification of an existing asset.
    function updateAsset(
        string    calldata symbol,
        string    calldata name,
        address            token,
        address            oracle,
        RiskClass          riskClass,
        AssetRole          assetRole,
        uint256            minimumInvestmentUsd6
    ) external onlyOwner {
        bytes32 k = _key(symbol);
        require(_active[k], "PortfolioRegistry: symbol not in portfolio");
        PortfolioAsset storage a = _assets[k];
        a.name = name;
        a.token = token;
        a.oracle = oracle;
        a.riskClass = riskClass;
        a.role = assetRole;
        a.minimumInvestmentUsd6 = minimumInvestmentUsd6;
        emit AssetUpdated(symbol, name, token, oracle, riskClass, assetRole, minimumInvestmentUsd6);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    /// @notice Returns all active symbol tickers in insertion order.
    function getActiveSymbols() external view returns (string[] memory) {
        return _symbolList;
    }

    /// @notice Returns full asset data for a symbol.
    function getAsset(string calldata symbol) external view returns (PortfolioAsset memory) {
        return _assets[_key(symbol)];
    }

    /// @notice Returns true if the symbol is currently in the active portfolio.
    function isInPortfolio(string calldata symbol) external view returns (bool) {
        return _active[_key(symbol)];
    }

    /// @notice Total number of active portfolio assets.
    function assetCount() external view returns (uint256) {
        return _symbolList.length;
    }

    /// @notice Batch-read all active assets with their full data in insertion order.
    function getAllAssets() external view returns (PortfolioAsset[] memory result) {
        uint256 len = _symbolList.length;
        result = new PortfolioAsset[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _assets[_key(_symbolList[i])];
        }
    }
}
