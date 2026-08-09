// GET /api/auth/nonce — step 1 of wallet sign-in.
//
// Issues a single-use nonce and binds it to a signed HttpOnly cookie. The
// client asks its wallet to sign a message containing this nonce; /verify
// rebuilds that message server-side and checks the signature against it.

import { withAuthority } from '../../../lib/security/apiGuard';
import { issueNonce } from '../../../lib/security/session';
import { LOGIN_CHALLENGE_TTL_SECONDS } from '../../../lib/security/loginMessage';
import { frontendSecurityConfig } from '../../../lib/security/config';

export default withAuthority('/api/auth/nonce', {
  GET: async (_req, res) => {
    const nonce = issueNonce(res);
    const issuedAt = new Date();
    const expirationTime = new Date(issuedAt.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * 1000);

    // The server dictates every field of the challenge. The client echoes them
    // back verbatim; it never chooses the domain, chain, or validity window.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      nonce,
      chainId: frontendSecurityConfig().chainId,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
    });
  },
});
