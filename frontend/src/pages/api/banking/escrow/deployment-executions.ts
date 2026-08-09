// /api/banking/escrow/deployment-executions
//
// GET  — public read of the stored multisig execution record.
// POST — records a client-side multisig execution. Requires a wallet session
//        holding `escrow:deployment:write`.
//
// WHAT CHANGED
//   The POST branch previously accepted any request when INTERNAL_API_TOKEN was
//   unset, and forwarded to the banking server with no credential at all. Both
//   halves of that are gone: authority now comes from the verified wallet
//   session, and the upstream call carries a scoped assertion.

import { withAuthority } from '../../../../lib/security/apiGuard';
import { callBankingApi, sendUpstream } from '../../../../lib/security/upstream';
import { SCOPES } from '../../../../../../services/shared/routeAuthority';

const RECORDS_PATH = '/banking/escrow/deployment-records';

export default withAuthority('/api/banking/escrow/deployment-executions', {
  GET: async (req, res, ctx) => {
    const batchUuid = typeof req.query.batchUuid === 'string' ? req.query.batchUuid.trim() : '';
    if (!batchUuid) {
      res.status(400).json({ error: 'batchUuid query parameter is required.', code: 'invalid_request' });
      return;
    }
    sendUpstream(res, await callBankingApi({
      method: 'GET',
      path: RECORDS_PATH,
      query: { batchUuid },
      session: null,
      authorityClass: 'public',
      scopes: [],
      requestId: ctx.requestId,
    }));
  },

  POST: async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const batchUuid = typeof body.batchUuid === 'string' ? body.batchUuid.trim() : '';
    if (!batchUuid || !body.execution?.deploymentId) {
      res.status(400).json({ error: 'batchUuid and execution.deploymentId are required.', code: 'invalid_request' });
      return;
    }

    // Pre-check kept from the original handler: surface an existing record as a
    // 409 rather than proxying a duplicate write. The banking server's
    // idempotency guard is the authoritative protection; this is a nicer error.
    const existing = await callBankingApi({
      method: 'GET',
      path: RECORDS_PATH,
      query: { batchUuid },
      session: null,
      authorityClass: 'public',
      scopes: [],
      requestId: ctx.requestId,
    });
    if (existing.status === 200 && (existing.data as any)?.execution != null) {
      res.status(409).json({
        error: 'Execution record already exists for this batch UUID.',
        existing: (existing.data as any).execution,
      });
      return;
    }

    sendUpstream(res, await callBankingApi({
      method: 'POST',
      path: RECORDS_PATH,
      body: { batchUuid, execution: body.execution },
      session: ctx.session,
      authorityClass: 'user',
      scopes: [SCOPES.escrowDeploymentWrite],
      requestId: ctx.requestId,
    }));
  },
});
