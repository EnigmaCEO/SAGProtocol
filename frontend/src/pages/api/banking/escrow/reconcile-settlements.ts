// POST /api/banking/escrow/reconcile-settlements
//
// Runs the Fineract reconciliation worker. `dryRun` defaults to true; a live
// run (`dryRun: false`) additionally requires `admin:settlement` on the banking
// server, because it posts to the external ledger.
//
// This handler no longer forwards a client-supplied `x-admin-token` — the
// browser has no administrative credential to offer. Authority comes from the
// wallet session and is asserted server-side.
import { withAuthority } from '../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/reconcile-settlements', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const escrowBatchId = typeof body.escrowBatchId === 'string' && body.escrowBatchId.trim()
      ? body.escrowBatchId.trim()
      : undefined;

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: '/banking/escrow/reconcile-settlements',
      body: { ...(escrowBatchId ? { escrowBatchId } : {}), dryRun: body.dryRun !== false },
      session: ctx.session,
      authorityClass: 'admin',
      scopes: [SCOPES.reconciliationRun],
      requestId: ctx.requestId,
      timeoutMs: 120_000,
    }));
  },
});
