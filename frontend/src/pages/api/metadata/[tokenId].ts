import type { NextApiRequest, NextApiResponse } from "next";
import { Contract, JsonRpcProvider } from "ethers";
import { CONTRACT_ADDRESSES } from "../../../lib/addresses";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const RPC_URL = process.env.METADATA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
const APP_URL = process.env.NFT_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const RECEIPT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const VAULT_ABI = [
  "function depositInfo(uint256 id) view returns (address user,address asset,uint256 amount,uint256 amountUsd6,uint256 shares,uint64 createdAt,uint64 lockUntil,bool withdrawn)",
];

const ESCROW_ABI = [
  "function receiptBatchId(uint256 tokenId) view returns (uint256)",
  "function batches(uint256 batchId) view returns (uint256 id,uint256 startTime,uint256 endTime,uint256 totalCollateralUsd,uint256 totalShares,uint256 finalNavPerShare,uint8 status,bool distributed)",
];

const TREASURY_ABI = [
  "function previewReceiptProfitUsd(uint256 receiptId) view returns (uint256 batchId,uint256 dueUsd,uint256 alreadyPaidUsd,uint256 unpaidUsd,address recipient)",
];

type DepositInfo = {
  user: string;
  asset: string;
  amount: bigint;
  amountUsd6: bigint;
  shares: bigint;
  createdAt: bigint;
  lockUntil: bigint;
  withdrawn: boolean;
};

type BatchInfo = {
  id: bigint;
  startTime: bigint;
  endTime: bigint;
  totalCollateralUsd: bigint;
  totalShares: bigint;
  finalNavPerShare: bigint;
  status: number;
  distributed: boolean;
};

type ProfitPreview = {
  batchId: bigint;
  dueUsd: bigint;
  alreadyPaidUsd: bigint;
  unpaidUsd: bigint;
  recipient: string;
};

function toUsdString(usd6: bigint): string {
  return (Number(usd6) / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function batchStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Pending";
    case 1:
      return "Running";
    case 2:
      return "Closed";
    case 3:
      return "Distributed";
    case 4:
      return "Invested";
    default:
      return "Unknown";
  }
}

