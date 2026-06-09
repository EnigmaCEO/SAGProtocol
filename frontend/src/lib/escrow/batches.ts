export type EscrowBatchStatus =
  | 'draft'
  | 'treasury_handoff_pending'
  | 'treasury_sent'
  | 'treasury_received'
  | 'handoff_approved'
  | 'wallet_requested'
  | 'wallet_created'
  | 'wallet_funded'
  | 'aaa_plan_attached'
  | 'deployment_pending'
  | 'deployed'
  | 'active'
  | 'settlement_pending'
  | 'settled'
  | 'disputed'
  | 'exception'
  | 'retired';

export type EscrowAuthorityRole = 'treasury' | 'escrow' | 'continuity';

export type EscrowSigningAuthority = {
  authorityId: string;
  role: EscrowAuthorityRole;
  displayName: string;
  publicSignerAddress: string;
  keyRef: string;
  custodyDomain: string;
  custodyMode: 'external_role_reference';
  status: 'active' | 'inactive' | 'suspended';
  allowedActions: EscrowSigningRequestActionType[];
  createdAt: string;
};

export type EscrowSigningRequestActionType =
  | 'create_wallet'
  | 'verify_funding'
  | 'deploy_batch'
  | 'settle_batch'
  | 'retire_wallet'
  | 'emergency_action';

export type EscrowSigningRequestPath = 'normal' | 'crisis';
export type EscrowSigningRequestStatus =
  | 'draft'
  | 'proposed'
  | 'awaiting_second_approval'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'expired';

export type EscrowSigningApprovalStatus = 'approved' | 'rejected';

export type EscrowSigningApproval = {
  authorityRole: EscrowAuthorityRole;
  authorityId: string;
  approvedAt: string;
  approvalStatus: EscrowSigningApprovalStatus;
  note?: string;
};

export type EscrowSigningRequest = {
  requestId: string;
  batchId: string;
  batchWalletAddress: string;
  actionType: EscrowSigningRequestActionType;
  requestedBy: string;
  requestPath: EscrowSigningRequestPath;
  amountUsd?: number;
  destinationLabel?: string;
  destinationAddress?: string;
  allocationPlanHash?: string;
  policyContextHash?: string;
  status: EscrowSigningRequestStatus;
  approvals: EscrowSigningApproval[];
  requiredApprovalCount: number;
  createdAt: string;
  approvedAt?: string;
  executedAt?: string;
};

export type EscrowFundingStatus = 'pending' | 'submitted' | 'verified' | 'mismatch' | 'rejected';

export type EscrowFundingConfirmation = {
  fundingConfirmationId: string;
  batchId: string;
  batchWalletAddress: string;
  expectedAmountUsd: number;
  observedAmountUsd: number;
  asset: string;
  custodyMode?: 'escrow_contract_custody' | 'batch_wallet_custody';
  sourceContract?: string;
  sourceBatchId?: string;
  sourceContractBalanceUsd?: number;
  batchPositionCollateralUsd?: number;
  fundingSource?: string;
  treasurySourceWallet?: string;
  fundingTxHash?: string;
  fundingStatus: EscrowFundingStatus;
  confirmedBy: string;
  confirmedAt: string;
  verifiedAt?: string;
};

export type EscrowDeploymentStatus = 'not_started' | 'ready' | 'executing' | 'deployed' | 'monitoring' | 'failed';

export type EscrowDeploymentLegResult = {
  legId: string;
  provider: 'blockdaemon' | 'usdc_yield' | 'goldfinch' | 'paxg_xaut' | 'liquidity' | 'manual';
  asset: string;
  amountUsd: number;
  allocationPercent: number;
  targetYieldBps: number;
  status: 'planned' | 'approved' | 'executed' | 'deployed' | 'monitoring' | 'settled' | 'exception';
  providerReferenceId: string;
  deploymentTxHash: string;
  deployedAt: string;
  walletAddress?: string;
  destinationAddress?: string;
  sourceBalanceBefore?: number;
  sourceBalanceAfter?: number;
  destinationBalanceBefore?: number;
  destinationBalanceAfter?: number;
  multisigTxIndex?: number;
  signingSource?: 'signer_services';
  treasurySignerAddress?: string;
  treasurySubmitTxHash?: string;
  treasuryConfirmTxHash?: string;
  escrowSignerAddress?: string;
  escrowConfirmTxHash?: string;
};

