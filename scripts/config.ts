export const RPC = 'http://127.0.0.1:8545';
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const DEFAULT_DEPOSIT_AMOUNT = '1000';

// AMM liquidity script multiplier (integer)
export const AMM_LIQ_MULTIPLIER = 1;

// Add-amm-liquidity probe constants
export const AMM_DESIRED_USDC_DEFAULT = 100000; // in whole USDC

// Debug script test-funding (opt-in)
export const MINT_TEST_FUNDS = false; // set to true when you want the debug script to mint system funds
export const MINT_AMOUNT_USD = 10_000_000; // default amount used when MINT_TEST_FUNDS = true

// Deploy bulk-mint defaults (deploy.ts)
export const MINT_USD_TREASURY = 10_000_000;
export const MINT_USD_AMM = 10_000_000;
export const MINT_USD_RESERVE = 500_000;
export const MINT_USD_DEMO = 1_000;

// Misc: demo account for local runs (same as Hardhat default)
export const DEMO_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
