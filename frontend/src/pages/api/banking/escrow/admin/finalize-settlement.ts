// POST /api/banking/escrow/admin/finalize-settlement
// Proxies to POST /banking/escrow/admin/finalize-settlement on the banking server.
// Calls depositReturnForBatch() on InvestmentEscrow, which auto-triggers finalizeBatchSettlement.
// Body: { escrowBatchId: string, finalNavPerShare?: string }
import type { NextApiRequest, NextApiResponse } from 'next';
import { proxyToServer } from '../lifecycle/_proxy';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  return proxyToServer(req, res, '/banking/escrow/admin/finalize-settlement');
}
