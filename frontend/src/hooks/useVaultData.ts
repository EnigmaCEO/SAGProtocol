import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getContracts, getSigner, bpsToPct } from "../lib/ethers";
import * as addresses from "../lib/addresses";

export interface VaultState {
  userAddress: string;
  usdcBalance: string;
  sagBalance: string;
  depositedUsd: string;
  receipts: any[];
  credits: any[];
  paused: boolean;
  principal: string;
  reserveUsd: string;
  treasuryUsd: string;
  coverage: number;
}

export function useVaultData() {
  const [state, setState] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const signer = await getSigner();
      if (!signer) {
        console.warn("No signer available");
        setLoading(false);
        return;
      }

      const userAddress = await signer.getAddress().catch(() => {
        console.warn("Failed to get user address");
        return "";
      });

      if (!userAddress) {
        setLoading(false);
        return;
      }

      const { vault, usdc, reserve } = await getContracts();

      // Verify contracts are deployed
      const provider = signer.provider;
      if (!provider) {
        console.warn("Provider not available");
        setLoading(false);
        return;
      }

      const network = await provider.getNetwork();
      const expectedChainId = 1337; // localhost/hardhat
      
      console.warn("Connected to network:", {
        chainId: network.chainId.toString(),
        name: network.name,
        expected: expectedChainId,
      });

      if (Number(network.chainId) !== expectedChainId) {
        console.warn(`⚠️ Wrong network! Connected to chain ${network.chainId} (${network.name}) but contracts are deployed to localhost (chain ${expectedChainId}). Please switch your wallet to localhost.`);
        setError(`Wrong network: Connected to ${network.name}. Please switch to localhost.`);
        setLoading(false);
        return;
      }

      console.warn("Checking contract deployments:", {
        Vault: addresses.CONTRACT_ADDRESSES.Vault,
        MockUSDC: addresses.CONTRACT_ADDRESSES.MockUSDC,
        Treasury: addresses.CONTRACT_ADDRESSES.Treasury,
      });

      const [vaultCode, usdcCode] = await Promise.all([
        provider.getCode(addresses.CONTRACT_ADDRESSES.Vault).catch((err) => {
          console.warn("Failed to get Vault code:", err);
          return "0x";
        }),
        provider.getCode(addresses.CONTRACT_ADDRESSES.MockUSDC).catch((err) => {
          console.warn("Failed to get USDC code:", err);
          return "0x";
        }),
      ]);

      console.warn("Contract bytecode lengths:", {
        Vault: vaultCode.length,
        MockUSDC: usdcCode.length,
      });

      if (vaultCode === "0x") {
        console.warn(`Vault contract not deployed at configured address: ${addresses.CONTRACT_ADDRESSES.Vault}`);
        setLoading(false);
        return;
      }
      if (usdcCode === "0x") {
        console.warn(`USDC contract not deployed at configured address: ${addresses.CONTRACT_ADDRESSES.MockUSDC}`);
        setLoading(false);
        return;
      }

      const [
        usdcBal,
        sagBal,
        depositedUsd,
        receiptCount,
        creditCount,
        paused,
        principal,
        treasuryUsdBal,
      ] = await Promise.all([
        usdc.balanceOf(userAddress).catch(() => BigInt(0)),
        vault.balanceOf(userAddress).catch(() => BigInt(0)),
        vault.depositedUsd ? vault.depositedUsd(userAddress).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
        vault.receiptCount(userAddress).catch(() => BigInt(0)),
        vault.creditCount(userAddress).catch(() => BigInt(0)),
        vault.paused().catch(() => false),
        usdc.balanceOf(addresses.CONTRACT_ADDRESSES.Vault).catch(() => BigInt(0)),
        usdc.balanceOf(addresses.CONTRACT_ADDRESSES.Treasury).catch(() => BigInt(0)),
      ]);

      // Fetch receipts
      const receipts = [];
      for (let i = 0; i < Number(receiptCount); i++) {
        try {
          const r = await vault.receipts(userAddress, i);
          receipts.push({
            amountUsd: ethers.formatUnits(r.amountUsd, 6),
            timestamp: Number(r.timestamp),
            redeemed: r.redeemed,
          });
        } catch (err) {
          console.warn(`Failed to fetch receipt ${i}:`, err);
        }
      }

      // Fetch credits
      const credits = [];
      for (let i = 0; i < Number(creditCount); i++) {
        try {
          const c = await vault.credits(userAddress, i);
          credits.push({
            amountUsd: ethers.formatUnits(c.amountUsd, 6),
            unlockAt: Number(c.unlockAt),
            claimed: c.claimed,
          });
        } catch (err) {
          console.warn(`Failed to fetch credit ${i}:`, err);
        }
      }

      // Get reserve NAV
      let reserveUsd = "0";
      try {
        // Check if reserve contract is deployed
        const reserveCode = await provider.getCode(addresses.CONTRACT_ADDRESSES.ReserveController);
        if (reserveCode !== "0x") {
          const navReserve = await reserve.navReserveUsd();
          reserveUsd = ethers.formatUnits(navReserve, 6);
        } else {
          console.warn("ReserveController not deployed, using 0 for reserve USD");
        }
      } catch (err) {
        console.warn("Failed to fetch reserve NAV:", err);
        reserveUsd = "0";
      }

      // Calculate coverage
      const principalNum = parseFloat(ethers.formatUnits(principal, 6));
      const reserveNum = parseFloat(reserveUsd);
      const treasuryNum = parseFloat(ethers.formatUnits(treasuryUsdBal, 6));
      const haircut = 0.9;
      const coverage = principalNum > 0 
        ? ((treasuryNum + haircut * reserveNum) / principalNum) * 100 
        : 0;

      setState({
        userAddress,
        usdcBalance: ethers.formatUnits(usdcBal, 6),
        sagBalance: ethers.formatUnits(sagBal, 18),
        depositedUsd: ethers.formatUnits(depositedUsd, 6),
        receipts,
        credits,
        paused,
        principal: ethers.formatUnits(principal, 6),
        reserveUsd,
        treasuryUsd: ethers.formatUnits(treasuryUsdBal, 6),
        coverage,
      });
    } catch (err: any) {
      console.warn("Failed to load vault data:", err);
      setError(err.message || "Failed to load vault data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { state, loading, error, reload: load };
}
