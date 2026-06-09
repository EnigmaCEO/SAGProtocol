// POST /api/banking/escrow/lifecycle/register-batch
// Proxies to POST /banking/escrow/lifecycle/register-batch on the banking server.
// Server reads canonical identity (treasuryAddress, openedAtUnix) from chain —
// the client only supplies { chainKey, sourceBatchId }.
import type { NextApiRequest, NextApiResponse } from 'next';
import { proxyToServer } from './_proxy';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  return proxyToServer(req, res, '/banking/escrow/lifecycle/register-batch');
}
