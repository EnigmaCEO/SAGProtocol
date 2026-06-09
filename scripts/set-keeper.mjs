/**
 * Sets the escrow signer address as keeper on InvestmentEscrow.
 * Run once after deploy: node scripts/set-keeper.mjs
 */
import { ethers } from 'ethers';
import 'dotenv/config';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const ESCROW_ADDRESS = process.env.INVESTMENT_ESCROW_ADDRESS || '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e';
const KEEPER_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS || '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

if (!DEPLOYER_KEY) {
  console.error('DEPLOYER_PRIVATE_KEY not set');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);

const escrow = new ethers.Contract(
  ESCROW_ADDRESS,
  ['function setKeeper(address _keeper) external', 'function keeper() view returns (address)', 'function owner() view returns (address)'],
  deployer
);

const current = await escrow.keeper();
const owner = await escrow.owner();
console.log('Owner:', owner);
console.log('Current keeper:', current);
console.log('Setting keeper to:', KEEPER_ADDRESS);

const tx = await escrow.setKeeper(KEEPER_ADDRESS);
await tx.wait();
console.log('Done. Tx:', tx.hash);
console.log('New keeper:', await escrow.keeper());
