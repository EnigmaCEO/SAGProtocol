import type { NextApiRequest, NextApiResponse } from 'next';

import { getBankingState } from '../../../lib/banking/demoStore';
import { buildEnvelope, mapProtectionStatus } from '../../../lib/banking/api';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const state = getBankingState();
  res.status(200).json(buildEnvelope(mapProtectionStatus(state)));
}
