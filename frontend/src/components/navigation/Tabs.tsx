import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

type TabId = 'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao';

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: 'user', label: 'User' },
  { id: 'vault', label: 'Vault' },
  { id: 'treasury', label: 'Treasury' },
  { id: 'escrow', label: 'Escrow' },
  { id: 'reserve', label: 'Reserve' },
  { id: 'dao', label: 'DAO' },
];

interface TabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function Tabs({ activeTab, onTabChange }: TabsProps) {
  return (
    <nav className="p-4">
      <ul className="flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button
              onClick={() => onTabChange(tab.id)}
              className={`w-full md:w-auto whitespace-nowrap px-4 py-3 rounded-lg font-semibold transition-all duration-200 text-left ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg'
                  : 'bg-gray-700/30 text-gray-300 hover:bg-gray-700/50'
              }`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function useTabSync(defaultTab: TabId = 'user'): [TabId, (tab: TabId) => void] {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    const tabFromUrl = router.query.tab as TabId;
    if (tabFromUrl && tabs.some(t => t.id === tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [router.query.tab]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    router.push({ query: { tab } }, undefined, { shallow: true });
  };

  return [activeTab, handleTabChange];
}
