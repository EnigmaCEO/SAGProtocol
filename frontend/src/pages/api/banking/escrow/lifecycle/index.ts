// GET /api/banking/escrow/lifecycle?escrowBatchId=
// Public read. Declared in services/shared/routeAuthority.ts.
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { proxyReadToServer } from './_proxy';

export default withAuthority('/api/banking/escrow/lifecycle', {
  GET: (req, res) => proxyReadToServer(req, res, '/banking/escrow/lifecycle'),
});
