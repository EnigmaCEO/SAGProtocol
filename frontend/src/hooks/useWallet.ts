import { useState, useEffect } from "react";
import { ethers } from "ethers";

declare global {
    interface Window {
        ethereum?: any;
    }
}

export const useWallet = () => {
    const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
    const [account, setAccount] = useState<string | null>(null);

    useEffect(() => {
        if (window.ethereum) {
            const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
            setProvider(web3Provider);
        }
    }, []);

    const connectWallet = async () => {
        if (provider) {
            const accounts = await provider.send("eth_requestAccounts", []);
            setAccount(accounts[0]);
        }
    };

    return { provider, account, connectWallet };
};
