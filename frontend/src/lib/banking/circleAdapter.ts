import crypto from 'crypto';

function baseUrl(): string {
  return env('CIRCLE_ENV') === 'production'
    ? 'https://api.circle.com'
    : 'https://api-sandbox.circle.com';
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function chain(): string {
  return (env('CIRCLE_BLOCKCHAIN') || env('BANKING_PROTOCOL_CHAIN') || 'ETH').toUpperCase();
}

function transferMode(): 'circle_mint' | 'local_arc' {
  const configured = env('CIRCLE_TRANSFER_MODE')?.toLowerCase();
  if (configured === 'circle_mint') return 'circle_mint';
  if (configured === 'local_arc' || configured === 'simulated') return 'local_arc';
  return chain() === 'ARC' || chain() === 'LOCALHOST' ? 'local_arc' : 'circle_mint';
}

function apiKey(): string {
  const key = env('CIRCLE_API_KEY');
  if (!key) throw new Error('CIRCLE_API_KEY is required.');
  return key;
}

function idempotencyKey(prefix: string, seed: string): string {
  const hash = crypto.createHash('sha256').update(`${prefix}:${seed}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

async function circleFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Circle request failed: ${response.status}`;
    throw new Error(`Circle ${response.status} ${path}: ${message}`);
  }
  return payload;
}

export class CircleAdapter {
  async createBusinessWireAccount(request: Record<string, unknown>) {
    return circleFetch('/v1/businessAccount/banks/wires', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getWireInstructions(providerBankId: string) {
    return circleFetch(`/v1/businessAccount/banks/wires/${providerBankId}/instructions`);
  }

  async createSandboxMockWire(input: { trackingRef: string; amount: number; currency?: string }) {
    if (env('CIRCLE_ENV') === 'production') {
      throw new Error('Sandbox mock wire is disabled in production.');
    }
    return circleFetch('/v1/mocks/payments/wire', {
      method: 'POST',
      body: JSON.stringify({
        trackingRef: input.trackingRef,
        amount: { amount: input.amount.toFixed(2), currency: input.currency || 'USD' },
      }),
    });
  }

  async getOrCreateRecipientAddress(input: { address: string; chain: string; description: string }) {
    const configuredAddressId = env('CIRCLE_DESTINATION_ADDRESS_ID');
    if (configuredAddressId) return configuredAddressId;

    const listPayload = await circleFetch('/v1/businessAccount/wallets/addresses/recipient');
    const existing = (listPayload?.data || []).find((item: any) =>
      String(item?.address || '').toLowerCase() === input.address.toLowerCase() &&
      String(item?.chain || '').toUpperCase() === input.chain.toUpperCase() &&
      String(item?.currency || 'USD').toUpperCase() === 'USD'
    );
    if (existing?.id) return existing.id;

    const created = await circleFetch('/v1/businessAccount/wallets/addresses/recipient', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: idempotencyKey('circle-recipient-address', `${input.chain}:${input.address}`),
        address: input.address,
        chain: input.chain,
        currency: 'USD',
        description: input.description,
      }),
    });
    const recipient = created?.data;
    if (!recipient?.id) throw new Error('Circle did not return a recipient address id.');
    if (recipient.status && recipient.status !== 'active') {
      throw new Error(`Circle recipient address is ${recipient.status}. Verify it in Circle Console, then retry Circle funding.`);
    }
    return recipient.id;
  }

  async createFirstPartyUsdcTransfer(input: { termPositionId: string; amount: number }) {
    if (transferMode() === 'local_arc') {
      const id = `arc-local-transfer-${input.termPositionId}`;
      return {
        data: {
          id,
          status: 'complete',
          transactionHash: `0x${crypto.createHash('sha256').update(id).digest('hex')}`,
          chain: chain(),
          amount: { amount: input.amount.toFixed(2), currency: 'USD' },
          rail: 'local_arc_simulation',
        },
      };
    }

    const destinationAddress = env('CIRCLE_DESTINATION_ADDRESS') || env('CIRCLE_WALLET_ADDRESS');
    const blockchain = env('CIRCLE_BLOCKCHAIN') || 'ETH';
    if (!destinationAddress) throw new Error('CIRCLE_DESTINATION_ADDRESS is required.');
    const addressId = await this.getOrCreateRecipientAddress({
      address: destinationAddress,
      chain: blockchain,
      description: `Sagitta protocol wallet ${blockchain}`,
    });

    return circleFetch('/v1/businessAccount/transfers', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: idempotencyKey('circle-transfer', input.termPositionId),
        destination: { type: 'verified_blockchain', addressId },
        amount: { amount: input.amount.toFixed(2), currency: 'USD' },
      }),
    });
  }

  async getTransfer(providerTransferId: string) {
    return circleFetch(`/v1/businessAccount/transfers/${providerTransferId}`);
  }

  // Circle uses ECDSA (not HMAC) for webhook verification.
  // The public key is fetched live using the key ID from the X-Circle-Key-Id header.
  // Returns false if the key ID or signature is missing; throws if the fetch fails.
  async verifyWebhookSignature(rawBody: string, signature: string | undefined, keyId: string | undefined): Promise<boolean> {
    if (!signature || !keyId) return false;
    try {
      const res = await fetch(`${baseUrl()}/v2/notifications/publicKey/${keyId}`, {
        headers: { Authorization: `Bearer ${apiKey()}` },
      });
      if (!res.ok) return false;
      const { publicKey } = await res.json();
      if (!publicKey) return false;
      return crypto.verify(
        'sha256',
        Buffer.from(rawBody),
        { key: publicKey, format: 'pem', type: 'spki', dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64'),
      );
    } catch {
      return false;
    }
  }
}

export function normalizeCircleId(payload: any): string | null {
  return payload?.data?.id || payload?.id || null;
}

export function normalizeCircleStatus(payload: any): string {
  return String(payload?.data?.status || payload?.status || 'pending').toLowerCase();
}

export function normalizeCircleAmount(payload: any): number | null {
  const raw = payload?.data?.amount?.amount || payload?.amount?.amount || payload?.amount;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
