// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GoldOracle
 * @notice Centralized price oracle for the gold reserve asset (XAUT / PAXG in production,
 *         mock GOLD token on testnet).
 * @dev Reports price in USD with 6 decimals via getGoldPrice() and 8 decimals via
 *      getPrice() / latest(). Consumed by Treasury and ReserveController.
 *
 * SECURITY — CENTRALIZATION RISK:
 *   Price updates are controlled by a single owner key. A compromised owner can post an
 *   arbitrary price and trigger incorrect rebalancing or under-collateralization. For
 *   mainnet deployment:
 *   - Gate the owner behind a multi-sig (Gnosis Safe) or a timelock controller.
 *   - Consider migrating to a Chainlink Data Feed or equivalent decentralised source.
 *   - Stale-price protection is enforced in Treasury via the MAX_ORACLE_AGE constant.
 */
contract GoldOracle is Ownable {
    /// @notice Current gold price in USD with 6 decimals (e.g. 2000_000000 = $2,000.00).
    uint256 public goldPrice;
    /// @notice Unix timestamp of the most recent price update.
    uint256 public updatedAt;
    /// @notice Whether this oracle is considered valid / operational.
    bool public valid = true;

    event GoldPriceSet(uint256 price);
    event OracleValiditySet(bool valid);

    /**
     * @param initialPrice Initial gold price in USD with 6 decimals.
     */
    constructor(uint256 initialPrice) Ownable(msg.sender) {
        require(initialPrice > 0, "GoldOracle: initial price must be > 0");
        goldPrice = initialPrice;
        updatedAt = block.timestamp;
    }

    /**
     * @notice Update the gold price. Only callable by the owner (operator / multi-sig).
     * @param price New gold price in USD with 6 decimals. Must be greater than zero.
     */
    function setGoldPrice(uint256 price) external onlyOwner {
        require(price > 0, "GoldOracle: price must be > 0");
        goldPrice = price;
        updatedAt = block.timestamp;
        emit GoldPriceSet(price);
    }

    /**
     * @notice Mark this oracle as valid or invalid. Only callable by the owner.
     * @dev Setting valid=false causes Treasury to treat the oracle as stale,
     *      potentially triggering an Emergency stress state.
     * @param _valid True if the oracle is operational; false to signal a circuit-break.
     */
    function setValid(bool _valid) external onlyOwner {
        valid = _valid;
        emit OracleValiditySet(_valid);
    }

    /// @notice Returns the gold price in USD with 6 decimals (legacy IGoldOracleLegacy interface).
    function getGoldPrice() external view returns (uint256) {
        return goldPrice;
    }

    /// @notice Returns the gold price in USD with 8 decimals (IPriceOracle-compatible).
    /// @dev price8 = goldPrice * 100.
    function getPrice() external view returns (uint256) {
        return goldPrice * 100;
    }

    /**
     * @notice Returns price, timestamp, and validity in one call (IOracleLatest interface).
     * @return price8     Gold price in USD with 8 decimals.
     * @return timestamp  Unix timestamp of the last price update.
     * @return isValid    Whether the oracle is currently considered valid.
     */
    function latest() external view returns (uint256 price8, uint256 timestamp, bool isValid) {
        return (goldPrice * 100, updatedAt, valid);
    }
}
