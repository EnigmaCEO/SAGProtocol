import React, { useState } from "react";
import { fmt6 } from "../lib/ethers";
import { CONTRACT_ADDRESSES as A } from "../lib/addresses";

interface ReceiptsTableProps {
  ids: bigint[];
  rows: any[];
  onWithdraw: (id: bigint) => Promise<void>;
  paused: boolean;
}

export default function ReceiptsTable({ ids, rows, onWithdraw, paused }: ReceiptsTableProps) {
  const [working, setWorking] = useState<string>("");

  const handleWithdraw = async (id: bigint) => {
    setWorking(id.toString());
    try {
      await onWithdraw(id);
    } catch (e: any) {
      console.error(e);
      alert(e?.reason || e?.message || "Withdraw failed");
    } finally {
      setWorking("");
    }
  };

  if (ids.length === 0) {
    return (
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <h2 className="text-lg font-semibold mb-3">Your Deposits</h2>
        <p className="text-gray-500">No deposits yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-6">
      <h2 className="text-lg font-semibold mb-3">Your Deposits</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">USD</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lock Until</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rows.map((row, idx) => {
              const id = ids[idx];
              const isWithdrawn = row.withdrawn;
              const lockUntil = Number(row.lockUntil);
              const nowSec = Math.floor(Date.now() / 1000);
              const canWithdraw = !isWithdrawn && nowSec >= lockUntil;
              const isWorking = working === id.toString();

              return (
                <tr key={id.toString()}>
                  <td className="px-3 py-2 text-sm">{id.toString()}</td>
                  <td className="px-3 py-2 text-sm">
                    {row.asset.toLowerCase() === A.MockUSDC.toLowerCase() ? "USDC" : row.asset.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-sm">{fmt6(row.amount).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">{fmt6(row.amountUsd6).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">
                    {new Date(lockUntil * 1000).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {isWithdrawn ? (
                      <span className="text-gray-500">Withdrawn</span>
                    ) : canWithdraw ? (
                      <span className="text-green-600">Unlocked</span>
                    ) : (
                      <span className="text-yellow-600">Locked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <button
                      onClick={() => handleWithdraw(id)}
                      disabled={paused || !canWithdraw || isWorking}
                      className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isWorking ? "Working..." : "Withdraw"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
