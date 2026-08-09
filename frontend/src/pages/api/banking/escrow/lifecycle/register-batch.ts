// POST /api/banking/escrow/lifecycle/register-batch
//
// Registers a batch with the lifecycle controller. The server reads canonical
// identity (treasuryAddress, openedAtUnix) from chain — the client supplies
// only { sourceBatchId, chainKey }.
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/lifecycle/register-batch', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sourceBatchId = typeof body.sourceBatchId === 'string' ? body.sourceBatchId.trim() : '';
    if (!sourceBatchId) {
      res.status(400).json({ error: 'sourceBatchId is required.', code: 'invalid_request' });
      return;
    }
    const chainKey = typeof body.chainKey === 'string' ? body.chainKey.trim() : undefined;

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: '/banking/escrow/lifecycle/register-batch',
      body: { sourceBatchId, ...(chainKey ? { chainKey } : {}) },
      session: ctx.session,
      authorityClass: 'user',
      scopes: [SCOPES.escrowLifecycleWrite],
      requestId: ctx.requestId,
      // Registration is once-per-batch by nature; a stable key makes a retry
      // return the original result instead of racing a second insert.
      idempotencyKey: `register:${sourceBatchId}:${chainKey ?? 'default'}`,
      timeoutMs: 60_000,
    }));
  },
});
