// POST /api/auth/verify — step 2 of wallet sign-in.
//
// Verifies that the presented signature was produced by the claimed address
// over the exact server-built challenge, then resolves that address's authority
// from the on-chain role authority registry and the configured allowlists.
//
// A valid signature proves wallet control. It does NOT by itself grant
// authority — an unrecognized wallet receives a read-only `viewer` session.
//
// The nonce is consumed twice over: the signed cookie proves the challenge was
// issued to THIS browser, and an atomic database claim proves it has never been
// used before by anyone. Neither control alone is sufficient.

import { verifyMessage } from 'ethers';
import { withAuthority } from '../../../lib/security/apiGuard';
import { consumeNonceCookie, issueSession, publicSessionView } from '../../../lib/security/session';
import { buildLoginMessage, LOGIN_CHALLENGE_TTL_SECONDS } from '../../../lib/security/loginMessage';
import { nonceStore } from '../../../lib/security/nonceStore';
import { resolveWalletAuthority } from '../../../lib/security/walletAuthority';
import { frontendSecurityConfig } from '../../../lib/security/config';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/** Uniform failure. A probe must not learn which check failed. */
function rejectChallenge(res: any): void {
  res.status(401).json({
    error: 'Sign-in challenge is invalid or expired. Request a new one.',
    code: 'bad_challenge',
  });
}

export default withAuthority('/api/auth/verify', {
  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
    const issuedAt = typeof body.issuedAt === 'string' ? body.issuedAt.trim() : '';
    const expirationTime = typeof body.expirationTime === 'string' ? body.expirationTime.trim() : '';

    if (!ADDRESS_PATTERN.test(address) || !signature || !nonce || !issuedAt || !expirationTime) {
      res.status(400).json({ error: 'address, signature, nonce, issuedAt, and expirationTime are required.', code: 'invalid_request' });
      return;
    }

    // 1. The cookie proves this challenge was issued to this browser.
    //    Cleared whether or not the attempt succeeds.
    if (!consumeNonceCookie(req, res, nonce)) {
      rejectChallenge(res);
      return;
    }

    // 2. Timestamps are inside the signed message, so they cannot be swapped
    //    without invalidating the signature — but they still have to be sane.
    const issuedMs = Date.parse(issuedAt);
    const expiresMs = Date.parse(expirationTime);
    const now = Date.now();
    if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) { rejectChallenge(res); return; }
    if (now > expiresMs) { rejectChallenge(res); return; }
    if (Math.abs(now - issuedMs) > LOGIN_CHALLENGE_TTL_SECONDS * 1000) { rejectChallenge(res); return; }
    if (expiresMs - issuedMs > LOGIN_CHALLENGE_TTL_SECONDS * 1000) { rejectChallenge(res); return; }

    // 3. Atomic single-use claim: exactly one attempt may ever consume a nonce,
    //    regardless of concurrency or which instance serves the request.
    let claimed: boolean;
    try {
      claimed = await nonceStore().claim(nonce, Math.floor(expiresMs / 1000));
    } catch (err: any) {
      console.error('[security] Sign-in nonce store unavailable', { message: String(err?.message ?? err) });
      res.status(503).json({ error: 'Sign-in is temporarily unavailable.', code: 'nonce_store_unavailable' });
      return;
    }
    if (!claimed) { rejectChallenge(res); return; }

    // 4. Rebuild the challenge server-side. Domain, URI, and chain id come from
    //    this server's own configuration and the already-validated same-origin
    //    header — never from the request body — so a caller cannot choose which
    //    domain or chain the signature is considered valid for.
    const config = frontendSecurityConfig();
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    let uri: string;
    try {
      const parsed = new URL(originHeader);
      uri = `${parsed.protocol}//${parsed.host}`;
    } catch {
      uri = config.allowedOrigins[0];
    }
    const domain = new URL(uri).host;

    const message = buildLoginMessage({
      address, nonce, domain, uri,
      chainId: config.chainId,
      issuedAt,
      expirationTime,
    });

    let recovered: string;
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      rejectChallenge(res);
      return;
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(), kind: 'security_audit', service: 'protocol-frontend',
        requestId: ctx.requestId, result: 'denied', reason: 'signature_address_mismatch',
      }));
      rejectChallenge(res);
      return;
    }

    const authority = await resolveWalletAuthority(address);
    const session = issueSession(res, {
      address,
      role: authority.role,
      institutionId: authority.institutionId,
    });

    console.log(JSON.stringify({
      ts: new Date().toISOString(), kind: 'security_audit', service: 'protocol-frontend',
      requestId: ctx.requestId, result: 'allowed', event: 'wallet_signin',
      subject: session.address, role: authority.role, authoritySource: authority.source,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(publicSessionView(session));
  },
});
