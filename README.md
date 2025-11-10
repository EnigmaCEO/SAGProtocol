## 🜂 Sagitta Protocol
An Autonomous Investment Engine for the Age of Trustless Wealth

Sagitta Protocol is a fully autonomous, self-regulating investment ecosystem built on Polkadot. It unites on-chain transparency with off-chain intelligence to form a complete DeFi architecture capable of managing, stabilizing, and protecting multi-billion-dollar portfolios.

- At its core, Sagitta is not a single contract — it is an engine of systems:
- Vaults issuing NFT receipts that represent real, tradable yield positions
- Treasuries that allocate liquidity dynamically between DeFi, staking, and institutional channels
- Reserves backed by tokenized gold assets such as XAUT and PAXG, forming a tangible insurance layer
- Escrows bridging on-chain trust and off-chain compliance for institutional onboarding
- And an AI Allocation Agent that manages every capital flow with precision — from small DOT deposits to high-net-worth nodes.

Together, these components create a living protocol capable of defending capital, rewarding participants, and adapting autonomously to market change.

## ⚙️ System Architecture
🏦 The Vault — Entry Point & NFT Receipts

Users deposit DOT into the Vault, which automatically issues NFT Receipts.
Each NFT represents a tokenized investment position with metadata including:

- Deposit amount and timestamp
- Expected APY or performance target
- Live Profit & Loss tracking feed
- Claim history and maturity schedule

These NFTs are tradable on the secondary market, allowing users to transfer, sell, or collateralize active yield positions — introducing true DeFi liquidity to staking and investment receipts.

## 💰 The Treasury — Liquidity Brain

The Treasury is the protocol’s central nervous system.
It manages liquidity flows, ensures 2:1 collateralization against the Reserve, and distributes capital to:

- On-chain staking pools for small and mid-size deposits
- Off-chain managed portfolios through the Escrow system for institutional-scale investments
- Stablecoin balancing pools that stabilize SAG token value

The Treasury continuously updates its P&L and interacts with the AI Allocation Layer, dynamically routing capital where it performs best while preserving safety ratios.

## 🏆 The Reserve — Gold Stability Engine

The Reserve is backed by tokenized gold assets (XAUT, PAXG) — serving as a final line of defense for investor capital.
It performs three roles:

1. Insurance — covering treasury underperformance with gold-backed liquidity.
2. Collateralization — ensuring every USDC or DOT-based deposit maintains a stable asset ratio.
3. Rebalance Authority — automatically adjusts the Treasury/Reserve ratio based on market volatility.

The Reserve transforms volatility into resilience — making Sagitta not just decentralized, but self-regulated.

## 🧾 The Escrow — Compliance & Institutional Bridge

The Escrow system connects off-chain investments with on-chain proof.
It conducts:

- Batch reporting on real-world portfolios
- Compliance checks and KYC onboarding for regulated investors
- Transparent P&L reports tied to each deposit batch

This allows institutions to integrate seamlessly without compromising DeFi transparency — a trust bridge between TradFi and Web3.

## 🤖 The AI Allocation Agent — Intelligent Governance

The AI allocation agent acts as Sagitta’s autonomous portfolio manager.
It analyzes:

- Market conditions
- Treasury ratios
- Historical yield data
- Risk levels per investment class

Small deposit batches are directed into staking and node operations, while large institutional deposits are diversified across our registered investors.
The system’s intelligence continuously rebalances exposure, ensuring that even in down markets, capital remains productive.

## 📈 P&L & Profit Defense System

Every NFT receipt maintains real-time Profit & Loss tracking and expected return timelines.
Profits are split 80/20 — 80% to the user, 20% to protocol reserves and DAO operations.
If investments underperform, the Reserve engages its 3-Layer Insurance System:

1. Treasury-based profit smoothing
2. Escrow recovery fund allocation
3. Gold reserve yield compensation — using appreciation from the Reserve’s assets to partially restore user profit

This multi-layer system ensures users experience profit stability, not just capital preservation — setting a new standard for investor protection in DeFi.

## 🔐 Technical Stack

- Blockchain: Polkadot / Substrate
- Smart Contracts: Solidity (Hardhat)
- Frontend: Next.js + TypeScript + Tailwind
- Wallet Integration: MetaMask (demo mode enabled)
- AI Tools: GitHub Copilot for assisted development and code acceleration