export type EscrowDeploymentExecution = {
  deploymentId: string;
  batchId: string;
  signingRequestId: string;
  status: EscrowDeploymentStatus;
  executedBy: string;
  executedAt: string;
  deploymentTxHash?: string;
  deploymentLegResults: EscrowDeploymentLegResult[];
};

export type EscrowDeploymentApprovalLeg = {
  asset: string;
  amount: number;
  weight: number;
  approvedDestinationId: string;
  destinationAddress: string;
  destinationType: string;
  destinationChain: 'arc_testnet' | 'arc_mainnet';
  allocationLegId: string;
};

export type EscrowDeploymentApprovalPayload = {
  batchUuid: string;
  batchWalletAddress: string;
  treasuryBatchId: string;
  escrowBatchId?: string;
  allocationPlanHash: string;
  policyContextHash: string;
  destinationApprovalHash: string;
  destinationRegistryVersion: string;
  deploymentLegs: EscrowDeploymentApprovalLeg[];
  targetChainId: string;
  approvedBy: string;
  approvedAt: string;
  deploymentApprovalStatus: 'deployment_approved';
};

export type EscrowDeploymentApprovalEvidence = {
  approvalId: string;
  batchId: string;
  deploymentApprovalHash: string;
  destinationApprovalHash: string;
  allocationPlanHash: string;
  policyContextHash: string;
  destinationRegistryVersion: string;
  approvedBy: string;
  approvedAt: string;
  status: 'deployment_approved';
  payload: EscrowDeploymentApprovalPayload;
};

export type Eip712TypeField = { name: string; type: string };
export type Eip712Types = Record<string, Eip712TypeField[]>;

export type BatchAuthorityBindingEip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
};

export type BatchAuthorityBindingCanonicalPayload = {
  sourceType: 'treasury' | 'vault';
  sourceContractAddress: string;
  activeTreasuryAddress: string;
  activeVaultAddress: string;
  activeEscrowAddress: string;
  daoSystemRegistryVersion: string;
  systemMapHash: string;
  sourceBatchId: string;
  escrowBatchId: string;
  custodyMode: string;
  custodyLocation: string;
  asset: string;
  totalAmountUsd: number;
  termMonths: number;
  depositManifestHash: string;
  allocationPlanHash?: string;
  policyContextHash?: string;
  chainId: number;
  nonce: string;
};

export type BatchAuthoritySignatureStatus = 'pending' | 'signed' | 'rejected' | 'invalid';
export type BatchAuthoritySignatureVerificationStatus = 'unverified' | 'verified' | 'invalid';

export type BatchAuthorityBinding = {
  bindingId: string;
  batchId: string;
  eip712Domain: BatchAuthorityBindingEip712Domain;
  eip712Types: Eip712Types;
  canonicalPayload: BatchAuthorityBindingCanonicalPayload;
  batchAuthorityBindingHash: string;
  networkLabel: string;
  treasurySignatureStatus: BatchAuthoritySignatureStatus;
  escrowSignatureStatus: BatchAuthoritySignatureStatus;
  treasurySignature?: string;
  escrowSignature?: string;
  // Configured expected signer addresses for each role
  treasurySignerAddress?: string;
  escrowSignerAddress?: string;
  // Signer address recovered from the on-chain EIP-712 signature
  treasuryRecoveredSignerAddress?: string;
  escrowRecoveredSignerAddress?: string;
  treasurySignedAt?: string;
  escrowSignedAt?: string;
  signatureVerificationStatus?: BatchAuthoritySignatureVerificationStatus;
  signatureMismatchReason?: string;
  anchorStatus: 'pending_onchain_anchor' | 'anchored' | 'binding_mismatch';
  anchorTxHash?: string;
  anchorBlockNumber?: number;
  anchoredAt?: string;
  createdAt: string;
  createdBy: string;
};

export type EscrowBatchWalletBindingStatus = 'not_created' | 'binding_pending' | 'binding_locked' | 'binding_rejected';

export type EscrowBatchWalletBindingCanonicalPayload = {
  batchId: string;
  treasuryBatchId: string;
  walletAddress: string;
  totalAmountUsd: number;
  asset: string;
  termMonths: number;
  depositManifestHash: string;
  allocationPlanHash: string;
  policyContextHash: string;
  chainId: string;
};

