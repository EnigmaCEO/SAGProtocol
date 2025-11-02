# Reserve Initialization Guide

## Overview
This guide explains how to bootstrap the SAG Protocol Reserve with initial SAG tokens and gold (XAUT) holdings.

## Prerequisites

Before initializing the Reserve, ensure:
- Reserve contract is deployed
- SAG token contract is deployed
- XAUT token contract address is known
- Oracle contracts are deployed and configured
- Initial funding source (treasury wallet) is prepared

## Initialization Steps

### 1. Set Initial Oracle Prices

Before adding assets, ensure oracles report accurate prices:

```solidity
// Set initial gold (XAUT) price via oracle
// Example: $2,000 per oz (in 6 decimals)
goldOracle.setPrice(2_000_000_000); // $2,000.00

// Set initial SAG price via oracle  
// Example: $1.00 per SAG (in 6 decimals)
sagOracle.setPrice(1_000_000); // $1.00
```

### 2. Mint Initial SAG Tokens to Reserve

The Reserve needs an initial supply of SAG tokens:

```solidity
// Mint initial SAG supply to Reserve
// Example: 100,000 SAG tokens (18 decimals)
uint256 initialSagAmount = 100_000 * 1e18;
sagToken.mint(address(reserve), initialSagAmount);
```

### 3. Transfer Initial Gold (XAUT) to Reserve

Transfer XAUT from treasury to Reserve:

```solidity
// Transfer initial XAUT from treasury
// Example: 50 oz of gold (6 decimals for XAUT)
uint256 initialXautAmount = 50 * 1e6;
xautToken.transferFrom(treasury, address(reserve), initialXautAmount);
```

### 4. Update Reserve Balances

After transferring assets, update the Reserve's internal accounting:

```solidity
// Update Reserve balance tracking
reserve.updateBalances();

// Or if manual update is needed:
reserve.setSagBalance(initialSagAmount);
reserve.setXautBalance(initialXautAmount);
```

### 5. Calculate Initial NAV

The Reserve NAV is calculated as:

```
NAV USD = (SAG Balance × SAG Price) + (XAUT Balance × Gold Price)
```

Example calculation:
```
SAG: 100,000 tokens × $1.00 = $100,000
XAUT: 50 oz × $2,000 = $100,000
Total NAV = $200,000
```

## Example Initialization Script

```typescript
// scripts/initialize-reserve.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  // Contract addresses (replace with actual deployed addresses)
  const RESERVE_ADDRESS = "0x...";
  const SAG_TOKEN_ADDRESS = "0x...";
  const XAUT_TOKEN_ADDRESS = "0x...";
  const SAG_ORACLE_ADDRESS = "0x...";
  const GOLD_ORACLE_ADDRESS = "0x...";
  
  // Get contract instances
  const reserve = await ethers.getContractAt("Reserve", RESERVE_ADDRESS);
  const sagToken = await ethers.getContractAt("SAGToken", SAG_TOKEN_ADDRESS);
  const xautToken = await ethers.getContractAt("IERC20", XAUT_TOKEN_ADDRESS);
  const sagOracle = await ethers.getContractAt("Oracle", SAG_ORACLE_ADDRESS);
  const goldOracle = await ethers.getContractAt("Oracle", GOLD_ORACLE_ADDRESS);
  
  // Initial amounts
  const INITIAL_SAG = ethers.parseUnits("100000", 18); // 100k SAG
  const INITIAL_XAUT = ethers.parseUnits("50", 6); // 50 oz gold (XAUT uses 6 decimals)
  
  // Initial prices
  const SAG_PRICE = ethers.parseUnits("1", 6); // $1.00
  const GOLD_PRICE = ethers.parseUnits("2000", 6); // $2,000.00
  
  console.log("Setting initial oracle prices...");
  await sagOracle.setPrice(SAG_PRICE);
  await goldOracle.setPrice(GOLD_PRICE);
  
  console.log("Minting initial SAG to Reserve...");
  await sagToken.mint(RESERVE_ADDRESS, INITIAL_SAG);
  
  console.log("Transferring initial XAUT to Reserve...");
  await xautToken.transfer(RESERVE_ADDRESS, INITIAL_XAUT);
  
  console.log("Updating Reserve balances...");
  await reserve.updateBalances();
  
  // Verify NAV
  const nav = await reserve.navReserveUsd();
  console.log(`Initial Reserve NAV: $${ethers.formatUnits(nav, 6)}`);
  
  console.log("Reserve initialization complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Initial Capital Recommendations

### Conservative Approach
- SAG: 50,000 - 100,000 tokens
- XAUT: 25 - 50 oz
- Total NAV: $100,000 - $200,000

### Moderate Approach
- SAG: 250,000 - 500,000 tokens
- XAUT: 125 - 250 oz
- Total NAV: $500,000 - $1,000,000

### Aggressive Approach
- SAG: 1,000,000+ tokens
- XAUT: 500+ oz
- Total NAV: $2,000,000+

## Asset Allocation Strategy

Recommended initial allocation:
- **50% SAG**: Provides liquidity and protocol flexibility
- **50% XAUT**: Provides stability and value backing

This 50/50 split offers:
- Balance between growth (SAG) and stability (gold)
- Diversification of reserve assets
- Flexibility for future rebalancing

## Post-Initialization Checklist

- [ ] Verify SAG balance in Reserve contract
- [ ] Verify XAUT balance in Reserve contract
- [ ] Confirm oracle prices are set correctly
- [ ] Verify NAV calculation is accurate
- [ ] Test coverage ratio calculation
- [ ] Document initial state for audit trail
- [ ] Set up monitoring for balance changes

## Important Notes

1. **Irreversible**: Initial minting cannot be undone easily
2. **Oracle Accuracy**: Ensure oracles report real market prices
3. **Treasury Security**: Use multi-sig for treasury wallet
4. **Gradual Scaling**: Start with smaller amounts, scale up based on demand
5. **Audit Trail**: Document all initialization transactions
6. **XAUT Decimals**: Note that XAUT uses 6 decimals, not 18 like most ERC20 tokens

## Troubleshooting

### NAV is Zero
- Check if oracle prices are set
- Verify tokens were actually transferred
- Ensure `updateBalances()` was called

### Coverage Ratio Error
- Ensure Vault has been initialized first
- Check that totalPrincipal > 0 before calculating ratio
- Initial state should have Reserve NAV > 0 with no deposits

### Token Transfer Failed
- Verify Reserve contract has proper approvals
- Check token balance of sender
- Ensure Reserve address is correct
- Verify XAUT decimal handling (6 decimals, not 18)
