// Browser-side entry point for privileged escrow operations.
//
// WHY THE BROWSER NO LONGER CALLS THE SIGNER SERVICES
//   The Treasury and Escrow signer services hold the role private keys, and the
//   signatures they produce are accepted on-chain as protocol authority. They
//   now require an authenticated service caller — and the browser must never
//   hold that credential, because shipping it to the client would hand signing
//   authority to anyone who opens devtools.
//
//   So the browser does not drive the signers. It asks the banking server to
//   advance the lifecycle, and the banking server calls the signers with its own
//   credential. The operations are identical — Phase 2 signs and anchors the
//   authority binding and creates the batch wallet, Phase 5 attaches the
//   allocation, Phase 8 deploys the legs — they simply happen behind an
//   authenticated boundary instead of in front of it.
//
// After an advance, callers re-derive their local state FROM CHAIN rather than
// from the response body. The chain is the source of truth; the response is not.

export interface LifecycleAdvanceResult {
  escrowBatchId: string;
  /** Phase after the advance, when the server reported one. */
  currentPhase?: number;
  status?: string;
  /** Set when the lifecycle refused to advance — e.g. a blocking checklist item. */
  blockedReason?: string;
  raw: unknown;
}

export class LifecycleActionError extends Error {
  /** HTTP status from the API, when there was one. */
  readonly status?: number;
  /** Machine-readable code from the API, when there was one. */
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'LifecycleActionError';
    this.status = options.status;
    this.code = options.code;
  }
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    // Sends the wallet session cookie. Authority comes from the signed-in
    // wallet; the browser holds no service credential of its own.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new LifecycleActionError(
      res.status === 401
        ? 'Connect and sign in with your wallet to perform this action.'
        : message,
      { status: res.status, code: typeof data?.code === 'string' ? data.code : undefined },
    );
  }
  return data;
}

/**
 * Resolve the lifecycle identity for a batch, registering it if necessary.
 * The server derives canonical identity from chain; the client supplies only
 * the source batch id.
 */
export async function resolveEscrowBatchId(params: {
  sourceBatchId: string;
  chainKey?: string;
  /** Already known? Skip the round trip. */
  escrowBatchId?: string;
}): Promise<string> {
  if (params.escrowBatchId) return params.escrowBatchId;

  const data = await postJson('/api/banking/escrow/lifecycle/register-batch', {
    sourceBatchId: params.sourceBatchId,
    ...(params.chainKey ? { chainKey: params.chainKey } : {}),
  });

  const id: string | undefined = data.escrowBatchId ?? data.lifecycle?.escrow_batch_id;
  if (!id) {
    throw new LifecycleActionError(
      'Could not resolve the lifecycle identity for this batch. It may not be registered on-chain yet.',
    );
  }
  return id;
}

/**
 * Advance the lifecycle, registering the batch first if needed.
 *
 * `mode: 'untilBlocked'` runs consecutive phases until one cannot proceed —
 * appropriate when the UI action corresponds to "get this batch to the next
 * stable state" rather than one specific phase.
 */
export async function advanceEscrowLifecycle(params: {
  sourceBatchId: string;
  escrowBatchId?: string;
  chainKey?: string;
  mode?: 'single' | 'untilBlocked';
}): Promise<LifecycleAdvanceResult> {
  const escrowBatchId = await resolveEscrowBatchId(params);

  const data = await postJson('/api/banking/escrow/lifecycle/advance', {
    escrowBatchId,
    mode: params.mode ?? 'single',
  });

  const state = data.state ?? data.lifecycle ?? data;
  const blockedReason: string | undefined =
    data.blockedReason ?? data.errorMessage ?? state?.blocked_reason ?? undefined;

  return {
    escrowBatchId,
    currentPhase: typeof state?.current_phase === 'number' ? state.current_phase : undefined,
    status: typeof state?.status === 'string' ? state.status : undefined,
    blockedReason,
    raw: data,
  };
}

/**
 * Advance and surface a refusal as an error.
 *
 * The lifecycle controller reports a blocked phase as a successful HTTP
 * response carrying a reason — correct for a status endpoint, wrong for a UI
 * action that the user expects to either work or explain itself. Callers that
 * are performing an action should use this.
 */
export async function advanceEscrowLifecycleOrThrow(
  params: Parameters<typeof advanceEscrowLifecycle>[0],
): Promise<LifecycleAdvanceResult> {
  const result = await advanceEscrowLifecycle(params);
  if (result.blockedReason) {
    throw new LifecycleActionError(result.blockedReason);
  }
  return result;
}