export type EscrowBatchWalletBinding = {
  bindingId: string;
  batchId: string;
  treasuryBatchId: string;
  walletAddress: string;
  totalAmountUsd: number;
  asset: string;
  termMonths: number;
  depositManifestHash: string;
  allocationPlanHash: string;
  policyContextHash: string;
  chainId: string;
  canonicalPayload: EscrowBatchWalletBindingCanonicalPayload;
  bindingHash: string;
  bindingStatus: EscrowBatchWalletBindingStatus;
  createdAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
};

export type EscrowDestinationProviderType = 'liquidity' | 'staking' | 'private_credit' | 'stabilizer' | 'manual';
export type EscrowDestinationApprovalStatus = 'pending' | 'approved' | 'rejected';

export type EscrowDaoDestination = {
  destinationId: string;
  destinationAddress: string;
  label: string;
  chain: 'arc_testnet' | 'arc_mainnet';
  asset: string;
  providerType: EscrowDestinationProviderType;
  riskTier: 'low' | 'medium' | 'high';
  allowedActions: EscrowSigningRequestActionType[];
  maxExposureUsd: number;
  approvalStatus: 'dao_approved' | 'dao_pending' | 'dao_rejected';
  destinationRegistryVersion: string;
};

export type EscrowBatchDestinationApproval = {
  approvalId: string;
  batchId: string;
  legId: string;
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  assetSymbol: string;
  amount: number;
  weight: number;
  destinationId: string;
  destinationName: string;
  destinationType: string;
  destinationAddress: string;
  aaaAllocationHash: string;
  amountUsd: number;
  asset: string;
  chain: 'arc_testnet' | 'arc_mainnet';
  allocationPlanHash: string;
  policyContextHash: string;
  destinationRegistryVersion: string;
  destinationApprovalHash: string;
  approvalStatus: EscrowDestinationApprovalStatus;
  reviewedBy: string;
  reviewedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
};

