import { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}

export default function AppShell({ sidebar, topbar, children }: AppShellProps) {
  return (
    <div className="relative flex h-screen w-screen overflow-hidden text-slate-100">
      {/* Ambient background gradients */}
      <div className="pointer-events-none absolute inset-0 z-0 " />

      {/* Left sidebar */}
      <aside className="sidebar-panel relative z-10 flex shrink-0 flex-col" style={{ width: 220 }}>
        {sidebar}
      </aside>

      {/* Right: topbar + content */}
      <div className="relative z-10 flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 topbar-header">
          {topbar}
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="shell-main-inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
