import { EscrowBatch, EscrowFundingConfirmation } from '../../lib/escrow/batches';

export type { EscrowFundingConfirmation, EscrowFundingStatus } from '../../lib/escrow/batches';

const DEFAULT_FUNDING_ASSET = 'USDC';

function makeFundingConfirmationId(batch: EscrowBatch, timestamp: string) {
  return `${batch.batchId}-funding-${timestamp.replace(/[^0-9]/g, '')}`;
}

function makeAuditEvent(
  batch: EscrowBatch,
  eventId: string,
  timestamp: string,
  actor: string,
  eventType: string,
  description: string,
  reference?: string
): EscrowBatch['auditTrail'][number] {
  return {
    eventId: `${batch.batchId}-${eventId}`,
    timestamp,
    actor,
    eventType,
    description,
    reference,
  };
}

export function getLatestFundingConfirmation(batch: EscrowBatch) {
  return [...(batch.fundingConfirmations ?? [])].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0];
}

export function getExecutedDeploymentOutflowUsd(batch: EscrowBatch): number {
  const latestByLeg = new Map<string, number>();

  for (const execution of batch.deploymentExecutions ?? []) {
    for (const result of execution.deploymentLegResults ?? []) {
      if (!['executed', 'deployed', 'monitoring', 'settled'].includes(result.status)) continue;
      latestByLeg.set(result.legId, Number(result.amountUsd ?? 0));
    }
  }

  for (const leg of batch.deploymentLegs ?? []) {
    if (latestByLeg.has(leg.legId)) continue;
    if (!['executed', 'deployed', 'monitoring', 'settled'].includes(leg.status)) continue;
    latestByLeg.set(leg.legId, Number(leg.amount ?? leg.amountUsd ?? 0));
  }

  return Array.from(latestByLeg.values()).reduce((sum, amount) => sum + amount, 0);
}

export function createFundingConfirmation(params: {
  batch: EscrowBatch;
  observedAmountUsd: number;
  fundingTxHash?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  asset?: string;
  custodyMode?: EscrowBatch['custodyMode'];
  sourceContract?: string;
  sourceBatchId?: string;
  sourceContractBalanceUsd?: number;
  batchPositionCollateralUsd?: number;
  fundingSource?: string;
  fundingStatus?: EscrowFundingConfirmation['fundingStatus'];
}) {
  const confirmedAt = params.confirmedAt ?? new Date().toISOString();
  const expectedAmountUsd = params.batch.expectedFundingAmountUsd || params.batch.totalAmountUsd;
  const fundingStatus = params.fundingStatus ?? (params.observedAmountUsd === expectedAmountUsd ? 'verified' : 'mismatch');

  return {
    fundingConfirmationId: makeFundingConfirmationId(params.batch, confirmedAt),
    batchId: params.batch.batchId,
    batchWalletAddress: params.batch.wallet.walletAddress ?? params.batch.wallet.address,
    expectedAmountUsd,
    observedAmountUsd: params.observedAmountUsd,
    asset: params.asset ?? DEFAULT_FUNDING_ASSET,
    custodyMode: params.custodyMode ?? params.batch.custodyMode,
    sourceContract: params.sourceContract ?? params.batch.sourceContract,
    sourceBatchId: params.sourceBatchId ?? params.batch.sourceBatchId ?? params.batch.treasuryHandoff.handoffId,
    sourceContractBalanceUsd: params.sourceContractBalanceUsd ?? params.batch.sourceContractBalanceUsd,
    batchPositionCollateralUsd: params.batchPositionCollateralUsd ?? params.batch.batchPositionCollateralUsd,
    fundingSource: params.fundingSource ?? params.batch.fundingSource,
    treasurySourceWallet: params.batch.treasuryHandoff.treasurySourceWallet,
    fundingTxHash: params.fundingTxHash,
    fundingStatus,
    confirmedBy: params.confirmedBy ?? 'Escrow Operator',
    confirmedAt,
    verifiedAt: fundingStatus === 'verified' ? confirmedAt : undefined,
  } satisfies EscrowFundingConfirmation;
}

export function applyFundingConfirmationToBatch(batch: EscrowBatch, confirmation: EscrowFundingConfirmation) {
  const isVerified = confirmation.fundingStatus === 'verified';
  const submittedEvent = makeAuditEvent(
    batch,
    `treasury-funding-submitted-${confirmation.fundingConfirmationId}`,
    confirmation.confirmedAt,
    confirmation.confirmedBy,
    'Funding observed',
    `${confirmation.fundingSource || 'Custody source'} reported ${confirmation.asset} ${confirmation.observedAmountUsd.toLocaleString('en-US')}.`,
    confirmation.fundingTxHash
  );
  const verificationEvent = makeAuditEvent(
    batch,
    `treasury-funding-${isVerified ? 'verified' : 'mismatch'}-${confirmation.fundingConfirmationId}`,
    confirmation.verifiedAt ?? confirmation.confirmedAt,
    'Escrow Service',
    isVerified ? 'Funding verification passed' : 'Funding verification failed',
    isVerified
      ? `Observed wallet balance matched expected funding amount ${confirmation.expectedAmountUsd.toLocaleString('en-US')}.`
      : `Observed wallet balance ${confirmation.observedAmountUsd.toLocaleString('en-US')} did not match expected ${confirmation.expectedAmountUsd.toLocaleString('en-US')}.`,
    confirmation.fundingTxHash
  );

  return {
    ...batch,
    status: isVerified && ['treasury_sent', 'treasury_received', 'wallet_requested', 'wallet_created'].includes(batch.status)
      ? 'wallet_funded'
      : !isVerified && batch.status === 'wallet_funded'
        ? 'wallet_created'
        : batch.status,
    observedWalletBalanceUsd: confirmation.observedAmountUsd,
    sourceContract: confirmation.sourceContract ?? batch.sourceContract,
    sourceBatchId: confirmation.sourceBatchId ?? batch.sourceBatchId,
    sourceContractBalanceUsd: confirmation.sourceContractBalanceUsd ?? batch.sourceContractBalanceUsd,
    batchPositionCollateralUsd: confirmation.batchPositionCollateralUsd ?? batch.batchPositionCollateralUsd,
    fundingSource: confirmation.fundingSource ?? batch.fundingSource,
    fundingVerifiedAt: isVerified ? confirmation.verifiedAt : undefined,
    wallet: {
      ...batch.wallet,
      fundingStatus:
        isVerified && (confirmation.custodyMode ?? batch.custodyMode) === 'batch_wallet_custody'
          ? 'verified'
          : !isVerified && batch.wallet.fundingStatus === 'verified'
            ? 'created'
            : batch.wallet.fundingStatus,
      fundingTxHash: confirmation.fundingTxHash || batch.wallet.fundingTxHash,
    },
    fundingConfirmations: [...(batch.fundingConfirmations ?? []), confirmation],
    auditTrail: [...batch.auditTrail, submittedEvent, verificationEvent],
  } satisfies EscrowBatch;
}
