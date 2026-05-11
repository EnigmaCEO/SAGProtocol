import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path ?? ''];
  const baseUrl = process.env.BANKING_API_URL || 'http://localhost:4000';
  const url = new URL(`${baseUrl}/banking/${segments.join('/')}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = { method: req.method };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url, init);
    const raw = await upstream.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = {
        error: raw || `Upstream returned HTTP ${upstream.status}`,
      };
    }
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(502).json({
      error: `Banking API unavailable: ${String(err?.message || err)}`,
    });
  }
}