export type EscrowBatch = {
  batchId: string;
  status: EscrowBatchStatus;
  /** True only when this batch was loaded from both treasury.getTreasuryBatch and escrow.escrowBatchPositions on the current chain session. False (or absent) for DB-only execution orders. A batch with chainConfirmed !== true must not trigger authority binding signing. */
  chainConfirmed?: boolean;
  exceptionReason?: string;
  custodyMode?: 'escrow_contract_custody' | 'batch_wallet_custody';
  sourceContract?: string;
  sourceBatchId?: string;
  sourceContractBalanceUsd?: number;
  batchPositionCollateralUsd?: number;
  fundingSource?: string;
  wallet: {
    address: string;
    walletAddress?: string;
    walletType?: 'batch_multisig';
    provider: 'local_demo' | 'circle' | 'manual' | 'unknown' | 'wallet_factory';
    providerWalletId?: string;
    chain: 'arc_testnet' | 'arc_mainnet';
    custodyMode: 'demo' | 'provider_mpc' | 'manual' | 'role_based_multisig';
    threshold?: number;
    signerAuthorities?: EscrowSigningAuthority[];
    fundingStatus: 'not_created' | 'created' | 'funded' | 'verified';
    fundingTxHash?: string;
    createdAt?: string;
    createdBy?: string;
    creationTxHash?: string;
    bindingTxHash?: string;
    boundAuthorityBindingHash?: string;
    owners?: {
      treasury: string;
      escrow: string;
      continuity: string;
    };
  };
  originBanks: string[];
  deposits: {
    depositId: string;
    originBank: string;
    adapterType: 'fineract' | 'core_adapter' | 'manual' | 'fintech_partner';
    bankClientRef?: string;
    depositAccountRef?: string;
    amountUsd: number;
    termMonths: number;
    status: 'received' | 'batched' | 'funded' | 'active' | 'settled' | 'exception';
  }[];
  asset?: string;
  totalAmountUsd: number;
  expectedFundingAmountUsd: number;
  observedWalletBalanceUsd?: number;
  fundingVerifiedAt?: string;
  termMonths: number;
  treasuryHandoff: {
    handoffId: string;
    approvedByTreasury: boolean;
    approvedAt?: string;
    treasurySourceWallet?: string;
    depositManifestHash: string;
  };
  aaaAllocation: {
    planId: string;
    allocationPlanHash: string;
    policyContextHash: string;
    portfolioRegistryVersion: string;
    targetYieldBps: number;
    attachedAt?: string;
    attachTxHash?: string;
    /** Full tick response stored locally for hash-mismatch detection on reload. */
    allocationPlan?: unknown;
    /**
     * computed       — plan in DB, not yet anchored on-chain
     * pending_anchor — chain tx submitted, waiting confirmation
     * validated      — DB payload hash matches on-chain attachment (authoritative)
     * chain_only     — chain has hash but full DB payload is missing
     * hash_mismatch  — DB payload exists but its hash differs from on-chain
     * attached       — legacy alias for validated (kept for backward compat)
     */
    status:
      | 'missing'
      | 'requesting'
      | 'computed'
      | 'pending_anchor'
      | 'validated'
      | 'chain_only'
      | 'hash_mismatch'
      | 'failed'
      | 'attached'
      | 'locked'
      | 'deployed';
  };
  deploymentApproval: {
    status: 'missing' | 'pending' | 'approved' | 'rejected';
    approvedBy?: string;
    approvedAt?: string;
    deploymentApprovalHash?: string;
    destinationApprovalHash?: string;
    allocationPlanHash?: string;
    policyContextHash?: string;
    destinationRegistryVersion?: string;
    payload?: EscrowDeploymentApprovalPayload;
    evidence?: EscrowDeploymentApprovalEvidence;
  };
  deploymentLegs: {
    legId: string;
    provider: 'blockdaemon' | 'usdc_yield' | 'goldfinch' | 'paxg_xaut' | 'liquidity' | 'manual';
    asset: string;
    strategyType: 'staking' | 'yield' | 'private_credit' | 'stabilizer' | 'liquidity';
    amountUsd: number;
    allocationPercent: number;
    targetYieldBps: number;
    sourceBatchId?: string;
    escrowBatchId?: string;
    walletAddress?: string;
    assetSymbol?: string;
    amount?: number;
    weight?: number;
    destinationId?: string;
    destinationName?: string;
    destinationType?: string;
    destinationTypeId?: number;
    destinationAddress?: string;
    aaaAllocationHash?: string;
    destinationRegistryVersion?: string;
    currentValueUsd?: number;
    status: 'planned' | 'approved' | 'executed' | 'deployed' | 'monitoring' | 'settled' | 'exception';
    providerReferenceId?: string;
    deploymentTxHash?: string;
  }[];
  performance: {
    projectedYieldUsd: number;
    realizedYieldUsd?: number;
    currentValueUsd?: number;
    varianceBps?: number;
    lastUpdatedAt?: string;
  };
  settlement: {
    maturityDate: string;
    status: 'not_due' | 'pending' | 'settled' | 'exception';
    expectedReturnUsd?: number;
    returnedAmountUsd?: number;
    bankRepaymentAmountUsd?: number;
    surplusUsd?: number;
    settlementTxHash?: string;
    walletRetirementStatus: 'not_eligible' | 'eligible' | 'retired';
  };
  exception?: {
    type: string;
    expectedAmountUsd: number;
    observedAmountUsd: number;
    requiredAction: string;
    blockingStep: string;
    expectedBatchWallet: string;
    lastCheckedAt: string;
    resolutionAction: string;
  };
  batchWalletBinding?: EscrowBatchWalletBinding;
  batchAuthorityBinding?: BatchAuthorityBinding;
  destinationApprovals?: EscrowBatchDestinationApproval[];
  deploymentExecutions?: EscrowDeploymentExecution[];
  fundingConfirmations?: EscrowFundingConfirmation[];
  signingRequests?: EscrowSigningRequest[];
  auditTrail: {
    eventId: string;
    timestamp: string;
    actor: string;
    eventType: string;
    description: string;
    txHash?: string;
    reference?: string;
  }[];
};

const ESCROW_BATCHES_ENDPOINT = '/api/banking/escrow/batches';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function unwrapBatchList(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  return payload.batches ?? payload.items ?? payload.data ?? payload.results ?? payload;
}

