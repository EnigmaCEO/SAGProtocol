import React, { useState, useEffect } from 'react';
import IERC20ABI from './abis/IERC20ABI.json'; // Adjust the path to the actual location of the IERC20 ABI file
import VaultABI from './abis/VaultABI.json'; // Adjust the path to the actual location of the Vault ABI file
import { ethers, BrowserProvider, Contract } from 'ethers';
import { CONTRACT_ADDRESSES } from './lib/addresses';

function App() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [vault, setVault] = useState<Contract | null>(null);
  const [usdc, setUsdc] = useState<Contract | null>(null);
  const [sag, setSag] = useState<Contract | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<string>('—');

  useEffect(() => {
    const loadContracts = async () => {
      if (!provider) return;

      try {
        const vaultContract = new Contract(CONTRACT_ADDRESSES.Vault, VaultABI, provider);
        const usdcContract = new Contract(CONTRACT_ADDRESSES.MockUSDC, IERC20ABI, provider);
        const sagContract = new Contract(CONTRACT_ADDRESSES.SAGToken, IERC20ABI, provider);

        setVault(vaultContract);
        setUsdc(usdcContract);
        setSag(sagContract);
      } catch (error) {
        console.error('Error loading contracts:', error);
      }
    };

    loadContracts();
  }, [provider]);

  const fetchBalances = async () => {
    if (!vault || !usdc || !sag || !account || !provider) return;

    try {
      const treasuryBalance = await usdc.balanceOf(CONTRACT_ADDRESSES.Treasury);
      const treasuryUSDC = parseFloat(ethers.formatUnits(treasuryBalance, 6));

      let reserveUSD = 0;

      // If GOLD contract exists, get reserve balance and convert to USD
      if (CONTRACT_ADDRESSES.MockGOLD && (CONTRACT_ADDRESSES.MockGOLD as string) !== '0x0000000000000000000000000000000000000000') {
        try {
          const goldContract = new Contract(CONTRACT_ADDRESSES.MockGOLD, IERC20ABI, provider);
          const reserveGoldBalance = await goldContract.balanceOf(CONTRACT_ADDRESSES.ReserveController);
          const reserveGold = parseFloat(ethers.formatUnits(reserveGoldBalance, 18));

          // TODO: Get gold price from oracle when available
          // reserveUSD = reserveGold * goldPrice;
        } catch (error) {
          console.error('Error fetching reserve gold balance:', error);
        }
      }

      const vaultPrincipal = 0; // TODO: Get vault principal from contract

      // Calculate coverage with 90% haircut on reserve
      const HAIRCUT = 0.9;
      const numerator = treasuryUSDC + (HAIRCUT * reserveUSD);

      if (vaultPrincipal > 0 && (treasuryUSDC > 0 || reserveUSD > 0)) {
        const coverageRatio = (numerator / vaultPrincipal) * 100;
        setCoverage(`${coverageRatio.toFixed(2)}%`);
      } else {
        setCoverage('—');
      }
    } catch (error) {
      console.error('Error fetching balances:', error);
      setCoverage('—');
    }
  };

  return (
    <div className="App">
      <div className="metric">
        <span>Coverage:</span>
        <span>{coverage}</span>
      </div>
    </div>
  );
}

export default App;
