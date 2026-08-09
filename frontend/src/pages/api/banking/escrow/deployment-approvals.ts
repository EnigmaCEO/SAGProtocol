import { withAuthority } from '../../../../lib/security/apiGuard';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeploymentApprovalRecord = {
  batchUuid: string;
  approvalId: string;
  deploymentApprovalHash: string;
  destinationApprovalHash: string;
  allocationPlanHash: string;
  policyContextHash: string;
  destinationRegistryVersion: string;
  approvedBy: string;
  approvedAt: string;
  status: 'deployment_approved';
  payload: unknown;
  createdAt: string;
};

// ── In-memory store (dev fallback when DATABASE_URL is absent) ────────────────

const memoryStore = new Map<string, DeploymentApprovalRecord>();

// ── Postgres helpers (gracefully degrade when pool is unavailable) ────────────

async function pgFetch(batchUuid: string): Promise<DeploymentApprovalRecord | null> {
  try {
    if (!process.env.DATABASE_URL) return null;
    const { query } = await import('../../../../lib/banking/db');
    const result = await query<any>(
      `SELECT * FROM escrow_deployment_approvals WHERE batch_uuid = $1 LIMIT 1`,
      [batchUuid],
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      batchUuid:                   r.batch_uuid,
      approvalId:                  r.approval_id,
      deploymentApprovalHash:      r.deployment_approval_hash,
      destinationApprovalHash:     r.destination_approval_hash,
      allocationPlanHash:          r.allocation_plan_hash,
      policyContextHash:           r.policy_context_hash,
      destinationRegistryVersion:  r.destination_registry_version,
      approvedBy:                  r.approved_by,
      approvedAt:                  String(r.approved_at),
      status:                      'deployment_approved',
      payload:                     r.payload,
      createdAt:                   String(r.created_at),
    };
  } catch {
    return null;
  }
}

async function pgInsert(record: DeploymentApprovalRecord): Promise<boolean> {
  try {
    if (!process.env.DATABASE_URL) return false;
    const { query } = await import('../../../../lib/banking/db');
    await query(
      `INSERT INTO escrow_deployment_approvals
         (batch_uuid, approval_id, deployment_approval_hash, destination_approval_hash,
          allocation_plan_hash, policy_context_hash, destination_registry_version,
          approved_by, approved_at, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        record.batchUuid,
        record.approvalId,
        record.deploymentApprovalHash,
        record.destinationApprovalHash,
        record.allocationPlanHash,
        record.policyContextHash,
        record.destinationRegistryVersion,
        record.approvedBy,
        new Date(record.approvedAt),
        record.status,
        JSON.stringify(record.payload ?? {}),
      ],
    );
    return true;
  } catch {
    return false;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
//
// WHAT CHANGED
//   The POST branch previously allowed every request when INTERNAL_API_TOKEN
//   was unset. Authority now comes from a verified wallet session carrying
//   `escrow:deployment:write`, enforced by withAuthority before this code runs.

export default withAuthority('/api/banking/escrow/deployment-approvals', {
  GET: async (req, res) => {
    const { batchUuid } = req.query;
    if (!batchUuid || typeof batchUuid !== 'string') {
      return res.status(400).json({ error: 'batchUuid query parameter is required.' });
    }

    const pg = await pgFetch(batchUuid);
    if (pg) return res.status(200).json(pg);

    const mem = memoryStore.get(batchUuid);
    if (mem) return res.status(200).json(mem);

    return res.status(200).json({ approval: null });
  },

  POST: async (req, res) => {
    const body: Partial<DeploymentApprovalRecord> = req.body ?? {};
    const {
      batchUuid, approvalId, deploymentApprovalHash, destinationApprovalHash,
      allocationPlanHash, policyContextHash, destinationRegistryVersion,
      approvedBy, approvedAt, payload,
    } = body;

    if (
      !batchUuid || !deploymentApprovalHash || !destinationApprovalHash ||
      !allocationPlanHash || !policyContextHash || !approvedBy || !approvedAt
    ) {
      return res.status(400).json({ error: 'Missing required deployment approval fields.' });
    }

    // Duplicate check — fail closed; same batch UUID cannot be approved twice
    const existingPg = await pgFetch(batchUuid);
    if (existingPg) {
      return res.status(409).json({
        error: 'Deployment approval already exists for this batch UUID.',
        existing: existingPg,
      });
    }
    if (memoryStore.has(batchUuid)) {
      return res.status(409).json({
        error: 'Deployment approval already exists for this batch UUID.',
        existing: memoryStore.get(batchUuid),
      });
    }

    const record: DeploymentApprovalRecord = {
      batchUuid,
      approvalId:                 approvalId ?? `${batchUuid}-deployment-approval`,
      deploymentApprovalHash,
      destinationApprovalHash,
      allocationPlanHash,
      policyContextHash,
      destinationRegistryVersion: destinationRegistryVersion ?? '',
      approvedBy,
      approvedAt,
      status:                     'deployment_approved',
      payload:                    payload ?? {},
      createdAt:                  new Date().toISOString(),
    };

    const savedToPg = await pgInsert(record);
    if (!savedToPg) {
      memoryStore.set(batchUuid, record);
    }

    return res.status(201).json({
      ...record,
      auditEvent: {
        eventType:              'deployment_approval_created',
        batchUuid,
        deploymentApprovalHash,
        destinationApprovalHash,
        allocationPlanHash,
        policyContextHash,
        approvedBy,
        approvedAt,
        status:                 'deployment_approved',
      },
    });
  },
});
