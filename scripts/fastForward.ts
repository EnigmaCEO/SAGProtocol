import { network } from "hardhat";

async function main() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const days = daysIndex !== -1 && args[daysIndex + 1] 
    ? parseInt(args[daysIndex + 1]) 
    : 365;

  const seconds = days * 24 * 60 * 60;

  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");

  console.log(`⏩ Advanced ${days} days (${seconds} seconds)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
