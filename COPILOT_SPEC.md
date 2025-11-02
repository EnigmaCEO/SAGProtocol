# 🧠 COPILOT_SPEC.md
## Project Title
**SAG Protocol — Safe Automated Treasury & Reserve (Moonbeam Testnet)**

---

## Overview

SAG Protocol is a **user-centric, automated investment vault** built for the Polkadot ecosystem (demo on **Moonbeam testnet**).  
Its mission is to bring Web2-style safety and trust into Web3 finance by guaranteeing that **user deposits are never touched** by protocol operations.

### Core Design
- **User Vault (UV)** – Stores user USDC deposits. Principal remains immutable until withdrawal.
- **Operating Treasury (SAG-T)** – Protocol-owned capital (SAG token) that performs investment operations, buybacks, and profit distribution.
- **Gold Reserve (GOLD / XAUt)** – A counter-cyclical buffer that stabilizes the treasury value using gold exposure.
- **Profit Automation** – At every `harvest()` call, profits are split automatically:
  - α% → User profit credits (12-month vest)
  - β% → GOLD reserve (USDC→GOLD swap)
  - γ% → Liquidity buffer (SWCP)
  - δ% → SAG buyback (controlled market shock)
- **Coverage-Gated Deposits** – New deposits only accepted if the protocol’s coverage ratio (Treasury + Reserve / Liabilities) ≥ threshold (1.05x).

### Objective
Deliver a **vertical slice demo** that proves:
- User deposits stay protected and static.
- Treasury automation and buyback work autonomously.
- Reserve rebalancing maintains stability.
- Cross-chain oracles and tokens operate seamlessly on Moonbeam.

---

## Architecture Diagram (Mermaid)

