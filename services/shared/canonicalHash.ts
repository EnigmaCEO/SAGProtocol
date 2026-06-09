import { keccak256, toUtf8Bytes } from 'ethers';
import { makeCanonicalKeccak, sortedJson } from '../../packages/escrow-protocol/src/canonicalHash';

export { sortedJson };

export const canonicalKeccak = makeCanonicalKeccak(
  (data) => keccak256(data),
  (text) => toUtf8Bytes(text),
);
