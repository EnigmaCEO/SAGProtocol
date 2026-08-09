// POST /api/banking/escrow/admin/finalize-settlement
//
// Calls depositReturnForBatch() on InvestmentEscrow, which auto-triggers
// finalizeBatchSettlement — an on-chain, money-moving operation. Requires an
// admin wallet session holding `admin:settlement`.
//
// Body: { escrowBatchId: string, finalNavPerShare?: string }
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/admin/finalize-settlement', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const escrowBatchId = typeof body.escrowBatchId === 'string' ? body.escrowBatchId.trim() : '';
    if (!escrowBatchId) {
      res.status(400).json({ error: 'escrowBatchId is required.', code: 'invalid_request' });
      return;
    }
    const finalNavPerShare = typeof body.finalNavPerShare === 'string' ? body.finalNavPerShare.trim() : undefined;

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: '/banking/escrow/admin/finalize-settlement',
      body: { escrowBatchId, ...(finalNavPerShare ? { finalNavPerShare } : {}) },
      session: ctx.session,
      authorityClass: 'admin',
      scopes: [SCOPES.adminSettlement],
      requestId: ctx.requestId,
      // A batch settles once. This key stops a retry from submitting a second
      // depositReturnForBatch transaction.
      idempotencyKey: `finalize:${escrowBatchId}`,
      timeoutMs: 120_000,
    }));
  },
});
