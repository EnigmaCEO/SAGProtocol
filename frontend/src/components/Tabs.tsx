import { useRouter } from 'next/router';
import React, { ReactNode, useEffect, useState } from 'react';

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export default function Tabs({ tabs, defaultTab = 'user' }: TabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    const tabFromQuery = router.query.tab as string;
    if (tabFromQuery && tabs.some(t => t.id === tabFromQuery)) {
      setActiveTab(tabFromQuery);
    }
  }, [router.query.tab, tabs]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    router.push({ query: { tab: tabId } }, undefined, { shallow: true });
  };

  const activeContent = tabs.find(t => t.id === activeTab)?.content;

  return (
    <div className="w-full">
      <div className="border-b-2 border-gray-700/50 mb-8">
        <nav className="flex space-x-2 -mb-0.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                px-8 py-4 font-semibold text-lg transition-all duration-200 rounded-t-xl
                ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white border-b-4 border-blue-400 shadow-lg transform scale-105'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="py-4">{activeContent}</div>
    </div>
  );
}
