import type { NextApiRequest, NextApiResponse } from 'next';

const PUBLIC_BANKING_API_URL = 'https://sag-banking-server.fly.dev';

function resolveBankingApiUrl(): string {
  const configured = (process.env.BANKING_API_URL || process.env.BANKING_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    const isFlyInternal = /\.internal(?::\d+)?$/i.test(configured) || /\.internal[:/]/i.test(configured);
    if (!isFlyInternal || process.env.FLY_APP_NAME) return configured;
  }

  if (process.env.NODE_ENV === 'development') return 'http://localhost:4000';
  return PUBLIC_BANKING_API_URL;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path ?? ''];
  const baseUrl = resolveBankingApiUrl();
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
