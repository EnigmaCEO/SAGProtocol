/**
 * Shared proxy utility for lifecycle API routes.
 * All lifecycle authority lives in the banking server (port 4000).
 * These Next.js routes are thin pass-through proxies — no logic here.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const SERVER_BASE =
  process.env.BANKING_API_URL ??
  process.env.NEXT_PUBLIC_BANKING_API_URL ??
  'http://localhost:4000';

export async function proxyToServer(
  req: NextApiRequest,
  res: NextApiResponse,
  serverPath: string,
): Promise<void> {
  try {
    // Forward query string for GET requests; strip internal Next.js routing params.
    const query = { ...req.query };
    delete query.path; // catch-all segment — not meaningful to the server

    const qs = new URLSearchParams(query as Record<string, string>).toString();
    const url = `${SERVER_BASE}${serverPath}${qs ? '?' + qs : ''}`;

    const init: RequestInit = {
      method: req.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(url, init);
    const contentType = upstream.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await upstream.json().catch(() => ({}))
      : await upstream.text().catch(() => '');

    res.status(upstream.status);
    if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (err: any) {
    res.status(502).json({
      error: `Banking server unreachable: ${String(err?.message ?? err)}`,
      serverBase: SERVER_BASE,
    });
  }
}
