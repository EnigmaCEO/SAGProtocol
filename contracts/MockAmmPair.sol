// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAmmPair {
    uint256 public constant SWAP_FEE_BPS = 30; // 0.3%

    function swap(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        returns (uint256 amountOut)
    {
        require(reserveIn > 0 && reserveOut > 0, "Invalid reserves");
        uint256 amountInWithFee = amountIn * (10000 - SWAP_FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
    }

    // Implement constant-product AMM logic with swap fee and TWAP helpers.
}
