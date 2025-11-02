# SAG Protocol

// ...existing code...

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

// ...existing code...
