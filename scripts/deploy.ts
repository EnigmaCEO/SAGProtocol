import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Add these lines for ESM __dirname support:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add helper to resolve ambiguous artifact names (tries plain name, then fully-qualified fallback)
async function getFactorySafe(name: string) {
  try {
    return await ethers.getContractFactory(name);
  } catch (err) {
    // try to find a fully-qualified name that ends with ":<Name>"
    // hre.artifacts.getAllFullyQualifiedNames() returns an array of "path:ContractName"
    const all = await hre.artifacts.getAllFullyQualifiedNames();
    const match = all.find((f: string) => f.endsWith(":" + name));
    if (!match) throw err;
    console.log(`getFactorySafe: resolving ${name} -> artifact ${match}`);
    return await ethers.getContractFactory(match);
  }
}

async function wait(d: any) {
  if (d.waitForDeployment) return d.waitForDeployment();
  if (d.deployed) return d.deployed();
}

function addr(d: any): string {
  return (d.target ?? d.address) as string;
}

async function verifyDeployed(address: string, name: string) {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`Deployment verification failed: ${name} not deployed at ${address}`);
  }
}

async function deployAndVerify(factory: any, ...args: any[]) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = addr(contract);
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    console.error(`❌ Deployment failed: No bytecode at ${address}`);
    process.exit(1);
  }
  return contract;
}

// Add helper: introspect constructor inputs and build deployment args
function getConstructorInputs(factory: any): any[] {
  // Try common spots for constructor fragment
  const iface = factory.interface ?? (factory as any).interface;
  const constructorFragment =
    (iface && (iface.deploy?.inputs ?? (iface.fragments ? iface.fragments.find((f: any) => f.type === "constructor")?.inputs : undefined))) ??
    [];
  return constructorFragment;
}