function buildImageSvg(tokenId: string, status: string, principal: string, batchLabel: string): string {
  const safeStatus = status.replace(/[<>&"]/g, "");
  const safePrincipal = principal.replace(/[<>&"]/g, "");
  const safeBatch = batchLabel.replace(/[<>&"]/g, "");
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#071223"/>
      <stop offset="55%" stop-color="#0e2744"/>
      <stop offset="100%" stop-color="#0a1a32"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="34" y="34" width="1132" height="562" rx="24" fill="none" stroke="#2b4d7a" opacity="0.45"/>
  <text x="72" y="120" fill="#dbe8ff" font-family="Arial, sans-serif" font-size="54" font-weight="700">Sagitta Vault Receipt #${tokenId}</text>
  <text x="72" y="190" fill="#8da8ca" font-family="Arial, sans-serif" font-size="28">Transferable claim on vault principal + batch-linked profit flow</text>

  <text x="72" y="300" fill="#7a91b0" font-family="Arial, sans-serif" font-size="24" letter-spacing="2">STATUS</text>
  <text x="72" y="350" fill="#66e3c4" font-family="Courier New, monospace" font-size="48" font-weight="700">${safeStatus}</text>

  <text x="72" y="430" fill="#7a91b0" font-family="Arial, sans-serif" font-size="24" letter-spacing="2">PRINCIPAL (USD)</text>
  <text x="72" y="478" fill="#f1f6ff" font-family="Courier New, monospace" font-size="44" font-weight="700">$${safePrincipal}</text>

  <text x="760" y="300" fill="#7a91b0" font-family="Arial, sans-serif" font-size="24" letter-spacing="2">BATCH</text>
  <text x="760" y="350" fill="#f1f6ff" font-family="Courier New, monospace" font-size="44" font-weight="700">${safeBatch}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tokenIdInput = Array.isArray(req.query.tokenId) ? req.query.tokenId[0] : req.query.tokenId;
  if (!tokenIdInput || !/^\d+$/.test(tokenIdInput)) {
    return res.status(400).json({ error: "Invalid token id" });
  }

  const tokenId = BigInt(tokenIdInput);
  const provider = new JsonRpcProvider(RPC_URL);

  const receiptAddress = (CONTRACT_ADDRESSES as any).ReceiptNFT || ZERO_ADDRESS;
  const vaultAddress = (CONTRACT_ADDRESSES as any).Vault || ZERO_ADDRESS;
  const treasuryAddress = (CONTRACT_ADDRESSES as any).Treasury || ZERO_ADDRESS;
  const escrowAddress = (CONTRACT_ADDRESSES as any).InvestmentEscrow || ZERO_ADDRESS;

  if (receiptAddress === ZERO_ADDRESS || vaultAddress === ZERO_ADDRESS) {
    return res.status(503).json({ error: "Protocol addresses not configured" });
  }

  const receipt = new Contract(receiptAddress, RECEIPT_ABI, provider);
  const vault = new Contract(vaultAddress, VAULT_ABI, provider);
  const treasury = treasuryAddress !== ZERO_ADDRESS ? new Contract(treasuryAddress, TREASURY_ABI, provider) : null;
  const escrow = escrowAddress !== ZERO_ADDRESS ? new Contract(escrowAddress, ESCROW_ABI, provider) : null;

  let owner = ZERO_ADDRESS;
  let deposit: DepositInfo | null = null;
  let batchId = 0n;
  let batch: BatchInfo | null = null;
  let profit: ProfitPreview | null = null;

  try {
    owner = await receipt.ownerOf(tokenId);
  } catch {
    return res.status(404).json({ error: "Receipt not found" });
  }

  try {
    deposit = await vault.depositInfo(tokenId) as DepositInfo;
  } catch {
    // Keep endpoint alive even when vault query fails.
    deposit = null;
  }

  if (escrow) {
    try {
      batchId = await escrow.receiptBatchId(tokenId);
      if (batchId > 0n) {
        batch = await escrow.batches(batchId) as BatchInfo;
      }
    } catch {
      batchId = 0n;
      batch = null;
    }
  }

  if (treasury) {
    try {
      profit = await treasury.previewReceiptProfitUsd(tokenId) as ProfitPreview;
    } catch {
      profit = null;
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const lockUntilSec = deposit ? Number(deposit.lockUntil) : 0;
  const withdrawn = deposit?.withdrawn ?? false;
  const principalUsd6 = deposit?.amountUsd6 ?? 0n;
  const principalUsd = toUsdString(principalUsd6);
  const batchStatus = batch ? batchStatusLabel(batch.status) : "Unassigned";

  let lifecycleStatus = "Locked";
  if (withdrawn) lifecycleStatus = "Returned";
  else if (batch && batch.status === 1) lifecycleStatus = "Batch Running";
  else if (batch && batch.status === 4) lifecycleStatus = "Batch Invested";
  else if (batch && batch.status === 2) lifecycleStatus = "Batch Closed";
  else if (lockUntilSec > 0 && lockUntilSec <= nowSec) lifecycleStatus = "Matured";

  const nextUnlock = lockUntilSec > 0 ? new Date(lockUntilSec * 1000).toISOString() : "N/A";
  const dueProfitUsd = profit ? toUsdString(profit.dueUsd) : "0.00";
  const unpaidProfitUsd = profit ? toUsdString(profit.unpaidUsd) : "0.00";
  const paidProfitUsd = profit ? toUsdString(profit.alreadyPaidUsd) : "0.00";
  const batchLabel = batchId > 0n ? `#${batchId.toString()} (${batchStatus})` : "Unassigned";

  const metadata = {
    name: `Sagitta Vault Receipt #${tokenId.toString()}`,
    description:
      "Transferable receipt NFT representing a Sagitta Vault deposit, with lifecycle state derived from on-chain Vault, Escrow, and Treasury data.",
    external_url: `${APP_URL}/?tab=user&receipt=${tokenId.toString()}`,
    image: buildImageSvg(tokenId.toString(), lifecycleStatus, principalUsd, batchLabel),
    attributes: [
      { trait_type: "Lifecycle", value: lifecycleStatus },
      { trait_type: "Batch", value: batchLabel },
      { trait_type: "Principal (USD)", value: principalUsd },
      { trait_type: "Due Profit (USD)", value: dueProfitUsd },
      { trait_type: "Unpaid Profit (USD)", value: unpaidProfitUsd },
      { trait_type: "Paid Profit (USD)", value: paidProfitUsd },
      { trait_type: "Owner", value: shortAddress(owner) },
      { trait_type: "Lock Unlock Time", value: nextUnlock },
    ],
    properties: {
      token_id: tokenId.toString(),
      owner,
      vault: vaultAddress,
      escrow: escrowAddress,
      treasury: treasuryAddress,
      principal_usd6: principalUsd6.toString(),
      lock_until: lockUntilSec,
      withdrawn,
      batch_id: batchId.toString(),
      batch_status: batchStatus,
      due_profit_usd6: profit?.dueUsd?.toString?.() ?? "0",
      unpaid_profit_usd6: profit?.unpaidUsd?.toString?.() ?? "0",
      paid_profit_usd6: profit?.alreadyPaidUsd?.toString?.() ?? "0",
    },
  };

  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json(metadata);
}
