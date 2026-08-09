// GET /api/banking/escrow/lifecycle/list?chainKey=
// Public read. Declared in services/shared/routeAuthority.ts.
import { withAuthority } from '../../../../../lib/security/apiGuard';
import { proxyReadToServer } from './_proxy';

export default withAuthority('/api/banking/escrow/lifecycle/list', {
  GET: (req, res) => proxyReadToServer(req, res, '/banking/escrow/lifecycle/list'),
});
