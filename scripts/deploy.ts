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
const LOCAL_TRANSFER_OWNERSHIP = process.env.LOCAL_TRANSFER_OWNERSHIP === "true";

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

function isLocalChainId(chainId: number): boolean {
  return chainId === 1337 || chainId === 31337;
}

function isLocalOrTestnetNetwork(chainId: number, networkName: string | null | undefined): boolean {
  if (isLocalChainId(chainId)) return true;
  if ([1287, 84532, 421614, 11155420, 5042002].includes(chainId)) return true;
  const normalized = String(networkName ?? "").toLowerCase();
  return normalized.includes("test") || normalized.includes("sepolia") || normalized.includes("moonbase") || normalized.includes("arc");
}

function normalizeDeploymentNetworkName(chainId: number, networkName: string | null | undefined): string {
  if (isLocalChainId(chainId)) return "local";
  const normalized = String(networkName ?? "").trim();
  return normalized || "unknown";
}

function deploymentChainKey(chainId: number, networkName: string | null | undefined): string {
  if (isLocalChainId(chainId)) return "localhost";
  if (chainId === 5042002) return "arc";
  const normalized = normalizeDeploymentNetworkName(chainId, networkName);
  if (normalized === "arc") return "arc";
  if (normalized === "baseSepolia") return "base-sepolia";
  if (normalized === "arbitrumSepolia") return "arbitrum-sepolia";
  if (normalized === "optimismSepolia") return "optimism-sepolia";
  return normalized;
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

function writeDeploymentsSnapshot(deployments: Record<string, string | number | null>) {
  const outFile = path.join(__dirname, "../deployments.json");
  fs.writeFileSync(outFile, `${JSON.stringify(deployments, null, 2)}\n`);
  console.log(`Saved deployments -> ${outFile}`);

  const chainId = Number(deployments.chainId);
  const networkName = normalizeDeploymentNetworkName(
    chainId,
    typeof deployments.network === "string" ? deployments.network : undefined
  );
  const chainKey = deploymentChainKey(chainId, typeof deployments.network === "string" ? deployments.network : undefined);
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const chainFile = path.join(deploymentsDir, `${chainKey}.json`);
  fs.writeFileSync(chainFile, `${JSON.stringify({ chainKey, ...deployments, network: networkName }, null, 2)}\n`);
  console.log(`Saved chain deployment -> ${chainFile}`);
  writeFrontendDeploymentArtifacts(deploymentsDir);
}

function writeFrontendDeploymentArtifacts(deploymentsDir: string) {
  const outFile = path.join(__dirname, "../frontend/src/lib/config/deployment-artifacts.ts");
  const artifacts: Record<string, any> = {};

  if (fs.existsSync(deploymentsDir)) {
    for (const fileName of fs.readdirSync(deploymentsDir)) {
      if (!fileName.endsWith(".json")) continue;
      const fullPath = path.join(deploymentsDir, fileName);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        const key = parsed.chainKey || path.basename(fileName, ".json");
        artifacts[key] = parsed;
      } catch (e) {
        console.warn(`Skipping malformed deployment artifact ${fullPath}`);
      }
    }
  }

  const content =
    `// AUTO-GENERATED MIRROR OF deployments/*.json FOR FRONTEND BUNDLING.\n` +
    `// Source of truth remains the root deployments/<chain-key>.json files.\n` +
    `export const DEPLOYMENT_ARTIFACTS = ${JSON.stringify(artifacts, null, 2)} as const;\n`;

  fs.writeFileSync(outFile, content);
  console.log(`Saved frontend deployment artifact mirror -> ${outFile}`);
}

