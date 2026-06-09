/**
 * AAA Allocation — protocol_deterministic_v1
 *
 * Implements the Sagitta Automated Asset Allocation algorithm against DAO-approved
 * PortfolioRegistry assets. The output schema matches the official tick_v1 format.
 *
 * Scoring formula (v1):
 *   score_base  = er_raw - vol_raw / 2
 *   score_final = er_raw * er_mult - (vol_raw * vol_mult) / 2
 *   score_shift = max(0, -min(all_scores)) + 1e-6
 *   raw_weight  = score_final + score_shift
 *   weight      = raw_weight / Σ(raw_weights), then capped [min=0.05, max=0.60]
 */

import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers';
import { EscrowBatch } from '../../lib/escrow/batches';
import { canonicalKeccak } from '../../lib/escrow/canonicalHash';

// ── ABI fragments ─────────────────────────────────────────────────────────────

const PORTFOLIO_REGISTRY_ABI = [
  'function getAllAssets() view returns (tuple(string symbol, string name, address token, address oracle, uint8 riskClass, uint8 role, uint256 minimumInvestmentUsd6, uint256 defaultDestinationId, address destination, uint8 destinationType, uint256 addedAt)[])',
  'function assetCount() view returns (uint256)',
  'function owner() view returns (address)',
];

const EXECUTION_ROUTE_REGISTRY_ABI = [
  'function getAllRoutes() view returns (tuple(uint256 routeId, string assetSymbol, uint8 routeType, bytes32 counterpartyRefHash, bytes32 jurisdictionRefHash, bytes32 custodyRefHash, bool documentsComplete, bool sagittaFundApproved, bool ndaSigned, string pnlEndpoint, bool manualMarksRequired, bool active)[])',
  'function nextRouteId() view returns (uint256)',
  'function owner() view returns (address)',
];

const ESCROW_ALLOCATION_ABI = [
  'function attachAllocation(uint256 sourceBatchId, bytes32 allocationPlanHash, bytes32 policyContextHash, string portfolioRegistryVersion) external',
  'function getAllocationAttachment(uint256 sourceBatchId) view returns (tuple(bytes32 allocationPlanHash, bytes32 policyContextHash, string portfolioRegistryVersion, address attachedBy, uint64 attachedAt, bool exists))',
  'function batchWalletFunded(uint256 sourceBatchId) view returns (bool)',
];

// ── Allocator constants ───────────────────────────────────────────────────────

/** Expected return and volatility derived from PortfolioRegistry RiskClass enum. */
const RISK_CLASS_PARAMS: Record<number, { er: number; vol: number }> = {
  0: { er: 0.28, vol: 0.24 }, // WealthManagement
  1: { er: 0.14, vol: 0.07 }, // Stablecoin
  2: { er: 0.20, vol: 0.35 }, // DefiBluechip
  3: { er: 0.18, vol: 0.25 }, // FundOfFunds
  4: { er: 0.14, vol: 0.70 }, // LargeCap
  5: { er: 0.11, vol: 0.40 }, // PrivateCreditFund
  6: { er: 0.15, vol: 0.15 }, // RealWorldAsset
  7: { er: 0.20, vol: 0.45 }, // ExternalProtocol
};

const ASSET_ROLE_STRINGS: Record<number, string> = {
  0: 'core',
  1: 'liquidity',
  2: 'satellite',
  3: 'defensive',
  4: 'speculative',
  5: 'yield_fund',
  6: 'external',
};

type RoleMults = { er: number; vol: number; churn: number };
const ROLE_MULTIPLIERS: Record<string, RoleMults> = {
  core:       { er: 0.95, vol: 0.90, churn: 1.35 },
  liquidity:  { er: 0.85, vol: 0.50, churn: 0.85 },
  satellite:  { er: 1.00, vol: 1.00, churn: 1.00 },
  defensive:  { er: 0.90, vol: 0.80, churn: 1.25 },
  speculative:{ er: 1.10, vol: 1.20, churn: 0.90 },
  yield_fund: { er: 1.00, vol: 0.90, churn: 1.00 },
  external:   { er: 0.95, vol: 1.00, churn: 1.00 },
};

const ROLE_FLOORS: Record<string, number> = { core: 0.10 };
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.60;
const MAX_CONCENTRATION = 0.70;

// ── Public types ──────────────────────────────────────────────────────────────

export type PortfolioRegistryAsset = {
  symbol: string;
  name: string;
  token: string;
  oracle: string;
  riskClass: number;
  role: number;
  minimumInvestmentUsd6: bigint;
  defaultDestinationId: bigint;
  destination: string;
  destinationType: number;
  addedAt: bigint;
};

export type ExecutionRoute = {
  routeId: bigint;
  assetSymbol: string;
  routeType: number;
  documentsComplete: boolean;
  sagittaFundApproved: boolean;
  ndaSigned: boolean;
  pnlEndpoint: string;
  manualMarksRequired: boolean;
  active: boolean;
};

export type ExcludedAllocationAsset = {
  symbol: string;
  reason: string;
  routeId?: string;
};

export type AaaTickScoreTrace = {
  current_weight_used: number;
  score_v1: number;
  role: string;
  er_mult: number;
  vol_mult: number;
  churn_penalty_mult: number;
  expected_return_used_raw: number;
  volatility_used_raw: number;
  expected_return_used_role_adj: number;
  volatility_used_role_adj: number;
  score_base: number;
  score_role_delta: number;
  score_posture_delta: number;
  score_final: number;
  role_bias_mult: number;
  posture_bias_mult: number;
  score_shift: number;
  role_floor_value?: number;
  role_floor_applied: boolean;
  cap_min?: number;
  cap_max?: number;
  weight_pre_cap?: number;
  weight_post_cap?: number;
  weight_final: number;
};

export type AaaTickMeta = {
  allocator: string;
  status: string;
  reason_code: string;
  reason_codes: string[];
  role_policy: {
    core_floor: number;
    speculative_cap_conservative: number;
    liquidity_conservative_score_mult: number;
    liquidity_cap_boost: number;
    dominance_gap: number;
  };
  role_constraints_summary: string[];
  constraints: {
    min_asset_weight: number;
    max_asset_weight: number;
    max_concentration: number;
  };
  assets_sanitized: {
    assets_in: number;
    assets_out: number;
    dropped_count: number;
    duplicate_ids_count: number;
  };
  excluded_assets?: ExcludedAllocationAsset[];
  compliance_registry_version?: string;
  allocator_version_requested: string;
  allocator_version_effective: string;
  allow_fallback: boolean;
};

export type AaaTickPolicySnapshot = {
  decision_type: string;
  policy_id: string | null;
  policy_name: string | null;
  allocator_version_requested: string;
  allocator_version_effective: string;
  mission: string;
  risk_posture: string;
  confidence_level: string;
  liquidity_state: string;
  correlation_state: string;
  constraints: {
    min_asset_weight: number;
    max_asset_weight: number;
    max_concentration: number;
  };
};

export type AaaTickLinkageScope = {
  account_id: string;
  decision_type: string;
  portfolio_fingerprint: string;
  policy_fingerprint: string;
};

export type AaaTickResponse = {
  target_weights: Record<string, number>;
  next_allocation_weights: Record<string, number>;
  score_trace_by_asset: Record<string, AaaTickScoreTrace>;
  meta: AaaTickMeta;
  timestamp: string;
  tick_id: string;
  schema_version: string;
  decision_type: string;
  allocator_version: string;
  policy_id: string | null;
  policy_name: string | null;
  role_by_asset: Record<string, string>;
  policy_snapshot: AaaTickPolicySnapshot;
  linkage_scope: AaaTickLinkageScope;
  risk_summary: {
    pre: { portfolio_volatility: number };
    post: { portfolio_volatility: number };
    delta: { portfolio_volatility: number };
  };
  stability_metrics: {
    turnover_l1: number;
    churn_pct: number;
    max_asset_shift: { asset: string; delta: number };
    notes: string[];
  };
  prior_portfolio_weights: Record<string, number>;
};

export type AaaAllocationRequest = {
  sourceBatchId: string;
  escrowBatchId: string;
  batchWalletAddress: string;
  asset: string;
  totalAmountUsd: number;
  termMonths: number;
  chainId: number;
  custodyMode: string;
  batchAuthorityBindingHash: string;
  batchWalletBindingHash: string;
  fundingTxHash: string;
  portfolioRegistryVersion: string;
  portfolioRegistryAddress: string;
  approvedAssetList: string[];
  excludedAssetList: ExcludedAllocationAsset[];
  executionRouteRegistryVersion: string;
  policyContextHash: string;
};

export type AaaAllocationResponse = {
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  createdAt: string;
  sourceBatchId: string;
  escrowBatchId: string;
  attachTxHash?: string;
  attachedAt?: string;
  /** DB write result — if not 'validated', the plan was anchored on-chain but the DB save failed or mismatched. */
  dbSaveStatus?: 'validated' | 'hash_mismatch' | 'db_save_failed';
};

export type ComputedAllocationPlan = {
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  createdAt: string;
  sourceBatchId: string;
  escrowBatchId: string;
};

