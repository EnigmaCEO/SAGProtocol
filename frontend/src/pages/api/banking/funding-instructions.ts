import type { NextApiRequest, NextApiResponse } from 'next';

import { getBankingState } from '../../../lib/banking/demoStore';
import {
  buildEnvelope,
  createFundingInstructionRecord,
  type FundingInstructionCreateRequest,
} from '../../../lib/banking/api';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body || {}) as FundingInstructionCreateRequest;
  const record = createFundingInstructionRecord(getBankingState(), body);
  res.status(201).json(buildEnvelope(record));
}
