import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from './addresses';
import VaultABI from './abis/Vault.json';
import { getEffectiveRole, listRoleAssignments } from './roles';
import { RPC_URL } from './network';

const OPERATOR_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function normalizeAbi(abiModule: any): any[] {
  const mod = abiModule?.default ?? abiModule;
  if (Array.isArray(mod)) return mod;
  if (mod && Array.isArray(mod.abi)) return mod.abi;
  if (mod?.default && Array.isArray(mod.default)) return mod.default;
  if (mod?.default && Array.isArray(mod.default.abi)) return mod.default.abi;
  throw new Error('Invalid ABI format: expected ABI array or { abi: ABI[] }');
}

export async function getOperator(): Promise<string | null> {
  try {
    const assignedOperators = listRoleAssignments()
      .filter(item => item.role === 'operator' || item.role === 'owner')
      .map(item => item.address);
    if (assignedOperators.length > 0) return assignedOperators[0];
    const wallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY);
    return wallet.address;
  } catch (error) {
    console.error('Failed to get operator:', error);
    return null;
  }
}

export async function getOperatorAddress(): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vault = new ethers.Contract(CONTRACT_ADDRESSES.Vault, normalizeAbi(VaultABI), provider);
    const owner = await vault.owner();
    return owner;
  } catch (error) {
    console.error('Failed to get operator address:', error);
    return null;
  }
}

export function isOperatorAddress(address: string | null | undefined, operator: string | null): boolean {
  if (!address) return false;
  if (getEffectiveRole(address) !== 'viewer') return true;
  if (!operator) return false;
  return address.toLowerCase() === operator.toLowerCase();
}
