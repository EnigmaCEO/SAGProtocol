export type ApiLogEntry = {
  id: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  method: string;
  url: string;
  requestPayload?: unknown;
  responseStatus?: number;
  responseOk?: boolean;
  responsePayload?: unknown;
  error?: string;
};

const API_LOG_EVENT = 'sagitta:api-log-updated';
const MAX_LOG_ENTRIES = 200;
const MAX_CAPTURE_CHARS = 20_000;

declare global {
  interface Window {
    __sagittaApiLoggerInstalled?: boolean;
    __sagittaApiOriginalFetch?: typeof fetch;
    __sagittaApiLogEntries?: ApiLogEntry[];
  }
}

function truncate(value: string) {
  if (value.length <= MAX_CAPTURE_CHARS) return value;
  return `${value.slice(0, MAX_CAPTURE_CHARS)}... [truncated ${value.length - MAX_CAPTURE_CHARS} chars]`;
}

function parseMaybeJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return truncate(trimmed);
  }
}

function normalizeUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function normalizeMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && 'method' in input && input.method) return input.method.toUpperCase();
  return 'GET';
}

function shouldLogUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.pathname.startsWith('/_next/')) return false;
    if (url.pathname === '/favicon.ico') return false;
    return (
      url.pathname.startsWith('/api/') ||
      url.hostname !== window.location.hostname ||
      ['4000', '8545', '3001', '3002', '3003', '3004'].includes(url.port)
    );
  } catch {
    return true;
  }
}

async function readRequestPayload(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body;
  if (typeof body === 'string') return parseMaybeJson(body);
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (body instanceof FormData) return Object.fromEntries(body.entries());
  if (body instanceof Blob) return `[Blob ${body.size} bytes]`;
  if (body) return '[request body not text-readable]';

  if (typeof input === 'object' && 'clone' in input) {
    try {
      const text = await input.clone().text();
      return parseMaybeJson(text);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function readResponsePayload(response: Response) {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.clone().text();
    if (!text) return '';
    if (contentType.includes('application/json')) return parseMaybeJson(text);
    return truncate(text);
  } catch {
    return '[response body not readable]';
  }
}

function publish(entry: ApiLogEntry) {
  const entries = window.__sagittaApiLogEntries ?? [];
  window.__sagittaApiLogEntries = [entry, ...entries].slice(0, MAX_LOG_ENTRIES);
  window.dispatchEvent(new CustomEvent(API_LOG_EVENT, { detail: window.__sagittaApiLogEntries }));
}

export function getApiLogEntries() {
  if (typeof window === 'undefined') return [];
  return window.__sagittaApiLogEntries ?? [];
}

export function clearApiLogEntries() {
  if (typeof window === 'undefined') return;
  window.__sagittaApiLogEntries = [];
  window.dispatchEvent(new CustomEvent(API_LOG_EVENT, { detail: [] }));
}

export function subscribeToApiLog(listener: (entries: ApiLogEntry[]) => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<ApiLogEntry[]>).detail ?? getApiLogEntries());
  };
  window.addEventListener(API_LOG_EVENT, handler);
  return () => window.removeEventListener(API_LOG_EVENT, handler);
}

export function installApiLogger() {
  if (typeof window === 'undefined') return;
  if (window.__sagittaApiLoggerInstalled) return;
  window.__sagittaApiLoggerInstalled = true;
  window.__sagittaApiOriginalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const originalFetch = window.__sagittaApiOriginalFetch ?? window.fetch.bind(window);
    const url = normalizeUrl(input);
    if (!shouldLogUrl(url)) {
      return originalFetch(input, init);
    }

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const method = normalizeMethod(input, init);
    const requestPayload = await readRequestPayload(input, init);

    try {
      const response = await originalFetch(input, init);
      const completedAtMs = Date.now();
      const responsePayload = await readResponsePayload(response);
      publish({
        id: `${startedAtMs}-${Math.random().toString(16).slice(2)}`,
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - startedAtMs,
        method,
        url,
        requestPayload,
        responseStatus: response.status,
        responseOk: response.ok,
        responsePayload,
      });
      return response;
    } catch (error) {
      const completedAtMs = Date.now();
      publish({
        id: `${startedAtMs}-${Math.random().toString(16).slice(2)}`,
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - startedAtMs,
        method,
        url,
        requestPayload,
        error: String((error as Error)?.message ?? error),
      });
      throw error;
    }
  };
}
