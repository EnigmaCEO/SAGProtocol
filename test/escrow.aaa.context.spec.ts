import { expect } from 'chai';

import * as aaaAllocator from '../server/src/lib/banking/aaaAllocator.ts';
import * as escrowContextBuilder from '../server/src/lib/banking/escrowContextBuilder.ts';

const { requestAllocationFromAAA, scoreEligibleCandidates } = (aaaAllocator as any).default ?? aaaAllocator;
const { buildEscrowDecisionContext, deriveRouteClassWeights } = (escrowContextBuilder as any).default ?? escrowContextBuilder;

function baseOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    batch_id: 'batch-1',
    source_type: 'BANK',
    origin_institution_id: 'sagitta-demo-bank',
    principal_received_usd: '25000',
    duration_class: '1Y',
    product_duration: '1Y',
    execution_horizon: '30D',
    deployment_start_at: new Date().toISOString(),
    target_return_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    hard_close_at: new Date(Date.now() + 37 * 24 * 60 * 60 * 1000).toISOString(),
    policy_profile_id: 'bank-conservative-v1',
    policy_version: 1,
    policy_config_hash: 'hash-v1',
    strategy_class: 'conservative_bank_sleeve',
    execution_status: 'received',
    aaa_request_status: 'not_requested',
    deployment_status: 'not_started',
    settlement_status: 'not_started',
    route_status: 'queued',
    eligible_route_types: ['staking', 'private_credit', 'external_investor'],
    assigned_portfolio: null,
    assigned_investor: null,
    assigned_venue: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function basePolicy(overrides: Record<string, any> = {}) {
  return {
    institution_id: 'sagitta-demo-bank',
    display_name: 'Sagitta Demo Bank',
    active_policy_profile_id: 'bank-conservative-v1',
    allowed_duration_classes: ['1Y', '2Y'],
    risk_posture: 'conservative',
    allocator_version: 'aaa-policy-v2',
    policy_config: {
      routeTypes: ['staking', 'private_credit', 'external_investor'],
      sourceTypes: ['BANK', 'VAULT'],
    },
    policy_version: 1,
    policy_config_hash: 'hash-v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

class RepoStub {
  compliance: any[] = [];
  performance: any[] = [];

  async listRouteComplianceStatuses() {
    return this.compliance;
  }

  async listLatestRoutePerformance() {
    return this.performance;
  }
}

describe('Escrow AAA context builder', function () {
  it('builds canonical identity context for BANK and VAULT execution orders', async function () {
    const repo = new RepoStub();
    const bankContext = await buildEscrowDecisionContext(repo as any, baseOrder(), basePolicy());
    const vaultContext = await buildEscrowDecisionContext(
      repo as any,
      baseOrder({
        batch_id: 'vault-7',
        source_type: 'VAULT',
        policy_profile_id: 'vault-standard-v1',
        strategy_class: 'standard_vault_sleeve',
      }),
      basePolicy({
        active_policy_profile_id: 'vault-standard-v1',
      })
    );

    expect(bankContext.identity.batchId).to.equal('batch-1');
    expect(bankContext.identity.sourceType).to.equal('BANK');
    expect(vaultContext.identity.batchId).to.equal('vault-7');
    expect(vaultContext.identity.sourceType).to.equal('VAULT');
    expect(bankContext.summary.registrySource).to.be.oneOf(['dao_registries', 'sandbox_fallback']);
  });

  it('filters the eligible universe by compliance, min amount, and timing before AAA scoring', async function () {
    const repo = new RepoStub();
    repo.compliance = [
      {
        route_id: 'staking-sandbox-1',
        compliance_ready: false,
        docs_ready: false,
        endpoint_ready: false,
        valuation_feed_ready: false,
        active: true,
        notes: 'missing onboarding docs',
        source_snapshot: {},
        updated_at: new Date().toISOString(),
      },
    ];
    const lowPrincipalContext = await buildEscrowDecisionContext(
      repo as any,
      baseOrder({
        principal_received_usd: '2',
      }),
      basePolicy()
    );
    const timingConstrainedContext = await buildEscrowDecisionContext(
      repo as any,
      baseOrder({
        principal_received_usd: '25',
        hard_close_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      basePolicy()
    );

    expect(lowPrincipalContext.eligibleUniverse).to.have.length(0);
    expect(lowPrincipalContext.excludedUniverse.some((item) => item.stage === 'compliance' && item.routeId === 'staking-sandbox-1')).to.equal(true);
    expect(lowPrincipalContext.excludedUniverse.some((item) => item.stage === 'structural' && item.reasons.some((reason) => reason.includes('min amount')))).to.equal(true);
    expect(timingConstrainedContext.excludedUniverse.some((item) => item.stage === 'mandate_fit')).to.equal(true);
  });

  it('weights performance history more heavily for external/private routes than market-native routes', function () {
    const marketNative = deriveRouteClassWeights('market_native');
    const external = deriveRouteClassWeights('external');

    expect(marketNative.marketDataWeight).to.be.greaterThan(external.marketDataWeight);
    expect(external.performanceHistoryWeight).to.be.greaterThan(marketNative.performanceHistoryWeight);
    expect(external.reliabilityWeight).to.be.greaterThan(marketNative.reliabilityWeight);
  });

  it('keeps external/private-credit routes scorable with strong performance history', async function () {
    const repo = new RepoStub();
    repo.performance = [
      {
        id: 'perf-1',
        route_id: 'external_investor-sandbox-3',
        as_of: new Date().toISOString(),
        realized_return: '0.18',
        unrealized_return: '0.03',
        drawdown: '0.01',
        volatility: '0.05',
        consistency_score: '0.92',
        close_delay_days: '0',
        returned_on_time: true,
        recovery_score: '0.95',
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ];
    const context = await buildEscrowDecisionContext(repo as any, baseOrder(), basePolicy());
    const scores = scoreEligibleCandidates(context);

    expect(scores[0].candidate.routeType).to.equal('external_investor');
    expect(scores[0].score).to.be.greaterThan(0.7);
  });

  it('builds AAA payloads with universe snapshots, exclusions, and proposed legs', async function () {
    const repo = new RepoStub();
    const decision = await requestAllocationFromAAA(repo as any, baseOrder(), basePolicy());

    expect(decision.aaaPayload).to.have.property('mandate');
    expect(decision.universeSnapshot).to.have.property('eligibleUniverse');
    expect(decision.universeSnapshot).to.have.property('excludedUniverse');
    expect(decision.decisionContext).to.have.property('scoringModel');
    expect(decision.proposedLegs.length).to.be.greaterThan(0);
    expect(decision.proposedLegs.every((leg) => ['staking', 'private_credit', 'external_investor'].includes(leg.routeType))).to.equal(true);
  });
});
