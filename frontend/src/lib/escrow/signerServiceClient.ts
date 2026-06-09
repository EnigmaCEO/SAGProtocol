// Client for the autonomous Treasury and Escrow signer services.
//
// The frontend only passes batch identifiers — never a signing payload.
// Each signer service independently reads chain state, reconstructs the
// canonical EIP-712 payload, validates it, and returns the signature.
//
// Configure service URLs via env vars:
//   NEXT_PUBLIC_TREASURY_SIGNER_URL  (e.g. http://localhost:4001)
//   NEXT_PUBLIC_ESCROW_SIGNER_URL    (e.g. http://localhost:4002)

export type SignerServiceConfig = {
  treasurySignerUrl: string | null;
  escrowSignerUrl: string | null;
};

export type SignerServiceSignatureResponse = {
  role: 'treasury' | 'escrow';
  signature: string;
  signerAddress: string;
  recoveredAddress: string;
  bindingHash: string;
  signedAt: string;
  sourceBatchId: string;
  escrowBatchId: string;
};

export type SignerServiceAnchorWalletResult = {
  walletAddress: string;
  creationTxHash: string;
  bindingTxHash: string;
  boundAt: string;
  ownerTreasury: string;
  ownerEscrow: string;
  ownerContinuity: string;
  threshold: number;
  batchAuthorityBindingHash: string;
  fundingTxHash?: string;
  fundingError?: string;
  error?: never;
} | {
  error: string;
  walletAddress?: never;
};

export type SignerServiceAnchorResponse = {
  txHash: string;
  blockNumber: number;
  anchoredAt: string;
  sourceBatchId: string;
  escrowBatchId: string;
  bindingHash: string;
  wallet?: SignerServiceAnchorWalletResult;
};

export type SignerServiceHealthResponse = {
  role: 'treasury' | 'escrow';
  signerAddress: string;
  version: string;
};

export type TreasuryDeployLegResponse = {
  role: 'treasury';
  signerAddress: string;
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  assetSymbol: string;
  amount: string;
  destinationAddress: string;
  txIndex: number;
  submitTxHash: string;
  confirmTxHash: string;
  submittedAt: string;
  confirmedAt: string;
  alreadySubmitted: boolean;
  alreadyConfirmed: boolean;
  executed: boolean;
};

export type EscrowConfirmDeployLegResponse = {
  role: 'escrow';
  signerAddress: string;
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  assetSymbol: string;
  amount: string;
  destinationAddress: string;
  txIndex: number;
  confirmTxHash: string;
  deploymentTxHash: string;
  confirmedAt: string;
  executedAt: string;
  alreadyConfirmed: boolean;
  alreadyExecuted: boolean;
};

export function getSignerServiceConfig(): SignerServiceConfig {
  return {
    treasurySignerUrl: process.env.NEXT_PUBLIC_TREASURY_SIGNER_URL ?? null,
    escrowSignerUrl: process.env.NEXT_PUBLIC_ESCROW_SIGNER_URL ?? null,
  };
}

export function isSignerServiceConfigured(config: SignerServiceConfig, role: 'treasury' | 'escrow'): boolean {
  return role === 'treasury' ? Boolean(config.treasurySignerUrl) : Boolean(config.escrowSignerUrl);
}

export function areBothSignerServicesConfigured(config: SignerServiceConfig): boolean {
  return Boolean(config.treasurySignerUrl) && Boolean(config.escrowSignerUrl);
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = (body as any)?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

// Request a signature from the Treasury or Escrow signer service.
// The service reconstructs the payload from chain state independently.
// Only the batch identifiers are sent — no signing payload.
export async function requestSignatureFromService(params: {
  serviceUrl: string;
  sourceBatchId: string;
  escrowBatchId: string;
  chainId: number;
  custodyMode?: string;
}): Promise<SignerServiceSignatureResponse> {
  const { serviceUrl, sourceBatchId, escrowBatchId, chainId, custodyMode } = params;
  return fetchJson<SignerServiceSignatureResponse>(`${serviceUrl}/request-signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceBatchId, escrowBatchId, chainId, custodyMode }),
  });
}

// Request the escrow signer service to submit the anchor transaction on-chain.
// The two signatures must have been produced by the respective signer services.
// The service re-reconstructs the payload, cross-checks the binding hash, then anchors.
// If custodyMode is 'batch_wallet_custody' and the service has WALLET_FACTORY_URL set,
// it will also deploy and bind the 2-of-3 multisig wallet as part of the same call.
export async function requestAnchorFromService(params: {
  escrowSignerUrl: string;
  sourceBatchId: string;
  escrowBatchId: string;
  treasurySignature: string;
  escrowSignature: string;
  batchAuthorityBindingHash: string;
  custodyMode?: string;
}): Promise<SignerServiceAnchorResponse> {
  const { escrowSignerUrl, ...body } = params;
  return fetchJson<SignerServiceAnchorResponse>(`${escrowSignerUrl}/anchor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Submit attachAllocation() via the escrow signer service (no browser wallet needed).
export async function requestAllocationAnchorFromService(params: {
  escrowSignerUrl: string;
  sourceBatchId: string;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
}): Promise<{ txHash: string; attachedAt: string; alreadyAttached: boolean }> {
  const { escrowSignerUrl, ...body } = params;
  return fetchJson<{ txHash: string; attachedAt: string; alreadyAttached: boolean }>(`${escrowSignerUrl}/attach-allocation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Check that a signer service is reachable and confirm its signer address.
export async function checkSignerServiceHealth(serviceUrl: string): Promise<SignerServiceHealthResponse> {
  return fetchJson<SignerServiceHealthResponse>(`${serviceUrl}/health`);
}

export async function requestTreasuryDeployLegFromService(params: {
  treasurySignerUrl: string;
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  assetSymbol: string;
  amount: string;
  destinationAddress: string;
  chainId?: number;
}): Promise<TreasuryDeployLegResponse> {
  const { treasurySignerUrl, ...body } = params;
  return fetchJson<TreasuryDeployLegResponse>(`${treasurySignerUrl}/deploy-leg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function requestEscrowDeployLegConfirmationFromService(params: {
  escrowSignerUrl: string;
  sourceBatchId: string;
  escrowBatchId: string;
  walletAddress: string;
  assetSymbol: string;
  amount: string;
  destinationAddress: string;
  txIndex: number;
  chainId?: number;
}): Promise<EscrowConfirmDeployLegResponse> {
  const { escrowSignerUrl, ...body } = params;
  return fetchJson<EscrowConfirmDeployLegResponse>(`${escrowSignerUrl}/confirm-deploy-leg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
