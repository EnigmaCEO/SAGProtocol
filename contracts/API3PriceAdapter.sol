// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal interface for any API3 IProxy-compatible contract.
interface IApi3Proxy {
    /// @notice Returns the latest data point written by the data feed.
    /// @return value     Price in USD with 18 decimal places (int224).
    /// @return timestamp Unix timestamp of the last on-chain update (uint32).
    function read() external view returns (int224 value, uint32 timestamp);
}

/**
 * @title API3PriceAdapter
 * @notice Wraps an API3 dAPI proxy and exposes the oracle interfaces expected by
 *         Treasury and ReserveController.
 *
 * @dev API3 dAPI proxies return `(int224 value, uint32 timestamp)` via `read()` where
 *      `value` carries 18 decimal places (e.g. 2000e18 = $2,000.00).
 *      This adapter converts to 8 decimal places (`price8`) used throughout the protocol:
 *          price8 = uint256(value) / 1e10
 *
 *      Deploy one adapter per price feed. For example:
 *        - goldAdapter  = new API3PriceAdapter(xautUsdProxyAddress)
 *        - stableAdapter = new API3PriceAdapter(usdcUsdProxyAddress)
 *      Then point Treasury.setGoldOracle / setPriceOracle at the adapters.
 *
 *      FINDING THE PROXY ADDRESS:
 *        Visit https://market.api3.org, select the chain and data feed (e.g. XAU/USD),
 *        and copy the proxy address. On Moonbase Alpha use the testnet section.
 *
 *      HEARTBEAT / STALENESS:
 *        API3 dAPIs self-report via OEV-enabled beacons. The adapter re-validates
 *        freshness using `maxAge` (default 1 day). Reduce for volatile assets.
 *
 *      SECURITY — CENTRALIZATION:
 *        The owner can swap the underlying proxy address. Gate the owner behind a
 *        multi-sig or timelock before mainnet deployment.
 */
contract API3PriceAdapter is Ownable {

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice The API3 dAPI proxy for this feed (e.g. XAU/USD proxy on Moonbeam).
    IApi3Proxy public proxy;

    /// @notice Maximum acceptable age of a price update in seconds.
    ///         Readings older than this are treated as stale and `valid` returns false.
    uint256 public maxAge = 1 days;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ProxyUpdated(address indexed previousProxy, address indexed newProxy);
    event MaxAgeUpdated(uint256 newMaxAge);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param _proxy API3 dAPI proxy address for the target price feed.
     */
    constructor(address _proxy) Ownable(msg.sender) {
        require(_proxy != address(0), "API3PriceAdapter: zero proxy");
        proxy = IApi3Proxy(_proxy);
        emit ProxyUpdated(address(0), _proxy);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /**
     * @notice Update the underlying API3 proxy address (e.g. when migrating to a new feed).
     * @param _proxy New API3 dAPI proxy address.
     */
    function setProxy(address _proxy) external onlyOwner {
        require(_proxy != address(0), "API3PriceAdapter: zero proxy");
        address prev = address(proxy);
        proxy = IApi3Proxy(_proxy);
        emit ProxyUpdated(prev, _proxy);
    }

    /**
     * @notice Update the staleness threshold.
     * @param _maxAge Maximum acceptable price age in seconds. Set to 0 to disable the check.
     */
    function setMaxAge(uint256 _maxAge) external onlyOwner {
        maxAge = _maxAge;
        emit MaxAgeUpdated(_maxAge);
    }

    // ─── Internal read ───────────────────────────────────────────────────────

    /**
     * @dev Reads from the API3 proxy and normalises the output.
     *      Converts int224 (18 dec) → uint256 (8 dec).
     *      Returns isValid=false when:
     *        - value is zero or negative
     *        - timestamp is zero
     *        - price is older than maxAge (when maxAge > 0)
     */
    function _readProxy()
        internal
        view
        returns (uint256 price8, uint256 ts, bool isValid)
    {
        (int224 raw, uint32 timestamp) = proxy.read();
        ts = uint256(timestamp);

        // Reject non-positive prices (int224 can be negative in edge cases)
        if (raw <= 0) {
            return (0, ts, false);
        }

        // Convert 18-decimal int224 → 8-decimal uint256.
        // Safe: raw > 0 so int256(raw) > 0 and uint256 cast is safe.
        price8 = uint256(int256(raw)) / 1e10;

        if (price8 == 0 || ts == 0) {
            return (0, ts, false);
        }

        // Staleness check
        if (maxAge > 0 && block.timestamp > ts + maxAge) {
            return (price8, ts, false);
        }

        isValid = true;
    }

    // ─── Oracle interfaces ───────────────────────────────────────────────────

    /**
     * @notice Returns the asset price in USD with 8 decimal places.
     * @dev Implements IPriceOracle used by Vault, Treasury, and ReserveController.
     *      Returns 0 when the feed is stale or invalid.
     */
    function getPrice() external view returns (uint256) {
        (uint256 price8, , ) = _readProxy();
        return price8;
    }

    /**
     * @notice Returns the gold price in USD with 6 decimal places.
     * @dev Legacy IGoldOracleLegacy interface still consumed by some off-chain tooling.
     *      price6 = price8 / 100.
     */
    function getGoldPrice() external view returns (uint256) {
        (uint256 price8, , ) = _readProxy();
        return price8 / 100;
    }

    /**
     * @notice Returns price, timestamp, and validity in a single call.
     * @dev Implements IOracleLatest — the preferred interface for Treasury and ReserveController.
     * @return price8  Asset price in USD with 8 decimal places.
     * @return ts      Unix timestamp of the last on-chain price update.
     * @return isValid True when the price is positive, non-stale, and the feed responded.
     */
    function latest()
        external
        view
        returns (uint256 price8, uint256 ts, bool isValid)
    {
        return _readProxy();
    }

    /**
     * @notice Returns the timestamp of the most recent price update.
     * @dev Implements IOracleUpdatedAt used as a fallback in _readOraclePrice8().
     */
    function updatedAt() external view returns (uint256) {
        (, uint32 timestamp) = proxy.read();
        return uint256(timestamp);
    }

    /**
     * @notice Returns whether the current reading is considered valid.
     * @dev Implements IOracleValidity used as a fallback in _readOraclePrice8().
     */
    function valid() external view returns (bool) {
        (, , bool isValid) = _readProxy();
        return isValid;
    }
}
