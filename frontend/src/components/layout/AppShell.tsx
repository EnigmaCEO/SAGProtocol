import { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}

export default function AppShell({ sidebar, topbar, children }: AppShellProps) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 text-slate-100">
      <div className="flex h-full w-full">
        {/* Left Sidebar */}
        <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/50 backdrop-blur-sm overflow-y-auto h-full scrollbar-thin">
          <div className="p-6">
            {sidebar}
          </div>
        </aside>
        
        {/* Right side: TopBar + Content */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <header className="shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm">
            <div className="px-8 py-4">{topbar}</div>
          </header>
          
          <main className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="p-8 h-full">
              <div className="max-w-7xl mx-auto h-full">
                {children}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
