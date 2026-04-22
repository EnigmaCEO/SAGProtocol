import type { NextApiRequest, NextApiResponse } from 'next';

import { getBankingState } from '../../../../lib/banking/demoStore';
import { buildEnvelope, getCapitalAccountRecord } from '../../../../lib/banking/api';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) {
    res.status(400).json({ error: 'Account id is required' });
    return;
  }

  const account = getCapitalAccountRecord(getBankingState(), accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  res.status(200).json(buildEnvelope(account));
}
