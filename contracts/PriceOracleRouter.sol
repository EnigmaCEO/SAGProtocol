// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISagOracle {
    function getSagPrice() external view returns (uint256);
}

interface IGoldOracle {
    function getGoldPrice() external view returns (uint256);
}

contract PriceOracleRouter {
    address public sagOracle;
    address public goldOracle;

    constructor(address _sagOracle, address _goldOracle) {
        sagOracle = _sagOracle;
        goldOracle = _goldOracle;
    }

    function getSagPriceUsd() external view returns (uint256) {
        return ISagOracle(sagOracle).getSagPrice();
    }

    function getGoldPriceUsd() external view returns (uint256) {
        return IGoldOracle(goldOracle).getGoldPrice();
    }
}
