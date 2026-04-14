import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_METADATA_BASE_URI = "http://localhost:3000/api/metadata/";

async function getFactorySafe(name: string, preferredFqn?: string) {
  if (preferredFqn) {
    try {
      return await ethers.getContractFactory(preferredFqn);
    } catch (err) {
      console.warn(`getFactorySafe: failed preferred FQN ${preferredFqn}, falling back by name`);
    }
  }

  try {
    return await ethers.getContractFactory(name);
  } catch (err) {
    const all = await hre.artifacts.getAllFullyQualifiedNames();
    const matches = all.filter((f: string) => f.endsWith(`:${name}`));
    if (matches.length === 0) throw err;

    const preferred =
      matches.find((f: string) => f.startsWith("contracts/") && !f.includes("/mocks/")) ??
      matches[0];

    console.log(`getFactorySafe: resolving ${name} -> artifact ${preferred}`);
    return await ethers.getContractFactory(preferred);
  }
}

function addr(d: any): string {
  return (d?.target ?? d?.address) as string;
}

async function deployAndVerify(factory: any, ...args: any[]) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();

  const deployed = addr(contract);
  const code = await ethers.provider.getCode(deployed);
  if (!code || code === "0x") {
    throw new Error(`Deployment verification failed: no bytecode at ${deployed}`);
  }
  return contract;
}

function getConstructorInputs(factory: any): any[] {
  const iface = factory.interface ?? (factory as any).interface;
  const constructorFragment =
    (iface &&
      (iface.deploy?.inputs ??
        (iface.fragments ? iface.fragments.find((f: any) => f.type === "constructor")?.inputs : undefined))) ??
    [];
  return constructorFragment;
}

function buildArgsForConstructor(inputs: any[], ctx: Record<string, any>) {
  return inputs.map((inp: any) => {
    const t = String(inp?.type ?? "").toLowerCase();
    const name = String(inp?.name ?? "").toLowerCase();

    if (t === "address") {
      if (name.includes("gold")) return addr(ctx.gold);
      if (name.includes("usdc") || name.includes("usd") || name.includes("stable")) return addr(ctx.usdc);
      if (name.includes("dot") || name.includes("mdot")) return addr(ctx.mdot);
      if (name.includes("vault")) return addr(ctx.vault);
      if (name.includes("treasury")) return addr(ctx.treasury) ?? ZERO;
      if (name.includes("reserve")) return addr(ctx.reserve) ?? ZERO;
      if (name.includes("escrow")) return addr(ctx.escrow) ?? ZERO;
      if (name.includes("owner") || name.includes("admin") || name.includes("govern")) return ctx.deployer?.address ?? ZERO;
      return ZERO;
    }

    if (t.startsWith("uint") || t.startsWith("int")) return 0;
    return ZERO;
  });
}

async function syncPairIfSupported(pairAddr: string, label: string, owner: string) {
  try {
    const pair = await ethers.getContractAt("MockAmmPair", pairAddr);
    if (typeof (pair as any).sync === "function") {
      await (await (pair as any).sync()).wait();
      console.log(`synced ${label}`);
      return;
    }
    if (typeof (pair as any).mint === "function") {
      await (await (pair as any).mint(owner)).wait();
      console.log(`mint(owner) used for ${label}`);
      return;
    }
    console.log(`${label}: no sync/mint method, skipping reserve update`);
  } catch (e) {
    console.warn(`${label}: sync step failed (non-fatal)`, e);
  }
}

