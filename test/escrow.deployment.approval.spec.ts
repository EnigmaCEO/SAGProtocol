/**
 * Deployment Approval Gate — unit-level invariant tests.
 *
 * These are self-contained (no contract deployment required) and run via the
 * standard `npm test` / `hardhat test` command alongside the on-chain specs.
 *
 * The logic inlined below mirrors frontend/src/components/tabs/escrowDeploymentApproval.ts
 * and the modules it depends on.  If you change the production logic, keep
 * these invariant proofs in sync.
 */

import { expect } from 'chai';
import { keccak256, toUtf8Bytes } from 'ethers';

// ── canonical hash ────────────────────────────────────────────────────────────

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(sortedJson).join(',') + ']';
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedJson((value as any)[k])).join(',') + '}';
}

function canonicalKeccak(obj: unknown): string {
  return keccak256(toUtf8Bytes(sortedJson(obj)));
}

function equalHash(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

// ── Test constants ────────────────────────────────────────────────────────────

const BATCH_UUID        = '11111111-1111-1111-1111-111111111111';
const OTHER_UUID        = '22222222-2222-2222-2222-222222222222';
const WALLET_ADDRESS    = '0x1234567890123456789012345678901234567890';
const LIQUIDITY_ADDR    = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REGISTRY_VERSION  = 'dao-destination-registry-v1';
const DEST_ID           = 'dao-dest-arc-usdc-liquidity';
const ATTACHED_AT       = '2026-06-01T10:00:00.000Z';
const APPROVED_AT       = '2026-06-01T12:00:00.000Z';
const CHAIN             = 'arc_testnet';

// ── Minimal allocation plan + hash ────────────────────────────────────────────

const ALLOC_PLAN = {
  target_weights:    { USDC: 1 },
  allocator_version: 'protocol_deterministic_v1',
  schema_version:    'tick_v1',
  role_by_asset:     { USDC: 'core' },
  policy_snapshot:   { constraint: 'none' },
  linkage_scope:     'escrow',
  meta: {
    allocator:                   'sagitta_deterministic',
    constraints:                 [] as string[],
    allocator_version_effective: '2026-01-01',
  },
};

function canonicalPlanFields(plan: typeof ALLOC_PLAN) {
  return {
    target_weights:    plan.target_weights,
    allocator_version: plan.allocator_version,
    schema_version:    plan.schema_version,
    role_by_asset:     plan.role_by_asset,
    policy_snapshot:   plan.policy_snapshot,
    linkage_scope:     plan.linkage_scope,
    meta: {
      allocator:                   plan.meta.allocator,
      constraints:                 plan.meta.constraints,
      allocator_version_effective: plan.meta.allocator_version_effective,
    },
  };
}

const ALLOC_PLAN_HASH   = canonicalKeccak(canonicalPlanFields(ALLOC_PLAN));
const POLICY_CTX_HASH   = canonicalKeccak({ type: 'sagitta_policy_context_v1', portfolioRegistryVersion: 'v1', asset: 'USDC' });

// ── Minimal DAO destination registry (hard-coded address) ────────────────────

const DAO_DEST_REGISTRY = [
  {
    destinationId:            DEST_ID,
    destinationAddress:       LIQUIDITY_ADDR,
    label:                    'Arc USDC Liquidity Sleeve',
    chain:                    CHAIN as 'arc_testnet',
    asset:                    'USDC',
    providerType:             'liquidity' as const,
    riskTier:                 'low' as const,
    allowedActions:           ['deploy_batch', 'settle_batch'] as string[],
    maxExposureUsd:           100_000_000,
    approvalStatus:           'dao_approved' as const,
    destinationRegistryVersion: REGISTRY_VERSION,
  },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeDestinationApprovalHash(legId: string, amountUsd: number) {
  return canonicalKeccak({
    batchId:                    BATCH_UUID,
    legId,
    destinationId:              DEST_ID,
    destinationAddress:         LIQUIDITY_ADDR,
    amountUsd,
    allocationPlanHash:         ALLOC_PLAN_HASH,
    policyContextHash:          POLICY_CTX_HASH,
    destinationRegistryVersion: REGISTRY_VERSION,
  });
}

function makeDestinationApproval(legId: string, amountUsd: number, overrides: Record<string, any> = {}) {
  return {
    approvalId:                 `${BATCH_UUID}-${legId}-destination-approval`,
    batchId:                    BATCH_UUID,
    legId,
    destinationId:              DEST_ID,
    destinationAddress:         LIQUIDITY_ADDR,
    amountUsd,
    asset:                      'USDC',
    chain:                      CHAIN,
    allocationPlanHash:         ALLOC_PLAN_HASH,
    policyContextHash:          POLICY_CTX_HASH,
    destinationRegistryVersion: REGISTRY_VERSION,
    destinationApprovalHash:    makeDestinationApprovalHash(legId, amountUsd),
    approvalStatus:             'approved' as const,
    reviewedBy:                 'Escrow Operator',
    reviewedAt:                 APPROVED_AT,
    approvedBy:                 'Escrow Operator',
    approvedAt:                 APPROVED_AT,
    ...overrides,
  };
}

// ── Full-prerequisites batch fixture ─────────────────────────────────────────

function makeFullBatch(overrides: Record<string, any> = {}): any {
  const legId = 'leg-001';
  const amountUsd = 1_000_000;

  return {
    batchId:                  BATCH_UUID,
    status:                   'aaa_plan_attached',
    custodyMode:              'batch_wallet_custody',
    asset:                    'USDC',
    totalAmountUsd:           amountUsd,
    expectedFundingAmountUsd: amountUsd,
    observedWalletBalanceUsd: amountUsd,
    fundingVerifiedAt:        ATTACHED_AT,
    termMonths:               12,
    sourceBatchId:            'treasury-batch-001',
    sourceContract:           null,
    wallet: {
      walletAddress:  WALLET_ADDRESS,
      address:        WALLET_ADDRESS,
      fundingStatus:  'verified',
      chain:          CHAIN,
    },
    batchWalletBinding: {
      bindingStatus: 'binding_locked',
      bindingHash:   '0xbinding',
    },
    batchAuthorityBinding: {
      bindingId:                'binding-001',
      treasurySignature:        '0xtreasurysig',
      escrowSignature:          '0xescrowsig',
      treasurySignatureStatus:  'signed',
      escrowSignatureStatus:    'signed',
      anchorStatus:             'anchored',
      batchAuthorityBindingHash:'0xbindHash',
      canonicalPayload: { escrowBatchId: BATCH_UUID },
    },
    treasuryHandoff: {
      handoffId:           'handoff-001',
      approvedByTreasury:  true,
      approvedAt:          ATTACHED_AT,
      depositManifestHash: '0xmanifest',
    },
    deposits: [],
    aaaAllocation: {
      planId:                  'plan-001',
      status:                  'validated',
      allocationPlan:          ALLOC_PLAN,
      allocationPlanHash:      ALLOC_PLAN_HASH,
      policyContextHash:       POLICY_CTX_HASH,
      portfolioRegistryVersion:'portfolio-registry-v1',
      targetYieldBps:          400,
      attachedAt:              ATTACHED_AT,
    },
    deploymentApproval: { status: 'missing' },
    deploymentLegs: [
      {
        legId,
        provider:       'liquidity',
        asset:          'USDC',
        strategyType:   'liquidity',
        amountUsd,
        allocationPercent: 100,
        targetYieldBps: 400,
        status:         'planned',
      },
    ],
    destinationApprovals: [makeDestinationApproval(legId, amountUsd)],
    fundingConfirmations: [
      {
        fundingConfirmationId: 'conf-001',
        batchId:               BATCH_UUID,
        batchWalletAddress:    WALLET_ADDRESS,
        expectedAmountUsd:     amountUsd,
        observedAmountUsd:     amountUsd,
        asset:                 'USDC',
        fundingStatus:         'verified',
        confirmedBy:           'Escrow Operator',
        confirmedAt:           ATTACHED_AT,
        verifiedAt:            ATTACHED_AT,
      },
    ],
    deploymentExecutions: [],
    signingRequests:       [],
    performance:  { projectedYieldUsd: 40_000 },
    settlement: {
      maturityDate:          '2027-06-01T00:00:00.000Z',
      status:                'not_due',
      walletRetirementStatus:'not_eligible',
    },
    auditTrail: [],
    ...overrides,
  };
}

// ── Logic under test (mirrors escrowDeploymentApproval.ts) ───────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function hasActiveCustody(b: any): boolean {
  if (b.custodyMode === 'escrow_contract_custody') {
    return Boolean(b.sourceContract) && Boolean(b.sourceBatchId);
  }
  return b.wallet.fundingStatus !== 'not_created' && Boolean(b.wallet.address);
}

function hasLockedWalletBinding(b: any): boolean {
  if (b.custodyMode === 'escrow_contract_custody') return hasActiveCustody(b);
  return b.batchWalletBinding?.bindingStatus === 'binding_locked';
}

function isFundingGateOpen(b: any): boolean {
  if (b.custodyMode === 'escrow_contract_custody') {
    return b.batchAuthorityBinding?.anchorStatus === 'anchored';
  }
  return hasLockedWalletBinding(b);
}

function getFundingVerificationState(b: any): 'verified' | 'mismatch' | 'pending' {
  const latest = [...(b.fundingConfirmations ?? [])]
    .sort((a: any, c: any) => c.confirmedAt.localeCompare(a.confirmedAt))[0];
  if (!latest) return 'pending';
  if (latest.fundingStatus === 'mismatch') return 'mismatch';
  if (latest.fundingStatus === 'verified') {
    if (typeof latest.observedAmountUsd === 'number' &&
        latest.observedAmountUsd !== b.expectedFundingAmountUsd) return 'mismatch';
    return 'verified';
  }
  return 'pending';
}

function hasRequiredSignatures(b: any): boolean {
  const binding = b.batchAuthorityBinding;
  return Boolean(
    binding &&
    binding.treasurySignature &&
    binding.escrowSignature &&
    binding.treasurySignatureStatus === 'signed' &&
    binding.escrowSignatureStatus === 'signed',
  );
}

function isAuthorityAnchored(b: any): boolean {
  return b.batchAuthorityBinding?.anchorStatus === 'anchored';
}

function hasValidatedAllocation(b: any): boolean {
  const a = b.aaaAllocation;
  return (
    ['validated', 'locked', 'deployed'].includes(a.status) &&
    Boolean(a.allocationPlan) &&
    Boolean(a.allocationPlanHash) &&
    Boolean(a.policyContextHash) &&
    Boolean(a.portfolioRegistryVersion)
  );
}

function allocationHashMatches(b: any): boolean {
  const plan = b.aaaAllocation.allocationPlan;
  if (!plan || !b.aaaAllocation.allocationPlanHash) return false;
  return equalHash(canonicalKeccak(canonicalPlanFields(plan)), b.aaaAllocation.allocationPlanHash);
}

function isApprovalBoundToAllocation(b: any, approval: any): boolean {
  const attachedAt = b.aaaAllocation.attachedAt;
  return Boolean(
    hasValidatedAllocation(b) &&
    attachedAt &&
    approval.approvedAt &&
    new Date(approval.approvedAt).getTime() >= new Date(attachedAt).getTime() &&
    approval.approvalStatus === 'approved' &&
    approval.destinationApprovalHash &&
    equalHash(approval.allocationPlanHash, b.aaaAllocation.allocationPlanHash) &&
    equalHash(approval.policyContextHash, b.aaaAllocation.policyContextHash),
  );
}

function areBatchDestinationsApproved(b: any): boolean {
  if (!hasValidatedAllocation(b)) return false;
  const legs: any[] = b.deploymentLegs;
  if (legs.length === 0) return false;
  return legs.every((leg) => {
    const approval = (b.destinationApprovals ?? []).find((a: any) => a.legId === leg.legId);
    const destination = DAO_DEST_REGISTRY.find((d) => d.destinationId === approval?.destinationId);
    return (
      Boolean(approval && isApprovalBoundToAllocation(b, approval)) &&
      Boolean(approval.destinationRegistryVersion) &&
      destination?.approvalStatus === 'dao_approved'
    );
  });
}

function getBatchDestinationApprovalHash(b: any): string {
  if (!areBatchDestinationsApproved(b)) return '';
  const legs: any[] = b.deploymentLegs;
  const approvals: any[] = b.destinationApprovals ?? [];
  const records = legs
    .slice()
    .sort((a, c) => a.legId.localeCompare(c.legId))
    .map((leg) => {
      const approval = approvals.find((a) => a.legId === leg.legId);
      const dest = DAO_DEST_REGISTRY.find((d) => d.destinationId === approval?.destinationId);
      return {
        allocationLegId:         leg.legId,
        asset:                   leg.asset || b.asset || 'USDC',
        amount:                  Number(leg.amountUsd.toFixed(6)),
        weight:                  Number((leg.allocationPercent / 100).toFixed(12)),
        destinationId:           approval?.destinationId ?? '',
        destinationName:         dest?.label ?? '',
        destinationType:         dest?.providerType ?? '',
        destinationAddress:      approval?.destinationAddress ?? '',
        destinationChain:        approval?.chain ?? b.wallet.chain,
        destinationApprovalHash: approval?.destinationApprovalHash ?? '',
        destinationRegistryVersion: approval?.destinationRegistryVersion ?? '',
      };
    });

  return canonicalKeccak({
    type:                    'sagitta_destination_approval_set_v1',
    batchUuid:               b.batchId,
    allocationPlanHash:      b.aaaAllocation.allocationPlanHash,
    policyContextHash:       b.aaaAllocation.policyContextHash,
    destinationRegistryVersion: records[0]?.destinationRegistryVersion ?? '',
    deploymentLegs:          records,
  });
}

function hasDeploymentStarted(b: any): boolean {
  return (
    (b.deploymentExecutions ?? []).length > 0 ||
    b.deploymentLegs.some((leg: any) => ['deployed', 'monitoring', 'settled'].includes(leg.status)) ||
    ['deployed', 'active', 'settlement_pending', 'settled', 'retired'].includes(b.status)
  );
}

function getDeploymentApprovalBlockingReason(b: any): string | null {
  if (!isUuid(b.batchId))
    return 'Batch UUID is missing or invalid.';
  if (b.deploymentApproval.status === 'approved' && b.deploymentApproval.deploymentApprovalHash)
    return 'Deployment approval already exists for this batch UUID.';
  if (['exception', 'disputed'].includes(b.status))
    return 'Incident, dispute, or SCE block is active.';
  if (hasDeploymentStarted(b))
    return 'Batch is already deployed or deployment execution has started.';
  if (!hasActiveCustody(b))
    return 'Batch custody is not active.';
  if (!isFundingGateOpen(b))
    return 'Wallet binding or authority gate is not locked.';
  if (!hasLockedWalletBinding(b))
    return 'Wallet binding is not locked.';
  if (getFundingVerificationState(b) !== 'verified')
    return 'Funding is not verified.';
  if (!hasRequiredSignatures(b))
    return 'Treasury and Escrow signatures are both required.';
  if (!isAuthorityAnchored(b))
    return 'Authority binding is not anchored.';
  if (!hasValidatedAllocation(b))
    return 'AAA allocation is missing.';
  if (!b.aaaAllocation.allocationPlanHash)
    return 'Allocation plan hash is missing.';
  if (!b.aaaAllocation.policyContextHash)
    return 'Policy context hash is missing.';
  if (!allocationHashMatches(b))
    return 'Recomputed allocation JSON hash does not match the stored allocation plan hash.';
  if (!areBatchDestinationsApproved(b))
    return 'Destination approval is missing.';

  const destHash = getBatchDestinationApprovalHash(b);
  if (!destHash)
    return 'Destination approval hash is missing.';

  const approvals: any[] = b.destinationApprovals ?? [];
  if (approvals.some((a) => !a.destinationRegistryVersion))
    return 'Destination registry version is missing.';
  if (approvals.some((a) => !a.destinationApprovalHash))
    return 'A destination approval hash is missing.';

  return null;
}

function canApproveDeployment(b: any): boolean {
  return getDeploymentApprovalBlockingReason(b) === null;
}

function hasDeploymentApproval(b: any): boolean {
  if (b.deploymentApproval.status !== 'approved') return false;
  if (!b.deploymentApproval.deploymentApprovalHash || !b.deploymentApproval.destinationApprovalHash) return false;
  return equalHash(getBatchDestinationApprovalHash(b), b.deploymentApproval.destinationApprovalHash);
}

function buildDeploymentApprovalPayload(b: any, approvedBy: string, approvedAt: string) {
  const destinationApprovalHash = getBatchDestinationApprovalHash(b);
  const approvals: any[] = b.destinationApprovals ?? [];
  const legs = b.deploymentLegs
    .slice()
    .sort((a: any, c: any) => a.legId.localeCompare(c.legId))
    .map((leg: any) => {
      const approval = approvals.find((a) => a.legId === leg.legId);
      const dest = DAO_DEST_REGISTRY.find((d) => d.destinationId === approval?.destinationId);
      return {
        asset:                leg.asset || b.asset || 'USDC',
        amount:               Number(leg.amountUsd.toFixed(6)),
        weight:               Number((leg.allocationPercent / 100).toFixed(12)),
        approvedDestinationId:approval?.destinationId ?? '',
        destinationAddress:   approval?.destinationAddress ?? '',
        destinationType:      dest?.providerType ?? '',
        destinationChain:     approval?.chain ?? b.wallet.chain,
        allocationLegId:      leg.legId,
      };
    });

  return {
    batchUuid:                  b.batchId,
    batchWalletAddress:         b.wallet.walletAddress ?? b.wallet.address,
    treasuryBatchId:            b.sourceBatchId ?? b.treasuryHandoff.handoffId,
    escrowBatchId:              b.batchAuthorityBinding?.canonicalPayload?.escrowBatchId ?? b.batchId,
    allocationPlanHash:         b.aaaAllocation.allocationPlanHash,
    policyContextHash:          b.aaaAllocation.policyContextHash,
    destinationApprovalHash,
    destinationRegistryVersion: approvals[0]?.destinationRegistryVersion ?? '',
    deploymentLegs:             legs,
    targetChainId:              b.wallet.chain,
    approvedBy,
    approvedAt,
    deploymentApprovalStatus:   'deployment_approved' as const,
  };
}

function createDeploymentApprovalEvidence(b: any, approvedBy = 'Escrow Operator', approvedAt = APPROVED_AT) {
  const payload = buildDeploymentApprovalPayload(b, approvedBy, approvedAt);
  const deploymentApprovalHash = canonicalKeccak(payload);
  return {
    approvalId:                 `${b.batchId}-deployment-approval`,
    batchId:                    b.batchId,
    deploymentApprovalHash,
    destinationApprovalHash:    payload.destinationApprovalHash,
    allocationPlanHash:         payload.allocationPlanHash,
    policyContextHash:          payload.policyContextHash,
    destinationRegistryVersion: payload.destinationRegistryVersion,
    approvedBy,
    approvedAt,
    status:                     'deployment_approved' as const,
    payload,
  };
}

function approveDeployment(b: any, approvedBy = 'Escrow Operator', approvedAt = APPROVED_AT): any {
  if (!canApproveDeployment(b)) return b;
  const evidence = createDeploymentApprovalEvidence(b, approvedBy, approvedAt);
  return {
    ...b,
    status: 'deployment_pending',
    deploymentApproval: {
      status:                     'approved',
      approvedBy:                 evidence.approvedBy,
      approvedAt:                 evidence.approvedAt,
      deploymentApprovalHash:     evidence.deploymentApprovalHash,
      destinationApprovalHash:    evidence.destinationApprovalHash,
      allocationPlanHash:         evidence.allocationPlanHash,
      policyContextHash:          evidence.policyContextHash,
      destinationRegistryVersion: evidence.destinationRegistryVersion,
      payload:                    evidence.payload,
      evidence,
    },
    deploymentLegs: b.deploymentLegs.map((leg: any) =>
      leg.status === 'planned' ? { ...leg, status: 'approved' } : leg,
    ),
  };
}

// ── In-memory deployment approval store (mirrors the API route) ───────────────

class DeploymentApprovalStore {
  private store = new Map<string, any>();

  has(batchUuid: string) { return this.store.has(batchUuid); }
  get(batchUuid: string) { return this.store.get(batchUuid) ?? null; }

  save(evidence: any): { status: 'created' | 'conflict'; existing?: any } {
    if (this.store.has(evidence.batchId)) {
      return { status: 'conflict', existing: this.store.get(evidence.batchId) };
    }
    this.store.set(evidence.batchId, evidence);
    return { status: 'created' };
  }

  clear() { this.store.clear(); }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Deployment Approval Gate', function () {
  const store = new DeploymentApprovalStore();

  beforeEach(() => store.clear());

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('approves deployment when all prerequisites are met', function () {
    const batch = makeFullBatch();
    expect(canApproveDeployment(batch)).to.equal(true);
    const approved = approveDeployment(batch);
    expect(approved.status).to.equal('deployment_pending');
    expect(approved.deploymentApproval.status).to.equal('approved');
    expect(approved.deploymentApproval.deploymentApprovalHash).to.be.a('string').with.length.above(10);
    expect(hasDeploymentApproval(approved)).to.equal(true);
  });

  it('marks all planned legs as approved after deployment approval', function () {
    const batch = makeFullBatch();
    const approved = approveDeployment(batch);
    expect(approved.deploymentLegs.every((l: any) => l.status === 'approved')).to.equal(true);
  });

  it('status stays deployment_pending — batch is not marked deployed', function () {
    const approved = approveDeployment(makeFullBatch());
    expect(approved.status).to.equal('deployment_pending');
    expect(['deployed', 'active', 'settled']).not.to.include(approved.status);
  });

  // ── Prerequisite failures ──────────────────────────────────────────────────

  it('fails when destinations are not approved', function () {
    const batch = makeFullBatch({ destinationApprovals: [] });
    expect(canApproveDeployment(batch)).to.equal(false);
    const reason = getDeploymentApprovalBlockingReason(batch);
    expect(reason).to.be.a('string').that.is.not.empty;
  });

  it('fails when funding is not verified', function () {
    const batch = makeFullBatch({
      fundingConfirmations: [
        {
          fundingConfirmationId: 'conf-x',
          batchId:               BATCH_UUID,
          batchWalletAddress:    WALLET_ADDRESS,
          expectedAmountUsd:     1_000_000,
          observedAmountUsd:     500_000,
          asset:                 'USDC',
          fundingStatus:         'verified',
          confirmedBy:           'Escrow Operator',
          confirmedAt:           ATTACHED_AT,
          verifiedAt:            ATTACHED_AT,
        },
      ],
    });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.include('Funding');
  });

  it('fails when wallet binding is not locked', function () {
    const batch = makeFullBatch({ batchWalletBinding: { bindingStatus: 'binding_pending' } });
    expect(canApproveDeployment(batch)).to.equal(false);
    const reason = getDeploymentApprovalBlockingReason(batch);
    expect(reason).to.be.a('string').that.matches(/binding|gate/i);
  });

  it('fails when AAA allocation evidence is missing from the batch', function () {
    const batch = makeFullBatch({
      aaaAllocation: {
        planId:                   'plan-001',
        status:                   'missing',
        allocationPlan:           null,
        allocationPlanHash:       '',
        policyContextHash:        '',
        portfolioRegistryVersion: '',
        targetYieldBps:           0,
      },
    });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.include('AAA allocation');
  });

  it('fails when allocation hash does not match the recomputed plan hash', function () {
    const batch = makeFullBatch({
      aaaAllocation: {
        planId:                   'plan-001',
        status:                   'validated',
        allocationPlan:           ALLOC_PLAN,
        allocationPlanHash:       '0x000000badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad',
        policyContextHash:        POLICY_CTX_HASH,
        portfolioRegistryVersion: 'portfolio-registry-v1',
        targetYieldBps:           400,
        attachedAt:               ATTACHED_AT,
      },
    });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.include('hash');
  });

  it('fails when destination approval hash has changed (stale approval)', function () {
    // Approve then mutate the allocation hashes so the destination hash no longer matches
    const batch = makeFullBatch();
    const approvedBatch = approveDeployment(batch);

    // Simulate allocation plan hash change after approval
    const mutated = {
      ...approvedBatch,
      aaaAllocation: {
        ...approvedBatch.aaaAllocation,
        allocationPlanHash: canonicalKeccak({ different: 'plan' }),
      },
    };

    expect(hasDeploymentApproval(mutated)).to.equal(false);
  });

  it('fails when any allocation leg lacks an approved destination', function () {
    const legId2 = 'leg-002';
    const batch = makeFullBatch({
      deploymentLegs: [
        {
          legId: 'leg-001', provider: 'liquidity', asset: 'USDC', strategyType: 'liquidity',
          amountUsd: 600_000, allocationPercent: 60, targetYieldBps: 400, status: 'planned',
        },
        {
          legId: legId2, provider: 'liquidity', asset: 'USDC', strategyType: 'liquidity',
          amountUsd: 400_000, allocationPercent: 40, targetYieldBps: 400, status: 'planned',
        },
      ],
      // Only one of the two legs has a destination approval
      destinationApprovals: [makeDestinationApproval('leg-001', 600_000)],
    });
    expect(canApproveDeployment(batch)).to.equal(false);
    const reason = getDeploymentApprovalBlockingReason(batch);
    expect(reason).to.be.a('string').that.is.not.empty;
  });

  it('fails when the batch is already deployed', function () {
    const batch = makeFullBatch({ status: 'deployed' });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.include('deployed');
  });

  it('fails when an incident (exception) is active', function () {
    const batch = makeFullBatch({ status: 'exception' });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.match(/incident|dispute|block/i);
  });

  // ── Duplicate prevention ───────────────────────────────────────────────────

  it('prevents duplicate deployment approval for the same batch UUID', function () {
    const batch = makeFullBatch();
    const evidence = createDeploymentApprovalEvidence(batch);

    const first = store.save(evidence);
    expect(first.status).to.equal('created');

    const second = store.save(evidence);
    expect(second.status).to.equal('conflict');
    expect(second.existing).to.exist;
  });

  it('different batch UUIDs can each have their own approval', function () {
    const evidence1 = createDeploymentApprovalEvidence(makeFullBatch());
    const evidence2 = createDeploymentApprovalEvidence(makeFullBatch({ batchId: OTHER_UUID }));
    // Manually fix the evidence batchId to match the second UUID
    evidence2.batchId = OTHER_UUID;

    expect(store.save(evidence1).status).to.equal('created');
    expect(store.save(evidence2).status).to.equal('created');
    expect(store.get(BATCH_UUID)).to.have.property('batchId', BATCH_UUID);
    expect(store.get(OTHER_UUID)).to.have.property('batchId', OTHER_UUID);
  });

  // ── Deterministic hash ─────────────────────────────────────────────────────

  it('produces the same deploymentApprovalHash on repeated calls', function () {
    const batch = makeFullBatch();
    const e1 = createDeploymentApprovalEvidence(batch, 'Operator', APPROVED_AT);
    const e2 = createDeploymentApprovalEvidence(batch, 'Operator', APPROVED_AT);
    expect(e1.deploymentApprovalHash).to.equal(e2.deploymentApprovalHash);
  });

  it('deploymentApprovalHash changes when any bound field changes', function () {
    const batch = makeFullBatch();
    const e1 = createDeploymentApprovalEvidence(batch, 'Operator A', APPROVED_AT);
    const e2 = createDeploymentApprovalEvidence(batch, 'Operator B', APPROVED_AT);
    expect(e1.deploymentApprovalHash).to.not.equal(e2.deploymentApprovalHash);
  });

  it('deploymentApprovalHash is a keccak256 hex string (0x + 64 hex chars)', function () {
    const evidence = createDeploymentApprovalEvidence(makeFullBatch());
    expect(evidence.deploymentApprovalHash).to.match(/^0x[0-9a-f]{64}$/i);
  });

  // ── UUID-only lookup ───────────────────────────────────────────────────────

  it('stores and retrieves approval keyed only by batch UUID', function () {
    const batch = makeFullBatch();
    const evidence = createDeploymentApprovalEvidence(batch);
    store.save(evidence);

    const found = store.get(BATCH_UUID);
    expect(found).to.exist;
    expect(found.batchId).to.equal(BATCH_UUID);

    // Any other UUID returns null
    expect(store.get(OTHER_UUID)).to.be.null;
    expect(store.get('not-a-uuid')).to.be.null;
  });

  it('payload binds all required fields to the batch UUID', function () {
    const evidence = createDeploymentApprovalEvidence(makeFullBatch());
    const p = evidence.payload;

    expect(p.batchUuid).to.equal(BATCH_UUID);
    expect(p.allocationPlanHash).to.equal(ALLOC_PLAN_HASH);
    expect(p.policyContextHash).to.equal(POLICY_CTX_HASH);
    expect(p.destinationApprovalHash).to.be.a('string').with.length.above(10);
    expect(p.deploymentLegs).to.have.length(1);
    expect(p.deploymentLegs[0].approvedDestinationId).to.equal(DEST_ID);
  });

  // ── Deployment Approved ≠ Deployed ────────────────────────────────────────

  it('hasDeploymentApproval is false before approval', function () {
    expect(hasDeploymentApproval(makeFullBatch())).to.equal(false);
  });

  it('hasDeploymentApproval is true after approval, batch status is deployment_pending not deployed', function () {
    const approved = approveDeployment(makeFullBatch());
    expect(hasDeploymentApproval(approved)).to.equal(true);
    expect(approved.status).to.equal('deployment_pending');
    expect(approved.status).to.not.equal('deployed');
  });

  // ── Treasury handoff required ──────────────────────────────────────────────

  it('fails when treasury handoff was not approved (and therefore wallet binding is not locked)', function () {
    // In practice, no treasury approval means no locked binding — so both are unset.
    const batch = makeFullBatch({
      treasuryHandoff: {
        handoffId:           'handoff-001',
        approvedByTreasury:  false,
        depositManifestHash: '0xmanifest',
      },
      batchWalletBinding: { bindingStatus: 'binding_pending' },
    });
    expect(canApproveDeployment(batch)).to.equal(false);
    expect(getDeploymentApprovalBlockingReason(batch)).to.match(/binding|gate/i);
  });
});
