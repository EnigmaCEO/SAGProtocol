import { ethers } from "ethers";
import fs from "fs";
import path from "path";

/*
Usage:
  RPC_URL=http://localhost:8545 OWNER_PRIVATE_KEY=0xabc... ORACLE=0x... RESERVE=0x... PRICE=4000 npx ts-node scripts/set-gold-oracle.ts
If PRICE is provided the script will also call oracle.setGoldPrice(PRICE*1e6).
*/

async function main() {
  const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";
  const OWNER_KEY = process.env.OWNER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const ORACLE = process.env.ORACLE || process.env.NEXT_PUBLIC_GOLD_ORACLE;
  const RESERVE = process.env.RESERVE || process.env.NEXT_PUBLIC_RESERVE_CONTROLLER_ADDRESS;
  const PRICE = process.env.PRICE ? Number(process.env.PRICE) : undefined; // e.g. 4000

  if (!OWNER_KEY) {
    console.error("OWNER_PRIVATE_KEY env required");
    process.exit(1);
  }
  if (!ORACLE) {
    console.error("ORACLE env (GoldOracle address) required");
    process.exit(1);
  }
  if (!RESERVE) {
    console.error("RESERVE env (ReserveController address) required");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(OWNER_KEY, provider);

  // load ABIs
  const reserveAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/src/lib/abis/ReserveController.json"), "utf8"));
  const oracleAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/src/lib/abis/GoldOracle.json"), "utf8"));

  const reserve = new ethers.Contract(RESERVE, reserveAbi, signer);
  const oracle = new ethers.Contract(ORACLE, oracleAbi, signer);

  console.log("Connected as", await signer.getAddress());
  console.log("Setting reserve.goldOracle ->", ORACLE);

  const tx = await reserve.setGoldOracle(ORACLE);
  console.log("setGoldOracle tx:", tx.hash);
  await tx.wait();
  console.log("setGoldOracle confirmed");

  if (PRICE !== undefined && PRICE > 0) {
    const price6 = Math.round(PRICE * 1e6).toString();
    if (typeof oracle.setGoldPrice !== "function") {
      console.warn("oracle.setGoldPrice not available on ABI; skipping price set");
    } else {
      const tx2 = await oracle.setGoldPrice(price6);
      console.log("setGoldPrice tx:", tx2.hash);
      await tx2.wait();
      console.log("setGoldPrice confirmed");
    }
  }

  // quick verification readbacks
  try {
    const oraclePrice = await oracle.getGoldPrice();
    console.log("oracle.getGoldPrice() =>", oraclePrice.toString());
  } catch (err) {
    console.warn("oracle.getGoldPrice failed", err);
  }
  try {
    const current = await reserve.goldOracle();
    console.log("reserve.goldOracle() =>", current);
  } catch (err) {
    console.warn("reserve.goldOracle() read failed", err);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
