import type { NextApiRequest, NextApiResponse } from 'next';

import { getBankingState } from '../../../../lib/banking/demoStore';
import { buildEnvelope, getTermPositionRecord } from '../../../../lib/banking/api';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const positionId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!positionId) {
    res.status(400).json({ error: 'Term position id is required' });
    return;
  }

  const position = getTermPositionRecord(getBankingState(), positionId);
  if (!position) {
    res.status(404).json({ error: 'Term position not found' });
    return;
  }

  res.status(200).json(buildEnvelope(position));
}
