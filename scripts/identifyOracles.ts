import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadFrontendAddrs(): Promise<Record<string, string> | null> {
  const p = path.resolve(__dirname, "../frontend/src/lib/addresses.ts");
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, "utf8");
  const m = src.match(/export\s+const\s+CONTRACT_ADDRESSES\s*=\s*([\s\S]*?)\s*as\s+const\s*;/m);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch {
    // fallback
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[1].trim()});`)();
  }
}

function short(hex?: string) {
  if (!hex) return "<empty>";
  return hex.slice(0, 66);
}

async function probe(addresses: string[]) {
  const provider = hre.ethers.provider;
  console.log("Probing", addresses.length, "address(es)\n");

  for (const addr of addresses) {
    console.log("==> Address:", addr);
    try {
      const code = await provider.getCode(addr);
      console.log("  bytecode length:", (code.length / 2).toString(), "bytes");
      console.log("  bytecode prefix:", short(code));
    } catch (e) {
      console.log("  failed to fetch bytecode:", String(e));
    }

    const ifaceVariants = {
      getPrice: ["function getPrice() view returns (uint256)"],
      getSagPriceUsd: ["function getSagPriceUsd() view returns (uint256)"],
      getGoldPriceUsd: ["function getGoldPriceUsd() view returns (uint256)"],
      price: ["function price() view returns (uint256)"],
      latestAnswer: ["function latestAnswer() view returns (int256)"],
      owner: ["function owner() view returns (address)"],
    };

    for (const [name, abi] of Object.entries(ifaceVariants)) {
      try {
        const contract = new hre.ethers.Contract(addr, abi, provider);
        // @ts-ignore
        const res = await contract[name]();
        console.log(`  ${name}() -> OK : ${res?.toString?.() ?? String(res)}`);
      } catch (err: any) {
        const msg = String(err?.message || err).split("\n")[0];
        console.log(`  ${name}() -> FAIL : ${msg}`);
      }
    }

    // Attempt a generic low-level eth_call for common selector fingerprints to detect presence
    const selectors = [
      { sig: "getPrice()", sel: hre.ethers.id("getPrice()").slice(0,10) },
      { sig: "getSagPriceUsd()", sel: hre.ethers.id("getSagPriceUsd()").slice(0,10) },
      { sig: "getGoldPriceUsd()", sel: hre.ethers.id("getGoldPriceUsd()").slice(0,10) },
      { sig: "price()", sel: hre.ethers.id("price()").slice(0,10) },
      { sig: "latestAnswer()", sel: hre.ethers.id("latestAnswer()").slice(0,10) },
    ];
    try {
      const code = (await provider.getCode(addr)) ?? "0x";
      const present = selectors.filter(s => code.includes(s.sel.slice(2)));
      console.log("  selectors found in bytecode (heuristic):", present.map(p => p.sig).join(", ") || "<none>");
    } catch (_) {}
    console.log("");
  }
}

async function main() {
  const cli = process.argv.slice(2);
  let candidates: string[] = cli.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a));
  if (candidates.length === 0) {
    const addrs = await loadFrontendAddrs();
    if (addrs) {
      // common keys written by deploy.ts
      candidates = [
        addrs.DotOracle,
        addrs.SagOracle,
        addrs.GoldOracle,
        addrs.MockOracle,
        addrs.MockDOT,
        addrs.Vault,
        addrs.Treasury
      ].filter(Boolean) as string[];
    }
  }
  if (candidates.length === 0) {
    console.error("No candidate addresses provided via CLI and none found in frontend/src/lib/addresses.ts");
    process.exit(1);
  }

  await probe(candidates);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
