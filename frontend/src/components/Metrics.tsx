import React from "react";

interface MetricsProps {
  usdcBal: number;
  vaultPrincipal: number;
  pending: { total: number; unlocked: number };
}

export default function Metrics({ usdcBal, vaultPrincipal, pending }: MetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-500">Your USDC Balance</div>
        <div className="text-2xl font-bold">{usdcBal.toLocaleString()}</div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-500">Vault Principal (USDC)</div>
        <div className="text-2xl font-bold">{vaultPrincipal.toLocaleString()}</div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-500">Pending Credits</div>
        <div className="text-2xl font-bold">{pending.total.toLocaleString()}</div>
        <div className="text-xs text-gray-500">
          Unlocked: {pending.unlocked.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
