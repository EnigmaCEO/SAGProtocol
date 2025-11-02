// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 { 
    function transfer(address to, uint256 amount) external returns (bool); 
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ITreasury {
    function usdc() external view returns (address);
}

contract InvestmentEscrow {
    ITreasury public treasury;
    IERC20 public usdc;
    uint256 public nextInvestmentId;

    struct Investment {
        address vendor;
        uint256 amountUsd6;
        uint256 startTime;
        uint256 endTime;
        bool returned;
    }

    mapping(uint256 => Investment) public investments;

    event InvestmentOpened(uint256 indexed investmentId, address indexed vendor, uint256 amountUsd6, uint256 duration);
    event InvestmentClosed(uint256 indexed investmentId, uint256 returnedAmount, uint256 profit);

    constructor(address _usdc, address _treasury) {
        usdc = IERC20(_usdc);
        treasury = ITreasury(_treasury);
    }

    function openInvestment(address vendor, uint256 amountUsd6, uint256 duration) external {
        // Transfer USDC from treasury to vendor
        require(usdc.transferFrom(msg.sender, vendor, amountUsd6), "Transfer failed");
        
        investments[nextInvestmentId] = Investment({
            vendor: vendor,
            amountUsd6: amountUsd6,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            returned: false
        });
        
        emit InvestmentOpened(nextInvestmentId, vendor, amountUsd6, duration);
        nextInvestmentId++;
    }

    function closeInvestment(uint256 investmentId, uint256 returnedAmount) external {
        Investment storage inv = investments[investmentId];
        require(msg.sender == inv.vendor, "Only vendor");
        require(!inv.returned, "Already returned");
        
        inv.returned = true;
        
        // Transfer returned amount from vendor back to treasury
        require(usdc.transferFrom(msg.sender, address(treasury), returnedAmount), "Transfer failed");
        
        uint256 profit = returnedAmount > inv.amountUsd6 ? returnedAmount - inv.amountUsd6 : 0;
        emit InvestmentClosed(investmentId, returnedAmount, profit);
    }
}
