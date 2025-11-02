# Coverage Ratio Formula

## Overview
The coverage ratio is a key metric in the SAG Protocol that measures the protocol's ability to back its stablecoin liabilities with reserves.

## Formula

```
Coverage Ratio (%) = (Reserve NAV USD / Total Principal USD) × 100
```

### In Basis Points (BPS)

```
Coverage Ratio (BPS) = (Reserve NAV USD / Total Principal USD) × 10,000
```

## Components

### Reserve NAV USD
- The total net asset value of the protocol's reserve holdings
- Stored in the Reserve contract via `navReserveUsd()`
- Typically denominated in 6 decimals (USDC format)
- Includes:
  - Protocol-owned liquidity
  - Treasury assets
  - Accumulated fees and profits

### Total Principal USD
- The total amount of user deposits in the Vault
- Measured as USDC balance held by the Vault contract
- Represents the protocol's liabilities to depositors
- Denominated in 6 decimals (USDC format)

## Example Calculation

```
Reserve NAV USD = $150,000
Total Principal = $100,000

Coverage Ratio = (150,000 / 100,000) × 100 = 150%
Coverage Ratio BPS = (150,000 / 100,000) × 10,000 = 15,000 BPS
```

## Implementation

In the smart contracts, the coverage ratio is typically calculated and stored in basis points:

```solidity
uint256 coverageRatioBps = (navReserveUsd * 10_000) / totalPrincipalUsd;
```

In the frontend, this is converted to a percentage for display:

```typescript
function bpsToPct(bps: bigint): number {
  return Number(bps) / 100; // Convert BPS to percentage
}
```

## Interpretation

- **< 100%**: Under-collateralized - reserves cannot fully back deposits
- **= 100%**: Fully collateralized - reserves exactly match deposits
- **> 100%**: Over-collateralized - reserves exceed deposits (healthy state)

## Target Range

The SAG Protocol typically targets a coverage ratio above 100% to ensure:
- Stability during market volatility
- Confidence for depositors
- Buffer for operational expenses
- Capacity for growth and rewards
