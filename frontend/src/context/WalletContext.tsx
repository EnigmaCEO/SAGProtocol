import React, { createContext, useContext, useState } from "react";

interface WalletContextProps {
    account: string | null;
    setAccount: (account: string | null) => void;
}

const WalletContext = createContext<WalletContextProps | undefined>(undefined);

export const WalletProvider: React.FC = ({ children }) => {
    const [account, setAccount] = useState<string | null>(null);

    return (
        <WalletContext.Provider value={{ account, setAccount }}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWalletContext = () => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error("useWalletContext must be used within a WalletProvider");
    }
    return context;
};
