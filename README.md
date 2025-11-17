## 🜂 Sagitta Protocol
An Autonomous Investment Engine for the Age of Trustless Wealth

Sagitta Protocol is a fully autonomous, self-regulating investment ecosystem built on Polkadot. It unites on-chain transparency with off-chain intelligence to form a complete DeFi architecture capable of managing, stabilizing, and protecting multi-billion-dollar portfolios.

- At its core, Sagitta is not a single contract — it is an engine of systems:
- DOT travels through XCM, crosses into Moonbeam as xcDOT, and finds its place in the Vault
- The Vault issuing NFT receipts that represent real, tradable yield positions
- The Treasury that allocate liquidity dynamically between DeFi, staking, and institutional channels
- The Reserve backed by tokenized gold assets such as XAUT and PAXG, forming a tangible insurance layer
- Escrow Batches bridging on-chain trust and off-chain compliance for institutional onboarding
- And an AI Allocation Agent that manages every capital flow with precision — from small DOT deposits to high-net-worth nodes.

Together, these components create a living protocol capable of defending capital, rewarding participants, and adapting autonomously to market change.

## 🪂 Polkadot Integration
✔️ 1. Native DOT → xcDOT via XCM

Users bridge DOT from the Relay Chain into Moonbeam as xcDOT using Polkadot’s XCM transfer system.
Sagitta’s Vault accepts xcDOT directly, making deposits Polkadot-native.

✔️ 2. Deployed on Moonbeam (Polkadot Parachain)

Sagitta’s smart contracts (Vault, Treasury, Escrow) run inside Moonbeam’s Substrate-secured EVM environment, benefiting from:

- Polkadot shared security
- Low-latency finality
- XC-20 assets compatible with ERC-20
- Native access to XCM messaging

✔️ 3. Cross-Chain Investment Engine (Future Use)

Sagitta’s batch-based Escrow is designed to route investments to other parachains or asset-specific chains via XCM.
This enables:

- Parachain treasury yield strategies
- Cross-chain staking
- Cross-chain RWA investment flows
- Inter-ecosystem capital routing without bridging risk

## ⚙️ System Architecture
Sagitta is a layered economic engine built for Polkadot:

DOT (Relay Chain)
   ↓ XCM
xcDOT on Moonbeam
   ↓ Vault
┌───────────────────────────────┐
│       1. Vault (xcDOT)        │
│  - User principal stored      │
│  - NFT receipts minted        │
│  - Auto-return on unlock      │
└─────────────┬─────────────────┘
              │
      Collateralize via Treasury
              │
┌───────────────────────────────┐
│   2. Treasury (SAG + Gold)    │
│  - Converts value → USDC      │
│  - Maintains 2:1 T:R ratio    │
│  - Routes capital to Escrow   │
│  - Receives profits           │
└─────────────┬─────────────────┘
              │
         Batch Allocation
              │
┌───────────────────────────────┐
│   3. Escrow Batch Engine      │
│  - Weekly batch creation      │
│  - XCM-ready routing          │
│  - Off-chain asset support    │
│  - Batch P&L reporting        │
└─────────────┬─────────────────┘
              │
       Reinforce Stability
              │
┌───────────────────────────────┐
│  4. Gold Reserve (RWA Backed) │
│  - Tokenized gold (XAUT/PAXG) │
│  - Insurance + Rebalancing    │
│  - Value buffer for Treasury  │
└───────────────────────────────┘

## 🏦 The Vault — Trustless xcDOT Custody

It holds xcDOT — untouched, unleveraged, unscarred by speculation.
Each deposit becomes an NFT receipt, a bearer instrument of time:

- Transferable
- Sellable
- Giftable
- Redeemable

When time expires, the Vault looks only at the current holder of the receipt, not the original depositor.
And like all things sovereign, it returns what is owed, without hesitation.

This is the core of trustless wealth management.

## 💰 The Treasury — Liquidity Brain

The Treasury is the protocol’s central nervous system.
It manages liquidity flows, ensures 2:1 collateralization against the Reserve, and distributes capital to:

- On-chain staking pools for small and mid-size deposits
- Off-chain managed portfolios through the Escrow system for institutional-scale investments
- A buyback policy that strengthens SAG
- A rebalancer that sells gold in times of need

The Treasury continuously updates its P&L and interacts with the AI Allocation Layer, dynamically routing capital where it performs best while preserving safety ratios.

## 🏆 The Reserve — Gold Stability Engine

The Reserve is backed by tokenized gold assets (XAUT, PAXG) — serving as a final line of defense for investor capital.
It performs three roles:

1. Insurance — covering treasury underperformance with gold-backed liquidity.
2. Collateralization — ensuring every USDC or DOT-based deposit maintains a stable asset ratio.
3. Rebalance Authority — automatically adjusts the Treasury/Reserve ratio based on market volatility.

The Reserve transforms volatility into resilience — making Sagitta not just decentralized, but self-regulated.

## 📦 The Escrow — Compliance & Institutional Bridge

The Escrow system connects off-chain investments with on-chain proof.
It conducts:

- Batch reporting on real-world and on-chain portfolios
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

## 📈 P&L & Stability Defense System

Each NFT receipt transparently records on-chain performance data and historical allocation outcomes. When an investment cycle completes, the protocol autonomously allocates 80 % of realized gains to users and 20 % to protocol reserves and DAO operations. In periods of adverse performance, the Reserve’s 3-Layer Stability System activates to mitigate volatility and support overall protocol equilibrium:

1. Treasury-based smoothing — gradual adjustment of Treasury allocations to maintain balanced performance metrics.

2. Escrow recovery fund routing — strategic redeployment of escrow reserves to offset underperforming cycles.

3. Gold reserve rebalancing — utilization of asset appreciation within the Reserve to reinforce long-term stability.

This multi-layer framework is designed to promote consistent outcomes and sustainable protocol health — establishing a new benchmark for resilience and user confidence in DeFi.

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

## 🚀 Impact on Polkadot Ecosystem

Sagitta becomes the wealth layer of Polkadot.

Use cases:

💎 For DOT holders

Trustless, principal-protected yield.

🛡️ For Parachain Treasuries

Deposit DOT → generate income → auto-return guaranteed.

🏦 For DAOs

Invest treasury assets without losing custody.

🔗 For Polkadot developers

Sagitta can route capital to their chains via XCM.

🏛️ For Institutions

A compliance-friendly, batch-based, cross-chain investment interface.

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

5. Code Test & Coverage:
```bash
npx hardhat test
npx hardhat coverage
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

### 3. Start Frontend (in a new terminal)
```bash
cd frontend
pnpm dev
```

### 4. Access the App

Visit `http://localhost:3000`

**Demo Mode:** The frontend runs in demo mode using a pre-configured test account. No wallet needed!

- Demo Account: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Initial Balance: 1000 mDOT

**Note:** Hardhat node is ephemeral. If you restart it, you must redeploy contracts and get new addresses.


## 🏆 Built For

Polkadot Hackathon — Polkadot Tinkerers Track
Pioneering self-regulated, AI-enhanced DeFi infrastructure for a decentralized global economy.

We built Sagitta to demonstrate true Polkadot-native financial architecture:

- XCM asset flows
- Cross-chain investment engine
- Smart contracts on a Polkadot parachain
- Multi-layer stability
- Autonomous batch execution
- NFT-encoded yield positions

This is not another yield farm.
Sagitta is a cross-chain trust engine anchored in Polkadot.

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