import { useState, useEffect } from "react";
import { ethers } from "ethers";

declare global {
    interface Window {
        ethereum?: any;
    }
}

export const useWallet = () => {
    // provider will represent the injected provider (only set after user connects)
    const [provider, setProvider] = useState<any | null>(null);
    const [account, setAccount] = useState<string | null>(null);

    useEffect(() => {
        // keep lightweight: do not create injected provider or request accounts on mount
        // but if a wallet is already connected and exposes selectedAddress, capture it
        const eth = (window as any).ethereum;
        if (!eth) return;
        const selected = eth.selectedAddress ?? eth._selectedAddress ?? null;
        if (selected) setAccount(String(selected));
        // don't instantiate ethers providers here to avoid Web3Provider undefined errors
    }, []);

    const connectWallet = async () => {
        const eth = (window as any).ethereum;
        if (!eth) return null;

        // user-initiated account request (works across wallets)
        let accounts: string[] | null = null;
        try {
            if (typeof eth.request === 'function') {
                accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
            } else if (typeof eth.requestAccounts === 'function') {
                // legacy fallback
                accounts = (await eth.requestAccounts()) as string[];
            } else if (typeof eth.send === 'function') {
                accounts = (await eth.send('eth_requestAccounts')) as string[];
            }
        } catch (err) {
            console.warn('connectWallet request failed', err);
        }

        if (!Array.isArray(accounts) || accounts.length === 0) return null;

        // create injected ethers provider compatibly (v5 Web3Provider or v6 BrowserProvider)
        let p: any = null;
        try {
            // detect constructors first (avoid optional-chaining on `new`)
            const Web3ProviderCtor = (ethers as any).providers && (ethers as any).providers.Web3Provider
                ? (ethers as any).providers.Web3Provider
                : undefined;
            const BrowserProviderCtor = (ethers as any).BrowserProvider;

            if (Web3ProviderCtor) {
                p = new Web3ProviderCtor(eth);
            } else if (BrowserProviderCtor) {
                p = new BrowserProviderCtor(eth);
            } else {
                p = null;
            }
        } catch (err) {
            console.warn('failed to construct injected provider', err);
            p = null;
        }

        setProvider(p);
        setAccount(accounts[0]);
        return accounts[0];
    };

    return { provider, account, connectWallet };
};
