// POST /api/banking/escrow/admin/simulate-leg-returns
//
// DEV HARNESS ONLY. Mints and burns mUSDC on the configured chain and writes
// `escrow_dev_leg_positions` rows (production_valid: false).
// `withAuthority` returns 404 outside development, before the body is read.
//
// Body: { escrowBatchId, scenarioId, mode }
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/admin/simulate-leg-returns', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const escrowBatchId = typeof body.escrowBatchId === 'string' ? body.escrowBatchId.trim() : '';
    const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId.trim() : '';
    if (!escrowBatchId || !scenarioId) {
      res.status(400).json({ error: 'escrowBatchId and scenarioId are required.', code: 'invalid_request' });
      return;
    }

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: '/banking/escrow/admin/dev/simulate-leg-returns',
      body: { escrowBatchId, scenarioId, mode: body.mode },
      session: ctx.session,
      authorityClass: 'admin',
      scopes: [SCOPES.adminDev],
      requestId: ctx.requestId,
      timeoutMs: 180_000,
    }));
  },
});
