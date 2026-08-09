// GET /api/banking/escrow/audit-onchain/:escrowBatchId
// READ-ONLY. Public read of the aggregated on-chain audit trail.
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { proxyReadToServer } from '../lifecycle/_proxy';

export default withAuthority('/api/banking/escrow/audit-onchain/[escrowBatchId]', {
  GET: (req, res) => {
    const escrowBatchId = typeof req.query.escrowBatchId === 'string' ? req.query.escrowBatchId.trim() : '';
    if (!escrowBatchId) {
      res.status(400).json({ error: 'escrowBatchId is required.', code: 'invalid_request' });
      return;
    }
    return proxyReadToServer(req, res, `/banking/escrow/audit-onchain/${encodeURIComponent(escrowBatchId)}`);
  },
});