export type OnChainAllocationAttachment = {
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  attachedBy: string;
  attachedAt: number;
  exists: boolean;
};

// ── Registry read ─────────────────────────────────────────────────────────────

export async function readPortfolioRegistryAssets(params: {
  rpcUrl: string;
  registryAddress: string;
}): Promise<{ assets: PortfolioRegistryAsset[]; version: string }> {
  const provider = new JsonRpcProvider(params.rpcUrl);
  const registry = new Contract(params.registryAddress, PORTFOLIO_REGISTRY_ABI, provider);
  const [rawAssets, assetCount, ownerAddr] = await Promise.all([
    registry.getAllAssets(),
    registry.assetCount(),
    registry.owner(),
  ]);

  const assets: PortfolioRegistryAsset[] = (rawAssets as readonly unknown[]).map((a: unknown) => {
    const r = a as Record<string, unknown>;
    return {
      symbol:               String(r.symbol ?? (a as string[])[0]),
      name:                 String(r.name   ?? (a as string[])[1]),
      token:                String(r.token  ?? (a as string[])[2]),
      oracle:               String(r.oracle ?? (a as string[])[3]),
      riskClass:            Number(r.riskClass ?? (a as unknown[])[4]),
      role:                 Number(r.role      ?? (a as unknown[])[5]),
      minimumInvestmentUsd6:BigInt(String(r.minimumInvestmentUsd6 ?? (a as unknown[])[6])),
      defaultDestinationId: BigInt(String(r.defaultDestinationId ?? (a as unknown[])[7] ?? 0)),
      destination:          String(r.destination    ?? (a as string[])[8]),
      destinationType:      Number(r.destinationType ?? (a as unknown[])[9]),
      addedAt:              BigInt(String(r.addedAt ?? (a as unknown[])[10])),
    };
  });

  const version = canonicalKeccak({
    owner: ownerAddr,
    assetCount: String(assetCount),
    symbols: assets.map((a) => a.symbol),
  }).slice(0, 18);

  return { assets, version };
}

async function readExecutionRoutes(params: {
  rpcUrl: string;
  routeRegistryAddress?: string;
}): Promise<{ routes: ExecutionRoute[]; version: string }> {
  if (!params.routeRegistryAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.routeRegistryAddress)) {
    return { routes: [], version: 'routes-unconfigured' };
  }

  const provider = new JsonRpcProvider(params.rpcUrl);
  const registry = new Contract(params.routeRegistryAddress, EXECUTION_ROUTE_REGISTRY_ABI, provider);
  const [rawRoutes, nextRouteId, ownerAddr] = await Promise.all([
    registry.getAllRoutes(),
    registry.nextRouteId(),
    registry.owner(),
  ]);

  const routes: ExecutionRoute[] = (rawRoutes as readonly unknown[]).map((route: unknown) => {
    const r = route as Record<string, unknown>;
    return {
      routeId:             BigInt(String(r.routeId ?? (route as unknown[])[0])),
      assetSymbol:         String(r.assetSymbol ?? (route as unknown[])[1]),
      routeType:           Number(r.routeType ?? (route as unknown[])[2]),
      documentsComplete:   Boolean(r.documentsComplete ?? (route as unknown[])[6]),
      sagittaFundApproved: Boolean(r.sagittaFundApproved ?? (route as unknown[])[7]),
      ndaSigned:           Boolean(r.ndaSigned ?? (route as unknown[])[8]),
      pnlEndpoint:         String(r.pnlEndpoint ?? (route as unknown[])[9] ?? ''),
      manualMarksRequired: Boolean(r.manualMarksRequired ?? (route as unknown[])[10]),
      active:              Boolean(r.active ?? (route as unknown[])[11]),
    };
  });

  const version = canonicalKeccak({
    owner: ownerAddr,
    nextRouteId: String(nextRouteId),
    routes: routes.map((route) => ({
      routeId: String(route.routeId),
      assetSymbol: route.assetSymbol,
      routeType: route.routeType,
      documentsComplete: route.documentsComplete,
      sagittaFundApproved: route.sagittaFundApproved,
      ndaSigned: route.ndaSigned,
      hasPnlEndpoint: route.pnlEndpoint.trim().length > 0,
      manualMarksRequired: route.manualMarksRequired,
      active: route.active,
    })),
  }).slice(0, 18);

  return { routes, version };
}

function isExternalPortfolioAsset(asset: PortfolioRegistryAsset): boolean {
  return asset.role === 6 || !/^0x[a-fA-F0-9]{40}$/.test(asset.token) || asset.token.toLowerCase() === '0x0000000000000000000000000000000000000000';
}

function isRouteBatchEligible(route?: ExecutionRoute): boolean {
  if (!route?.active) return false;
  if (route.routeType !== 3) return true;
  return route.documentsComplete
    && route.sagittaFundApproved
    && route.ndaSigned
    && route.pnlEndpoint.trim().length > 0;
}

function buildAllocationUniverse(params: {
  assets: PortfolioRegistryAsset[];
  routes: ExecutionRoute[];
  routeRegistryConfigured: boolean;
}): { allocatableAssets: PortfolioRegistryAsset[]; excludedAssets: ExcludedAllocationAsset[] } {
  const allocatableAssets: PortfolioRegistryAsset[] = [];
  const excludedAssets: ExcludedAllocationAsset[] = [];

  for (const asset of params.assets) {
    if (!isExternalPortfolioAsset(asset)) {
      allocatableAssets.push(asset);
      continue;
    }

    const route = params.routes.find(
      (item) => item.routeType === 3 && item.assetSymbol.toLowerCase() === asset.symbol.toLowerCase(),
    );

    if (isRouteBatchEligible(route)) {
      allocatableAssets.push(asset);
      continue;
    }

    excludedAssets.push({
      symbol: asset.symbol,
      reason: !params.routeRegistryConfigured
        ? 'execution_route_registry_unconfigured'
        : !route
          ? 'external_route_missing'
          : !route.active
            ? 'external_route_inactive'
            : 'external_route_compliance_incomplete',
      ...(route ? { routeId: String(route.routeId) } : {}),
    });
  }

  return { allocatableAssets, excludedAssets };
}

// ── Deterministic v1 allocator ────────────────────────────────────────────────

function applyWeightCaps(
  weights: Record<string, number>,
  minW: number,
  maxW: number,
  maxConc: number,
): Record<string, number> {
  const symbols = Object.keys(weights);
  let w = { ...weights };

  // Iteratively apply caps until stable
  for (let iter = 0; iter < 20; iter++) {
    const capped: Record<string, boolean> = {};
    let fixedSum = 0;
    let freeSum = 0;

    for (const s of symbols) {
      if (w[s] <= minW + 1e-9) {
        w[s] = minW;
        capped[s] = true;
        fixedSum += minW;
      } else if (w[s] >= Math.min(maxW, maxConc) - 1e-9) {
        w[s] = Math.min(maxW, maxConc);
        capped[s] = true;
        fixedSum += w[s];
      }
    }

    const freeSymbols = symbols.filter((s) => !capped[s]);
    if (freeSymbols.length === 0) break;

    const remainingWeight = 1 - fixedSum;
    for (const s of freeSymbols) freeSum += w[s];
    if (freeSum < 1e-12) break;

    let changed = false;
    for (const s of freeSymbols) {
      const newW = (w[s] / freeSum) * remainingWeight;
      if (Math.abs(newW - w[s]) > 1e-9) changed = true;
      w[s] = newW;
    }

    if (!changed) break;
  }

  // Final normalise to exactly 1
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  for (const s of symbols) w[s] = w[s] / total;
  return w;
}

function portfolioVol(weights: Record<string, number>, vols: Record<string, number>): number {
  // Diagonal covariance (no correlation) — σ_p = sqrt(Σ w_i^2 * σ_i^2)
  const sumSq = Object.entries(weights).reduce((s, [sym, w]) => s + w * w * (vols[sym] ?? 0) ** 2, 0);
  return Math.sqrt(sumSq);
}

