// Status helpers for the autonomous Treasury and Escrow signer services.
//
// ⚠ DO NOT CALL THE SIGNER SERVICES FROM THE BROWSER.
//
// The request functions that used to live here were removed. Those services
// hold the role private keys, and the signatures they produce are accepted
// on-chain as protocol authority — so they now require an authenticated service
// caller. The browser cannot be that caller: shipping the credential to the
// client would hand signing authority to anyone who opens devtools.
//
// Privileged escrow operations go through `lib/escrow/lifecycleActions.ts`,
// which asks the banking server to advance the lifecycle. The banking server
// calls the signers with its own credential. Same operations, authenticated
// boundary in front of them instead of behind.
//
// What remains here is display-only status, derived from optional env vars:
//   NEXT_PUBLIC_TREASURY_SIGNER_URL  (e.g. http://localhost:4001)
//   NEXT_PUBLIC_ESCROW_SIGNER_URL    (e.g. http://localhost:4002)
// These are a local-development convenience indicator. They do NOT gate any
// operation — the banking server resolves its own SIGNER_TREASURY_URL and
// SIGNER_ESCROW_URL, and reports unreachability through the lifecycle response.

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