function writeAddresses(deployments: Record<string, string | number | null>) {
  const chainId = Number(deployments.chainId);
  const isLocal = isLocalChainId(chainId);
  const networkName = normalizeDeploymentNetworkName(
    chainId,
    typeof deployments.network === "string" ? deployments.network : undefined
  );
  const chainKey = deploymentChainKey(chainId, networkName);

  // Non-local chains: only write the ProtocolDAO address.
  // All other addresses are fetched at runtime from the ProtocolDAO contract,
  // so they don't need to live in the repo.
  // Local chains: write all addresses (needed for the localStorage dev-override system).
  const payload = isLocal
    ? { chainKey, ...deployments, network: networkName }
    : {
        chainKey,
        network: networkName,
        chainId,
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
    const outFile = path.join(dir, `addresses.${networkName}.ts`);
    fs.writeFileSync(outFile, content);
    console.log(`Saved addresses -> ${outFile}`);
  }

  if (isLocal) {
    console.log(`\nSet this in frontend/.env.local for localhost:`);
    console.log(`  NEXT_PUBLIC_LOCALHOST_RPC_URL=http://127.0.0.1:8545`);
  } else {
    console.log(`\nDeployment artifact written to deployments/${chainKey}.json`);
    console.log(`Use NEXT_PUBLIC_PROTOCOL_DAO_OVERRIDE_${chainKey.toUpperCase().replace(/-/g, "_")}=... only for emergency frontend overrides.`);
  }
}

