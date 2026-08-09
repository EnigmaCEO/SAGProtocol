// POST /api/banking/escrow/lifecycle/advance
//
// Advances the escrow lifecycle state machine, which can submit on-chain
// transactions through the signer services. Requires a wallet session holding
// `escrow:lifecycle:write`; the banking server independently verifies the
// minted assertion before executing anything.
//
// Body: { escrowBatchId: string, mode?: 'single' | 'untilBlocked' }
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/lifecycle/advance', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const escrowBatchId = typeof body.escrowBatchId === 'string' ? body.escrowBatchId.trim() : '';
    if (!escrowBatchId) {
      res.status(400).json({ error: 'escrowBatchId is required.', code: 'invalid_request' });
      return;
    }
    const mode = body.mode === 'untilBlocked' ? 'untilBlocked' : 'single';

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: '/banking/escrow/lifecycle/advance',
      body: { escrowBatchId, mode },
      session: ctx.session,
      authorityClass: 'user',
      scopes: [SCOPES.escrowLifecycleWrite],
      requestId: ctx.requestId,
      // Scoped to this request id so a double-click cannot advance twice, while
      // a deliberate second advance (a new request) still works.
      idempotencyKey: `advance:${escrowBatchId}:${mode}:${ctx.requestId}`,
      timeoutMs: 120_000,
    }));
  },
});
