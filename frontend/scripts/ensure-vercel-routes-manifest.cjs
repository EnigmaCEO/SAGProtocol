const fs = require('node:fs');
const path = require('node:path');

const nextDir = path.join(__dirname, '..', '.next');
const source = path.join(nextDir, 'routes-manifest.json');
const target = path.join(nextDir, 'routes-manifest-deterministic.json');
const repoRootNextDir = path.join(__dirname, '..', '..', '.next');
const repoRootTarget = path.join(repoRootNextDir, 'routes-manifest-deterministic.json');

if (!fs.existsSync(source)) {
  console.warn('[postbuild] .next/routes-manifest.json not found; skipping deterministic manifest copy.');
  process.exit(0);
}

fs.copyFileSync(source, target);
console.log('[postbuild] Wrote .next/routes-manifest-deterministic.json for Vercel finalization.');

fs.mkdirSync(repoRootNextDir, { recursive: true });
fs.copyFileSync(source, repoRootTarget);
console.log('[postbuild] Wrote ../.next/routes-manifest-deterministic.json for Vercel Git Integration finalization.');