function normalizeBatch(candidate: unknown): EscrowBatch | null {
  if (!isRecord(candidate) || typeof candidate.batchId !== 'string' || typeof candidate.status !== 'string') {
    return null;
  }

  const deposits = Array.isArray(candidate.deposits) ? candidate.deposits : [];
  const deploymentLegs = Array.isArray(candidate.deploymentLegs) ? candidate.deploymentLegs : [];
  const auditTrail = Array.isArray(candidate.auditTrail) ? candidate.auditTrail : [];
  const signingRequests = Array.isArray(candidate.signingRequests) ? candidate.signingRequests : [];
  const destinationApprovals = Array.isArray(candidate.destinationApprovals) ? candidate.destinationApprovals : [];
  const fundingConfirmations = Array.isArray(candidate.fundingConfirmations) ? candidate.fundingConfirmations : [];
  const deploymentExecutions = Array.isArray(candidate.deploymentExecutions) ? candidate.deploymentExecutions : [];
  const totalAmountUsd = Number(candidate.totalAmountUsd ?? 0);

  const batchAuthorityBinding = isRecord(candidate.batchAuthorityBinding)
    ? (candidate.batchAuthorityBinding as BatchAuthorityBinding)
    : undefined;

  return {
    ...(candidate as EscrowBatch),
    batchAuthorityBinding,
    custodyMode:
      candidate.custodyMode === 'escrow_contract_custody' || candidate.custodyMode === 'batch_wallet_custody'
        ? candidate.custodyMode
        : undefined,
    sourceContract: typeof candidate.sourceContract === 'string' ? candidate.sourceContract : undefined,
    sourceBatchId: typeof candidate.sourceBatchId === 'string' ? candidate.sourceBatchId : undefined,
    sourceContractBalanceUsd: candidate.sourceContractBalanceUsd == null ? undefined : Number(candidate.sourceContractBalanceUsd),
    batchPositionCollateralUsd: candidate.batchPositionCollateralUsd == null ? undefined : Number(candidate.batchPositionCollateralUsd),
    fundingSource: typeof candidate.fundingSource === 'string' ? candidate.fundingSource : undefined,
    deposits: deposits as EscrowBatch['deposits'],
    deploymentLegs: deploymentLegs as EscrowBatch['deploymentLegs'],
    auditTrail: auditTrail as EscrowBatch['auditTrail'],
    signingRequests: signingRequests as EscrowBatch['signingRequests'],
    destinationApprovals: destinationApprovals as EscrowBatch['destinationApprovals'],
    fundingConfirmations: fundingConfirmations as EscrowBatch['fundingConfirmations'],
    deploymentExecutions: deploymentExecutions as EscrowBatch['deploymentExecutions'],
    originBanks: Array.isArray(candidate.originBanks) ? (candidate.originBanks as string[]) : [],
    asset: typeof candidate.asset === 'string' ? candidate.asset : 'USDC',
    totalAmountUsd,
    expectedFundingAmountUsd: Number(candidate.expectedFundingAmountUsd ?? totalAmountUsd),
    wallet: {
      address: '',
      provider: 'unknown',
      chain: 'arc_testnet',
      custodyMode: 'manual',
      fundingStatus: 'not_created',
      ...(isRecord(candidate.wallet) ? candidate.wallet : {}),
    } as EscrowBatch['wallet'],
    treasuryHandoff: {
      handoffId: '',
      approvedByTreasury: false,
      depositManifestHash: '',
      ...(isRecord(candidate.treasuryHandoff) ? candidate.treasuryHandoff : {}),
    } as EscrowBatch['treasuryHandoff'],
    aaaAllocation: {
      planId: '',
      allocationPlanHash: '',
      policyContextHash: '',
      portfolioRegistryVersion: '',
      targetYieldBps: 0,
      status: 'missing',
      ...(isRecord(candidate.aaaAllocation) ? candidate.aaaAllocation : {}),
    } as EscrowBatch['aaaAllocation'],
    deploymentApproval: {
      status: 'missing',
      ...(isRecord(candidate.deploymentApproval) ? candidate.deploymentApproval : {}),
    } as EscrowBatch['deploymentApproval'],
    performance: {
      projectedYieldUsd: 0,
      ...(isRecord(candidate.performance) ? candidate.performance : {}),
    } as EscrowBatch['performance'],
    settlement: {
      maturityDate: '',
      status: 'not_due',
      walletRetirementStatus: 'not_eligible',
      ...(isRecord(candidate.settlement) ? candidate.settlement : {}),
    } as EscrowBatch['settlement'],
  };
}

export async function getEscrowBatches(): Promise<EscrowBatch[]> {
  const response = await fetch(ESCROW_BATCHES_ENDPOINT);

  if (response.status === 404) {
    return [];
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 140);
    throw new Error(`Escrow batch API returned a non-JSON response${detail ? `: ${detail}` : '.'}`);
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Escrow batch API request failed (${response.status}).`);
  }

  const batchList = unwrapBatchList(payload);
  if (!Array.isArray(batchList)) {
    return [];
  }

  return batchList.map(normalizeBatch).filter((batch): batch is EscrowBatch => Boolean(batch));
}
