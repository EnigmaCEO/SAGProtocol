import { useState, useEffect } from "react";
import { ethers } from "ethers";

declare global {
    interface Window {
        ethereum?: any;
    }
}

const WALLET_STORAGE_KEY = 'sagitta.connectedAccount';

function readPersistedAccount(): string | null {
    try {
        return typeof window !== 'undefined'
            ? window.localStorage.getItem(WALLET_STORAGE_KEY)
            : null;
    } catch { return null; }
}

function persistAccount(address: string | null): void {
    try {
        if (address) {
            window.localStorage.setItem(WALLET_STORAGE_KEY, address);
        } else {
            window.localStorage.removeItem(WALLET_STORAGE_KEY);
        }
    } catch { /* ignore */ }
}

export const useWallet = () => {
    // provider will represent the injected provider (only set after user connects)
    const [provider, setProvider] = useState<any | null>(null);
    const [account, setAccount] = useState<string | null>(() => readPersistedAccount());

    useEffect(() => {
        const eth = (window as any).ethereum;
        if (!eth) return;

        // Try synchronous selectedAddress first (available immediately in some wallets)
        const selected = eth.selectedAddress ?? eth._selectedAddress ?? null;
        if (selected) {
            setAccount(String(selected));
            persistAccount(String(selected));
            return;
        }

        // Fall back to eth_accounts (no prompt — returns already-granted accounts)
        if (typeof eth.request === 'function') {
            eth.request({ method: 'eth_accounts' })
                .then((accounts: string[]) => {
                    if (Array.isArray(accounts) && accounts.length > 0) {
                        setAccount(accounts[0]);
                        persistAccount(accounts[0]);
                    }
                })
                .catch(() => { /* wallet locked or not connected */ });
        }

        const handleAccountsChanged = (accounts: string[]) => {
            const next = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
            setAccount(next);
            persistAccount(next);
        };
        eth.on?.('accountsChanged', handleAccountsChanged);
        return () => { eth.removeListener?.('accountsChanged', handleAccountsChanged); };
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
        persistAccount(accounts[0]);
        return accounts[0];
    };

    return { provider, account, connectWallet };
};