## 🧠 Development Philosophy

Every module in Sagitta Protocol was built with audit-ready precision and institutional foresight.
Our guiding principle: autonomy requires accountability.
That means on-chain transparency, off-chain verification, and algorithmic consistency — together creating a financial organism that regulates itself as it grows.

```bash
┌────────────────────┐
│    User Deposits   │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│     Treasury       │───► Allocates capital to staking & DeFi pools
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│      Reserve       │───► Gold-backed insurance & stability
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│       Escrow       │───► Off-chain portfolio & yield reporting
└────────────────────┘
```

## Setup

1. Install dependencies:
```bash
npm install
cd frontend && npm install
```

2. Compile smart contracts:
```bash
npx hardhat compile
```

3. Deploy contracts (optional, for local development):
```bash
npx hardhat run scripts/deploy.ts --network localhost
```

4. Run the frontend:
```bash
cd frontend
npm run dev
```

## Quick Start

### 1. Start Hardhat Node
```bash
npx hardhat node
```

### 2. Deploy Contracts (in a new terminal)
```bash
npx hardhat run scripts/deploy.ts --network localhost
```

This will:
- Deploy all contracts to localhost
- Fund demo account with 1000 USDC
- Generate contract addresses

### 3. Start Frontend
```bash
cd frontend
pnpm dev
```

### 4. Access the App

Visit `http://localhost:3000`

**Demo Mode:** The frontend runs in demo mode using a pre-configured test account. No wallet needed!

- Demo Account: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Initial Balance: 1000 USDC

**Note:** Hardhat node is ephemeral. If you restart it, you must redeploy contracts and get new addresses.


## 🏆 Built For

Polkadot Hackathon — Polkadot Tinkerers Track
Pioneering self-regulated, AI-enhanced DeFi infrastructure for a decentralized global economy.

## 🚀 What’s Next for Sagitta Protocol

1. On-Chain Integration & Yield Activation
The next stage is full Polkadot staking integration, connecting the Treasury dashboard to leading staking and node infrastructure APIs such as Blockdaemon and similar providers. This phase will transition Sagitta from a demo environment into a fully operational on-chain yield engine, capable of autonomously executing staking strategies, aggregating validator performance data, and tracking portfolio returns in real time.

2. Institutional Investor Onboarding
Parallel to on-chain integration, Sagitta will begin onboarding professional and institutional investors with proven performance records across DeFi, staking, and yield management. These verified entities will operate as licensed investment nodes, bringing transparent, performance-based capital strategies into the protocol. Each approved investor’s history will be auditable, with compliance managed through the Escrow layer and NFT-linked verification data.

3. Full-System Audit & Certification
A comprehensive audit will be conducted across all smart contracts, Treasury logic, and Reserve management modules. The goal is to achieve institutional-grade certification, ensuring readiness for large-scale deployment and regulatory partnerships.

4. NFT Secondary Market Launch
The Vault’s NFT Receipts will be made fully tradable, enabling users to buy and sell yield positions on an open market. This introduces liquidity to staking— a breakthrough in capital mobility where investors can exit or transfer active yield contracts instantly.

5. Three-Layer Insurance Architecture
Implementation of Sagitta’s 3-tier protection model:

- Layer 1: Treasury yield smoothing fund

- Layer 2: Escrow-managed recovery pool for off-chain investment variance

- Layer 3: Gold reserve-backed compensation, using appreciation from XAUT/PAXG holdings to restore user profit targets

6. DAO Governance Activation
Launch of the Sagitta DAO, allowing holders of governance tokens and NFT Receipts to propose treasury actions, approve institutional investors, and vote on Reserve allocations.

7. AI Allocation Expansion
The AI Allocation Agent will evolve to include predictive rebalancing and performance analytics, learning from real market data to optimize between staking, off-chain investments, and Reserve liquidity — making Sagitta a continuously adapting economic organism.

The ultimate goal: to make Sagitta Protocol the world’s first DeFi FDIC — an autonomous, insured, and performance-verified decentralized investment institution capable of managing billions in user capital with real-world accountability.

## 💬 Team Philosophy

“We are not building another yield farm. We are building a financial organism — one that protects, evolves, and thrives without permission.”
— The Sagitta Protocol Team