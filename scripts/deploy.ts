import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_METADATA_BASE_URI = "https://protocol.sagitta.systems/api/metadata/";

// On live networks, transfer ownership to this address after deploy.
// Set to empty string to keep ownership with the deployer.
const OWNER_ADDRESS = process.env.OWNER_ADDRESS || "";

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
  // Wait for the deployment tx to be mined (1 confirmation minimum).
  const deployTx = contract.deploymentTransaction();
  if (deployTx) await deployTx.wait(1);
  else await contract.waitForDeployment();

  const deployed = addr(contract);
  // Retry getCode up to 5 times — live testnets can lag slightly after confirmation.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await ethers.provider.getCode(deployed);
    if (code && code !== "0x") return contract;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Deployment verification failed: no bytecode at ${deployed}`);
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
  const isLocal =
    Number(deployments.chainId) === 1337 || Number(deployments.chainId) === 31337;

  // Non-local chains: only write the ProtocolDAO address.
  // All other addresses are fetched at runtime from the ProtocolDAO contract,
  // so they don't need to live in the repo.
  // Local chains: write all addresses (needed for the localStorage dev-override system).
  const payload = isLocal
    ? deployments
    : {
        network: deployments.network,
        chainId: deployments.chainId,
        ProtocolDAO: deployments.ProtocolDAO,
      };

  const content =
    `// AUTO-GENERATED. DO NOT EDIT.\n` +
    (isLocal ? `` : `// Non-local deploy: only ProtocolDAO address is stored here.\n`) +
    (isLocal ? `` : `// All other addresses are read from ProtocolDAO on-chain at runtime.\n`) +
    `export const CONTRACT_ADDRESSES: Record<string, any> = ${JSON.stringify(payload, null, 2)};\n`;

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

  if (!isLocal) {
    console.log(`\nSet this in Vercel / .env.local for the frontend:`);
    console.log(`  NEXT_PUBLIC_PROTOCOL_DAO_ADDRESS=${deployments.ProtocolDAO}`);
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

  // Deploy oracles first so ReserveController constructor gets the real oracle address.
  // On mainnet replace MockOracle with API3PriceAdapter contracts pointed at live dAPI proxies:
  //   const API3Adapter = await getFactorySafe("API3PriceAdapter", "contracts/API3PriceAdapter.sol:API3PriceAdapter");
  //   const oracleGold = await deployAndVerify(API3Adapter, process.env.API3_GOLD_PROXY);  // e.g. XAU/USD
  //   const oracleUsdc = await deployAndVerify(API3Adapter, process.env.API3_USDC_PROXY);  // e.g. USDC/USD
  const oracleGold = await deployAndVerify(MockOracle);
  const oracleUsdc = await deployAndVerify(MockOracle);
  console.log("GoldOracle:", addr(oracleGold));
  console.log("UsdcOracle:", addr(oracleUsdc));

  await (await oracleGold.setPrice(400_000_000_000n)).wait(); // $4000 (8 dec)
  await (await oracleUsdc.setPrice(100_000_000n)).wait();     // $1    (8 dec)

  // Deploy ReserveController after oracles so the goldOracle arg is the real oracle.
  const reserve = await deployAndVerify(ReserveController, addr(gold), addr(oracleGold));
  console.log("ReserveController:", addr(reserve));

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
  // MockAmmPair constructor: (address _tokenA, address _tokenB)
  const ammUSDCGOLD = await deployAndVerify(Pair, addr(usdc), addr(gold));
  console.log("AmmUSDCGOLD:", addr(ammUSDCGOLD));

  const escrow = await deployAndVerify(InvestmentEscrow, addr(usdc), addr(treasury));
  console.log("InvestmentEscrow:", addr(escrow));

  const PortfolioRegistry = await getFactorySafe("PortfolioRegistry", "contracts/PortfolioRegistry.sol:PortfolioRegistry");
  const portfolioRegistry = await deployAndVerify(PortfolioRegistry);
  console.log("PortfolioRegistry:", addr(portfolioRegistry));

  const ProtocolDAO = await getFactorySafe("ProtocolDAO", "contracts/ProtocolDAO.sol:ProtocolDAO");
  const protocolDao = await deployAndVerify(ProtocolDAO, deployer.address);
  console.log("ProtocolDAO:", addr(protocolDao));

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

  // On local chains, authorize the deployer as keeper so manual batch operations work
  // without a separate keeper service. On live networks, set keeper via OWNER_ADDRESS env.
  if (chainId === 1337 || chainId === 31337) {
    try {
      if (typeof (escrow as any).setKeeper === "function") {
        await (await (escrow as any).setKeeper(deployer.address)).wait();
        console.log("InvestmentEscrow keeper set to deployer:", deployer.address);
      }
    } catch (e) {
      console.warn("escrow.setKeeper failed (non-fatal):", e);
    }
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

  console.log("\n=== Seeding portfolio assets ===");
  try {
    // Deploy mock ERC-20 tokens for on-chain demo assets.
    // External/fund assets (e.g. SPC) have no token address — address(0) is intentional.
    // On mainnet replace these with the real token contract addresses.
    const mockSKY   = await deployAndVerify(MockUSDC);   // SKY (on-chain DeFi token)
    const mockGFI   = await deployAndVerify(MockUSDC);   // Goldfinch GFI
    const mockSYRUP = await deployAndVerify(MockUSDC);   // Maple Finance SYRUP
    const mockDOT   = await deployAndVerify(MockUSDC);   // Polkadot (wrapped)
    const mockOUSG  = await deployAndVerify(MockUSDC);   // Ondo US Gov Bond (RWA)
    const mockWBTC  = await deployAndVerify(MockUSDC);   // Wrapped Bitcoin (external)

    // Enum ordinals must match PortfolioRegistry.sol
    // RiskClass: 0=WealthManagement 1=Stablecoin 2=DefiBluechip 3=FundOfFunds
    //            4=LargeCap 5=PrivateCreditFund 6=RealWorldAsset 7=ExternalProtocol
    // AssetRole: 0=Core 1=Liquidity 2=Satellite 3=Defensive 4=Speculative
    //            5=YieldFund 6=External
    // addAsset(symbol, name, token, oracle, riskClass, role)
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
    const seedAssets: Array<[string, string, string, string, number, number]> = [
      // [symbol,  name,                        token,           oracle,          riskClass, role]
      ["SPC",   "Sagitta SPC",                ZERO_ADDR,       ZERO_ADDR,       0, 0],  // WealthManagement / Core — external company, no token
      ["USDC",  "US Dollar Coin",             addr(usdc),      addr(oracleUsdc),1, 1],  // Stablecoin / Liquidity
      ["SKY",   "SKY",                        addr(mockSKY),   ZERO_ADDR,       2, 2],  // DefiBluechip / Satellite
      ["GFI",   "Goldfinch",                  addr(mockGFI),   ZERO_ADDR,       5, 5],  // PrivateCreditFund / YieldFund
      ["DOT",   "Polkadot",                   addr(mockDOT),   ZERO_ADDR,       4, 4],  // LargeCap / Speculative
      ["SYRUP", "Maple Finance",              addr(mockSYRUP), ZERO_ADDR,       5, 5],  // PrivateCreditFund / YieldFund
      ["OUSG",  "Ondo US Government Bond",    addr(mockOUSG),  ZERO_ADDR,       6, 3],  // RealWorldAsset / Defensive
      ["WBTC",  "Wrapped Bitcoin",            addr(mockWBTC),  ZERO_ADDR,       7, 6],  // ExternalProtocol / External
    ];

    for (const [symbol, name, token, oracle, riskClass, role] of seedAssets) {
      await (await (portfolioRegistry as any).addAsset(symbol, name, token, oracle, riskClass, role)).wait();
      console.log(`  Seeded ${symbol}${token === ZERO_ADDR ? ' (external, no token)' : ''}`);
    }
  } catch (e) {
    console.warn("Portfolio seeding failed (non-fatal):", e);
  }

  // ── Register all protocol addresses in ProtocolDAO ────────────────────────
  console.log("\n=== Registering addresses in ProtocolDAO ===");
  const daoKeys = [
    "Vault", "Treasury", "ReserveController", "InvestmentEscrow",
    "GoldOracle", "UsdcOracle", "ReceiptNFT", "AmmUSDCGOLD",
    "PortfolioRegistry", "MockUSDC", "MockGOLD",
  ];
  const daoAddrs = [
    addr(vault), addr(treasury), addr(reserve), addr(escrow),
    addr(oracleGold), addr(oracleUsdc), addr(receiptNft), addr(ammUSDCGOLD),
    addr(portfolioRegistry), addr(usdc), addr(gold),
  ];
  await (await (protocolDao as any).setAddresses(daoKeys, daoAddrs)).wait();
  console.log("ProtocolDAO registry populated with", daoKeys.length, "addresses");

  const deployments: Record<string, string | number | null> = {
    network: String(network.name),
    chainId,
    ProtocolDAO: addr(protocolDao),
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
    PortfolioRegistry: addr(portfolioRegistry),

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

  // Transfer ownership to designated owner if set
  const newOwner = OWNER_ADDRESS.trim();
  if (newOwner && newOwner !== deployer.address) {
    console.log("\n=== Transferring ownership to", newOwner, "===");
    const ownableAbi = ["function transferOwnership(address newOwner) external"];
    const ownables: [string, string][] = [
      ["Vault",             addr(vault)],
      ["Treasury",          addr(treasury)],
      ["ReserveController", addr(reserve)],
      ["InvestmentEscrow",  addr(escrow)],
      ["ReceiptNFT",        addr(receiptNft)],
      ["PortfolioRegistry", addr(portfolioRegistry)],
      ["ProtocolDAO",       addr(protocolDao)],
    ];
    for (const [name, contractAddr] of ownables) {
      try {
        const c = new ethers.Contract(contractAddr, ownableAbi, deployer);
        await (await c.transferOwnership(newOwner)).wait();
        console.log(`  ${name} -> ${newOwner} ✓`);
      } catch (e: any) {
        console.warn(`  ${name} transfer failed (non-fatal): ${e?.message ?? e}`);
      }
    }
  }

  console.log("\nDeployment complete");
  console.log("Demo account:", demoAddress);
  console.log("USDC minted to demo: 1000");
  console.log("IMPORTANT: localhost addresses reset when Hardhat node restarts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