async function verifyProtocolDaoRegistry(
  protocolDao: any,
  entries: Array<[string, string]>
) {
  const [keys, addrs]: [string[], string[]] = await (protocolDao as any).getAllAddresses();
  const registry = new Map<string, string>();

  for (let i = 0; i < keys.length; i++) {
    registry.set(keys[i], addrs[i]);
  }

  for (const [key, expectedAddress] of entries) {
    const actual = registry.get(key);
    if (!actual || actual.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(
        `ProtocolDAO registry mismatch for ${key}: expected ${expectedAddress}, got ${actual ?? "missing"}`
      );
    }

    const code = await ethers.provider.getCode(actual);
    if (!code || code === "0x") {
      throw new Error(`ProtocolDAO registry entry ${key} has no bytecode at ${actual}`);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const metadataBaseUri = process.env.NFT_METADATA_BASE_URI || DEFAULT_METADATA_BASE_URI;
  if (!deployer) {
    throw new Error(
      `No deployer account configured for network "${hre.network.name}". ` +
        `Set DEPLOYER_PRIVATE_KEY, PRIVATE_KEY, or the network-specific deployer key in .env.`
    );
  }
  console.log("Deploying with:", deployer.address);

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("Network:", network.name, "Chain ID:", chainId);
  if (!isLocalChainId(chainId)) {
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

  const ExecutionRouteRegistry = await getFactorySafe("ExecutionRouteRegistry", "contracts/ExecutionRouteRegistry.sol:ExecutionRouteRegistry");
  const executionRouteRegistry = await deployAndVerify(ExecutionRouteRegistry);
  console.log("ExecutionRouteRegistry:", addr(executionRouteRegistry));

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

  try {
    if (typeof (escrow as any).setProtocolDAO === "function") {
      await (await (escrow as any).setProtocolDAO(addr(protocolDao))).wait();
      console.log("InvestmentEscrow linked to ProtocolDAO");
    }
  } catch (e) {
    console.warn("escrow.setProtocolDAO failed (non-fatal):", e);
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
  const isLocal = isLocalChainId(chainId);
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
    const ERC20Mock = await getFactorySafe("ERC20Mock", "contracts/mocks/ERC20Mock.sol:ERC20Mock");
    const mockSKY   = await deployAndVerify(MockUSDC);   // SKY (on-chain DeFi token)
    const mockGFI   = await deployAndVerify(MockUSDC);   // Goldfinch GFI
    const mockSYRUP = await deployAndVerify(MockUSDC);   // Maple Finance SYRUP
    const mockDOT   = await deployAndVerify(MockUSDC);   // Polkadot (wrapped)
    const mockOUSG  = await deployAndVerify(MockUSDC);   // Ondo US Gov Bond (RWA)
    const mockWBTC  = await deployAndVerify(MockUSDC);   // Wrapped Bitcoin (external)
    const mockPAXG  = await deployAndVerify(ERC20Mock, "Mock PAXG", "PAXG", 18); // PAXG purchase asset

    // Enum ordinals must match PortfolioRegistry.sol
    // RiskClass:       0=WealthManagement 1=Stablecoin 2=DefiBluechip 3=FundOfFunds
    //                  4=LargeCap 5=PrivateCreditFund 6=RealWorldAsset 7=ExternalProtocol
    // AssetRole:       0=Core 1=Liquidity 2=Satellite 3=Defensive 4=Speculative
    //                  5=YieldFund 6=External
    // DestinationType: 0=BatchWalletHold 1=StakingContract 2=InvestmentHandoff 3=Purchase
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
    const seedAssets: Array<[string, string, string, string, number, number, bigint]> = [
      // [symbol,  name,                     token,           oracle,           risk, role, minUsd6]
      ["SPC",   "Sagitta SPC",             ZERO_ADDR,       ZERO_ADDR,        0, 0, 0n],  // WealthManagement / Core
      ["USDC",  "US Dollar Coin",          addr(usdc),      addr(oracleUsdc), 1, 1, 0n],  // Stablecoin / Liquidity
      ["SKY",   "SKY",                     addr(mockSKY),   ZERO_ADDR,        2, 2, 0n],  // DefiBluechip / Satellite
      ["GFI",   "Goldfinch",               addr(mockGFI),   ZERO_ADDR,        5, 5, 0n],  // PrivateCreditFund / YieldFund
      ["DOT",   "Polkadot",                addr(mockDOT),   ZERO_ADDR,        4, 4, 0n],  // LargeCap / Speculative
      ["SYRUP", "Maple Finance",           addr(mockSYRUP), ZERO_ADDR,        5, 5, 0n],  // PrivateCreditFund / YieldFund
      ["OUSG",  "Ondo US Government Bond", addr(mockOUSG),  ZERO_ADDR,        6, 3, 0n],  // RealWorldAsset / Defensive
      ["PAXG",  "PAXG",                    addr(mockPAXG),  ZERO_ADDR,        6, 3, 0n],  // RealWorldAsset / Defensive
      ["WBTC",  "Wrapped Bitcoin",         addr(mockWBTC),  ZERO_ADDR,        7, 6, 0n],  // ExternalProtocol / External
    ];

    const addAssetWithoutDestination = (portfolioRegistry as any)["addAsset(string,string,address,address,uint8,uint8,uint256)"];
    const updateAssetWithDestination = (portfolioRegistry as any)["updateAsset(string,string,address,address,uint8,uint8,uint256,uint256)"];

    for (const [symbol, name, token, oracle, riskClass, role, minimumInvestmentUsd6] of seedAssets) {
      await (await addAssetWithoutDestination(symbol, name, token, oracle, riskClass, role, minimumInvestmentUsd6)).wait();
      console.log(`  Seeded ${symbol}${token === ZERO_ADDR ? ' (external, no token)' : ''}`);
    }

    if (isLocalOrTestnetNetwork(chainId, network.name)) {
      console.log("\n=== Seeding DAO approved destinations ===");
      const mockDestinationFactories = {
        usdc: await getFactorySafe("MockBlockdaemonUsdcDestination", "contracts/mocks/MockApprovedDestinations.sol:MockBlockdaemonUsdcDestination"),
        dot: await getFactorySafe("MockBlockdaemonDotStaking", "contracts/mocks/MockApprovedDestinations.sol:MockBlockdaemonDotStaking"),
        sky: await getFactorySafe("MockSkyDestination", "contracts/mocks/MockApprovedDestinations.sol:MockSkyDestination"),
        gfi: await getFactorySafe("MockGoldfinchDestination", "contracts/mocks/MockApprovedDestinations.sol:MockGoldfinchDestination"),
        syrup: await getFactorySafe("MockMapleSyrupDestination", "contracts/mocks/MockApprovedDestinations.sol:MockMapleSyrupDestination"),
        ousg: await getFactorySafe("MockOndoOusgDestination", "contracts/mocks/MockApprovedDestinations.sol:MockOndoOusgDestination"),
        paxg: await getFactorySafe("MockPaxgPurchaseAdapter", "contracts/mocks/MockApprovedDestinations.sol:MockPaxgPurchaseAdapter"),
      };
      const mockDestinations = {
        usdc: await deployAndVerify(mockDestinationFactories.usdc),
        dot: await deployAndVerify(mockDestinationFactories.dot),
        sky: await deployAndVerify(mockDestinationFactories.sky),
        gfi: await deployAndVerify(mockDestinationFactories.gfi),
        syrup: await deployAndVerify(mockDestinationFactories.syrup),
        ousg: await deployAndVerify(mockDestinationFactories.ousg),
        paxg: await deployAndVerify(mockDestinationFactories.paxg),
      };

      const assetBySymbol = new Map(seedAssets.map(([symbol, name, token, oracle, riskClass, role, minimumInvestmentUsd6]) => [
        symbol,
        { name, token, oracle, riskClass, role, minimumInvestmentUsd6 },
      ]));
      const destinationSeeds: Array<[string, string, string, number, string]> = [
        ["USDC",  "Blockdaemon USDC Route",    addr(usdc),      1, addr(mockDestinations.usdc)],
        ["DOT",   "Blockdaemon DOT Staking",   addr(mockDOT),   1, addr(mockDestinations.dot)],
        ["SKY",   "SKY Protocol Route",        addr(mockSKY),   2, addr(mockDestinations.sky)],
        ["GFI",   "Goldfinch Route",           addr(mockGFI),   2, addr(mockDestinations.gfi)],
        ["SYRUP", "Maple SYRUP Route",         addr(mockSYRUP), 2, addr(mockDestinations.syrup)],
        ["OUSG",  "Ondo OUSG Route",           addr(mockOUSG),  2, addr(mockDestinations.ousg)],
        ["PAXG",  "PAXG Purchase Then Hold",   addr(mockPAXG),  3, addr(mockDestinations.paxg)],
      ];

      for (const [symbol, destinationName, assetAddress, destinationType, destinationAddress] of destinationSeeds) {
        const destinationId = Number(await (portfolioRegistry as any).nextDestinationId());
        await (await (portfolioRegistry as any).addDestination(
          destinationName,
          symbol,
          assetAddress,
          destinationType,
          destinationAddress,
          true
        )).wait();

        const asset = assetBySymbol.get(symbol);
        if (!asset) throw new Error(`Seed asset missing for destination ${symbol}`);
        await (await updateAssetWithDestination(
          symbol,
          asset.name,
          asset.token,
          asset.oracle,
          asset.riskClass,
          asset.role,
          asset.minimumInvestmentUsd6,
          destinationId
        )).wait();
        console.log(`  ${symbol} -> destination #${destinationId} (${destinationName})`);
      }
    } else {
      console.log("Skipping mock approved destination seeding on non-test network.");
    }
  } catch (e) {
    console.warn("Portfolio seeding failed (non-fatal):", e);
  }

  // ── Register all protocol addresses in ProtocolDAO ────────────────────────
  console.log("\n=== Registering addresses in ProtocolDAO ===");
  const daoEntries: Array<[string, string]> = [
    ["ProtocolDAO", addr(protocolDao)],
    ["Vault", addr(vault)],
    ["Treasury", addr(treasury)],
    ["ReserveController", addr(reserve)],
    ["InvestmentEscrow", addr(escrow)],
    ["ExecutionRouteRegistry", addr(executionRouteRegistry)],
    ["GoldOracle", addr(oracleGold)],
    ["UsdcOracle", addr(oracleUsdc)],
    ["ReceiptNFT", addr(receiptNft)],
    ["AmmUSDCGOLD", addr(ammUSDCGOLD)],
    ["PortfolioRegistry", addr(portfolioRegistry)],
    ["MockUSDC", addr(usdc)],
    ["MockGOLD", addr(gold)],
  ];
  const daoKeys = daoEntries.map(([key]) => key);
  const daoAddrs = daoEntries.map(([, address]) => address);
  await (await (protocolDao as any).setAddresses(daoKeys, daoAddrs)).wait();
  await verifyProtocolDaoRegistry(protocolDao, daoEntries);
  console.log("ProtocolDAO registry populated with", daoKeys.length, "addresses");

  try {
    if (typeof (escrow as any).syncRouteRegistryFromDAO === "function") {
      await (await (escrow as any).syncRouteRegistryFromDAO()).wait();
      console.log("InvestmentEscrow route registry synced from ProtocolDAO");
    } else if (typeof (escrow as any).setRouteRegistry === "function") {
      await (await (escrow as any).setRouteRegistry(addr(executionRouteRegistry))).wait();
      console.log("InvestmentEscrow route registry set directly");
    }
  } catch (e) {
    console.warn("escrow route-registry linking failed (non-fatal):", e);
  }

  // ── Initialize role authorities on localhost ─────────────────────────────────
  // On live networks run `npm run init-roles` separately with real keys.
  // On localhost we use Hardhat accounts [1], [2], [3] as fallbacks so the
  // full signing pipeline works immediately after deploy with no extra steps.
  const HARDHAT_FALLBACK_KEYS: Record<string, string> = {
    TREASURY_SIGNER_PRIVATE_KEY:   '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    ESCROW_SIGNER_PRIVATE_KEY:     '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    CONTINUITY_SIGNER_PRIVATE_KEY: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  };

  function resolveRoleKey(envName: string): string {
    const val = (process.env[envName] ?? '').trim();
    if (val && val !== '0x...' && val.replace('0x', '').length === 64) {
      return val.startsWith('0x') ? val : `0x${val}`;
    }
    return HARDHAT_FALLBACK_KEYS[envName];
  }

  if (isLocalChainId(chainId)) {
    console.log("\n=== Initializing role authorities (localhost) ===");

    const treasuryKey   = resolveRoleKey('TREASURY_SIGNER_PRIVATE_KEY');
    const escrowKey     = resolveRoleKey('ESCROW_SIGNER_PRIVATE_KEY');
    const continuityKey = resolveRoleKey('CONTINUITY_SIGNER_PRIVATE_KEY');

    const treasuryWallet   = new ethers.Wallet(treasuryKey);
    const escrowWallet     = new ethers.Wallet(escrowKey);
    const continuityWallet = new ethers.Wallet(continuityKey);

    const roleAbi = [
      'function setRoleAuthority(uint8 roleId, address signer, uint8 status) external',
    ];
    const escrowOwned = new ethers.Contract(addr(escrow), roleAbi, deployer);

    const roleEntries = [
      { id: 0, label: 'ROLE_TREASURY_VAULT', wallet: treasuryWallet },
      { id: 1, label: 'ROLE_ESCROW',         wallet: escrowWallet },
      { id: 2, label: 'ROLE_CONTINUITY_SCE', wallet: continuityWallet },
    ];

    for (const role of roleEntries) {
      await (await escrowOwned.setRoleAuthority(role.id, role.wallet.address, 0)).wait();
      console.log(`  ${role.label} (${role.id}): ${role.wallet.address}`);
    }

    try {
      if (typeof (escrow as any).setKeeper === "function") {
        await (await (escrow as any).setKeeper(escrowWallet.address)).wait();
        console.log("  InvestmentEscrow keeper set to escrow signer:", escrowWallet.address);
      }
    } catch (e) {
      console.warn("escrow.setKeeper(escrow signer) failed (non-fatal):", e);
    }

    // Propagate signer addresses to frontend/.env.local
    const frontendEnvPath = path.join(__dirname, '../frontend/.env.local');
    function patchEnvLine(content: string, key: string, value: string): string {
      const re = new RegExp(`^${key}=.*$`, 'm');
      return re.test(content) ? content.replace(re, `${key}=${value}`) : `${content}\n${key}=${value}`;
    }
    let envContent = fs.existsSync(frontendEnvPath) ? fs.readFileSync(frontendEnvPath, 'utf8') : '';
    envContent = patchEnvLine(envContent, 'NEXT_PUBLIC_TREASURY_SIGNER_ADDRESS',   treasuryWallet.address);
    envContent = patchEnvLine(envContent, 'NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS',     escrowWallet.address);
    envContent = patchEnvLine(envContent, 'NEXT_PUBLIC_CONTINUITY_SIGNER_ADDRESS', continuityWallet.address);
    fs.writeFileSync(frontendEnvPath, envContent, 'utf8');
    console.log(`  Signer addresses written to frontend/.env.local`);

    // Write resolved SCE key back to root .env so it is not silently lost
    const rootEnvPath = path.join(__dirname, '../.env');
    let rootEnvContent = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, 'utf8') : '';
    rootEnvContent = patchEnvLine(rootEnvContent, 'CONTINUITY_SIGNER_PRIVATE_KEY', continuityKey);
    fs.writeFileSync(rootEnvPath, rootEnvContent, 'utf8');
    console.log(`  CONTINUITY_SIGNER_PRIVATE_KEY written to .env`);

    // Write signer service .env files
    const rpc = 'http://127.0.0.1:8545';
    const daoVersion = process.env.NEXT_PUBLIC_DAO_SYSTEM_REGISTRY_VERSION ?? 'v1.0.0-arc-testnet';

    function writeServiceEnv(filePath: string, vars: Record<string, string>) {
      const lines = ['# Auto-generated by deploy.ts — do not commit', ''];
      for (const [k, v] of Object.entries(vars)) lines.push(`${k}=${v}`);
      fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
    }

    writeServiceEnv(path.join(__dirname, '../services/signer-treasury/.env'), {
      TREASURY_SIGNER_PRIVATE_KEY:  treasuryKey,
      RPC_URL:                      rpc,
      CHAIN_ID:                     String(chainId),
      TREASURY_CONTRACT_ADDRESS:    addr(treasury),
      INVESTMENT_ESCROW_ADDRESS:    addr(escrow),
      VAULT_CONTRACT_ADDRESS:       addr(vault),
      DAO_SYSTEM_REGISTRY_VERSION:  daoVersion,
      PORT:                         '4001',
      CORS_ORIGIN:                  'http://localhost:3000',
    });
    console.log(`  services/signer-treasury/.env written`);

    writeServiceEnv(path.join(__dirname, '../services/signer-escrow/.env'), {
      ESCROW_SIGNER_PRIVATE_KEY:    escrowKey,
      RPC_URL:                      rpc,
      CHAIN_ID:                     String(chainId),
      TREASURY_CONTRACT_ADDRESS:    addr(treasury),
      INVESTMENT_ESCROW_ADDRESS:    addr(escrow),
      VAULT_CONTRACT_ADDRESS:       addr(vault),
      DAO_SYSTEM_REGISTRY_VERSION:  daoVersion,
      PORT:                         '4002',
      CORS_ORIGIN:                  'http://localhost:3000',
      WALLET_FACTORY_URL:           'http://localhost:4003',
    });
    console.log(`  services/signer-escrow/.env written`);

    // wallet-factory uses the continuity key to pay gas (already funded by Hardhat)
    writeServiceEnv(path.join(__dirname, '../services/wallet-factory/.env'), {
      WALLET_FACTORY_PRIVATE_KEY:   continuityKey,
      RPC_URL:                      rpc,
      CHAIN_ID:                     String(chainId),
      INVESTMENT_ESCROW_ADDRESS:    addr(escrow),
      PORT:                         '4003',
      CORS_ORIGIN:                  'http://localhost:3000',
    });
    console.log(`  services/wallet-factory/.env written`);

    // Propagate wallet-factory URL to frontend
    envContent = patchEnvLine(envContent, 'NEXT_PUBLIC_WALLET_FACTORY_URL', 'http://localhost:4003');
    fs.writeFileSync(frontendEnvPath, envContent, 'utf8');
    console.log(`  NEXT_PUBLIC_WALLET_FACTORY_URL written to frontend/.env.local`);
  }

  const deploymentNetworkName = normalizeDeploymentNetworkName(chainId, network.name);
  const deployments: Record<string, string | number | null> = {
    network: deploymentNetworkName,
    chainId,
    ProtocolDAO: addr(protocolDao),
    MockUSDC: addr(usdc),
    MockGOLD: addr(gold),
    Vault: addr(vault),
    Treasury: addr(treasury),
    ReserveController: addr(reserve),
    InvestmentEscrow: addr(escrow),
    ExecutionRouteRegistry: addr(executionRouteRegistry),
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

  writeDeploymentsSnapshot(deployments);
  writeAddresses(deployments);

  // Transfer ownership to designated owner if set
  const newOwner = OWNER_ADDRESS.trim();
  if (newOwner && newOwner !== deployer.address && (!isLocal || LOCAL_TRANSFER_OWNERSHIP)) {
    console.log("\n=== Transferring ownership to", newOwner, "===");
    const ownableAbi = ["function transferOwnership(address newOwner) external"];
    const ownables: [string, string][] = [
      ["Vault",             addr(vault)],
      ["Treasury",          addr(treasury)],
      ["ReserveController", addr(reserve)],
      ["InvestmentEscrow",  addr(escrow)],
      ["ExecutionRouteRegistry", addr(executionRouteRegistry)],
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
  } else if (newOwner && newOwner !== deployer.address && isLocal) {
    console.log("\n=== Skipping ownership transfer on local chain ===");
    console.log(`OWNER_ADDRESS=${newOwner} ignored for chain ${chainId}. Set LOCAL_TRANSFER_OWNERSHIP=true to enable local ownership transfer.`);
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
