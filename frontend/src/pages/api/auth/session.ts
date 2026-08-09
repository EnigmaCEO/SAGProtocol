// GET /api/auth/session — current wallet session, or an unauthenticated marker.
//
// Returns only the public view: address, role, scopes, tenant, expiry. Never the
// cookie value, the session secret, or anything that could reconstruct either.

import { withAuthority } from '../../../lib/security/apiGuard';
import { readSession, publicSessionView } from '../../../lib/security/session';

export default withAuthority('/api/auth/session', {
  GET: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(publicSessionView(readSession(req)));
  },
});