export function runDeterministicAllocatorV1(params: {
  assets: PortfolioRegistryAsset[];
  excludedAssets?: ExcludedAllocationAsset[];
  complianceRegistryVersion?: string;
  priorWeights?: Record<string, number>;
  policySnapshot: AaaTickPolicySnapshot;
  tickId: string;
  timestamp: string;
  sourceBatchId: string;
  portfolioRegistryVersion: string;
}): AaaTickResponse {
  const { assets, policySnapshot, tickId, timestamp, portfolioRegistryVersion } = params;

  const n = assets.length;
  if (n === 0) {
    throw new Error('No DAO-eligible assets are available for AAA allocation.');
  }
  const uniformPrior = 1 / n;
  const priorWeights: Record<string, number> = params.priorWeights
    ? { ...params.priorWeights }
    : Object.fromEntries(assets.map((a) => [a.symbol, uniformPrior]));

  const rawParams: Record<string, { er: number; vol: number; role: string; mults: RoleMults }> = {};
  for (const asset of assets) {
    const { er, vol } = RISK_CLASS_PARAMS[asset.riskClass] ?? { er: 0.15, vol: 0.30 };
    const role = ASSET_ROLE_STRINGS[asset.role] ?? 'satellite';
    const mults = ROLE_MULTIPLIERS[role] ?? ROLE_MULTIPLIERS.satellite;
    rawParams[asset.symbol] = { er, vol, role, mults };
  }

  // Compute raw scores
  const scores: Record<string, number> = {};
  for (const [sym, p] of Object.entries(rawParams)) {
    scores[sym] = p.er * p.mults.er - (p.vol * p.mults.vol) / 2;
  }

  const minScore = Math.min(...Object.values(scores));
  const scoreShift = Math.max(0, -minScore) + 1e-6;

  // Raw weights before caps
  const rawWeights: Record<string, number> = {};
  let rawTotal = 0;
  for (const sym of Object.keys(scores)) {
    rawWeights[sym] = scores[sym] + scoreShift;
    rawTotal += rawWeights[sym];
  }
  const normalizedRaw: Record<string, number> = {};
  for (const sym of Object.keys(rawWeights)) {
    normalizedRaw[sym] = rawWeights[sym] / rawTotal;
  }

  // Apply floor caps from role policy
  const minEffective: Record<string, number> = {};
  for (const [sym, p] of Object.entries(rawParams)) {
    minEffective[sym] = Math.max(MIN_WEIGHT, ROLE_FLOORS[p.role] ?? MIN_WEIGHT);
  }
  const maxEffective: Record<string, number> = {};
  for (const sym of Object.keys(rawParams)) {
    maxEffective[sym] = MAX_WEIGHT;
  }

  // Apply per-asset min floors to normalized raw weights before global cap
  const withFloors = { ...normalizedRaw };
  for (const [sym, floor] of Object.entries(minEffective)) {
    if (withFloors[sym] < floor) withFloors[sym] = floor;
  }
  // Re-normalise after floor adjustments
  const floorTotal = Object.values(withFloors).reduce((s, v) => s + v, 0);
  for (const sym of Object.keys(withFloors)) withFloors[sym] /= floorTotal;

  const finalWeights = applyWeightCaps(withFloors, MIN_WEIGHT, MAX_WEIGHT, MAX_CONCENTRATION);

  // Build score trace
  const scoreTraceByAsset: Record<string, AaaTickScoreTrace> = {};
  for (const [sym, p] of Object.entries(rawParams)) {
    const erAdj = p.er * p.mults.er;
    const volAdj = p.vol * p.mults.vol;
    const scoreBase = p.er - p.vol / 2;
    const scoreFinal = scores[sym];
    const roleFloor = ROLE_FLOORS[p.role];
    const preCap = normalizedRaw[sym];

    scoreTraceByAsset[sym] = {
      current_weight_used: priorWeights[sym] ?? uniformPrior,
      score_v1: scoreFinal,
      role: p.role,
      er_mult: p.mults.er,
      vol_mult: p.mults.vol,
      churn_penalty_mult: p.mults.churn,
      expected_return_used_raw: p.er,
      volatility_used_raw: p.vol,
      expected_return_used_role_adj: Math.round(erAdj * 1e9) / 1e9,
      volatility_used_role_adj: Math.round(volAdj * 1e9) / 1e9,
      score_base: Math.round(scoreBase * 1e9) / 1e9,
      score_role_delta: Math.round((scoreFinal - scoreBase) * 1e9) / 1e9,
      score_posture_delta: 0,
      score_final: scoreFinal,
      role_bias_mult: 1,
      posture_bias_mult: 1,
      score_shift: scoreShift,
      ...(roleFloor !== undefined ? { role_floor_value: roleFloor } : {}),
      role_floor_applied: roleFloor !== undefined && preCap < roleFloor,
      cap_min: minEffective[sym],
      cap_max: maxEffective[sym],
      weight_pre_cap: preCap,
      weight_post_cap: withFloors[sym] / floorTotal,
      weight_final: finalWeights[sym],
    };
  }

  const volsMap: Record<string, number> = {};
  for (const [sym, p] of Object.entries(rawParams)) volsMap[sym] = p.vol;

  const prePorVol  = portfolioVol(priorWeights, volsMap);
  const postPortVol = portfolioVol(finalWeights, volsMap);

  // Stability metrics
  const symbols = Object.keys(finalWeights);
  let turnoverL1 = 0;
  let maxShiftDelta = 0;
  let maxShiftAsset = symbols[0];
  for (const sym of symbols) {
    const delta = Math.abs(finalWeights[sym] - (priorWeights[sym] ?? uniformPrior));
    turnoverL1 += delta;
    if (delta > maxShiftDelta) { maxShiftDelta = delta; maxShiftAsset = sym; }
  }
  turnoverL1 /= 2; // L1 norm / 2

  const policyFingerprint = canonicalKeccak(policySnapshot);
  const portfolioFingerprint = canonicalKeccak({ prior_weights: priorWeights, portfolio_registry_version: portfolioRegistryVersion });

  const roleByAsset: Record<string, string> = {};
  for (const [sym, p] of Object.entries(rawParams)) roleByAsset[sym] = p.role;

  return {
    target_weights:           finalWeights,
    next_allocation_weights:  finalWeights,
    score_trace_by_asset:     scoreTraceByAsset,
    meta: {
      allocator:               'protocol_deterministic',
      status:                  'OK',
      reason_code:             'WEIGHTS_COMPUTED_RULES_BASED',
      reason_codes:            ['WEIGHTS_COMPUTED_RULES_BASED', 'SCORE_SHIFT_APPLIED', 'MIN_MAX_CAPS_APPLIED', 'ROLE_MODIFIERS_APPLIED'],
      role_policy: {
        core_floor:                       0.10,
        speculative_cap_conservative:     0.10,
        liquidity_conservative_score_mult:1.10,
        liquidity_cap_boost:              1.20,
        dominance_gap:                    0.01,
      },
      role_constraints_summary: ['Role modifiers adjusted expected return/volatility inputs.'],
      constraints: {
        min_asset_weight:  MIN_WEIGHT,
        max_asset_weight:  MAX_WEIGHT,
        max_concentration: MAX_CONCENTRATION,
      },
      assets_sanitized: {
        assets_in:           n + (params.excludedAssets?.length ?? 0),
        assets_out:          n,
        dropped_count:       params.excludedAssets?.length ?? 0,
        duplicate_ids_count: 0,
      },
      excluded_assets: params.excludedAssets ?? [],
      compliance_registry_version: params.complianceRegistryVersion,
      allocator_version_requested: 'v1',
      allocator_version_effective: 'v1',
      allow_fallback:              false,
    },
    timestamp,
    tick_id:           tickId,
    schema_version:    'tick_v1',
    decision_type:     'allocation',
    allocator_version: 'v1',
    policy_id:         null,
    policy_name:       null,
    role_by_asset:     roleByAsset,
    policy_snapshot:   policySnapshot,
    linkage_scope: {
      account_id:            'escrow',
      decision_type:         'allocation',
      portfolio_fingerprint: portfolioFingerprint,
      policy_fingerprint:    policyFingerprint,
    },
    risk_summary: {
      pre:   { portfolio_volatility: prePorVol },
      post:  { portfolio_volatility: postPortVol },
      delta: { portfolio_volatility: postPortVol - prePorVol },
    },
    stability_metrics: {
      turnover_l1: turnoverL1,
      churn_pct:   turnoverL1 * 100,
      max_asset_shift: { asset: maxShiftAsset, delta: maxShiftDelta },
      notes: [],
    },
    prior_portfolio_weights: priorWeights,
  };
}

// ── Stable hash fields ────────────────────────────────────────────────────────
// Both hashes must be deterministic across sessions so plan data can be
// recovered by re-running the allocator against the same registry state.
// Excluded: timestamp, tick_id, score_trace_by_asset, stability_metrics,
//           risk_summary, prior_portfolio_weights, createdAt.

export function canonicalPlanFields(plan: AaaTickResponse) {
  return {
    target_weights:    plan.target_weights,
    allocator_version: plan.allocator_version,
    schema_version:    plan.schema_version,
    role_by_asset:     plan.role_by_asset,
    policy_snapshot:   plan.policy_snapshot,
    linkage_scope:     plan.linkage_scope,
    meta: {
      allocator:                  plan.meta.allocator,
      constraints:                plan.meta.constraints,
      allocator_version_effective:plan.meta.allocator_version_effective,
    },
  };
}

export type PolicyContextInput = {
  portfolioRegistryVersion: string;
  portfolioRegistryAddress: string;
  executionRouteRegistryAddress?: string;
  executionRouteRegistryVersion?: string;
  approvedAssetList: string[];
  excludedAssetList?: ExcludedAllocationAsset[];
  chainId: number;
  custodyMode: string;
  asset: string;
  escrowContractAddress: string;
  sourceBatchId: string;
  escrowBatchId: string;
};

// ── Policy context ────────────────────────────────────────────────────────────

