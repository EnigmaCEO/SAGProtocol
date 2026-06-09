// POST /api/banking/escrow/lifecycle/advance
// Proxies to POST /banking/escrow/lifecycle/advance on the banking server.
// Body: { escrowBatchId: string, mode?: 'single' | 'untilBlocked' }
import type { NextApiRequest, NextApiResponse } from 'next';
import { proxyToServer } from './_proxy';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  return proxyToServer(req, res, '/banking/escrow/lifecycle/advance');
}
