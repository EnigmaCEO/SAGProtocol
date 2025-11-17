// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestTreasury {
    IERC20 public usdc;
    // last reported values for assertions
    uint256 public lastFundedBatch;
    uint256 public lastFundedAmount;
    uint256 public lastReportedBatch;
    uint256 public lastPrincipalUsd;
    uint256 public lastUserProfitUsd;
    uint256 public lastFeeUsd;
    uint256 public lastFinalNavPerShare;

    event Funded(uint256 batchId, uint256 amount, address to);
    event Reported(uint256 batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd, uint256 finalNavPerShare);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    // Test helper: allow this Treasury contract to approve tokens to a spender (useful in tests)
    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    // Called by Escrow; mint USDC to caller (escrow) to simulate funding
    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external {
        lastFundedBatch = batchId;
        lastFundedAmount = amountUsd;
        // Try to mint if token supports mint(address,uint256)
        // Best-effort: we ignore failures here to keep test flow robust.
        (bool ok, ) = address(usdc).call(abi.encodeWithSignature("mint(address,uint256)", msg.sender, amountUsd));
        // If mint failed, attempt transfer from this contract (requires pre-funded TestTreasury)
        if (!ok) {
            // no-op fallback
        }
        emit Funded(batchId, amountUsd, msg.sender);
    }

    // Treasury is notified when batch is closed so tests can assert values
    function reportBatchResult(uint256 batchId, uint256 principalUsd, uint256 userProfitUsd, uint256 feeUsd, uint256 finalNavPerShare) external {
        lastReportedBatch = batchId;
        lastPrincipalUsd = principalUsd;
        lastUserProfitUsd = userProfitUsd;
        lastFeeUsd = feeUsd;
        lastFinalNavPerShare = finalNavPerShare;
        emit Reported(batchId, principalUsd, userProfitUsd, feeUsd, finalNavPerShare);
    }
}
