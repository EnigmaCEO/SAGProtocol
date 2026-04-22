import type { NextApiRequest, NextApiResponse } from 'next';

import { createBankingDeposit } from '../../../../lib/banking/demoStore';
import { buildEnvelope, mapTermPosition } from '../../../../lib/banking/api';
import type { BankingDepositRequest } from '../../../../lib/banking/types';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body as BankingDepositRequest;
    const result = createBankingDeposit(body);
    res.status(200).json(buildEnvelope(mapTermPosition(result.createdPosition)));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
}
