// Canonical keccak256 hash — authoritative specification.
//
// This file is the single source of truth for the sortedJson algorithm.
// All consumers must stay byte-identical to this implementation:
//
//   Frontend (Next.js):   frontend/src/lib/escrow/canonicalHash.ts
//   Signer services:      services/shared/canonicalHash.ts  →  imports this file
//
// Next.js cannot transpile TypeScript from outside the project root, so the
// frontend carries a standalone copy. The signer services (Node.js) import
// directly from here via services/shared/canonicalHash.ts.
//
// Rules:
//   - Object keys sorted alphabetically before serialization (cross-environment determinism).
//   - Backed by keccak256 — not a non-cryptographic hash.
//   - Any field in a signed or anchored record must use canonicalKeccak.

export function sortedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(sortedJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedJson((value as Record<string, unknown>)[k])).join(',') + '}';
}

// Returns a canonicalKeccak function bound to the provided ethers primitives.
// This keeps ethers as a peer dependency of each consumer rather than a hard dep here.
export function makeCanonicalKeccak(
  keccak256: (data: Uint8Array) => string,
  toUtf8Bytes: (text: string) => Uint8Array,
): (obj: unknown) => string {
  return (obj: unknown) => keccak256(toUtf8Bytes(sortedJson(obj)));
}