function buildArgsForConstructor(inputs: any[], ctx: Record<string, any>) {
  const ZERO = "0x0000000000000000000000000000000000000000";
  return inputs.map((inp: any) => {
    const t = (inp?.type ?? "").toLowerCase();
    const name = (inp?.name ?? "").toLowerCase();
    // prefer mapping by name to known deployed contracts
    if (t === "address") {
      if (name.includes("gold")) return addr(ctx.gold);
      if (name.includes("usdc") || name.includes("usd") || name.includes("stable")) return addr(ctx.usdc);
      if (name.includes("sag")) return addr(ctx.sag);
      if (name.includes("dot") || name.includes("mdot") || name.includes("dot")) return addr(ctx.mdot);
      if (name.includes("vault")) return addr(ctx.vault);
      if (name.includes("treasury")) return addr(ctx.treasury) ?? ZERO;
      if (name.includes("reserve")) return addr(ctx.reserve) ?? ZERO;
      if (name.includes("owner") || name.includes("admin") || name.includes("govern")) return ctx.deployer?.address ?? ZERO;
      // fallback to zero address
      return ZERO;
    }
    // numeric defaults
    if (t.startsWith("uint") || t.startsWith("int")) return 0;
    // bytes / other -> zero-like
    return ZERO;
  });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "Chain ID:", network.chainId.toString());
  
  if (Number(network.chainId) !== 1337 && Number(network.chainId) !== 31337) {
    console.warn("⚠️ Warning: Not deploying to localhost. Chain ID:", network.chainId.toString());
  }

  // 1) Core tokens
  console.log("\n=== Deploying MockUSDC ===");
  const MockUSDC = await getFactorySafe("MockUSDC");
  const usdc = await deployAndVerify(MockUSDC);
  console.log("MockUSDC:", addr(usdc));

  console.log("\n=== Deploying SAGToken ===");
  const SAGToken = await getFactorySafe("SAGToken");
  const sag = await deployAndVerify(SAGToken);
  console.log("SAGToken:", addr(sag));

  console.log("\n=== Deploying MockGOLD ===");
  const MockGOLD = await getFactorySafe("MockGOLD");
  const gold = await deployAndVerify(MockGOLD);
  console.log("MockGOLD:", addr(gold));

  console.log("\n=== Deploying MockDOT ===");
  const MockDOT = await getFactorySafe("MockDOT");
  const mdot = await deployAndVerify(MockDOT);
  const mdotDecimals = await mdot.decimals();
  if (Number(mdotDecimals) !== 6) {
    throw new Error(`MockDOT decimals must be 6, got ${mdotDecimals}`);
  }
  console.log("MockDOT:", addr(mdot));

  // 2) Core protocol contracts
  console.log("\n=== Deploying Vault ===");
  const Vault = await getFactorySafe("Vault");
  const vault = await deployAndVerify(Vault);
  console.log("Vault:", addr(vault));

  console.log("\n=== Deploying ReserveController ===");
  const ReserveController = await getFactorySafe("ReserveController");

  // Introspect constructor and attempt to build appropriate args
  const ctorInputs = getConstructorInputs(ReserveController);
  const ctx = { gold, usdc, sag, mdot, vault, // may be undefined for some entries but functions handle it
    deployer,
  };
  let reserve;
  try {
    const ctorArgs = buildArgsForConstructor(ctorInputs, ctx);
    console.log("ReserveController constructor signature:", ctorInputs.map((i: any) => `${i.type} ${i.name}`).join(", "));
    console.log("Attempting to deploy ReserveController with args:", ctorArgs);
    reserve = await deployAndVerify(ReserveController, ...ctorArgs);
  } catch (e) {
    console.warn("ReserveController deploy with inferred args failed:", e);
    console.log("Falling back to deploy without constructor args (if constructor accepts none).");
    try {
      reserve = await deployAndVerify(ReserveController);
    } catch (e2) {
      console.error("Final attempt to deploy ReserveController failed. Please inspect constructor and adjust script.", e2);
      process.exit(1);
    }
  }

  console.log("ReserveController:", addr(reserve));

  const MockOracle = await getFactorySafe("MockOracle");
  // Deploy three per-asset oracles (SAG, GOLD, DOT)
  const oracleGold = await deployAndVerify(MockOracle);
  const oracleSag = await deployAndVerify(MockOracle);
  const oracleDot = await deployAndVerify(MockOracle);

  console.log("\n=== Deploying Treasury ===");
  const Treasury = await getFactorySafe("Treasury");
  // Pass one oracle into constructor for backward compatibility (we'll set per-asset oracles below)
  const treasury = await deployAndVerify(
    Treasury,
    addr(sag),
    addr(usdc),
    addr(gold),
    addr(reserve),
    addr(vault),
    addr(oracleGold) // initial priceOracle (legacy); we will set sag/gold oracles explicitly
  );
  console.log("Treasury:", addr(treasury));

  // 3) Oracle
  console.log("\n=== Deploying MockOracle ===");
  
  // Set per-asset prices (8-decimals):
  // SAG = $0.75 -> 0.75 * 1e8 = 75_000_000
  await (await oracleSag.setPrice(BigInt("75000000"))).wait();
  console.log("MockOracle SAG:", addr(oracleSag), "price=75000000 (0.75 USD)");

  // GOLD = $4000 -> 4000 * 1e8 = 400_000_000_000
  await (await oracleGold.setPrice(BigInt("400000000000"))).wait();
  console.log("MockOracle GOLD:", addr(oracleGold), "price=400000000000 (4000 USD)");

  // DOT = $10 -> 10 * 1e8 = 1_000_000_000
  await (await oracleDot.setPrice(BigInt("1000000000"))).wait();
  console.log("MockOracle DOT:", addr(oracleDot), "price=1000000000 (10 USD)");

  console.log("\n=== Deploying Receipt NFT ===");
  const Receipt = await getFactorySafe("SagittaVaultReceipt");
  const receiptNft = await deployAndVerify(Receipt, "Sagitta Vault Receipt", "SVR");
  console.log("ReceiptNFT:", addr(receiptNft));

  // 4) AMM pools
  console.log("\n=== Deploying AMM Pairs ===");
  const Pair = await getFactorySafe("MockAmmPair");

  // Introspect constructor inputs for MockAmmPair and deploy with sensible token args.
  const pairCtorInputs = getConstructorInputs(Pair);
  console.log("MockAmmPair constructor signature:", pairCtorInputs.map((i: any) => `${i.type} ${i.name}`).join(", "));

  let ammSAGUSDC;
  try {
    let argsForSAGUSDC: any[] = [];
    // If constructor looks like (address, address) assume token0, token1
    if (
      pairCtorInputs.length === 2 &&
      pairCtorInputs.every((i: any) => (i.type ?? "").toLowerCase() === "address")
    ) {
      argsForSAGUSDC = [addr(sag), addr(usdc)];
    } else if (pairCtorInputs.length === 0) {
      argsForSAGUSDC = [];
    } else {
      argsForSAGUSDC = buildArgsForConstructor(pairCtorInputs, { sag, usdc, gold, mdot, vault, deployer });
    }
    console.log("Attempting to deploy AMM SAG/USDC with args:", argsForSAGUSDC);
    ammSAGUSDC = await deployAndVerify(Pair, ...argsForSAGUSDC);
  } catch (e) {
    console.warn("AMM SAG/USDC deploy with inferred args failed:", e);
    console.log("Falling back to deploy without constructor args (if supported).");
    ammSAGUSDC = await deployAndVerify(Pair);
  }
  console.log("AMM SAG/USDC:", addr(ammSAGUSDC));

  let ammUSDCGOLD;
  try {
    let argsForUSDCGOLD: any[] = [];
    if (
      pairCtorInputs.length === 2 &&
      pairCtorInputs.every((i: any) => (i.type ?? "").toLowerCase() === "address")
    ) {
      argsForUSDCGOLD = [addr(usdc), addr(gold)];
    } else if (pairCtorInputs.length === 0) {
      argsForUSDCGOLD = [];
    } else {
      argsForUSDCGOLD = buildArgsForConstructor(pairCtorInputs, { sag, usdc, gold, mdot, vault, deployer });
    }
    console.log("Attempting to deploy AMM USDC/GOLD with args:", argsForUSDCGOLD);
    ammUSDCGOLD = await deployAndVerify(Pair, ...argsForUSDCGOLD);
  } catch (e) {
    console.warn("AMM USDC/GOLD deploy with inferred args failed:", e);
    console.log("Falling back to deploy without constructor args (if supported).");
    ammUSDCGOLD = await deployAndVerify(Pair);
  }
  console.log("AMM USDC/GOLD:", addr(ammUSDCGOLD));

  // --- NEW: ensure Treasury.ammPair is set so adminCollateralize has an AMM to use ---
  try {
    const ammAddrToSet = addr(ammSAGUSDC);
    if (ammAddrToSet) {
      try {
        // call setAmmPair on Treasury (non-fatal)
        await (await treasury.setAmmPair(ammAddrToSet)).wait();
        console.log('treasury.setAmmPair ->', ammAddrToSet);
      } catch (e) {
        console.warn('treasury.setAmmPair failed (non-fatal):', String((e as any).message || e));
      }
    } else {
      console.log('No AmmSAGUSDC address available to set on Treasury; skipping setAmmPair');
    }
  } catch (e) {
    console.warn('Unexpected error while setting ammPair (non-fatal):', String((e as any).message || e));
  }

  // 5) Investment Escrow
  console.log("\n=== Deploying InvestmentEscrow ===");
  const InvestmentEscrow = await getFactorySafe("InvestmentEscrow");
  // constructor expects (address _usdc, address _treasury)
  const escrow = await deployAndVerify(InvestmentEscrow, addr(usdc), addr(treasury));
  console.log("InvestmentEscrow:", addr(escrow));

  // 6) Wire relationships
  console.log("\n=== Configuring contracts ===");
  // Wire Vault <-> Treasury where supported by the contracts' ABIs.
  // Some Vault builds intentionally removed setTreasury/treasury — skip if not present.
  try {
    if (typeof (vault as any).setTreasury === "function") {
      await (await (vault as any).setTreasury(addr(treasury))).wait();
      if (typeof (vault as any).treasury === "function") {
        const wiredTreasury = await (vault as any).treasury();
        if (wiredTreasury.toLowerCase() !== addr(treasury).toLowerCase()) {
          throw new Error(`Wiring failed: vault.treasury() = ${wiredTreasury}, expected ${addr(treasury)}`);
        }
      } else {
        console.log("vault.setTreasury called but vault.treasury() getter not present — skipping read verification");
      }
    } else {
      console.log("Vault contract has no setTreasury(), skipping Vault->Treasury wiring (intended for simplified Vault).");
    }
  } catch (e) {
    console.warn("Warning: vault <-> treasury wiring check failed or skipped:", e);
  }

  await (await treasury.setVault(addr(vault))).wait();
  const wiredVault = await treasury.vault();
  if (wiredVault.toLowerCase() !== addr(vault).toLowerCase()) {
    throw new Error(`Wiring failed: treasury.vault() = ${wiredVault}, expected ${addr(vault)}`);
  }
  // NEW: register escrow with Treasury and Vault so collateral flows and batch funding work
  try {
    await (await treasury.setEscrow(addr(escrow))).wait();
    console.log("Wired Treasury.escrow ->", addr(escrow));
  } catch (e) {
    console.warn("Failed to set Treasury.escrow:", e);
  }
  try {
    // Vault has setEscrow(owner) — make Vault aware of Escrow for registration calls
    if ("setEscrow" in vault) {
      await (await vault.setEscrow(addr(escrow))).wait();
      console.log("Wired Vault.escrow ->", addr(escrow));
    }
  } catch (e) {
    console.warn("Failed to set Vault.escrow:", e);
  }
  try {
    // Tell Escrow where the Vault is (so registerDeposit calls from Vault work)
    if ("setVault" in escrow) {
      await (await escrow.setVault(addr(vault))).wait();
      console.log("Wired Escrow.vault ->", addr(vault));
    }
  } catch (e) {
    console.warn("Failed to set Escrow.vault:", e);
  }

  // Reserve controller wiring: Treasury exposes setReserveAddress(...)
  await (await treasury.setReserveAddress(addr(reserve))).wait();
  const wiredReserve = await treasury.reserveAddress();
  if (wiredReserve.toLowerCase() !== addr(reserve).toLowerCase()) {
    throw new Error(`Wiring failed: treasury.reserveAddress() = ${wiredReserve}, expected ${addr(reserve)}`);
  }
  console.log("Wired Vault <-> Treasury <-> ReserveController");

  // Wire receipt NFT
      try {
        const vaultAddr = addr(vault);
        // Prefer setMinter if present, fallback to AccessControl's MINTER_ROLE
        if ("setMinter" in (receiptNft as any)) {
          await (await (receiptNft as any).setMinter(vaultAddr)).wait();
        } else if ("grantRole" in (receiptNft as any)) {
          let minterRole: string | undefined;
          try {
            const role = (receiptNft as any).MINTER_ROLE;
            minterRole = typeof role === "function" ? await role() : role;
          } catch (_) {}
          if (minterRole) {
            await (await (receiptNft as any).grantRole(minterRole, vaultAddr)).wait();
          } else {
            console.log("MINTER_ROLE not found on Receipt NFT, skipping minter grant");
          }
        } else {
          console.log("Receipt NFT has no setMinter/grantRole, skipping minter wiring");
        }
        if ("setReceiptNFT" in (vault as any)) {
          await (await (vault as any).setReceiptNFT(addr(receiptNft))).wait();
        } else if ("setReceiptToken" in (vault as any)) {
          await (await (vault as any).setReceiptToken(addr(receiptNft))).wait();
        } else {
          console.log("Vault has no setReceiptNFT/setReceiptToken, skipping receipt NFT wiring");
        }
      } catch (e) { console.log("Skip wiring receipt NFT:", e); }

  // Enable SAGToken on Vault with its decimals and the MockOracle
  try {
    const sagDecimals = await sag.decimals();
    await (await vault.setAsset(addr(sag), true, Number(sagDecimals), addr(oracleSag))).wait();
    // Optional: shorten lock duration for local testing (e.g., 5 minutes)
    try { await (await vault.setLockDuration(60 * 5)).wait(); } catch (_) {}
    console.log("Vault asset configured:", { asset: addr(sag), decimals: sagDecimals.toString(), oracle: addr(oracleSag) });
  } catch (e) {
    console.log("Skip vault.setAsset:", e);
  }

  // Enable MockDOT on Vault with its decimals and the MockOracle
  try {
    const mdotDecimals = await mdot.decimals();
    // Make sure 'oracle' here is the correct MockOracle address
    await (await vault.setAsset(addr(mdot), true, Number(mdotDecimals), addr(oracleDot))).wait();
    // Set 12 months lock (MVP)
    try { await (await vault.setLockDuration(365 * 24 * 60 * 60)).wait(); } catch (_) {}
    console.log("Vault asset configured:", { asset: addr(mdot), decimals: mdotDecimals.toString(), oracle: addr(oracleDot) });
  } catch (e) {
    console.log("Skip vault.setAsset:", e);
  }

  // Wire Treasury to use per-asset oracles (requires Treasury.setSagOracle/setGoldOracle implemented)
  try {
    await (await treasury.setSagOracle(addr(oracleSag))).wait();
    await (await treasury.setGoldOracle(addr(oracleGold))).wait();
    console.log("Treasury sagOracle ->", addr(oracleSag), "goldOracle ->", addr(oracleGold));
  } catch (e) {
    console.log("Failed to set per-asset oracles on Treasury:", e);
  }

  // 6) Mint initial tokens

  // Mint 1M USD worth of SAG to the Treasury using the Oracle price of 0.75 per SAG to calculate
  console.log("\n=== Minting initial SAG to Treasury ===");
  const sagDecimalsRaw = await sag.decimals();
  const sagDecimalsNum = Number(sagDecimalsRaw);
  const sagPriceRaw = await oracleSag.getPrice();
  const sagPriceBig = BigInt(sagPriceRaw.toString());
  const ONE_MILLION_USD = 1_000_000n;
  const sagToMint = (ONE_MILLION_USD * (10n ** BigInt(8 + sagDecimalsNum))) / sagPriceBig;
  try {
    await (await sag.mint(addr(treasury), sagToMint)).wait();
    console.log(`Minted ${sagToMint.toString()} SAG to Treasury:`, addr(treasury));
  } catch (e) {
    console.log("Failed to mint SAG to Treasury:", e);
  }
  
  // Mint 500k USD worth of GOLD to the ReserveController using the Oracle price of $4000 per GOLD to calculate
  console.log("\n=== Minting initial GOLD to ReserveController ===");
  const goldDecimalsRaw = await gold.decimals();
  const goldDecimalsNum = Number(goldDecimalsRaw);
  const goldPriceRaw = await oracleGold.getPrice();
  const goldPriceBig = BigInt(goldPriceRaw.toString());
  const FIVE_HUNDRED_K_USD = 500_000n;
  const goldToMint = (FIVE_HUNDRED_K_USD * (10n ** BigInt(8 + goldDecimalsNum))) / goldPriceBig;
  try {
    await (await gold.mint(addr(reserve), goldToMint)).wait();
    console.log(`Minted ${goldToMint.toString()} GOLD to ReserveController:`, addr(reserve));
  } catch (e) {
    console.log("Failed to mint GOLD to ReserveController:", e);
  }

  // Post-mint snapshot
  try {
    const usdcT = await usdc.balanceOf(addr(treasury));
    const usdcA = ammSAGUSDC ? await usdc.balanceOf(ammSAGUSDC) : null;
    const sagT = await sag.balanceOf(addr(treasury));
    const sagA = ammSAGUSDC ? await sag.balanceOf(ammSAGUSDC) : null;
    console.log('Post-mint snapshot:');
    console.log('  Treasury USDC:', usdcT.toString(), 'AMM USDC:', usdcA ? usdcA.toString() : 'N/A');
    console.log('  Treasury SAG:', sagT.toString(), 'AMM SAG:', sagA ? sagA.toString() : 'N/A');
  } catch (e) { /* ignore */ }

  // === NEW: Mint additional AMM liquidity directly into pair contracts (best-effort) ===
  // Do not change address lookup behaviour — use existing amm addresses (ammSAGUSDC / ammUSDCGOLD).
  try {
    // amounts to seed AMMs with (USD totals)
    const AMM_SAG_USD = 1_000_000n; // $1,000,000 to SAG/USDC pair
    const AMM_USDCGOLD_USD = 500_000n; // $500,000 to USDC/GOLD pair

    // Amm addresses (inferred earlier in script)
    const ammSAGAddr = addr(ammSAGUSDC);
    const ammUSDCGoldAddr = addr(ammUSDCGOLD);

    // Mint to AmmSAGUSDC: USDC (6d) and SAG (18d) computed via saga oracle
    if (ammSAGAddr) {
      try {
        const usdcToAmm = AMM_SAG_USD * 10n ** 6n; // USD6 -> USDC base
        if (typeof usdc.mint === 'function') {
          console.log('Minting', usdcToAmm.toString(), 'USDC to AmmSAGUSDC', ammSAGAddr);
          await (await usdc.mint(ammSAGAddr, usdcToAmm)).wait();
        } else {
          console.warn('MockUSDC.mint not available; skipping AMM USDC mint for AmmSAGUSDC');
        }

        // compute SAG amount using sag oracle (token wei = neededUsd6 * 1e20 / price8)
        let sagPrice8 = BigInt(await oracleSag.getPrice());
        if (sagPrice8 > 0n && typeof sag.mint === 'function') {
          const neededUsd6 = AMM_SAG_USD * 10n ** 6n;
          const sagWei = (neededUsd6 * 10n ** 20n + sagPrice8 - 1n) / sagPrice8;
          console.log('Minting', sagWei.toString(), 'SAG wei to AmmSAGUSDC', ammSAGAddr);
          await (await sag.mint(ammSAGAddr, sagWei)).wait();
        } else {
          console.warn('SAG oracle missing or SAG.mint not available; skipping AMM SAG mint for AmmSAGUSDC');
        }
      } catch (e) {
        console.warn('AMM SAG/USDC minting failed (non-fatal):', e);
      }
    } else {
      console.log('AmmSAGUSDC address not found; skipping AMM seeding for SAG/USDC pair.');
    }

    // Mint to AmmUSDCGOLD: USDC (6d) and GOLD (18d) computed via gold oracle
    if (ammUSDCGoldAddr) {
      try {
        const usdcToAmm2 = AMM_USDCGOLD_USD * 10n ** 6n;
        if (typeof usdc.mint === 'function') {
          console.log('Minting', usdcToAmm2.toString(), 'USDC to AmmUSDCGOLD', ammUSDCGoldAddr);
          await (await usdc.mint(ammUSDCGoldAddr, usdcToAmm2)).wait();
        } else {
          console.warn('MockUSDC.mint not available; skipping AMM USDC mint for AmmUSDCGOLD');
        }

        // compute GOLD amount using gold oracle (token wei = neededUsd6 * 1e20 / price8)
        let goldPrice8 = BigInt(await oracleGold.getPrice());
        if (goldPrice8 > 0n && typeof gold.mint === 'function') {
          const neededUsd6_2 = AMM_USDCGOLD_USD * 10n ** 6n;
          const goldWei = (neededUsd6_2 * 10n ** 20n + goldPrice8 - 1n) / goldPrice8;
          console.log('Minting', goldWei.toString(), 'GOLD wei to AmmUSDCGOLD', ammUSDCGoldAddr);
          await (await gold.mint(ammUSDCGoldAddr, goldWei)).wait();
        } else {
          console.warn('Gold oracle missing or GOLD.mint not available; skipping AMM GOLD mint for AmmUSDCGOLD');
        }
      } catch (e) {
        console.warn('AMM USDC/GOLD minting failed (non-fatal):', e);
      }
    } else {
      console.log('AmmUSDCGOLD address not found; skipping AMM seeding for USDC/GOLD pair.');
    }
  } catch (e) {
    console.warn('AMM seeding block failed (non-fatal):', e);
  }

  // === NEW: Ensure AMM pairs update internal reserves (call sync() or mint fallback) ===
  try {
    // Try to call sync() on pairs, or mint(owner) as fallback if implemented.
    const trySyncPair = async (pairAddr: string | null, name: string) => {
      if (!pairAddr) return console.log(`${name} address missing; skipping sync`);
      try {
        const pair = await ethers.getContractAt("MockAmmPair", pairAddr);
        if (typeof (pair as any).sync === "function") {
          console.log(`Calling sync() on ${name} (${pairAddr})`);
          await (await (pair as any).sync()).wait();
          console.log(`sync() succeeded on ${name}`);
        } else if (typeof (pair as any).mint === "function") {
          console.log(`sync() not present; calling mint(owner) on ${name} (${pairAddr})`);
          await (await (pair as any).mint(deployer.address)).wait();
          console.log(`mint(owner) succeeded on ${name}`);
        } else {
          console.log(`${name} has neither sync() nor mint(); manual action may be required.`);
        }
      } catch (e) {
        console.warn(`Failed to call sync/mint on ${name} (${pairAddr}):`, e);
      }
    };

    await trySyncPair(addr(ammSAGUSDC), "AmmSAGUSDC");
    await trySyncPair(addr(ammUSDCGOLD), "AmmUSDCGOLD");
  } catch (e) {
    console.warn('AMM sync step failed (non-fatal):', e);
  }

  // 6.5) Fund demo account
  console.log("\n=== Funding demo account ===");
  const demoAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat account #0
  const fundAmount = BigInt("1000000000"); // 1000 USDC (6 decimals)
  try {
    await (await usdc.mint(demoAddress, fundAmount)).wait();
    console.log(`Minted 1000 USDC to demo account:`, demoAddress);
  } catch (e) {
    console.log("Failed to fund demo account USDC:", e);
  }

  // Fund demo with SAGToken for deposits
  try {
    const sagDecimalsForDemo = Number(await sag.decimals());
    // 100,000 SAG expressed with token decimals
    const sagToDemo = 100_000n * (10n ** BigInt(sagDecimalsForDemo));
    // mint(address,uint256) if available
    if ("mint" in sag) {
      await (await sag.mint(demoAddress, sagToDemo)).wait();
      console.log(`Minted 100000 SAG to demo account`);
    } else {
      console.log("SAGToken.mint not available, skip funding demo SAG");
    }
  } catch (e) {
    console.log("Failed to fund demo account SAG:", e);
  }

  // Fund demo with MockDOT for deposits
  try {
    const mdotDecimals = await mdot.decimals();
    // Mint 1000 mDOT (or more) for testing
    const mdotToDemo = BigInt("1000") * BigInt(10) ** BigInt(mdotDecimals); // 1000 mDOT
    await (await mdot.mint(demoAddress, mdotToDemo)).wait();
    console.log(`Minted 1000 mDOT to demo account`);
  } catch (e) {
    console.log("Failed to fund demo account mDOT:", e);
  }

  // Fund demo account with ETH for gas
  console.log("\n=== Funding demo account with ETH ===");
  try {
    // Send 10 ETH to demo account for testing
    await deployer.sendTransaction({
      to: demoAddress,
      value: ethers.parseEther("10.0"),
    });
    console.log(`Sent 10 ETH to demo account: ${demoAddress}`);
  } catch (e) {
    console.log("Failed to fund demo account with ETH:", e);
  }

  // 7) Write deployment info
  const deployments = {
    network: "localhost",
    chainId: 1337,
    SAGToken: addr(sag),
    MockUSDC: addr(usdc),
    MockGOLD: addr(gold),
    MockDOT: addr(mdot),
    Vault: addr(vault),
    Treasury: addr(treasury),
    ReserveController: addr(reserve),
    InvestmentEscrow: addr(escrow),
    GoldOracle: addr(oracleGold),
    SagOracle: addr(oracleSag),
    DotOracle: addr(oracleDot),
    ReceiptNFT: addr(receiptNft),
    AmmSAGUSDC: addr(ammSAGUSDC),
    AmmUSDCGOLD: addr(ammUSDCGOLD),
  };

  // --- Verification step ---
  for (const [name, address] of Object.entries(deployments)) {
    if (typeof address === "string" && address.startsWith("0x") && address.length === 42) {
      const code = await ethers.provider.getCode(address);
      if (!code || code === "0x") {
        console.error(`❌ Verification failed: ${name} not deployed at ${address}`);
        process.exit(1);
      }
    }
  }

  const content =
`// AUTO-GENERATED. DO NOT EDIT.
export const CONTRACT_ADDRESSES = ${JSON.stringify(deployments, null, 2)} as const;
`;
  
  // Also write to frontend if it exists
  const frontendDir = path.join(__dirname, "../frontend/src/lib");
  if (fs.existsSync(frontendDir)) {
    fs.writeFileSync(path.join(frontendDir, "addresses.ts"), content);
  }

  console.log("\n✅ Deployment complete");
  console.log("📝 Saved to src/lib/addresses.ts");
  console.log("\n🎮 Demo Account:", demoAddress);
  console.log("💰 USDC Balance: 1000");
  console.log("\n⚠️ IMPORTANT: If using Hardhat node, these addresses are only valid for this session.");
  console.log("Restart Hardhat node = need to redeploy!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
