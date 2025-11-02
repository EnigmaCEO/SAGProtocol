import React, { useState } from "react";
import { fmt6 } from "../lib/ethers";

interface CreditsListProps {
  pending: { total: number; unlocked: number };
  credits?: { amountUsd6: bigint; unlockAt: bigint; claimed: boolean }[];
  onClaim: (index: number) => Promise<void>;
  paused: boolean;
}

export default function CreditsList({ pending, credits, onClaim, paused }: CreditsListProps) {
  const [working, setWorking] = useState<number>(-1);

  const handleClaim = async (index: number) => {
    setWorking(index);
    try {
      await onClaim(index);
    } catch (e: any) {
      console.error(e);
      alert(e?.reason || e?.message || "Claim failed");
    } finally {
      setWorking(-1);
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-3">Profit Credits</h2>
      <div className="mb-3 text-sm">
        <div>
          Total Pending: <strong>{pending.total.toLocaleString()}</strong> USD
        </div>
        <div>
          Unlocked: <strong>{pending.unlocked.toLocaleString()}</strong> USD
        </div>
      </div>

      {!credits || credits.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No individual credits enumerable. Use totals above.
        </p>
      ) : (
        <div className="space-y-2">
          {credits.map((credit, idx) => {
            const unlockAt = Number(credit.unlockAt);
            const nowSec = Math.floor(Date.now() / 1000);
            const canClaim = !credit.claimed && nowSec >= unlockAt;
            const isWorking = working === idx;

            return (
              <div
                key={idx}
                className="flex items-center justify-between border border-gray-200 rounded p-2"
              >
                <div className="text-sm">
                  <div>
                    <strong>{fmt6(credit.amountUsd6).toLocaleString()}</strong> USD
                  </div>
                  <div className="text-xs text-gray-500">
                    Unlock: {new Date(unlockAt * 1000).toLocaleString()}
                  </div>
                  <div className="text-xs">
                    {credit.claimed ? (
                      <span className="text-gray-500">Claimed</span>
                    ) : canClaim ? (
                      <span className="text-green-600">Ready</span>
                    ) : (
                      <span className="text-yellow-600">Locked</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleClaim(idx)}
                  disabled={paused || !canClaim || isWorking}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {isWorking ? "Working..." : "Claim"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
