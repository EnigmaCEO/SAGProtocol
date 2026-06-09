import { canonicalKeccak } from './canonicalHash';

export interface EscrowBatchUuidParams {
  chainId: number | string;
  treasuryAddress: string;
  sourceBatchId: string;
  openedAt: number | string;
}

export function escrowBatchUuid(params: EscrowBatchUuidParams): string {
  const hex = canonicalKeccak({
    chainId: Number(params.chainId || 0),
    openedAt: Number(params.openedAt || 0),
    sourceBatchId: String(params.sourceBatchId || '').trim(),
    treasuryAddress: String(params.treasuryAddress || '').toLowerCase(),
    type: 'sagitta_escrow_batch_uuid_v1',
  }).slice(2);
  const variantByte = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantByte}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function isUuid(value: string | undefined | null): boolean {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

export function resolveEscrowBatchId(candidate: unknown, params: EscrowBatchUuidParams): string {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (isUuid(value)) return value;
  if (value && !/^escrow-\d+$/i.test(value)) return value;
  return escrowBatchUuid(params);
}
