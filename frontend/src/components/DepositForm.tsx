import React, { useState } from "react";
import { getContracts, to6 } from "../lib/ethers";

interface DepositFormProps {
  paused: boolean;
  onComplete: () => void;
}

export default function DepositForm({ paused, onComplete }: DepositFormProps) {
  const [amount, setAmount] = useState("");
  const [working, setWorking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;

    setWorking(true);
    try {
      const { vault, usdc, A } = await getContracts();
      const amt = to6(parseFloat(amount));

      await (await usdc.approve(A.Vault, amt)).wait();
      await (await vault.deposit(A.MockUSDC, amt)).wait();

      setAmount("");
      onComplete();
    } catch (e: any) {
      console.error(e);
      alert(e?.reason || e?.message || "Transaction failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-6">
      <h2 className="text-lg font-semibold mb-3">Deposit</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="number"
          step="0.01"
          placeholder="Amount (USDC)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={paused || working}
          className="flex-1 border border-gray-300 rounded px-3 py-2 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={paused || working || !amount}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {working ? "Working..." : "Approve & Deposit"}
        </button>
      </form>
    </div>
  );
}
