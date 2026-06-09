// GET /api/banking/escrow/lifecycle?escrowBatchId=
// Proxies to GET /banking/escrow/lifecycle?escrowBatchId= on the banking server.
import type { NextApiRequest, NextApiResponse } from 'next';
import { proxyToServer } from './_proxy';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  return proxyToServer(req, res, '/banking/escrow/lifecycle');
}
