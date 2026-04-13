import { ReactNode } from 'react';

interface MetricGridProps {
  children: ReactNode;
}

export default function MetricGrid({ children }: MetricGridProps) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-min">
      {children}
    </div>
  );
}
