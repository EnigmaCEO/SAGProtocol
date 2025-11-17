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
    // reduced event arguments to avoid "stack too deep" during emit
    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0) && _tokenA != _tokenB, "invalid tokens");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    // Compatibility: expose Uniswap-like token0/token1 for tooling that expects it
    function token0() external view returns (address) {
        return tokenA;
    }

    function token1() external view returns (address) {
        return tokenB;
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
    // UniswapV2-compatible: returns (reserve0, reserve1, blockTimestampLast)
    // Many tools expect getReserves() to have this signature.
    function getReserves() external view returns (uint112, uint112, uint32) {
        // cast down to uint112 for compatibility with UniswapV2 interface used by many probes/tools.
        // For local/testing, reserves are expected to be small enough to fit in uint112.
        return (uint112(reserveA), uint112(reserveB), uint32(block.timestamp % 2**32));
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

        // Attempt to pull tokens in (router-style). If transferFrom reverts,
        // accept the case where tokens were pre-transferred into the pair and validate balances.
        uint256 balanceBeforeAttempt = IERC20(tokenIn).balanceOf(address(this));
        bool pulled = false;
        // try to pull tokens via transferFrom; if this reverts, check whether tokens were pre-funded
        try IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn) returns (bool ok) {
            require(ok, "transferFrom failed");
            pulled = true;
        } catch {
            // transferFrom reverted — examine current balance to detect pre-funding.
            uint256 currentBalance = IERC20(tokenIn).balanceOf(address(this));
            // If caller pre-funded earlier, currentBalance will already include that amount:
            // accept if currentBalance >= reserveIn + amountIn (i.e., at least amountIn above logical reserve).
            if (currentBalance >= reserveIn + amountIn) {
                pulled = true;
            } else {
                // Fallback: if balance increased during this call path and is >= balanceBeforeAttempt + amountIn,
                // consider it pulled (covers unusual race/transfer timing).
                if (currentBalance >= balanceBeforeAttempt + amountIn) {
                    pulled = true;
                } else {
                    revert("transferFrom failed and no pre-funded tokens");
                }
            }
        }

        require(pulled, "token pull failed");

        // Compute amountOut using Uniswap-like formula with fee (inline to reduce local temporaries)
        {
            uint256 amountInWithFee = amountIn * (10000 - SWAP_FEE_BPS);
            amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
        }
        require(amountOut > 0, "zero output");

        // Transfer out to recipient
        IERC20(tokenOut).safeTransfer(to, amountOut);

        // Update reserves to actual token balances (sync)
        reserveA = IERC20(tokenA).balanceOf(address(this));
        reserveB = IERC20(tokenB).balanceOf(address(this));

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // Convenience: allow anyone to skim contract balances into reserves (useful after external transfers)
    function sync() external {
        reserveA = IERC20(tokenA).balanceOf(address(this));
        reserveB = IERC20(tokenB).balanceOf(address(this));
    }
}
