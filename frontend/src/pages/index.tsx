import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AppShell from '../components/layout/AppShell';
import TopBar from '../components/layout/TopBar';
import SidebarTabs from '../components/navigation/SidebarTabs';
import type { Tab } from '../components/navigation/SidebarTabs';
import { getSigner, getContract } from '../lib/ethers';
import useProtocolPause from '../hooks/useProtocolPause';

// Dynamic imports for tab components
const UserTab = dynamic(() => import('../components/tabs/UserTab'), { ssr: false });
const BankingTab = dynamic(() => import('../components/tabs/BankingTab'), { ssr: false });
const VaultTab = dynamic(() => import('../components/tabs/VaultTab'), { ssr: false });
const TreasuryTab = dynamic(() => import('../components/tabs/TreasuryTab'), { ssr: false });
const EscrowTab = dynamic(() => import('../components/tabs/EscrowTab'), { ssr: false });
const ReserveTab = dynamic(() => import('../components/tabs/ReserveTab'), { ssr: false });
const DAOTab = dynamic(() => import('../components/tabs/DAOTab'), { ssr: false });

const INTERNAL_TABS: Tab[] = ['user', 'banking', 'vault', 'treasury', 'escrow', 'reserve', 'dao'];

function isTab(value: string): value is Tab {
  return INTERNAL_TABS.includes(value as Tab);
}

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('user');
  const [address, setAddress] = useState<string>('');
  const [ownerAddress, setOwnerAddress] = useState<string>('');
  const [network, setNetwork] = useState<string>('');
  const { isPaused } = useProtocolPause();

  useEffect(() => {
    loadAccountData();
    // Sync with URL on mount
    const tab = router.query.tab as string;
    if (tab && isTab(tab)) setActiveTab(tab);
  }, [router.query.tab]);

  const loadAccountData = async () => {
    try {
      const signer = await getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const provider = signer.provider;
      if (provider) {
        const net = await provider.getNetwork();
        const chainId = Number(net.chainId);
        const networkNames: Record<number, string> = {
          1287: "Moonbase Alpha",
          1337: "Localhost",
          31337: "Localhost",
          1: "Mainnet",
        };
        setNetwork(networkNames[chainId] || `Chain ${chainId}`);
      }

      const vault = await getContract('vault') as any;
      const owner = await vault.owner().catch(() => '');
      setOwnerAddress(owner);
    } catch (error) {
      console.error('Failed to load account data:', error);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'user':
        return <UserTab />;
      case 'banking':
        return <BankingTab />;
      case 'vault':
        return <VaultTab />;
      case 'treasury':
        return <TreasuryTab />;
      case 'escrow':
        return <EscrowTab />;
      case 'reserve':
        return <ReserveTab />;
      case 'dao':
        return <DAOTab />;
default:
        return <UserTab />;
    }
  };

  return (
    <>
      <Head>
        <title>Sagitta Protocol - Trustless Wealth Management</title>
      </Head>
      <AppShell
        topbar={<TopBar address={address} ownerAddress={ownerAddress} />}
        sidebar={<SidebarTabs active={activeTab} paused={isPaused} network={network} onChange={setActiveTab} />}
      >
        {renderTab()}
      </AppShell>
    </>
  );
}
