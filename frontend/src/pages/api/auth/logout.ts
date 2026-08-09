// POST /api/auth/logout — clear the wallet session.
//
// Declared public so an already-expired session can still be cleared, but still
// CSRF-protected: `withAuthority` requires a same-origin unsafe method, so a
// third-party site cannot forcibly log a user out.

import { withAuthority } from '../../../lib/security/apiGuard';
import { clearSession } from '../../../lib/security/session';

export default withAuthority('/api/auth/logout', {
  POST: async (_req, res) => {
    clearSession(res);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ authenticated: false });
  },
});
