import { JsonRpcProvider, Contract } from "ethers";
import { CONTRACT_ADDRESSES } from "../frontend/src/lib/addresses.js";
import TREASURY_ABI from "../frontend/src/lib/abis/Treasury.json";
import SAG_ORACLE_ABI from "../frontend/src/lib/abis/SagOracle.json";
import GOLD_ORACLE_ABI from "../frontend/src/lib/abis/GoldOracle.json";

const LOCALHOST_RPC = "http://localhost:8545";

function formatUsd(val: number | string, decimals = 6) {
  if (!val) return "$0";
  const n = typeof val === "string" ? Number(val) : val;
  return "$" + (n / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function main() {
  const provider = new JsonRpcProvider(LOCALHOST_RPC);

  const treasury = new Contract(CONTRACT_ADDRESSES.Treasury, TREASURY_ABI.abi, provider);
  const sagOracle = new Contract(CONTRACT_ADDRESSES.SagOracle, SAG_ORACLE_ABI.abi, provider);
  const goldOracle = new Contract(CONTRACT_ADDRESSES.GoldOracle, GOLD_ORACLE_ABI.abi, provider);

  const sagPriceRaw = await sagOracle.getSagPrice();
  const goldPriceRaw = await goldOracle.getGoldPrice();
  const treasuryUsdRaw = await treasury.getTreasuryValueUsd();
  const reserveUsdRaw = await treasury.getReserveValueUsd();
  const targetReserveUsdRaw = await treasury.getTargetReserveUsd();

  const reserveAddress = await treasury.reserveAddress();
  const gold = new Contract(CONTRACT_ADDRESSES.MockGOLD, [
    "function balanceOf(address) view returns (uint256)"
  ], provider);

  console.log("MockGOLD Address used:", CONTRACT_ADDRESSES.MockGOLD);
  console.log("Reserve Address used:", reserveAddress);

  const goldBalanceRaw = await gold.balanceOf(reserveAddress);

  console.log("=== Sagitta Treasury Verification ===");
  console.log("Treasury Address:", CONTRACT_ADDRESSES.Treasury);
  console.log("Reserve Address:", reserveAddress);
  console.log("MockGOLD Address:", CONTRACT_ADDRESSES.MockGOLD);
  console.log("Raw GOLD balance at Reserve Address:", goldBalanceRaw); // <-- direct output
  console.log("GOLD Balance at Reserve Address (tokens):", (BigInt(goldBalanceRaw) / BigInt(10 ** 18)).toString());
  console.log("GOLD Balance at Reserve Address (ether):", Number(goldBalanceRaw) / 1e18);
  console.log("SAG Price (USD):", (Number(sagPriceRaw) / 1e18).toFixed(3));
  console.log("Gold Price (USD):", (Number(goldPriceRaw) / 1e18).toFixed(2));
  console.log("Treasury Value:", formatUsd(Number(treasuryUsdRaw)));
  console.log("Reserve Value:", formatUsd(Number(reserveUsdRaw)));
  console.log("Target Reserve:", formatUsd(Number(targetReserveUsdRaw)));
  console.log("GOLD Balance at Reserve Address:", (Number(goldBalanceRaw) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  if (Number(goldBalanceRaw) === 0) {
    console.warn("WARNING: GOLD balance is zero. Did you restart the Hardhat node or use old addresses?");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
