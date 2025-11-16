import { ReactNode } from 'react';

interface MetricGridProps {
  children: ReactNode;
}

export default function MetricGrid({ children }: MetricGridProps) {
  return (
    <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 auto-rows-min">
      {children}
    </div>
  );
}
