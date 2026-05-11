import { ethers } from "ethers";
import VaultABI from "./abis/Vault.json";
import MockUSDCABI from "./abis/MockUSDC.json";
import ReserveControllerABI from "./abis/ReserveController.json";
import InvestmentEscrowABI from "./abis/InvestmentEscrow.json";
import GOLDABI from "./abis/GOLD.json";
import TreasuryABI from "./abis/Treasury.json";
import { CONTRACT_ADDRESSES } from "./addresses";
import { ensureOnChainAddresses, getRuntimeAddress, isValidAddress, ZERO_ADDRESS } from "./runtime-addresses";
import { getActiveRpcUrl } from "./network";
import { getChainById } from "./config/chains";

// Demo mode configuration
const DEMO_MODE = true;
const DEMO_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat account #0

let _provider: ethers.JsonRpcProvider | null = null;
let _providerRpcUrl: string | null = null;
let _signer: ethers.Wallet | null = null;
let _signerRpcUrl: string | null = null;

function normalizeAbi(abiModule: any): any[] {
  let mod: any = abiModule;
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(mod)) return mod;
    if (mod && Array.isArray(mod.abi)) return mod.abi;
    if (!mod || mod.default === undefined) break;
    mod = mod.default;
  }
  throw new Error("Invalid ABI format: expected ABI array or { abi: ABI[] }");
}

const ABIS = {
  usdc: normalizeAbi(MockUSDCABI),
  vault: normalizeAbi(VaultABI),
  treasury: normalizeAbi(TreasuryABI),
  reserve: normalizeAbi(ReserveControllerABI),
  gold: normalizeAbi(GOLDABI),
  escrow: normalizeAbi(InvestmentEscrowABI),
};

export const A = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    if (prop === "MockUSDC") return resolveAddress(CONTRACT_ADDRESSES.MockUSDC, "MockUSDC");
    if (prop === "Vault") return resolveAddress(CONTRACT_ADDRESSES.Vault, "Vault");
    if (prop === "Treasury") return resolveAddress(CONTRACT_ADDRESSES.Treasury, "Treasury");
    if (prop === "ReserveController") return resolveAddress(CONTRACT_ADDRESSES.ReserveController, "ReserveController");
    if (prop === "InvestmentEscrow") return resolveAddress(CONTRACT_ADDRESSES.InvestmentEscrow, "InvestmentEscrow");
    return undefined;
  },
}) as {
  readonly MockUSDC: string;
  readonly Vault: string;
  readonly Treasury: string;
  readonly ReserveController: string;
  readonly InvestmentEscrow: string;
};

function resolveAddress(
  staticAddress: string | null | undefined,
  runtimeKey?: "MockUSDC" | "MockGOLD" | "Vault" | "Treasury" | "ReserveController" | "InvestmentEscrow"
): string {
  if (runtimeKey) {
    const runtimeAddress = getRuntimeAddress(runtimeKey);
    if (isValidAddress(runtimeAddress) && runtimeAddress !== "0x0000000000000000000000000000000000000000") {
      return runtimeAddress;
    }
  }
  return isValidAddress(staticAddress) ? staticAddress : ZERO_ADDRESS;
}

function requireAddress(address: string | null | undefined, label: string): string {
  if (isValidAddress(address) && address !== ZERO_ADDRESS) return address;
  throw new Error(`${label} address is not configured for the selected protocol chain.`);
}

export function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl = getActiveRpcUrl();
  if (!_provider || _providerRpcUrl !== rpcUrl) {
    _provider = new ethers.JsonRpcProvider(rpcUrl);
    _providerRpcUrl = rpcUrl;
  }
  return _provider;
}

export async function getSigner(): Promise<ethers.Wallet> {
  const rpcUrl = getActiveRpcUrl();
  if (!_signer || _signerRpcUrl !== rpcUrl) {
    const provider = getProvider();
    _signer = new ethers.Wallet(DEMO_PRIVATE_KEY, provider);
    _signerRpcUrl = rpcUrl;
    console.log("Demo account:", _signer.address);
  }
  return _signer;
}

export async function getContracts() {
  await ensureOnChainAddresses();
  const signer = await getSigner();

  const usdc = new ethers.Contract(requireAddress(A.MockUSDC, "MockUSDC"), ABIS.usdc, signer);
  const vault = new ethers.Contract(requireAddress(A.Vault, "Vault"), ABIS.vault, signer);
  const treasury = new ethers.Contract(requireAddress(A.Treasury, "Treasury"), ABIS.treasury, signer);
  const reserve = new ethers.Contract(requireAddress(A.ReserveController, "ReserveController"), ABIS.reserve, signer);
  const gold = new ethers.Contract(requireAddress(resolveAddress(CONTRACT_ADDRESSES.MockGOLD, "MockGOLD"), "MockGOLD"), ABIS.gold, signer);
  const escrow = new ethers.Contract(requireAddress(A.InvestmentEscrow, "InvestmentEscrow"), ABIS.escrow, signer);

  return { usdc, vault, treasury, reserve, gold, escrow, A };
}

export async function getContract(name: string) {
  await ensureOnChainAddresses();
  const signer = await getSigner();
  
  const contractMap: Record<string, { address: string; abi: any }> = {
    usdc: { address: resolveAddress(CONTRACT_ADDRESSES.MockUSDC, "MockUSDC"), abi: ABIS.usdc },
    vault: { address: resolveAddress(CONTRACT_ADDRESSES.Vault, "Vault"), abi: ABIS.vault },
    treasury: { address: resolveAddress(CONTRACT_ADDRESSES.Treasury, "Treasury"), abi: ABIS.treasury },
    reserve: { address: resolveAddress(CONTRACT_ADDRESSES.ReserveController, "ReserveController"), abi: ABIS.reserve },
    gold: { address: resolveAddress(CONTRACT_ADDRESSES.MockGOLD, "MockGOLD"), abi: ABIS.gold },
    escrow: { address: resolveAddress(CONTRACT_ADDRESSES.InvestmentEscrow, "InvestmentEscrow"), abi: ABIS.escrow },
  };

  const config = contractMap[name.toLowerCase()];
  if (!config) {
    throw new Error(`Unknown contract: ${name}`);
  }

  return new ethers.Contract(requireAddress(config.address, name), normalizeAbi(config.abi), signer);
}

export function bpsToPct(bps: bigint): number {
  return Number(bps) / 100;
}

export function fmt6(value: bigint | number | string): number {
  try {
    return Number(ethers.formatUnits(value, 6));
  } catch {
    return 0;
  }
}

export function to6(value: number | string): bigint {
  try {
    return ethers.parseUnits(String(value), 6);
  } catch {
    return 0n;
  }
}

export async function detectNetwork(): Promise<{ chainId: number; name: string } | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    
    const chainId = Number(network.chainId);
    
    return {
      chainId,
      name: getChainById(chainId)?.name || `Unknown (${network.chainId})`,
    };
  } catch (error) {
    console.error("Failed to detect network:", error);
    return null;
  }
}
