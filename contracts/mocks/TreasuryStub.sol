// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TreasuryStub {
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

    // parameterless constructor for tests
    constructor() {}

    // Called by Escrow in real system; here just store values and emit for tests
    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external {
        lastFundedBatch = batchId;
        lastFundedAmount = amountUsd;
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

    // test-only helper
    function poke() external pure returns (bool) {
        return true;
    }
}
