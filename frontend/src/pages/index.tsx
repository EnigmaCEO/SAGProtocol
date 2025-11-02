import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import AppShell from '../components/layout/AppShell';
import TopBar from '../components/layout/TopBar';
import SidebarTabs from '../components/navigation/SidebarTabs';
import { getSigner, getContract } from '../lib/ethers';

// Dynamic imports for tab components
const UserTab = dynamic(() => import('../components/tabs/UserTab'), { ssr: false });
const VaultTab = dynamic(() => import('../components/tabs/VaultTab'), { ssr: false });
const TreasuryTab = dynamic(() => import('../components/tabs/TreasuryTab'), { ssr: false });
const EscrowTab = dynamic(() => import('../components/tabs/EscrowTab'), { ssr: false });
const ReserveTab = dynamic(() => import('../components/tabs/ReserveTab'), { ssr: false });
const DAOTab = dynamic(() => import('../components/tabs/DAOTab'), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao'>('user');
  const [address, setAddress] = useState<string>('');
  const [isPaused, setIsPaused] = useState(false);
  const [network, setNetwork] = useState<string>('');

  useEffect(() => {
    loadAccountData();
    // Sync with URL on mount
    const tab = router.query.tab as string;
    if (tab) setActiveTab(tab as any);
  }, [router.query.tab]);

  const loadAccountData = async () => {
    try {
      const signer = await getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const provider = signer.provider;
      if (provider) {
        const network = await provider.getNetwork();
        setNetwork(network.name);
      }

      const vault = await getContract('vault') as any;
      const paused = await vault.paused().catch(() => false);
      setIsPaused(paused);
    } catch (error) {
      console.error('Failed to load account data:', error);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'user':
        return <UserTab />;
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
    <AppShell
      topbar={<TopBar address={address} paused={isPaused} network={network} />}
      sidebar={<SidebarTabs active={activeTab} onChange={setActiveTab} />}
    >
      {renderTab()}
    </AppShell>
  );
}
