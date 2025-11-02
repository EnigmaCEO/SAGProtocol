import { ethers } from "ethers";
import VaultABI from "./abis/Vault.json";
import MockUSDCABI from "./abis/MockUSDC.json";
import ReserveControllerABI from "./abis/ReserveController.json";
import InvestmentEscrowABI from "./abis/InvestmentEscrow.json";
import GOLDABI from "./abis/GOLD.json";
import TreasuryABI from "./abis/Treasury.json";
import { CONTRACT_ADDRESSES } from "./addresses";

// Demo mode configuration
const DEMO_MODE = true;
const DEMO_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat account #0
const RPC_URL = "http://127.0.0.1:8545";

let _provider: ethers.JsonRpcProvider | null = null;
let _signer: ethers.Wallet | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return _provider;
}

export async function getSigner(): Promise<ethers.Wallet> {
  if (!_signer) {
    const provider = getProvider();
    _signer = new ethers.Wallet(DEMO_PRIVATE_KEY, provider);
    console.log("Demo account:", _signer.address);
  }
  return _signer;
}

export async function getContracts() {
  const signer = await getSigner();

  const usdc = new ethers.Contract(CONTRACT_ADDRESSES.MockUSDC, MockUSDCABI.abi, signer);
  const vault = new ethers.Contract(CONTRACT_ADDRESSES.Vault, VaultABI, signer);
  const treasury = new ethers.Contract(CONTRACT_ADDRESSES.Treasury, TreasuryABI.abi, signer);
  const reserve = new ethers.Contract(CONTRACT_ADDRESSES.ReserveController, ReserveControllerABI, signer);
  const gold = new ethers.Contract(CONTRACT_ADDRESSES.MockGOLD, GOLDABI.abi, signer);
  const escrow = new ethers.Contract(CONTRACT_ADDRESSES.InvestmentEscrow, InvestmentEscrowABI.abi, signer);

  return { usdc, vault, treasury, reserve, gold, escrow };
}

export async function getContract(name: string) {
  const signer = await getSigner();
  
  const contractMap: Record<string, { address: string; abi: any }> = {
    usdc: { address: CONTRACT_ADDRESSES.MockUSDC, abi: MockUSDCABI.abi || MockUSDCABI },
    vault: { address: CONTRACT_ADDRESSES.Vault, abi: VaultABI },
    treasury: { address: CONTRACT_ADDRESSES.Treasury, abi: TreasuryABI.abi || TreasuryABI },
    reserve: { address: CONTRACT_ADDRESSES.ReserveController, abi: ReserveControllerABI },
    gold: { address: CONTRACT_ADDRESSES.MockGOLD, abi: GOLDABI.abi || GOLDABI },
    escrow: { address: CONTRACT_ADDRESSES.InvestmentEscrow, abi: InvestmentEscrowABI.abi || InvestmentEscrowABI },
  };

  const config = contractMap[name.toLowerCase()];
  if (!config) {
    throw new Error(`Unknown contract: ${name}`);
  }

  return new ethers.Contract(config.address, config.abi, signer);
}

export function bpsToPct(bps: bigint): number {
  return Number(bps) / 100;
}

export async function detectNetwork(): Promise<{ chainId: number; name: string } | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    
    const networkNames: Record<number, string> = {
      1287: "Moonbase Alpha",
      1: "Ethereum Mainnet",
      5: "Goerli",
      11155111: "Sepolia",
    };
    
    return {
      chainId: Number(network.chainId),
      name: networkNames[Number(network.chainId)] || `Unknown (${network.chainId})`,
    };
  } catch (error) {
    console.error("Failed to detect network:", error);
    return null;
  }
}

