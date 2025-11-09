// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockAmmPair {
    using SafeERC20 for IERC20;

    uint256 public constant SWAP_FEE_BPS = 30; // 0.3%

    address public tokenA;
    address public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB);
    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address to);

    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0) && _tokenA != _tokenB, "invalid tokens");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    // Anyone can add liquidity by transferring tokens to the pair and calling this.
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(amountA > 0 && amountB > 0, "zero amounts");
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    // Read current reserves
    function getReserves() external view returns (uint256, uint256) {
        return (reserveA, reserveB);
    }

    // Swap exact tokens: caller must have approved this contract to pull tokenIn.
    // Returns amountOut transferred to `to`.
    function swapExactTokensForTokens(
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        address to
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "zero amount");
        require((tokenIn == tokenA && tokenOut == tokenB) || (tokenIn == tokenB && tokenOut == tokenA), "invalid pair");

        // Determine reserves orientation
        bool aToB = (tokenIn == tokenA);
        uint256 reserveIn = aToB ? reserveA : reserveB;
        uint256 reserveOut = aToB ? reserveB : reserveA;
        require(reserveIn > 0 && reserveOut > 0, "insufficient liquidity");

        // Pull tokens in
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Compute amountOut using Uniswap-like formula with fee
        uint256 amountInWithFee = amountIn * (10000 - SWAP_FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 10000 + amountInWithFee;
        amountOut = numerator / denominator;
        require(amountOut > 0, "zero output");

        // Transfer out to recipient
        IERC20(tokenOut).safeTransfer(to, amountOut);

        // Update reserves
        if (aToB) {
            reserveA = IERC20(tokenA).balanceOf(address(this));
            reserveB = IERC20(tokenB).balanceOf(address(this));
        } else {
            reserveB = IERC20(tokenB).balanceOf(address(this));
            reserveA = IERC20(tokenA).balanceOf(address(this));
        }

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    // Convenience: allow anyone to skim contract balances into reserves (useful after external transfers)
    function sync() external {
        reserveA = IERC20(tokenA).balanceOf(address(this));
        reserveB = IERC20(tokenB).balanceOf(address(this));
    }
}
