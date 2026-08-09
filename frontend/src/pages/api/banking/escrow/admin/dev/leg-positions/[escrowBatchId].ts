// GET /api/banking/escrow/admin/dev/leg-positions/:escrowBatchId
//
// Development-only administrative read. withAuthority returns 404 outside
// development and requires an admin wallet session with `admin:dev` scope.
import { withAuthority } from '../../../../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../../../../services/shared/routeAuthority';

export default withAuthority('/api/banking/escrow/admin/dev/leg-positions/[escrowBatchId]', {
  GET: async (req, res, ctx) => {
    const escrowBatchId = typeof req.query.escrowBatchId === 'string' ? req.query.escrowBatchId.trim() : '';
    if (!escrowBatchId) {
      res.status(400).json({ error: 'escrowBatchId is required.', code: 'invalid_request' });
      return;
    }
    sendUpstream(res, await callBankingApi({
      method: 'GET',
      path: `/banking/escrow/admin/dev/leg-positions/${encodeURIComponent(escrowBatchId)}`,
      session: ctx.session,
      authorityClass: 'admin',
      scopes: [SCOPES.adminDev],
      requestId: ctx.requestId,
    }));
  },
});
