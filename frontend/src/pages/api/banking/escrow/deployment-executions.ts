import type { NextApiRequest, NextApiResponse } from 'next';

const BANKING_API = process.env.NEXT_PUBLIC_BANKING_API_URL || 'http://localhost:4000';
const RECORDS_URL = `${BANKING_API}/banking/escrow/deployment-records`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { batchUuid } = req.query;
    if (!batchUuid || typeof batchUuid !== 'string') {
      return res.status(400).json({ error: 'batchUuid query parameter is required.' });
    }
    try {
      const upstream = await fetch(`${RECORDS_URL}?batchUuid=${encodeURIComponent(batchUuid)}`);
      const data = await upstream.json().catch(() => null);
      return res.status(upstream.status).json(data ?? { execution: null });
    } catch {
      return res.status(200).json({ execution: null });
    }
  }

  if (req.method === 'POST') {
    // INTERNAL_ONLY — only lifecycle controller (server-to-server) may write execution records.
    const internalToken = process.env.INTERNAL_API_TOKEN;
    if (internalToken && req.headers['x-internal-token'] !== internalToken) {
      return res.status(403).json({ error: 'Forbidden: deployment-executions POST is an internal endpoint. Public clients may not create execution records.' });
    }

    // Local idempotency guard: if batchUuid is already recorded upstream, return 409 rather than
    // proxying a duplicate write that may produce a second execution record for the same batch.
    const batchUuid = req.body?.batchUuid;
    if (batchUuid && typeof batchUuid === 'string') {
      try {
        const check = await fetch(`${RECORDS_URL}?batchUuid=${encodeURIComponent(batchUuid)}`);
        const existing = await check.json().catch(() => null);
        if (check.ok && existing && existing.execution != null) {
          return res.status(409).json({ error: 'Execution record already exists for this batch UUID.', existing: existing.execution });
        }
      } catch {
        // If the idempotency check fails, proceed and let the upstream decide.
      }
    }

    try {
      const upstream = await fetch(RECORDS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await upstream.json().catch(() => null);
      return res.status(upstream.ok ? 201 : upstream.status).json(data ?? {});
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to save deployment record.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
