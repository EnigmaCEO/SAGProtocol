// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockApi3Proxy
 * @notice Local / testnet stand-in for an API3 dAPI proxy.
 * @dev Implements the same `read()` interface as a real API3 IProxy so that
 *      API3PriceAdapter can be tested without a live API3 deployment.
 *
 *      Prices are stored in USD with 18 decimal places to match the API3 format.
 *      Example: $2,000.00 gold price → setValue(2000e18)
 *
 *      NOT for production. Deploy the real API3 proxy address in production.
 */
contract MockApi3Proxy {
    /// @notice Stored price in USD with 18 decimals (API3 format).
    int224 public value;
    /// @notice Timestamp of the last update.
    uint32 public timestamp;

    event ValueSet(int224 value, uint32 timestamp);

    constructor(int224 initialValue) {
        value = initialValue;
        timestamp = uint32(block.timestamp);
    }

    /**
     * @notice Update the mock price.
     * @param _value New price in USD with 18 decimal places (e.g. 2000e18 for $2,000.00).
     */
    function setValue(int224 _value) external {
        value = _value;
        timestamp = uint32(block.timestamp);
        emit ValueSet(_value, timestamp);
    }

    /**
     * @notice Mimic API3 IProxy.read() — returns current value and timestamp.
     */
    function read() external view returns (int224, uint32) {
        return (value, timestamp);
    }

    /**
     * @notice Stub for IProxy.api3ServerV1() to satisfy full interface compliance.
     */
    function api3ServerV1() external pure returns (address) {
        return address(0);
    }
}
