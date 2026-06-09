// Canonical keccak256 hash for all security-relevant escrow evidence fields.
//
// This is the frontend (Next.js) implementation. The authoritative spec lives at:
//   packages/escrow-protocol/src/canonicalHash.ts
//
// The sortedJson function below MUST stay identical to the one in that file.
// The signer services (signer-treasury, signer-escrow) import from
// services/shared/canonicalHash.ts, which imports directly from the shared package.
// Next.js cannot transpile TypeScript imported from outside the project root,
// so the frontend carries its own standalone copy of the sortedJson logic.
//
// Any change to the hashing logic MUST be applied in all three places:
//   1. packages/escrow-protocol/src/canonicalHash.ts  (spec)
//   2. frontend/src/lib/escrow/canonicalHash.ts        (this file)
//   3. services/shared/canonicalHash.ts                (signer services)

import { keccak256, toUtf8Bytes } from 'ethers';

export function sortedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(sortedJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedJson((value as Record<string, unknown>)[k])).join(',') + '}';
}

export function canonicalKeccak(obj: unknown): string {
  return keccak256(toUtf8Bytes(sortedJson(obj)));
}
