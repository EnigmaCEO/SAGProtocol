const fs = require('node:fs');
const path = require('node:path');

const nextDir = path.join(__dirname, '..', '.next');
const repoRootNextDir = path.join(__dirname, '..', '..', '.next');
const routesManifest = path.join(nextDir, 'routes-manifest.json');

function copyFileIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function mirrorFiles(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return 0;
  let copied = 0;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isFile()) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }

  return copied;
}

if (!fs.existsSync(routesManifest)) {
  console.warn('[postbuild] .next/routes-manifest.json not found; skipping deterministic manifest copy.');
  process.exit(0);
}

fs.copyFileSync(routesManifest, path.join(nextDir, 'routes-manifest-deterministic.json'));
console.log('[postbuild] Wrote .next/routes-manifest-deterministic.json for Vercel finalization.');

const copiedRootFiles = mirrorFiles(nextDir, repoRootNextDir);
const copiedServerFiles = mirrorFiles(path.join(nextDir, 'server'), path.join(repoRootNextDir, 'server'));
copyFileIfExists(routesManifest, path.join(repoRootNextDir, 'routes-manifest-deterministic.json'));

console.log(
  `[postbuild] Mirrored ${copiedRootFiles} root manifest files and ${copiedServerFiles} server manifest files to ../.next for Vercel Git Integration finalization.`
);