```mermaid
flowchart LR
  U[User] -->|USDC Deposit| V[Vault (Principal Safe)]
  V -->|Internal Shares| U
  T[Treasury (SAG Ops)]
  R[Reserve (GOLD/XAUt)]
  A[AMM (SAG/USDC, USDC/GOLD)]
  O[Oracle (API3/DIA)]
  T -->|Harvest Split| V
  T -->|Buyback Budget| A
  T <-->|Swap SAG/USDC| A
  T -->|Funds| R
  R <-->|Swap GOLD/USDC| A
  O -->|Price Feeds| R
  O -->|Price Feeds| T
Monorepo Layout
lua
Copy code
sag-protocol/
  contracts/
    SAGToken.sol
    MockUSDC.sol
    MockGOLD.sol
    Vault.sol
    Treasury.sol
    ReserveController.sol
    AMM/MockAmmPair.sol
    Oracle/MockOracle.sol
    interfaces/
      IVault.sol
      ITreasury.sol
      IReserveController.sol
      IAMM.sol
      IOracle.sol
  scripts/
    deploy.ts
    demoScenario.ts
    buybackWindow.ts
  test/
    vault.spec.ts
    treasury.spec.ts
    reserve.spec.ts
    buyback.spec.ts
    coverageGate.spec.ts
  frontend/
    next.config.mjs
    package.json
    src/
      pages/
        index.tsx
      components/
        Meters.tsx
        EventFeed.tsx
        DepositCard.tsx
        ProfitCreditsCard.tsx
      lib/
        ethers.ts
        addresses.ts
        format.ts
      styles/
        globals.css
  docs/
    README.md
    architecture.md
    diagrams.mmd
  hardhat.config.ts
  package.json
  tsconfig.json
  .env.example
  .gitignore
Toolchain
Layer	Stack
Contracts	Solidity ^0.8.24 + Hardhat
Frontend	Next.js 15 + Tailwind + Wagmi + Ethers
Testing	Hardhat + Mocha/Chai
Network	Moonbase Alpha (chainId 1287)
Oracles	API3 / DIA test feeds (mocked in demo)
AI Assistance	GitHub Copilot for all code generation
Version Control	GitHub public repo per hackathon rules

Smart Contract Details
1️⃣ SAGToken.sol
ERC20, mintable by Treasury.

Pausable, Ownable, optional Permit.

Event: TreasurySet(address).

2️⃣ MockUSDC.sol
ERC20 with 6 decimals; faucet mint for test users.

3️⃣ MockGOLD.sol
ERC20 with 18 decimals; used as GOLD reserve token.

4️⃣ MockOracle.sol
Function setPrice(int256) and latestAnswer() returning 8-decimal price feed.

5️⃣ MockAmmPair.sol
Constant-product AMM for SAG/USDC and USDC/GOLD.

Swap fee = 0.3%.

Exposes liquidity add/remove and TWAP helpers.

6️⃣ Vault.sol
Accepts deposits only via Treasury admission.

Tracks principal & shares.

Records profit credits (12-month cliff).

Claim credits after unlock (transfers USDC from Treasury).

7️⃣ Treasury.sol
Holds protocol USDC/SAG.

Computes coverage ratio and admits deposits.

Executes harvest() to split profits:

α → Vault (issue credits)

β → Reserve (buy GOLD)

γ → SWCP buffer

δ → Buyback (TWAP via AMM)

Events: Harvested, BuybackStarted, BuybackTick, BuybackCompleted.

8️⃣ ReserveController.sol
Manages GOLD reserves within target ratio.

Buys GOLD if below floor, sells if above ceiling.

Uses oracle for GOLD price.

Events: ReserveFilled, ReserveDrained.

Hardhat Setup
hardhat.config.ts includes:

ts
Copy code
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    hardhat: {},
    moonbase: {
      url: process.env.MOONBASE_RPC,
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 1287
    },
  },
};
export default config;
Scripts
deploy.ts
Deploy tokens, oracle, AMM pools.

Add liquidity.

Deploy Vault, Reserve, Treasury.

Set policy parameters.

Output addresses to frontend/src/lib/addresses.ts.

demoScenario.ts
Simulates the full flow:

Deposit → Harvest (profit split) → Buyback → Reserve Update → Profit Credit Claim.

buybackWindow.ts
Executes TWAP-style buyback ticks in intervals.

Testing Plan
File	Coverage
vault.spec.ts	Deposits, withdrawals, profit credit claim logic.
coverageGate.spec.ts	Treasury coverage ratio enforcement.
treasury.spec.ts	Harvest splits, event emissions, credit linkage.
reserve.spec.ts	Reserve band balancing with oracle.
buyback.spec.ts	TWAP buyback correctness, slippage cap.

Frontend Features
Dashboard: Coverage Ratio, Reserve Ratio, NAV, Buyback Status.

Deposit Card: connect wallet, mint USDC, request deposit.

Profit Credits Card: view + claim vested profits.

Event Feed: live updates from contract logs.

Meters: visual gauges for ratios and NAV.

Environment Variables
.env.example

bash
Copy code
MOONBASE_RPC=https://rpc.api.moonbase.moonbeam.network
PRIVATE_KEY=0xYOUR_TEST_KEY
Policy Parameters (default)
Param	Value
crMinBps	10500
reserveFloorBps	1200
reserveCeilBps	2500
splits	α=6000 β=2000 γ=1500 δ=500
maxSlippageBps	100
payoutBwUsd	10000
goldPrice	2000 USD

README Boilerplate (docs/README.md)
markdown
Copy code
# SAG Protocol — Safe Automated Treasury & Reserve

SAG Protocol demonstrates how Web2-style safety meets Web3 automation.
User deposits are always protected, while protocol-owned capital performs on-chain investments, buybacks, and gold-backed stabilization.

### Features
- Principal-protected deposits
- Automated profit distribution
- Oracle-driven reserve management
- Controlled buyback market shock
- Real-time UI on Moonbeam testnet

### Quick Start
pnpm install  
pnpm compile  
pnpm test  
pnpm deploy  
pnpm demo  
cd frontend && pnpm dev

### Roadmap
- Integrate real XAUt token
- Add DAO vendor escrow system
- Migrate SAG to runtime pallet-assets
Development Instructions for Copilot
Generate all contracts and boilerplate according to this spec.

Ensure all Solidity contracts compile cleanly with Hardhat.

Generate scripts/deploy.ts and scripts/demoScenario.ts runnable locally.

Auto-generate placeholder React components in frontend/src/components with Tailwind styling.

Create a frontend home page displaying key metrics with mock data from deployed contracts.

Output all generated addresses to frontend/src/lib/addresses.ts.

Verify the project builds without manual edits (pnpm compile && pnpm dev).

Use modern ES modules and TypeScript.

Deliverable Goal
A fully scaffolded, buildable mono-repo that demonstrates:

DeFi automation (Vault + Treasury + Reserve)

On-chain event-driven profit allocation

Controlled buyback simulation

Oracle-fed reserve balancing

UI dashboard visualizing system metrics

This repo will be submitted to the Polkadot “Bring Web2 Apps to Web3” Hackathon under the User-Centric Apps category.