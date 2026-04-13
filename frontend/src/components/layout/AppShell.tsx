import { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}

export default function AppShell({ sidebar, topbar, children }: AppShellProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(1100px_420px_at_10%_-12%,rgba(78,130,196,0.16),transparent_58%),radial-gradient(850px_380px_at_95%_-10%,rgba(30,159,126,0.1),transparent_55%),repeating-linear-gradient(90deg,rgba(255,255,255,0.02)_0px,rgba(255,255,255,0.02)_1px,transparent_1px,transparent_120px)]" />

      <div className="shell-layout">
        <header className="surface-frame shrink-0">
          <div className="shell-header-nav">
            {sidebar}
          </div>
          <div className="shell-header-status">
            {topbar}
          </div>
        </header>

        <main className="shell-main scrollbar-thin">
          <div className="shell-main-inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