function writeAddresses(deployments: Record<string, string | number | null>) {
  const content =
    `// AUTO-GENERATED. DO NOT EDIT.\n` +
    `export const CONTRACT_ADDRESSES = ${JSON.stringify(deployments, null, 2)} as const;\n`;

  const outputDirs = [
    path.join(__dirname, "../frontend/src/lib"),
    path.join(__dirname, "../src/lib"),
  ];

  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) continue;
    const outFile = path.join(dir, "addresses.ts");
    fs.writeFileSync(outFile, content);
    console.log(`Saved addresses -> ${outFile}`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const metadataBaseUri = process.env.NFT_METADATA_BASE_URI || DEFAULT_METADATA_BASE_URI;
  console.log("Deploying with:", deployer.address);

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("Network:", network.name, "Chain ID:", chainId);
  if (chainId !== 1337 && chainId !== 31337) {
    console.warn(`Warning: deploying on non-local chain (chainId=${chainId})`);
  }

  console.log("\n=== Deploying core tokens ===");
  const MockUSDC = await getFactorySafe("MockUSDC", "contracts/MockUSDC.sol:MockUSDC");
  const MockGOLD = await getFactorySafe("MockGOLD", "contracts/MockGOLD.sol:MockGOLD");

  const usdc = await deployAndVerify(MockUSDC);
  const gold = await deployAndVerify(MockGOLD);

  console.log("MockUSDC:", addr(usdc));
  console.log("MockGOLD:", addr(gold));

  console.log("\n=== Deploying protocol contracts ===");
  const Vault = await getFactorySafe("Vault", "contracts/Vault.sol:Vault");
  const ReserveController = await getFactorySafe("ReserveController", "contracts/ReserveController.sol:ReserveController");
  const MockOracle = await getFactorySafe("MockOracle", "contracts/MockOracle.sol:MockOracle");
  const Treasury = await getFactorySafe("Treasury", "contracts/Treasury.sol:Treasury");
  const Receipt = await getFactorySafe("SagittaVaultReceipt", "contracts/SagittaVaultReceipt.sol:SagittaVaultReceipt");
  const Pair = await getFactorySafe("MockAmmPair", "contracts/MockAmmPair.sol:MockAmmPair");
  const InvestmentEscrow = await getFactorySafe("InvestmentEscrow", "contracts/InvestmentEscrow.sol:InvestmentEscrow");

  const vault = await deployAndVerify(Vault);
  console.log("Vault:", addr(vault));

  const reserveCtorInputs = getConstructorInputs(ReserveController);
  const reserveCtx = { gold, usdc, vault, deployer };
  let reserve: any;
  try {
    const reserveCtorArgs = buildArgsForConstructor(reserveCtorInputs, reserveCtx);
    reserve = await deployAndVerify(ReserveController, ...reserveCtorArgs);
  } catch (e) {
    console.warn("ReserveController inferred constructor deploy failed, retrying with zero args");
    reserve = await deployAndVerify(ReserveController);
  }
  console.log("ReserveController:", addr(reserve));

  // On localhost/testnet we deploy MockOracle instances.
  // On mainnet replace these with API3PriceAdapter contracts pointed at live dAPI proxies:
  //   const API3Adapter = await getFactorySafe("API3PriceAdapter", "contracts/API3PriceAdapter.sol:API3PriceAdapter");
  //   const oracleGold = await deployAndVerify(API3Adapter, process.env.API3_GOLD_PROXY);  // e.g. XAU/USD
  //   const oracleUsdc = await deployAndVerify(API3Adapter, process.env.API3_USDC_PROXY);  // e.g. USDC/USD
  const oracleGold = await deployAndVerify(MockOracle);
  const oracleUsdc = await deployAndVerify(MockOracle);
  console.log("GoldOracle:", addr(oracleGold));
  console.log("UsdcOracle:", addr(oracleUsdc));

  await (await oracleGold.setPrice(400_000_000_000n)).wait(); // $4000 (8 dec)
  await (await oracleUsdc.setPrice(100_000_000n)).wait();     // $1    (8 dec)

  const treasury = await deployAndVerify(
    Treasury,
    addr(usdc),
    addr(gold),
    addr(reserve),
    addr(vault),
    addr(oracleUsdc)
  );
  console.log("Treasury:", addr(treasury));

  const receiptNft = await deployAndVerify(Receipt, "Sagitta Vault Receipt", "SVR");
  console.log("ReceiptNFT:", addr(receiptNft));

  console.log("\n=== Deploying AMM pair (USDC/GOLD) ===");
  const pairCtorInputs = getConstructorInputs(Pair);
  let ammUSDCGOLD: any;
  try {
    let pairArgs: any[] = [];
    if (
      pairCtorInputs.length === 2 &&
      pairCtorInputs.every((i: any) => String(i.type ?? "").toLowerCase() === "address")
    ) {
      pairArgs = [addr(usdc), addr(gold)];
    } else if (pairCtorInputs.length > 0) {
      pairArgs = buildArgsForConstructor(pairCtorInputs, { usdc, gold, vault, reserve, treasury, deployer });
    }
    ammUSDCGOLD = await deployAndVerify(Pair, ...pairArgs);
  } catch (e) {
    console.warn("USDC/GOLD AMM inferred constructor deploy failed, retrying with zero args");
    ammUSDCGOLD = await deployAndVerify(Pair);
  }
  console.log("AmmUSDCGOLD:", addr(ammUSDCGOLD));

  const escrow = await deployAndVerify(InvestmentEscrow, addr(usdc), addr(treasury));
  console.log("InvestmentEscrow:", addr(escrow));

  console.log("\n=== Wiring contracts ===");

  try {
    if (typeof (vault as any).setTreasury === "function") {
      await (await (vault as any).setTreasury(addr(treasury))).wait();
    }
  } catch (e) {
    console.warn("vault.setTreasury failed (non-fatal):", e);
  }

  await (await treasury.setVault(addr(vault))).wait();
  await (await treasury.setReserveAddress(addr(reserve))).wait();
  await (await treasury.setGoldOracle(addr(oracleGold))).wait();

  try {
    if (typeof (reserve as any).setTreasury === "function") {
      await (await (reserve as any).setTreasury(addr(treasury))).wait();
      console.log("ReserveController.treasury linked to Treasury");
    }
  } catch (e) {
    console.warn("reserve.setTreasury failed (non-fatal):", e);
  }

  try {
    await (await treasury.setEscrow(addr(escrow))).wait();
  } catch (e) {
    console.warn("treasury.setEscrow failed (non-fatal):", e);
  }

  try {
    if (typeof (vault as any).setEscrow === "function") {
      await (await (vault as any).setEscrow(addr(escrow))).wait();
    }
  } catch (e) {
    console.warn("vault.setEscrow failed (non-fatal):", e);
  }

  try {
    if (typeof (escrow as any).setVault === "function") {
      await (await (escrow as any).setVault(addr(vault))).wait();
    }
  } catch (e) {
    console.warn("escrow.setVault failed (non-fatal):", e);
  }

  try {
    if (typeof (receiptNft as any).setMinter === "function") {
      await (await (receiptNft as any).setMinter(addr(vault))).wait();
    } else if (typeof (receiptNft as any).grantRole === "function") {
      const maybeRole = (receiptNft as any).MINTER_ROLE;
      const minterRole = typeof maybeRole === "function" ? await maybeRole() : maybeRole;
      if (minterRole) await (await (receiptNft as any).grantRole(minterRole, addr(vault))).wait();
    }

    if (typeof (vault as any).setReceiptNFT === "function") {
      await (await (vault as any).setReceiptNFT(addr(receiptNft))).wait();
    } else if (typeof (vault as any).setReceiptToken === "function") {
      await (await (vault as any).setReceiptToken(addr(receiptNft))).wait();
    }

    if (typeof (receiptNft as any).setBaseTokenURI === "function") {
      await (await (receiptNft as any).setBaseTokenURI(metadataBaseUri)).wait();
      console.log(`Receipt metadata base URI set: ${metadataBaseUri}`);
    }
  } catch (e) {
    console.warn("receipt wiring failed (non-fatal):", e);
  }

  try {
    await (await treasury.setAmmPair(addr(ammUSDCGOLD))).wait();
  } catch (e) {
    console.warn("treasury.setAmmPair failed (non-fatal):", e);
  }

  console.log("\n=== Configuring Vault assets ===");
  try {
    const usdcDecimals = Number(await usdc.decimals());
    await (await vault.setAsset(addr(usdc), true, usdcDecimals, addr(oracleUsdc))).wait();
    console.log("Vault asset enabled: USDC");
  } catch (e) {
    console.warn("vault.setAsset(USDC) failed (non-fatal):", e);
  }

  try {
    if (typeof (vault as any).setUSDC === "function") {
      await (await (vault as any).setUSDC(addr(usdc))).wait();
    } else if (typeof (vault as any).setMDot === "function") {
      await (await (vault as any).setMDot(addr(usdc))).wait();
    }
  } catch (e) {
    console.warn("vault payout-token wiring failed (non-fatal):", e);
  }

  try {
    await (await vault.setLockDuration(365 * 24 * 60 * 60)).wait();
  } catch (e) {
    console.warn("vault.setLockDuration failed (non-fatal):", e);
  }

  console.log("\n=== Funding protocol balances ===");
  const ONE_MILLION_USD = 1_000_000n;
  const usdcToTreasury = ONE_MILLION_USD * 10n ** 6n;
  await (await usdc.mint(addr(treasury), usdcToTreasury)).wait();
  console.log("Minted USDC to Treasury:", usdcToTreasury.toString());

  const goldDecimals = Number(await gold.decimals());
  const goldPrice8 = BigInt(await oracleGold.getPrice());
  const reserveUsd = 500_000n;
  const goldToReserve = (reserveUsd * 10n ** BigInt(8 + goldDecimals)) / goldPrice8;
  await (await gold.mint(addr(reserve), goldToReserve)).wait();
  console.log("Minted GOLD to ReserveController:", goldToReserve.toString());

  try {
    const ammUsd = 500_000n;
    const usdcToAmm = ammUsd * 10n ** 6n;
    const goldToAmm = (ammUsd * 10n ** BigInt(8 + goldDecimals)) / goldPrice8;
    await (await usdc.mint(addr(ammUSDCGOLD), usdcToAmm)).wait();
    await (await gold.mint(addr(ammUSDCGOLD), goldToAmm)).wait();
    await syncPairIfSupported(addr(ammUSDCGOLD), "AmmUSDCGOLD", deployer.address);
  } catch (e) {
    console.warn("AMM seed failed (non-fatal):", e);
  }

  // Fund a demo account on local chains only.
  // On Moonbase/mainnet the deployer address itself is the demo account — no faucet needed.
  const isLocal = chainId === 1337 || chainId === 31337;
  const demoAddress = isLocal
    ? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    : deployer.address;

  console.log("\n=== Funding demo account ===");
  await (await usdc.mint(demoAddress, 1_000n * 10n ** 6n)).wait();
  if (isLocal) {
    // Only send native tokens on localhost (Hardhat default account needs ETH)
    await deployer.sendTransaction({ to: demoAddress, value: ethers.parseEther("10") });
  }

  const deployments: Record<string, string | number | null> = {
    network: String(network.name),
    chainId,
    MockUSDC: addr(usdc),
    MockGOLD: addr(gold),
    Vault: addr(vault),
    Treasury: addr(treasury),
    ReserveController: addr(reserve),
    InvestmentEscrow: addr(escrow),
    GoldOracle: addr(oracleGold),
    UsdcOracle: addr(oracleUsdc),
    ReceiptNFT: addr(receiptNft),
    AmmUSDCGOLD: addr(ammUSDCGOLD),

    // Explicitly retained as null for backward compatibility with older scripts.
    SAGToken: null,
    SagOracle: null,
    AmmSAGUSDC: null,
  };

  for (const [name, value] of Object.entries(deployments)) {
    if (typeof value !== "string" || !value.startsWith("0x") || value.length !== 42) continue;
    const code = await ethers.provider.getCode(value);
    if (!code || code === "0x") {
      throw new Error(`Verification failed: ${name} not deployed at ${value}`);
    }
  }

  writeAddresses(deployments);

  console.log("\nDeployment complete");
  console.log("Demo account:", demoAddress);
  console.log("USDC minted to demo: 1000");
  console.log("IMPORTANT: localhost addresses reset when Hardhat node restarts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
