import type { NextApiRequest, NextApiResponse } from 'next';

import { getBankingState } from '../../../lib/banking/demoStore';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json(getBankingState());
}
