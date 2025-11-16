// Exports ABI JSON files from Hardhat artifacts to frontend/src/lib/abi/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeAbi(name: string, abi: any) {
  const outDir = path.resolve(__dirname, '../frontend/src/lib/abis');
  ensureDir(outDir);
  const outPath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(abi, null, 2), 'utf8');
  console.log('Wrote ABI:', outPath);
}

function isArtifactFile(file: string) {
  return file.endsWith('.json');
}

function collectArtifactFiles(artifactsDir: string): string[] {
  const list: string[] = [];
  if (!fs.existsSync(artifactsDir)) return list;
  const entries = fs.readdirSync(artifactsDir);
  for (const e of entries) {
    const full = path.join(artifactsDir, e);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      list.push(...collectArtifactFiles(full));
    } else if (stat.isFile() && isArtifactFile(full)) {
      list.push(full);
    }
  }
  return list;
}

async function main() {
  const artifactsRoot = path.resolve(__dirname, '../artifacts/contracts');
  const files = collectArtifactFiles(artifactsRoot);
  if (files.length === 0) {
    console.error('No artifact files found. Did you run `npx hardhat compile`?');
    process.exit(1);
  }

  for (const file of files) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      // skip non-artifact JSONs that don't contain "abi"
      if (!json || !json.abi) continue;
      // derive contract name: artifacts/contracts/<path>/<Name>.sol/<Name>.json
      const parts = file.split(path.sep);
      const fname = path.basename(file, '.json');
      // use contract name from artifact if present
      const contractName = json.contractName ?? fname;
      writeAbi(contractName, json.abi);
    } catch (err) {
      console.warn('Skipping', file, String((err as any).message || err));
    }
  }

  console.log('ABI export complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