export function buildPolicyContext(params: PolicyContextInput): PolicyContextInput {
  // createdAt intentionally excluded — hash must be session-independent
  return {
    portfolioRegistryVersion: params.portfolioRegistryVersion,
    portfolioRegistryAddress: params.portfolioRegistryAddress,
    executionRouteRegistryAddress: params.executionRouteRegistryAddress,
    executionRouteRegistryVersion: params.executionRouteRegistryVersion,
    approvedAssetList:        params.approvedAssetList,
    excludedAssetList:        params.excludedAssetList ?? [],
    chainId:                  params.chainId,
    custodyMode:              params.custodyMode,
    asset:                    params.asset,
    escrowContractAddress:    params.escrowContractAddress,
    sourceBatchId:            params.sourceBatchId,
    escrowBatchId:            params.escrowBatchId,
  };
}

const DEFAULT_POLICY_SNAPSHOT: AaaTickPolicySnapshot = {
  decision_type:              'allocation',
  policy_id:                  null,
  policy_name:                null,
  allocator_version_requested:'v1',
  allocator_version_effective:'v1',
  mission:                    'risk_adjusted_return',
  risk_posture:               'neutral',
  confidence_level:           'normal',
  liquidity_state:            'normal',
  correlation_state:          'normal',
  constraints: {
    min_asset_weight:  MIN_WEIGHT,
    max_asset_weight:  MAX_WEIGHT,
    max_concentration: MAX_CONCENTRATION,
  },
};

// ── DB persistence (banking backend) ─────────────────────────────────────────

const ALLOCATION_PLANS_API = '/api/banking/escrow/allocation-plans';

type StoredAllocationPlanRecord = {
  batchId?: string;
  planId: string;
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  status: EscrowBatch['aaaAllocation']['status'];
};

const allocationPlanRecordCache = new Map<string, StoredAllocationPlanRecord>();

export function getAllocationStorageBatchId(batch: EscrowBatch): string {
  // Allocation plan storage is keyed only by the immutable Escrow batch UUID.
  // Do not derive this from wallet/binding/source context; those values can be
  // created later or rehydrated differently after refresh.
  return batch.batchId;
}

function allocationPlanCacheKey(batchId: string, chainKey?: string) {
  return `${chainKey ?? ''}:${batchId}`;
}

function cacheStoredAllocationPlanRecord(record: StoredAllocationPlanRecord, chainKey?: string) {
  if (!record.batchId) return;
  allocationPlanRecordCache.set(allocationPlanCacheKey(record.batchId), record);
  allocationPlanRecordCache.set(allocationPlanCacheKey(record.batchId, chainKey), record);
}

function normalizeStoredAllocationPlanRecord(row: any): StoredAllocationPlanRecord | null {
  const planPayload = row?.planPayload ?? row?.plan_payload;
  if (!planPayload) return null;
  const allocationResult = row?.allocationResult ?? row?.allocation_result ?? {};
  return {
    batchId:                   row.batchId ?? row.batch_id ?? '',
    planId:                   row.planId ?? row.plan_id ?? '',
    allocationPlan:           planPayload as AaaTickResponse,
    allocationPlanHash:       allocationResult.allocationPlanHash ?? row.allocationPlanHash ?? row.allocation_plan_hash ?? '',
    policyContextHash:        allocationResult.policyContextHash  ?? row.policyContextHash ?? row.policy_context_hash ?? '',
    portfolioRegistryVersion: allocationResult.portfolioRegistryVersion ?? row.portfolioRegistryVersion ?? row.portfolio_registry_version ?? '',
    status:                   row.status ?? 'computed',
  };
}

