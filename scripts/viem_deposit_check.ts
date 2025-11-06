import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Abi } from 'viem';
import VaultABI from '../frontend/src/lib/abis/Vault.json';
import MockDOTABI from '../frontend/src/lib/abis/MockDOT.json';
import { CONTRACT_ADDRESSES } from '../frontend/src/lib/addresses';
import dotenv from 'dotenv';

dotenv.config();

function getArgOrEnv(index: number, envName: string, defaultValue: string): string {
  return process.argv[index] || process.env[envName] || defaultValue;
}

const VAULT_ABI = VaultABI as Abi[];
const MOCK_DOT_ABI = MockDOTABI as Abi[];

const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
const MOCK_DOT_ADDRESS = CONTRACT_ADDRESSES.MockDOT;
const OWNER_PRIVATE_KEY = getArgOrEnv(2, 'PRIVATE_KEY', '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const DEPOSIT_AMOUNT = getArgOrEnv(3, 'DEPOSIT_AMOUNT', '10');
const RPC_URL = getArgOrEnv(4, 'RPC_URL', 'http://127.0.0.1:8545');

const account = privateKeyToAccount(OWNER_PRIVATE_KEY as `0x${string}`);

const LOCALHOST_CHAIN = {
  id: CONTRACT_ADDRESSES.chainId,
  name: CONTRACT_ADDRESSES.network,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const publicClient = createPublicClient({
  chain: LOCALHOST_CHAIN,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: LOCALHOST_CHAIN,
  transport: http(RPC_URL),
});

async function expectRevert(fn: () => Promise<any>, label: string) {
  try {
    await fn();
    console.error(`[FAIL] ${label}: Expected revert but succeeded`);
  } catch (e: any) {
    console.log(`[PASS] ${label}: Reverted as expected`);
  }
}

async function testAssetNotEnabled() {
  // Try to deposit a random address as asset (not enabled)
  const fakeAsset = '0x000000000000000000000000000000000000dead';
  await expectRevert(async () => {
    await walletClient.writeContract({
      account,
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [fakeAsset, 1],
      chain: LOCALHOST_CHAIN,
    });
  }, "deposit fails if asset not enabled");
}

async function testTreasuryNotSet() {
  // Deploy a new Vault with no treasury set
  // This requires a deployer wallet and contract factory, so only run if you have setup for it
  // For illustration, pseudo-code:
  /*
  const VaultFactory = await ethers.getContractFactory("Vault");
  const vault = await VaultFactory.deploy();
  await expectRevert(async () => {
    await walletClient.writeContract({
      account,
      address: vault.address,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [MOCK_DOT_ADDRESS, 1],
      chain: LOCALHOST_CHAIN,
    });
  }, "deposit fails if treasury not set");
  */
}

async function testOracleZeroPrice(assetInfo: any) {
  // Set oracle price to zero
  // This assumes you have permission to call setPrice on the oracle
  await walletClient.writeContract({
    account,
    address: assetInfo[2],
    abi: [
      {
        "inputs": [{ "internalType": "uint256", "name": "_price", "type": "uint256" }],
        "name": "setPrice",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    functionName: 'setPrice',
    args: [0],
    chain: LOCALHOST_CHAIN,
  });
  await expectRevert(async () => {
    await walletClient.writeContract({
      account,
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [MOCK_DOT_ADDRESS, 1],
      chain: LOCALHOST_CHAIN,
    });
  }, "deposit fails if oracle price is zero");
  // Restore price for further tests
  await walletClient.writeContract({
    account,
    address: assetInfo[2],
    abi: [
      {
        "inputs": [{ "internalType": "uint256", "name": "_price", "type": "uint256" }],
        "name": "setPrice",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    functionName: 'setPrice',
    args: [700000000],
    chain: LOCALHOST_CHAIN,
  });
}

async function testInsufficientAllowance() {
  // Set allowance to 0
  await walletClient.writeContract({
    account,
    address: MOCK_DOT_ADDRESS,
    abi: MOCK_DOT_ABI,
    functionName: 'approve',
    args: [VAULT_ADDRESS, 0],
    chain: LOCALHOST_CHAIN,
  });
  await expectRevert(async () => {
    await walletClient.writeContract({
      account,
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [MOCK_DOT_ADDRESS, 1],
      chain: LOCALHOST_CHAIN,
    });
  }, "deposit fails if allowance is insufficient");
  // Restore allowance for further tests
  await walletClient.writeContract({
    account,
    address: MOCK_DOT_ADDRESS,
    abi: MOCK_DOT_ABI,
    functionName: 'approve',
    args: [VAULT_ADDRESS, parseUnits(DEPOSIT_AMOUNT, Number(await publicClient.readContract({
      address: MOCK_DOT_ADDRESS,
      abi: MOCK_DOT_ABI,
      functionName: 'decimals',
    })))],
    chain: LOCALHOST_CHAIN,
  });
}

async function testInsufficientBalance(balance: bigint) {
  // Try to deposit more than balance
  const bigAmount = BigInt(balance) + BigInt(1);
  await expectRevert(async () => {
    await walletClient.writeContract({
      account,
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [MOCK_DOT_ADDRESS, bigAmount],
      chain: LOCALHOST_CHAIN,
    });
  }, "deposit fails if balance is insufficient");
}

async function main() {
  // Approve Vault to spend mDOT
  const decimals = await publicClient.readContract({
    address: MOCK_DOT_ADDRESS,
    abi: MOCK_DOT_ABI,
    functionName: 'decimals',
  }) as number | bigint;
  console.log(`mDOT decimals: ${decimals} (type: ${typeof decimals})`);
  console.log(`DEPOSIT_AMOUNT: ${DEPOSIT_AMOUNT} (type: ${typeof DEPOSIT_AMOUNT})`);

  const depositAmount = parseUnits(DEPOSIT_AMOUNT, Number(decimals));
  const approveAmount = depositAmount;
  console.log(`Parsed deposit amount (in smallest unit): ${approveAmount.toString()}`);

  // --- New: Print balances and allowance ---
  const balance = await publicClient.readContract({
    address: MOCK_DOT_ADDRESS,
    abi: MOCK_DOT_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const allowance = await publicClient.readContract({
    address: MOCK_DOT_ADDRESS,
    abi: MOCK_DOT_ABI,
    functionName: 'allowance',
    args: [account.address, VAULT_ADDRESS],
  });
  console.log(`mDOT balance: ${balance.toString()}`);
  console.log(`mDOT allowance to Vault: ${allowance.toString()}`);
  if (BigInt(balance) < approveAmount) {
    throw new Error(`Insufficient mDOT balance for deposit. Balance: ${balance.toString()}, Needed: ${approveAmount.toString()}`);
  }
  if (BigInt(allowance) < approveAmount) {
    console.log("Approving Vault to spend mDOT...");
    const approveHash = await walletClient.writeContract({
      account,
      address: MOCK_DOT_ADDRESS,
      abi: MOCK_DOT_ABI,
      functionName: 'approve',
      args: [VAULT_ADDRESS, approveAmount],
      chain: LOCALHOST_CHAIN,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approval tx hash:', approveHash);
  } else {
    console.log("Sufficient allowance, skipping approve");
  }

  // Print Vault asset config
  const assetInfo = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'assets',
    args: [MOCK_DOT_ADDRESS],
  });
  console.log('Vault asset config for mDOT:', assetInfo);

  // Print Vault treasury address
  const treasuryAddress = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'treasury',
  });
  console.log('Vault treasury address:', treasuryAddress);

  // Print canAdmit result
  const price = await publicClient.readContract({
    address: assetInfo[2], // oracle address from assetInfo
    abi: [
      {
        "inputs": [],
        "name": "getPrice",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
      }
    ],
    functionName: 'getPrice',
  });
  console.log('Oracle price:', price.toString());

  const amountUsd6 = (BigInt(depositAmount) * BigInt(price)) / (BigInt(10) ** (BigInt(decimals) + BigInt(2)));
  const canAdmit = await publicClient.readContract({
    address: treasuryAddress,
    abi: [
      {
        "inputs": [{ "internalType": "uint256", "name": "amountUsd6", "type": "uint256" }],
        "name": "canAdmit",
        "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
        "stateMutability": "view",
        "type": "function"
      }
    ],
    functionName: 'canAdmit',
    args: [amountUsd6],
  });
  console.log('Treasury canAdmit:', canAdmit);

  // Deposit into Vault
  try {
    const depositHash = await walletClient.writeContract({
      account,
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [MOCK_DOT_ADDRESS, depositAmount],
      chain: LOCALHOST_CHAIN,
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log('Deposit tx hash:', depositHash);
  } catch (e) {
    console.error("Deposit failed:", e);
    // Optionally: try to estimate gas and print error
    try {
      await publicClient.estimateContractGas({
        account,
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [MOCK_DOT_ADDRESS, depositAmount],
      });
    } catch (gasErr) {
      console.error("Gas estimation failed:", gasErr);
    }
    throw e;
  }

  // Run scenario tests
  await testAssetNotEnabled();
  // await testTreasuryNotSet(); // Uncomment if you have deployer setup for isolated Vault
  await testOracleZeroPrice(assetInfo);
  await testInsufficientAllowance();
  await testInsufficientBalance(balance);
}

main().catch(console.error);
