## 🜂 Sagitta Protocol
Autonomous Investment Engine for Trustless Wealth Management

Sagitta Protocol is a next-generation DeFi framework built on Polkadot — an autonomous investment engine that blends decentralized governance, AI allocation, and real-world asset stability to create a self-regulating financial ecosystem.

By combining on-chain treasury management, off-chain investment flows, and gold-backed reserves, Sagitta aims to evolve into a new class of protocol: one that can govern, stabilize, and grow itself without human dependency.

## 🌌 Vision

Traditional DeFi offers freedom but lacks safety and structure. Sagitta introduces stability through autonomy — a system where AI and governance algorithms continuously balance Treasury and Reserve ratios (2:1) to protect user deposits and maintain systemic health.

In time, this architecture can scale into what we call the DeFi FDIC — a trustless, self-insured, and AI-regulated wealth system for the decentralized world.

## ⚙️ Core Features

- 🧭 Autonomous Treasury Engine — dynamically allocates assets between on-chain and off-chain investments.
- 🪙 Self-Regulating Reserve Layer — backed by gold reserves and stable assets for built-in insurance.
- 🤖 AI Allocation Agent — optimizes performance, risk exposure, and treasury ratios in real time.
- 🛡 DAO Governance System — community-driven oversight for transparency and integrity.
- 💹 Batch Escrow Reporting — off-chain investment tracking with transparent yield reporting.
- 🌐 Polkadot Integration — scalable, interoperable DeFi protocol built using Substrate and Polkadot SDK.

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

## 🧩 Stack

- Blockchain: Polkadot / Substrate
- Smart Contracts: Solidity (Hardhat)
- Frontend: Next.js + TypeScript + Tailwind
- AI Tools: Kiro, ChatGPT (GPT-5), Claude, Gemini, ElevenLabs
- Wallet Integration: MetaMask (demo mode optional)

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
Exploring how AI-driven DeFi systems can autonomously balance stability, governance, and growth across interconnected chains.

## 💡 Inspiration

“Autonomy isn’t just about decentralization — it’s about systems that protect themselves.”
— Sagitta Bank