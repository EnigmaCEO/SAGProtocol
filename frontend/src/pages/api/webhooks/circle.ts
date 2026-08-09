// POST /api/webhooks/circle
//
// WHAT CHANGED AND WHY
//   This handler used to call `bankingService().ingestCircleWebhook()` directly
//   from the Next.js process. That was a second, independent write path into the
//   same database — one that never enforced the signature verdict, so anyone who
//   could POST here could drive transfer status updates.
//
//   It is now a pure forwarder. The RAW body and Circle's signature headers are
//   passed through byte-for-byte to the banking server, which is the single
//   place that verifies the signature, enforces timestamp tolerance, and
//   deduplicates by provider event id.
//
// The body parser stays disabled: any re-serialization would change the bytes
// the signature was computed over and every webhook would fail verification.

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveBankingApiUrl } from '../../../lib/security/upstream';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Circle payloads are small; anything larger is refused rather than buffered. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

async function readRawBody(req: NextApiRequest): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_WEBHOOK_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.', code: 'method_not_allowed' });
    return;
  }

  const rawBody = await readRawBody(req);
  if (rawBody === null) {
    res.status(413).json({ error: 'Payload too large.', code: 'payload_too_large' });
    return;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Only the signature headers are forwarded. Nothing else the caller sends can
  // influence how the banking server authorizes this request.
  const signature = req.headers['x-circle-signature'];
  const keyId = req.headers['x-circle-key-id'];
  if (typeof signature === 'string') headers['x-circle-signature'] = signature;
  if (typeof keyId === 'string') headers['x-circle-key-id'] = keyId;

  try {
    const upstream = await fetch(`${resolveBankingApiUrl()}/webhooks/circle`, {
      method: 'POST',
      headers,
      body: new Uint8Array(rawBody),           // byte-identical — required for signature verification
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : { received: upstream.ok };
    } catch {
      data = { received: upstream.ok };
    }
    res.status(upstream.status).json(data);
  } catch (err: any) {
    // Do not reveal verification or connectivity detail to the caller.
    console.error('[security] Circle webhook forward failed', { message: String(err?.message ?? err) });
    res.status(502).json({ error: 'Unable to process webhook.' });
  }
}
