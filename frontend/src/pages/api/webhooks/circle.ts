import type { NextApiRequest, NextApiResponse } from 'next';

import { bankingService } from '../../../lib/banking/service';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = String(req.headers['x-circle-signature'] || '');
    const keyId = String(req.headers['x-circle-key-id'] || '');
    const event = await bankingService().ingestCircleWebhook(rawBody, signature, keyId);
    res.status(200).json({ received: true, id: event.id });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
}
