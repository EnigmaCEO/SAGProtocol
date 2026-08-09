// GET /api/banking/escrow/reconciliation-status?escrowBatchId=
// Public read. Declared in services/shared/routeAuthority.ts.
import { withAuthority } from '../../../../lib/security/apiGuard';
import { proxyReadToServer } from './lifecycle/_proxy';

export default withAuthority('/api/banking/escrow/reconciliation-status', {
  GET: (req, res) => proxyReadToServer(req, res, '/banking/escrow/reconciliation-status'),
});