async function fetchPlanFromStateFallback(
  batchId: string,
  chainKey?: string,
  allocationPlanHash?: string,
): Promise<StoredAllocationPlanRecord | null> {
  try {
    const query = new URLSearchParams();
    if (chainKey) query.set('chainKey', chainKey);
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    const response = await fetch(`/api/banking/state${qs}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const state = payload?.state ?? payload;
    const plans = Array.isArray(state?.escrowAllocationPlans) ? state.escrowAllocationPlans : [];
    const matchedRow = plans.find((row: any) => (row?.batchId ?? row?.batch_id) === batchId)
      ?? plans.find((row: any) => {
        const rowHash =
          row?.allocationResult?.allocationPlanHash ??
          row?.allocation_result?.allocationPlanHash ??
          row?.allocationPlanHash ??
          row?.allocation_plan_hash;
        return Boolean(
          allocationPlanHash &&
          typeof rowHash === 'string' &&
          rowHash.toLowerCase() === allocationPlanHash.toLowerCase()
        );
      })
      ?? null;
    const matched = matchedRow ? normalizeStoredAllocationPlanRecord(matchedRow) : null;
    if (matched) {
      cacheStoredAllocationPlanRecord(matched, chainKey);
    }
    return matched;
  } catch {
    return null;
  }
}

async function fetchPlanByWalletFromDb(
  walletAddress: string,
  allocationPlanHash: string,
  chainKey?: string,
): Promise<StoredAllocationPlanRecord | null> {
  if (!walletAddress || !allocationPlanHash) return null;
  try {
    const query = new URLSearchParams();
    if (chainKey) query.set('chainKey', chainKey);
    query.set('allocationPlanHash', allocationPlanHash);
    const res = await fetch(
      `${ALLOCATION_PLANS_API}/by-wallet/${encodeURIComponent(walletAddress)}?${query.toString()}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const normalized = normalizeStoredAllocationPlanRecord(json?.data ?? json);
    if (normalized) {
      cacheStoredAllocationPlanRecord(normalized, chainKey);
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function savePlanToDb(params: {
  batch: EscrowBatch;
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  chainKey?: string;
  chainId?: number;
  walletAddress?: string;
  status: 'computed' | 'pending_anchor' | 'validated' | 'hash_mismatch' | 'chain_only';
}): Promise<StoredAllocationPlanRecord | null> {
  const { batch, allocationPlan, allocationPlanHash, policyContextHash, portfolioRegistryVersion } = params;
  const storageBatchId = getAllocationStorageBatchId(batch);
  const walletAddress = params.walletAddress ?? batch.wallet.walletAddress ?? batch.wallet.address ?? '';
  const proposedLegs = Object.entries(allocationPlan.target_weights).map(([symbol, weight]) => ({
    symbol,
    weight,
    role:     allocationPlan.role_by_asset[symbol] ?? 'satellite',
    amountUsd:Math.round(weight * batch.totalAmountUsd * 100) / 100,
  }));

  const res = await fetch(ALLOCATION_PLANS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batchId:                  storageBatchId,
      walletAddress:            walletAddress || null,
      chainKey:                 params.chainKey,
      chainId:                  params.chainId ?? null,
      tickId:                   allocationPlan.tick_id,
      allocatorVersion:         allocationPlan.allocator_version,
      planPayload:              allocationPlan,
      allocationPlanHash,
      policyContextHash,
      portfolioRegistryVersion,
      policySnapshot:           allocationPlan.policy_snapshot,
      proposedLegs,
      marketContext: {
        batchId:        batch.batchId,
        displayBatchId: batch.batchId,
        totalAmountUsd: batch.totalAmountUsd,
        termMonths:     batch.termMonths,
        asset:          batch.asset ?? 'USDC',
        custodyMode:    batch.custodyMode ?? 'batch_wallet_custody',
      },
      universeSnapshot: {
        assets:          Object.keys(allocationPlan.role_by_asset),
        excludedAssets:  allocationPlan.meta.excluded_assets ?? [],
        registryVersion: portfolioRegistryVersion,
        complianceRegistryVersion: allocationPlan.meta.compliance_registry_version,
      },
      decisionContext: {
        storageBatchId: batch.batchId,
        sourceBatchId: batch.sourceBatchId ?? batch.treasuryHandoff.handoffId,
        escrowBatchId: batch.batchId,
        walletAddress: batch.wallet.walletAddress ?? batch.wallet.address ?? '',
        walletBindingHash: batch.batchWalletBinding?.bindingHash ?? '',
        authorityBindingHash:
          batch.batchAuthorityBinding?.batchAuthorityBindingHash ??
          batch.wallet.boundAuthorityBindingHash ??
          '',
      },
      status: params.status,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Allocation plan DB save failed (${res.status}): ${body || res.statusText}`);
  }
  const payload = await res.json().catch(() => null);
  const record = normalizeStoredAllocationPlanRecord(payload?.data ?? payload) ?? {
    batchId: storageBatchId,
    planId: '',
    allocationPlan,
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion,
    status: params.status,
  };
  cacheStoredAllocationPlanRecord(record, params.chainKey);
  return record;
}

export async function fetchPlanFromDb(
  batchOrId: EscrowBatch | string,
  chainKey?: string,
): Promise<StoredAllocationPlanRecord | null> {
  const batchId = typeof batchOrId === 'string' ? batchOrId : getAllocationStorageBatchId(batchOrId);
  const requestedHash =
    typeof batchOrId === 'string'
      ? undefined
      : batchOrId.aaaAllocation.allocationPlanHash || undefined;
  const cacheKey = allocationPlanCacheKey(batchId, chainKey);
  const cached = allocationPlanRecordCache.get(cacheKey) ?? allocationPlanRecordCache.get(allocationPlanCacheKey(batchId));
  if (cached && (!requestedHash || !cached.allocationPlanHash || cached.allocationPlanHash === requestedHash)) {
    return cached;
  }

  try {
    const query = new URLSearchParams();
    if (chainKey) query.set('chainKey', chainKey);
    if (typeof batchOrId !== 'string' && batchOrId.aaaAllocation.allocationPlanHash) {
      query.set('allocationPlanHash', batchOrId.aaaAllocation.allocationPlanHash);
    }
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    const res = await fetch(`${ALLOCATION_PLANS_API}/${encodeURIComponent(batchId)}${qs}`);
    if (!res.ok) {
      const fallback = await fetchPlanFromStateFallback(batchId, chainKey, requestedHash);
      return fallback ?? cached ?? null;
    }
    const json = await res.json();
    const row = json?.data ?? json;
    const normalized = normalizeStoredAllocationPlanRecord(row);
    if (normalized) {
      cacheStoredAllocationPlanRecord(normalized, chainKey);
      return normalized;
    }
    const fallback = await fetchPlanFromStateFallback(batchId, chainKey, requestedHash);
    return fallback ?? cached ?? null;
  } catch {
    const fallback = await fetchPlanFromStateFallback(batchId, chainKey, requestedHash);
    return fallback ?? cached ?? null;
  }
}

// Server-side allocation trigger — replaces the old frontend compute + POST flow.
// The browser sends only the batch UUID; the server reads chain, runs the allocator, and stores the plan.
async function triggerServerAllocation(params: {
  escrowBatchId: string;
  chainKey?: string;
}): Promise<StoredAllocationPlanRecord> {
  const query = new URLSearchParams();
  if (params.chainKey) query.set('chainKey', params.chainKey);
  const qs = query.size > 0 ? `?${query.toString()}` : '';
  const res = await fetch(`${ALLOCATION_PLANS_API}/request${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ escrowBatchId: params.escrowBatchId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Server-side AAA allocation failed (${res.status}): ${body || res.statusText}`);
  }
  const json = await res.json();
  const record = normalizeStoredAllocationPlanRecord(json?.data ?? json);
  if (!record) throw new Error('Server returned an empty or unparseable allocation plan.');
  if (record.batchId) cacheStoredAllocationPlanRecord(record, params.chainKey);
  return record;
}

// Post-anchor validation — server reads chain and updates plan status.
async function validateAllocationOnServer(params: {
  batchId: string;
  chainKey?: string;
}): Promise<StoredAllocationPlanRecord | null> {
  try {
    const query = new URLSearchParams();
    if (params.chainKey) query.set('chainKey', params.chainKey);
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    const res = await fetch(`${ALLOCATION_PLANS_API}/${encodeURIComponent(params.batchId)}/validate${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const record = normalizeStoredAllocationPlanRecord(json?.data ?? json);
    if (record?.batchId) cacheStoredAllocationPlanRecord(record, params.chainKey);
    return record;
  } catch {
    return null;
  }
}

export async function computeAndStoreAllocationPlan(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  registryAddress: string;
  routeRegistryAddress?: string;
  chainId: number;
  chainKey?: string;
}): Promise<ComputedAllocationPlan> {
  const escrowBatchId = getAllocationStorageBatchId(params.batch);
  const sourceBatchId = params.batch.sourceBatchId || params.batch.treasuryHandoff.handoffId || '';
  console.info('[AAA] triggering server-side compute', { escrowBatchId, sourceBatchId });
  const record = await triggerServerAllocation({ escrowBatchId, chainKey: params.chainKey });
  console.info('[AAA] server compute complete', { escrowBatchId, allocationPlanHash: record.allocationPlanHash });
  return {
    allocationPlan:           record.allocationPlan,
    allocationPlanHash:       record.allocationPlanHash,
    policyContextHash:        record.policyContextHash,
    portfolioRegistryVersion: record.portfolioRegistryVersion,
    createdAt:                record.allocationPlan.timestamp || new Date().toISOString(),
    sourceBatchId,
    escrowBatchId,
  };
}

// ── Main entry point: request + attach ───────────────────────────────────────

function equalHash(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function allocationAttachmentMatches(
  db: {
    allocationPlanHash: string;
    policyContextHash: string;
    portfolioRegistryVersion: string;
  },
  chain: OnChainAllocationAttachment | null,
): boolean {
  return Boolean(
    chain?.exists &&
    equalHash(db.allocationPlanHash, chain.allocationPlanHash) &&
    equalHash(db.policyContextHash, chain.policyContextHash) &&
    db.portfolioRegistryVersion === chain.portfolioRegistryVersion
  );
}

function assertStoredPlanIntegrity(db: {
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
}): void {
  const payloadHash = canonicalKeccak(canonicalPlanFields(db.allocationPlan));
  if (!equalHash(payloadHash, db.allocationPlanHash)) {
    throw new Error('Stored AAA allocation payload does not match its DB allocationPlanHash.');
  }
  if (!db.policyContextHash || !db.portfolioRegistryVersion) {
    throw new Error('Stored AAA allocation is missing policyContextHash or portfolioRegistryVersion.');
  }
}

export async function anchorBatchAllocationPlan(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  chainId: number;
  chainKey?: string;
  signer: ReturnType<BrowserProvider['getSigner']> extends Promise<infer S> ? S : never;
}): Promise<AaaAllocationResponse> {
  const { batch } = params;
  const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
  if (!sourceBatchId) throw new Error('sourceBatchId is missing from batch.');

  let { allocationPlanHash, policyContextHash, portfolioRegistryVersion } = batch.aaaAllocation;
  let allocationPlan = batch.aaaAllocation.allocationPlan as AaaTickResponse | undefined;

  // Hashes may be absent from in-memory state if the page was refreshed after the pre-save.
  // Load them from DB by exact batch UUID before failing.
  if (!allocationPlanHash || !policyContextHash || !allocationPlan) {
    const dbPlan = await fetchPlanFromDb(batch.batchId, params.chainKey);
    if (dbPlan?.allocationPlanHash && dbPlan?.policyContextHash && dbPlan?.allocationPlan) {
      if (dbPlan.batchId && dbPlan.batchId !== batch.batchId) {
        throw new Error(`Identity mismatch: plan batchId ${dbPlan.batchId} ≠ batch ${batch.batchId}`);
      }
      allocationPlanHash = dbPlan.allocationPlanHash;
      policyContextHash = dbPlan.policyContextHash;
      portfolioRegistryVersion = dbPlan.portfolioRegistryVersion;
      allocationPlan = dbPlan.allocationPlan;
    }
  }

  if (!allocationPlanHash || !policyContextHash || !portfolioRegistryVersion) {
    throw new Error('Allocation plan hashes are missing from batch. Cannot anchor without the computed plan data.');
  }
  if (!allocationPlan) {
    throw new Error('Allocation plan payload is missing from batch. Cannot anchor without the plan payload.');
  }

  const escrow = new Contract(params.escrowAddress, ESCROW_ALLOCATION_ABI, params.signer);
  const tx = await escrow.attachAllocation(
    BigInt(sourceBatchId),
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion,
  );
  const receipt = await (tx as { wait: () => Promise<{ hash?: string }> }).wait();

  // Server reads chain and updates DB status — no plan body flows from client.
  const validated = await validateAllocationOnServer({ batchId: batch.batchId, chainKey: params.chainKey });
  const dbSaveStatus: AaaAllocationResponse['dbSaveStatus'] = validated?.status === 'validated'
    ? 'validated'
    : validated?.status === 'hash_mismatch' ? 'hash_mismatch' : 'db_save_failed';

  return {
    allocationPlan,
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion,
    createdAt: allocationPlan.timestamp || new Date().toISOString(),
    sourceBatchId,
    escrowBatchId: batch.batchId,
    attachTxHash: receipt?.hash ?? (tx as any).hash,
    attachedAt: validated ? undefined : undefined,
    dbSaveStatus,
  };
}

// ── Single-step compute + anchor ──────────────────────────────────────────────
// Replaces the two-phase (compute → anchor) flow.
// Computes the allocation plan, anchors it on-chain in one shot via the signer
// service, then writes to DB keyed by wallet address. Status goes straight from
// missing → validated; no intermediate computed/pending_anchor states.

export async function computeAndAnchorAllocation(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  registryAddress: string;
  routeRegistryAddress?: string;
  chainId: number;
  chainKey?: string;
  escrowSignerUrl: string;
}): Promise<AaaAllocationResponse> {
  const { batch, rpcUrl, escrowAddress, registryAddress, chainId } = params;
  const walletAddress = batch.wallet.walletAddress ?? batch.wallet.address ?? '';
  const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
  if (!sourceBatchId) throw new Error('sourceBatchId is missing from batch.');
  if (!walletAddress) throw new Error('Batch wallet address is missing — wallet must be created before allocation.');

  const [{ assets, version }, routeRead] = await Promise.all([
    readPortfolioRegistryAssets({ rpcUrl, registryAddress }),
    readExecutionRoutes({ rpcUrl, routeRegistryAddress: params.routeRegistryAddress }),
  ]);
  if (assets.length === 0) throw new Error('PortfolioRegistry has no approved assets.');

  const routeRegistryConfigured = Boolean(params.routeRegistryAddress && /^0x[a-fA-F0-9]{40}$/.test(params.routeRegistryAddress));
  const { allocatableAssets, excludedAssets } = buildAllocationUniverse({ assets, routes: routeRead.routes, routeRegistryConfigured });
  if (allocatableAssets.length === 0) {
    throw new Error(`No DAO-eligible assets for allocation. Excluded: ${excludedAssets.map((e) => `${e.symbol}:${e.reason}`).join(', ')}`);
  }

  const createdAt = new Date().toISOString();
  const tickId = `tick-${sourceBatchId}-${Date.now()}`;

  const policyCtx = buildPolicyContext({
    portfolioRegistryVersion: version,
    portfolioRegistryAddress: registryAddress,
    executionRouteRegistryAddress: params.routeRegistryAddress,
    executionRouteRegistryVersion: routeRead.version,
    approvedAssetList:  allocatableAssets.map((a) => a.symbol),
    excludedAssetList:  excludedAssets,
    chainId,
    custodyMode:        batch.custodyMode ?? 'batch_wallet_custody',
    asset:              batch.asset ?? 'USDC',
    escrowContractAddress: escrowAddress,
    sourceBatchId,
    escrowBatchId:      batch.batchId,
  });
  const policyContextHash = canonicalKeccak(policyCtx);

  const allocationPlan = runDeterministicAllocatorV1({
    assets: allocatableAssets,
    excludedAssets,
    complianceRegistryVersion: routeRead.version,
    policySnapshot: DEFAULT_POLICY_SNAPSHOT,
    tickId,
    timestamp: createdAt,
    sourceBatchId,
    portfolioRegistryVersion: version,
  });
  const allocationPlanHash = canonicalKeccak(canonicalPlanFields(allocationPlan));

  // Anchor on-chain via signer service — no browser wallet needed.
  const { txHash, attachedAt } = await (async () => {
    const res = await fetch(`${params.escrowSignerUrl}/attach-allocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceBatchId, allocationPlanHash, policyContextHash, portfolioRegistryVersion: version }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Signer service attach-allocation failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<{ txHash: string; attachedAt: string }>;
  })();

  // Chain is the authority. Server reads chain and verifies.
  const validated = await validateAllocationOnServer({ batchId: batch.batchId, chainKey: params.chainKey });
  if (!validated) {
    throw new Error('Chain attachment hash mismatch after anchoring. Please retry.');
  }

  const dbSaveStatus: AaaAllocationResponse['dbSaveStatus'] = validated.status === 'validated' ? 'validated' : 'hash_mismatch';

  return {
    allocationPlan,
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion: version,
    createdAt,
    sourceBatchId,
    escrowBatchId: batch.batchId,
    attachTxHash:  txHash || undefined,
    attachedAt:    attachedAt || undefined,
    dbSaveStatus,
  };
}

export async function anchorComputedAllocation(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  chainId: number;
  chainKey?: string;
  signer: ReturnType<BrowserProvider['getSigner']> extends Promise<infer S> ? S : never;
}): Promise<AaaAllocationResponse> {
  const sourceBatchId = params.batch.sourceBatchId || params.batch.treasuryHandoff.handoffId;
  if (!sourceBatchId) throw new Error('sourceBatchId is missing from batch.');

  const db = await fetchPlanFromDb(params.batch, params.chainKey);
  if (!db) {
    throw new Error('Computed AAA allocation was not found in the database. Refusing to regenerate or anchor a replacement.');
  }
  assertStoredPlanIntegrity(db);

  const escrow = new Contract(params.escrowAddress, ESCROW_ALLOCATION_ABI, params.signer);
  const tx = await escrow.attachAllocation(
    BigInt(sourceBatchId),
    db.allocationPlanHash,
    db.policyContextHash,
    db.portfolioRegistryVersion,
  );
  const receipt = await (tx as { wait: () => Promise<{ hash?: string }> }).wait();

  const validated = await validateAllocationOnServer({ batchId: params.batch.batchId, chainKey: params.chainKey });
  const dbSaveStatus: AaaAllocationResponse['dbSaveStatus'] = validated?.status === 'validated'
    ? 'validated'
    : validated?.status === 'hash_mismatch' ? 'hash_mismatch' : 'db_save_failed';

  return {
    allocationPlan: db.allocationPlan,
    allocationPlanHash: db.allocationPlanHash,
    policyContextHash: db.policyContextHash,
    portfolioRegistryVersion: db.portfolioRegistryVersion,
    createdAt: db.allocationPlan.timestamp || new Date().toISOString(),
    sourceBatchId,
    escrowBatchId: params.batch.batchId,
    attachTxHash: receipt?.hash ?? (tx as any).hash,
    dbSaveStatus,
  };
}

export async function requestAndAttachAllocation(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  registryAddress: string;
  routeRegistryAddress?: string;
  chainId: number;
  chainKey?: string;
  signer: ReturnType<BrowserProvider['getSigner']> extends Promise<infer S> ? S : never;
}): Promise<AaaAllocationResponse> {
  const { batch, escrowAddress } = params;
  const escrowBatchId = getAllocationStorageBatchId(batch);
  const sourceBatchId = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
  if (!sourceBatchId) throw new Error('sourceBatchId is missing from batch.');

  console.info('[AAA] triggering server-side compute', { escrowBatchId, sourceBatchId });
  const record = await triggerServerAllocation({ escrowBatchId, chainKey: params.chainKey });
  console.info('[AAA] server compute returned', {
    escrowBatchId, sourceBatchId,
    allocationPlanHash: record.allocationPlanHash,
    policyContextHash: record.policyContextHash,
  });

  const escrow = new Contract(escrowAddress, ESCROW_ALLOCATION_ABI, params.signer);
  console.info('[AAA] attachAllocation submitting', { escrowBatchId, sourceBatchId });
  const tx = await escrow.attachAllocation(
    BigInt(sourceBatchId),
    record.allocationPlanHash,
    record.policyContextHash,
    record.portfolioRegistryVersion,
  );
  await (tx as { wait: () => Promise<unknown> }).wait();
  console.info('[AAA] attachAllocation confirmed', { escrowBatchId, sourceBatchId });

  const validated = await validateAllocationOnServer({ batchId: escrowBatchId, chainKey: params.chainKey });
  const dbStatus = (validated?.status === 'validated' ? 'validated'
    : validated?.status === 'hash_mismatch' ? 'hash_mismatch'
    : 'db_save_failed') as AaaAllocationResponse['dbSaveStatus'];
  console.info('[AAA] server validation', { escrowBatchId, sourceBatchId, dbStatus });

  return {
    allocationPlan: record.allocationPlan,
    allocationPlanHash: record.allocationPlanHash,
    policyContextHash: record.policyContextHash,
    portfolioRegistryVersion: record.portfolioRegistryVersion,
    createdAt: record.allocationPlan.timestamp || new Date().toISOString(),
    sourceBatchId,
    escrowBatchId,
    attachTxHash: (tx as any).hash,
    dbSaveStatus: dbStatus,
  };
}

// ── Chain read (for reload reconstruction) ────────────────────────────────────

export async function readAllocationFromChain(params: {
  sourceBatchId: string;
  rpcUrl: string;
  escrowAddress: string;
}): Promise<OnChainAllocationAttachment | null> {
  try {
    const provider = new JsonRpcProvider(params.rpcUrl);
    const escrow = new Contract(params.escrowAddress, ESCROW_ALLOCATION_ABI, provider);
    const raw = await escrow.getAllocationAttachment(BigInt(params.sourceBatchId));
    const result: OnChainAllocationAttachment = {
      allocationPlanHash:       String(raw.allocationPlanHash ?? raw[0]),
      policyContextHash:        String(raw.policyContextHash ?? raw[1]),
      portfolioRegistryVersion: String(raw.portfolioRegistryVersion ?? raw[2]),
      attachedBy:               String(raw.attachedBy ?? raw[3]),
      attachedAt:               Number(raw.attachedAt ?? raw[4]),
      exists:                   Boolean(raw.exists ?? raw[5]),
    };
    return result.exists ? result : null;
  } catch {
    return null;
  }
}

// ── Combined DB + chain resolution ───────────────────────────────────────────
// DB is the content source. Chain is the authority source.
// Status is only 'validated' when both agree on the same hash.

export type ResolvedAllocationStatus = {
  /** The allocation plan payload, if available from DB. */
  allocationPlan: AaaTickResponse | null;
  /** planId from the DB row (UUID), or empty string. */
  planId: string;
  /** Hash from DB row (or empty string). */
  dbPlanHash: string;
  /** Hash read from chain. */
  chainPlanHash: string;
  /** True = both sources present and hashes agree. */
  status:
    | 'validated'    // DB hash === chain hash
    | 'chain_only'   // chain has hash, DB payload missing
    | 'hash_mismatch'// DB payload exists, chain hash differs
    | 'computed'     // DB payload exists, no chain attachment found
    | 'missing';     // neither DB nor chain has anything
  policyContextHash: string;
  portfolioRegistryVersion: string;
  attachedAt?: string;
};

export async function resolveAllocationStatus(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  chainKey?: string;
}): Promise<ResolvedAllocationStatus> {
  const sourceBatchId = params.batch.sourceBatchId || params.batch.treasuryHandoff.handoffId;

  const chainResult = await (
    sourceBatchId
      ? readAllocationFromChain({ sourceBatchId, rpcUrl: params.rpcUrl, escrowAddress: params.escrowAddress })
      : Promise.resolve(null)
  );

  const chainHash = chainResult?.exists ? chainResult.allocationPlanHash : '';
  // Look up by batchId only — UNIQUE (chain_key, batch_id) means at most one row per batch.
  // Using the chain hash as a filter causes spurious "chain_only" results whenever the stored
  // allocation_result hash doesn't match the chain value (e.g. race between save and resolve).
  const storageBatchId = getAllocationStorageBatchId(params.batch);
  const walletAddress = params.batch.wallet.walletAddress ?? params.batch.wallet.address ?? '';
  const dbResult =
    await fetchPlanFromDb(storageBatchId, params.chainKey) ??
    await fetchPlanByWalletFromDb(walletAddress, chainHash, params.chainKey);

  const dbHash = dbResult?.allocationPlanHash ?? '';

  if (!chainHash && !dbHash) {
    return { allocationPlan: null, planId: '', dbPlanHash: '', chainPlanHash: '', status: 'missing', policyContextHash: '', portfolioRegistryVersion: '' };
  }

  if (chainHash && !dbResult) {
    return {
      allocationPlan:           null,
      planId:                   '',
      dbPlanHash:               '',
      chainPlanHash:            chainHash,
      status:                   'chain_only',
      policyContextHash:        chainResult?.policyContextHash ?? '',
      portfolioRegistryVersion: chainResult?.portfolioRegistryVersion ?? '',
      attachedAt:               chainResult?.attachedAt ? new Date(chainResult.attachedAt * 1000).toISOString() : undefined,
    };
  }

  if (!chainHash && dbResult) {
    return {
      allocationPlan:           dbResult.allocationPlan,
      planId:                   dbResult.planId,
      dbPlanHash:               dbHash,
      chainPlanHash:            '',
      status:                   'computed',
      policyContextHash:        dbResult.policyContextHash,
      portfolioRegistryVersion: dbResult.portfolioRegistryVersion,
    };
  }

  // Both present — hash comparison is the authority check
  let payloadMatchesDbHash = false;
  try {
    payloadMatchesDbHash = equalHash(canonicalKeccak(canonicalPlanFields(dbResult!.allocationPlan)), dbHash);
  } catch {
    payloadMatchesDbHash = false;
  }

  if (payloadMatchesDbHash && allocationAttachmentMatches(dbResult!, chainResult)) {
    return {
      allocationPlan:           dbResult!.allocationPlan,
      planId:                   dbResult!.planId,
      dbPlanHash:               dbHash,
      chainPlanHash:            chainHash,
      status:                   'validated',
      policyContextHash:        dbResult!.policyContextHash,
      portfolioRegistryVersion: dbResult!.portfolioRegistryVersion,
      attachedAt:               chainResult?.attachedAt ? new Date(chainResult.attachedAt * 1000).toISOString() : undefined,
    };
  }

  return {
    allocationPlan:           dbResult!.allocationPlan,
    planId:                   dbResult!.planId,
    dbPlanHash:               dbHash,
    chainPlanHash:            chainHash,
    status:                   'hash_mismatch',
    policyContextHash:        dbResult!.policyContextHash,
    portfolioRegistryVersion: dbResult!.portfolioRegistryVersion,
    attachedAt:               chainResult?.attachedAt ? new Date(chainResult.attachedAt * 1000).toISOString() : undefined,
  };
}

// ── Recover plan data (read-only, no tx) ──────────────────────────────────────
// Re-runs the deterministic allocator against the current PortfolioRegistry state,
// computes the stable hash, and compares it against the on-chain anchored hash.
// Returns the plan regardless of match — caller decides how to surface mismatch.

export type RecoveredAllocationPlan = {
  allocationPlan: AaaTickResponse;
  allocationPlanHash: string;
  policyContextHash: string;
  portfolioRegistryVersion: string;
  planId?: string;
  hashMatchesOnChain: boolean | null; // null when no on-chain hash available to compare
  sourceBatchId: string;
  escrowBatchId: string;
};

export async function recoverAllocationPlan(params: {
  batch: EscrowBatch;
  rpcUrl: string;
  escrowAddress: string;
  registryAddress: string;
  routeRegistryAddress?: string;
  chainId: number;
  chainKey?: string;
  onChainHash?: string;
  onChainPolicyHash?: string;
}): Promise<RecoveredAllocationPlan> {
  const { batch, rpcUrl, registryAddress, escrowAddress, chainId } = params;

  const [{ assets, version }, routeRead] = await Promise.all([
    readPortfolioRegistryAssets({ rpcUrl, registryAddress }),
    readExecutionRoutes({ rpcUrl, routeRegistryAddress: params.routeRegistryAddress }),
  ]);
  if (assets.length === 0) {
    throw new Error('PortfolioRegistry has no approved assets.');
  }
  const routeRegistryConfigured = Boolean(params.routeRegistryAddress && /^0x[a-fA-F0-9]{40}$/.test(params.routeRegistryAddress));
  const { allocatableAssets, excludedAssets } = buildAllocationUniverse({
    assets,
    routes: routeRead.routes,
    routeRegistryConfigured,
  });
  if (allocatableAssets.length === 0) {
    throw new Error(
      `No DAO-eligible assets are available for AAA allocation. Excluded: ${excludedAssets.map((item) => `${item.symbol}:${item.reason}`).join(', ') || 'none'}.`,
    );
  }

  const sourceBatchId  = batch.sourceBatchId || batch.treasuryHandoff.handoffId;
  const escrowBatchId  = batch.batchId;
  if (!sourceBatchId) throw new Error('sourceBatchId is missing from batch.');

  const policyCtx = buildPolicyContext({
    portfolioRegistryVersion: version,
    portfolioRegistryAddress: registryAddress,
    executionRouteRegistryAddress: params.routeRegistryAddress,
    executionRouteRegistryVersion: routeRead.version,
    approvedAssetList:        allocatableAssets.map((a) => a.symbol),
    excludedAssetList:        excludedAssets,
    chainId,
    custodyMode:              batch.custodyMode ?? 'batch_wallet_custody',
    asset:                    batch.asset ?? 'USDC',
    escrowContractAddress:    escrowAddress,
    sourceBatchId,
    escrowBatchId,
  });
  const policyContextHash = canonicalKeccak(policyCtx);

  const now = new Date().toISOString();
  const allocationPlan = runDeterministicAllocatorV1({
    assets: allocatableAssets,
    excludedAssets,
    complianceRegistryVersion: routeRead.version,
    policySnapshot: DEFAULT_POLICY_SNAPSHOT,
    tickId:    `tick-recovered-${sourceBatchId}`,
    timestamp: now,
    sourceBatchId,
    portfolioRegistryVersion: version,
  });

  const allocationPlanHash = canonicalKeccak(canonicalPlanFields(allocationPlan));

  let hashMatchesOnChain: boolean | null = null;
  if (params.onChainHash && params.onChainHash !== '0x' + '0'.repeat(64)) {
    hashMatchesOnChain = allocationPlanHash === params.onChainHash;
  }

  // Persist to DB.
  // 'validated' only when the hash was verified against the on-chain anchor.
  // 'computed' otherwise — the plan is stored for reference but the chain is authoritative.
  await savePlanToDb({
    batch,
    allocationPlan,
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion: version,
    chainId,
    chainKey: params.chainKey,
    status: hashMatchesOnChain === true ? 'validated' : 'computed',
  }).catch((e) => {
    console.error('[AAA] DB recovery save failed:', e?.message ?? e);
    throw e;
  });

  const saved = await fetchPlanFromDb(getAllocationStorageBatchId(batch), params.chainKey).catch(() => null);

  return {
    allocationPlan,
    allocationPlanHash,
    policyContextHash,
    portfolioRegistryVersion: version,
    planId: saved?.planId ?? '',
    hashMatchesOnChain,
    sourceBatchId,
    escrowBatchId,
  };
}

// ── Apply allocation response to batch state ──────────────────────────────────

export function applyAllocationToBatch(
  batch: EscrowBatch,
  response: AaaAllocationResponse,
  txHash?: string,
): EscrowBatch {
  const planId = `aaa-${batch.batchId}-${Date.now()}`;
  const attachedAt = response.attachedAt ?? response.createdAt;
  const validated = response.dbSaveStatus === 'validated';

  const auditEvent: EscrowBatch['auditTrail'][number] = {
    eventId:   `${batch.batchId}-aaa-attached-${Date.now()}`,
    timestamp: attachedAt,
    actor:     'AAA Allocation Service (protocol_deterministic_v1)',
    eventType: validated ? 'aaa_allocation_attached' : 'aaa_allocation_anchor_unvalidated',
    description: `AAA allocation attached. Assets: ${Object.keys(response.allocationPlan.target_weights).join(', ')}. Plan hash: ${response.allocationPlanHash.slice(0, 10)}…`,
    txHash: response.attachTxHash ?? txHash,
  };

  // Build deployment legs from allocation weights × total amount
  const weights = response.allocationPlan.target_weights;
  const roleByAsset = response.allocationPlan.role_by_asset;
  const deploymentLegs: EscrowBatch['deploymentLegs'] = Object.entries(weights).map(([symbol, weight], i) => ({
    legId:              `${batch.batchId}-leg-${i}`,
    provider:           providerFromRole(roleByAsset[symbol] ?? 'satellite'),
    asset:              symbol,
    strategyType:       strategyFromRole(roleByAsset[symbol] ?? 'satellite'),
    amountUsd:          Math.round(weight * batch.totalAmountUsd * 100) / 100,
    allocationPercent:  Math.round(weight * 10000) / 100,
    targetYieldBps:     targetYieldFromRole(roleByAsset[symbol] ?? 'satellite'),
    status:             'planned' as const,
  }));

  const blendedYieldBps = Math.round(
    Object.entries(weights).reduce(
      (sum, [sym, w]) => sum + w * targetYieldFromRole(roleByAsset[sym] ?? 'satellite'),
      0,
    ),
  );

  return {
    ...batch,
    status:
      validated && ['wallet_funded', 'wallet_created'].includes(batch.status) ? 'aaa_plan_attached' : batch.status,
    aaaAllocation: {
      planId,
      allocationPlanHash:       response.allocationPlanHash,
      policyContextHash:        response.policyContextHash,
      portfolioRegistryVersion: response.portfolioRegistryVersion,
      targetYieldBps:           blendedYieldBps,
      attachedAt,
      attachTxHash:             response.attachTxHash ?? txHash,
      allocationPlan:           response.allocationPlan,
      status:                   validated
        ? 'validated'
        : response.dbSaveStatus === 'hash_mismatch'
          ? 'hash_mismatch'
          : 'computed',
    },
    deploymentLegs: batch.deploymentLegs.length > 0 ? batch.deploymentLegs : deploymentLegs,
    auditTrail: [...batch.auditTrail, auditEvent],
  };
}

export function applyComputedPlanToBatch(
  batch: EscrowBatch,
  computed: ComputedAllocationPlan,
): EscrowBatch {
  const weights = computed.allocationPlan.target_weights;
  const roleByAsset = computed.allocationPlan.role_by_asset;
  const blendedYieldBps = Math.round(
    Object.entries(weights).reduce(
      (sum, [sym, w]) => sum + w * targetYieldFromRole(roleByAsset[sym] ?? 'satellite'),
      0,
    ),
  );

  const deploymentLegs: EscrowBatch['deploymentLegs'] = batch.deploymentLegs.length > 0
    ? batch.deploymentLegs
    : Object.entries(weights).map(([symbol, weight], i) => ({
        legId:              `${batch.batchId}-leg-${i}`,
        provider:           providerFromRole(roleByAsset[symbol] ?? 'satellite'),
        asset:              symbol,
        strategyType:       strategyFromRole(roleByAsset[symbol] ?? 'satellite'),
        amountUsd:          Math.round(weight * batch.totalAmountUsd * 100) / 100,
        allocationPercent:  Math.round(weight * 10000) / 100,
        targetYieldBps:     targetYieldFromRole(roleByAsset[symbol] ?? 'satellite'),
        status:             'planned' as const,
      }));

  return {
    ...batch,
    deploymentLegs,
    aaaAllocation: {
      ...batch.aaaAllocation,
      planId:                   `aaa-${batch.batchId}-computed`,
      allocationPlanHash:       computed.allocationPlanHash,
      policyContextHash:        computed.policyContextHash,
      portfolioRegistryVersion: computed.portfolioRegistryVersion,
      targetYieldBps:           blendedYieldBps,
      allocationPlan:           computed.allocationPlan,
      status:                   'computed',
    },
    auditTrail: [
      ...batch.auditTrail,
      {
        eventId: `${batch.batchId}-aaa-computed-${Date.now()}`,
        timestamp: computed.createdAt,
        actor: 'AAA Allocation Service (protocol_deterministic_v1)',
        eventType: 'aaa_allocation_computed',
        description: `AAA allocation computed and stored in DB. Assets: ${Object.keys(computed.allocationPlan.target_weights).join(', ')}. Plan hash: ${computed.allocationPlanHash.slice(0, 10)}...`,
        reference: computed.allocationPlanHash,
      },
    ],
  };
}

/** Apply a recovered plan to batch state. Does NOT change on-chain state. */
export function applyRecoveredPlanToBatch(
  batch: EscrowBatch,
  recovered: RecoveredAllocationPlan,
): EscrowBatch {
  const weights    = recovered.allocationPlan.target_weights;
  const roleByAss  = recovered.allocationPlan.role_by_asset;
  const blendedYieldBps = Math.round(
    Object.entries(weights).reduce(
      (sum, [sym, w]) => sum + w * targetYieldFromRole(roleByAss[sym] ?? 'satellite'),
      0,
    ),
  );

  const newStatus: EscrowBatch['aaaAllocation']['status'] =
    recovered.hashMatchesOnChain === false ? 'hash_mismatch' : 'validated';

  const deploymentLegs: EscrowBatch['deploymentLegs'] = batch.deploymentLegs.length > 0
    ? batch.deploymentLegs
    : Object.entries(weights).map(([symbol, weight], i) => ({
        legId:             `${batch.batchId}-leg-${i}`,
        provider:          providerFromRole(roleByAss[symbol] ?? 'satellite'),
        asset:             symbol,
        strategyType:      strategyFromRole(roleByAss[symbol] ?? 'satellite'),
        amountUsd:         Math.round(weight * batch.totalAmountUsd * 100) / 100,
        allocationPercent: Math.round(weight * 10000) / 100,
        targetYieldBps:    targetYieldFromRole(roleByAss[symbol] ?? 'satellite'),
        status:            'planned' as const,
      }));

  return {
    ...batch,
    deploymentLegs,
      aaaAllocation: {
      ...batch.aaaAllocation,
      planId:                   recovered.planId || batch.aaaAllocation.planId || `aaa-${batch.batchId}-recovered`,
      allocationPlan:           recovered.allocationPlan,
      allocationPlanHash:       recovered.allocationPlanHash,
      policyContextHash:        recovered.policyContextHash,
      targetYieldBps:           blendedYieldBps,
      portfolioRegistryVersion: recovered.portfolioRegistryVersion,
      status:                   newStatus,
    },
  };
}

/** Apply on-chain attachment read to batch (no plan data available after localStorage clear). */
export function applyOnChainAllocationToBatch(
  batch: EscrowBatch,
  onChain: OnChainAllocationAttachment,
): EscrowBatch {
  const localHash = batch.aaaAllocation.allocationPlanHash;
  const chainHash = onChain.allocationPlanHash;

  // If we have a local plan, verify its hash matches chain
  if (localHash && localHash !== '0x' + '0'.repeat(64) && chainHash !== '0x' + '0'.repeat(64)) {
    if (localHash !== chainHash) {
      return {
        ...batch,
        aaaAllocation: {
          ...batch.aaaAllocation,
          status: 'hash_mismatch',
          allocationPlanHash: localHash,
          policyContextHash:  batch.aaaAllocation.policyContextHash,
        },
      };
    }
    // Hashes match — already attached, nothing to change
    return batch;
  }

  // No local plan — reconstruct from chain
  const attachedAt = onChain.attachedAt > 0
    ? new Date(onChain.attachedAt * 1000).toISOString()
    : undefined;

  return {
    ...batch,
    status: batch.status,
    aaaAllocation: {
      ...batch.aaaAllocation,
      allocationPlanHash:       onChain.allocationPlanHash,
      policyContextHash:        onChain.policyContextHash,
      portfolioRegistryVersion: onChain.portfolioRegistryVersion,
      attachedAt,
      status: 'chain_only',
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function providerFromRole(role: string): EscrowBatch['deploymentLegs'][number]['provider'] {
  switch (role) {
    case 'core':        return 'manual';
    case 'liquidity':   return 'liquidity';
    case 'satellite':   return 'usdc_yield';
    case 'defensive':   return 'manual';
    case 'speculative': return 'goldfinch';
    case 'yield_fund':  return 'usdc_yield';
    default:            return 'manual';
  }
}

function strategyFromRole(role: string): EscrowBatch['deploymentLegs'][number]['strategyType'] {
  switch (role) {
    case 'core':        return 'yield';
    case 'liquidity':   return 'liquidity';
    case 'satellite':   return 'yield';
    case 'defensive':   return 'stabilizer';
    case 'speculative': return 'private_credit';
    case 'yield_fund':  return 'yield';
    default:            return 'yield';
  }
}

function targetYieldFromRole(role: string): number {
  switch (role) {
    case 'core':        return 800;
    case 'liquidity':   return 400;
    case 'satellite':   return 600;
    case 'defensive':   return 300;
    case 'speculative': return 1200;
    case 'yield_fund':  return 700;
    default:            return 500;
  }
}
