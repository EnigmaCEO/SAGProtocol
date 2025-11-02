import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from './addresses';
import VaultABI from './abis/Vault.json';

const OPERATOR_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export async function getOperator(): Promise<string | null> {
  try {
    const wallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY);
    return wallet.address;
  } catch (error) {
    console.error('Failed to get operator:', error);
    return null;
  }
}

export async function getOperatorAddress(): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const vault = new ethers.Contract(CONTRACT_ADDRESSES.Vault, VaultABI, provider);
    const owner = await vault.owner();
    return owner;
  } catch (error) {
    console.error('Failed to get operator address:', error);
    return null;
  }
}

export function isOperatorAddress(address: string | null | undefined, operator: string | null): boolean {
  if (!address || !operator) return false;
  return address.toLowerCase() === operator.toLowerCase();
}
