import { Contract, JsonRpcProvider } from 'ethers';
import type { OnChainAnchorResult, OnChainBatchWalletBinding } from './escrowAuthorityBinding';

const BATCH_CHAIN_STATE_ABI = [
  'function getBatchAuthorityAnchor(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash,bytes32 batchAuthorityBindingHash,bytes32 systemMapHash,address sourceContractAddress,address activeEscrowAddress,address treasurySignerAddress,address escrowSignerAddress,address anchoredBy,uint64 anchoredAt,bool exists))',
  'function getBatchWalletBinding(uint256 sourceBatchId) view returns (tuple(bytes32 escrowBatchIdHash,bytes32 batchAuthorityBindingHash,address walletAddress,address ownerTreasury,address ownerEscrow,address ownerContinuity,uint8 threshold,address factory,bytes32 creationTxHash,uint64 boundAt,address boundBy,bool exists))',
  'function batchWalletFunded(uint256 sourceBatchId) view returns (bool)',
  'function escrowBatchPositions(uint256 batchId) view returns (uint256 batchId,uint256 deployedPrincipal,uint64 expectedReturnAt,uint64 settlementDeadlineAt,bytes32 executionContextHash,uint64 actualReturnedAt,uint256 settlementAmount,uint8 status)',
  'function getAllocationAttachment(uint256 sourceBatchId) view returns (tuple(bytes32 allocationPlanHash,bytes32 policyContextHash,string portfolioRegistryVersion,address attachedBy,uint64 attachedAt,bool exists))',
  'function usdc() view returns (address)',
];

const ERC20_BALANCE_READER_ABI = [
  'function balanceOf(address account) view returns (uint256)',
];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type OnChainBatchAllocationAttachment = {
  exists: boolean;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  attachedBy: string;
  attachedAt: string;
};

export type OnChainBatchLifecycleState = {
  sourceBatchId: string;
  treasuryBatchReceived: boolean;
  authorityAnchored: boolean;
  walletBound: boolean;
  walletFunded: boolean;
  allocationAttached: boolean;
  expectedAmountUsd: number;
  observedWalletBalanceUsd?: number;
  anchor?: OnChainAnchorResult;
  wallet?: OnChainBatchWalletBinding;
  allocation?: OnChainBatchAllocationAttachment;
};

function secondsToIso(value: unknown) {
  const seconds = Number(value ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}

function usd6ToUsd(value: unknown) {
  const amount = typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
  return Number(amount) / 1_000_000;
}

function addressOrEmpty(value: unknown) {
  const address = String(value ?? '');
  return address && address !== ZERO_ADDRESS ? address : '';
}

async function readAggregatedChainState(contract: Contract, sourceBatchId: bigint): Promise<OnChainBatchLifecycleState> {
  const [anchorRaw, walletRaw, walletFunded, positionRaw, allocationRaw] = await Promise.all([
    contract.getBatchAuthorityAnchor(sourceBatchId).catch(() => null),
    contract.getBatchWalletBinding(sourceBatchId).catch(() => null),
    contract.batchWalletFunded(sourceBatchId).catch(() => false),
    contract.escrowBatchPositions(sourceBatchId).catch(() => null),
    contract.getAllocationAttachment(sourceBatchId).catch(() => null),
  ]);

  const walletExists = Boolean(walletRaw?.exists);
  let observedWalletBalanceUsd: number | undefined;
  if (walletExists && addressOrEmpty(walletRaw.walletAddress)) {
    try {
      const usdcAddress = String(await contract.usdc());
      const usdc = new Contract(usdcAddress, ERC20_BALANCE_READER_ABI, contract.runner);
      observedWalletBalanceUsd = usd6ToUsd(await usdc.balanceOf(String(walletRaw.walletAddress)));
    } catch {
      observedWalletBalanceUsd = undefined;
    }
  }

  const authorityAnchored = Boolean(anchorRaw?.exists);
  const allocationAttached = Boolean(allocationRaw?.exists);
  return {
    sourceBatchId: sourceBatchId.toString(),
    treasuryBatchReceived: Number(positionRaw?.batchId ?? positionRaw?.[0] ?? 0) === Number(sourceBatchId),
    authorityAnchored,
    walletBound: walletExists,
    walletFunded: Boolean(walletFunded),
    allocationAttached,
    expectedAmountUsd: usd6ToUsd(positionRaw?.deployedPrincipal ?? positionRaw?.[1] ?? 0),
    observedWalletBalanceUsd,
    anchor: authorityAnchored
      ? {
          exists: true,
          batchAuthorityBindingHash: String(anchorRaw.batchAuthorityBindingHash),
          escrowBatchIdHash: String(anchorRaw.escrowBatchIdHash),
          systemMapHash: String(anchorRaw.systemMapHash),
          sourceContractAddress: String(anchorRaw.sourceContractAddress),
          activeEscrowAddress: String(anchorRaw.activeEscrowAddress),
          treasurySignerAddress: String(anchorRaw.treasurySignerAddress),
          escrowSignerAddress: String(anchorRaw.escrowSignerAddress),
          anchoredBy: String(anchorRaw.anchoredBy),
          anchoredAt: secondsToIso(anchorRaw.anchoredAt) ?? '',
        }
      : undefined,
    wallet: walletExists
      ? {
          exists: true,
          escrowBatchIdHash: String(walletRaw.escrowBatchIdHash),
          batchAuthorityBindingHash: String(walletRaw.batchAuthorityBindingHash),
          walletAddress: String(walletRaw.walletAddress),
          ownerTreasury: String(walletRaw.ownerTreasury),
          ownerEscrow: String(walletRaw.ownerEscrow),
          ownerContinuity: String(walletRaw.ownerContinuity),
          threshold: Number(walletRaw.threshold),
          factory: String(walletRaw.factory),
          creationTxHash: String(walletRaw.creationTxHash),
          boundAt: secondsToIso(walletRaw.boundAt) ?? '',
          boundBy: String(walletRaw.boundBy),
        }
      : undefined,
    allocation: allocationAttached
      ? {
          exists: true,
          allocationPlanHash: String(allocationRaw.allocationPlanHash),
          policyContextHash: String(allocationRaw.policyContextHash),
          portfolioRegistryVersion: String(allocationRaw.portfolioRegistryVersion),
          attachedBy: String(allocationRaw.attachedBy),
          attachedAt: secondsToIso(allocationRaw.attachedAt) ?? '',
        }
      : undefined,
  };
}

export async function readBatchLifecycleStateFromChain(params: {
  escrowAddress: string;
  sourceBatchId: string;
  rpcUrl: string;
}): Promise<OnChainBatchLifecycleState | null> {
  let sourceBatchId: bigint;
  try {
    sourceBatchId = BigInt(params.sourceBatchId);
  } catch {
    return null;
  }

  const provider = new JsonRpcProvider(params.rpcUrl);
  const contract = new Contract(params.escrowAddress, BATCH_CHAIN_STATE_ABI, provider);

  return readAggregatedChainState(contract, sourceBatchId);
}
