// Route authority registry — the single machine-readable declaration of who may
// call what across every Sagitta service.
//
// This file is the source of truth for Phase 1 of the write-surface lockdown.
// A route that performs an unsafe method (POST/PUT/PATCH/DELETE) and is NOT
// declared here fails the coverage test in
// `server/src/lib/security/__tests__/routeAuthority.test.ts`.
//
// Adding a write route? Add its declaration here in the same commit. The
// coverage test enumerates the actual Express routers and the actual Next.js
// pages/api tree, so an omission is a test failure, not a silent hole.

import type { AuthorityClass } from './serviceAuth';

// ─── Service identities ───────────────────────────────────────────────────────
// These strings are also the assertion `iss`/`aud` values. Changing one is a
// breaking protocol change across services.

export const SERVICE_IDS = {
  frontend: 'protocol-frontend',
  banking: 'banking-server',
  signerTreasury: 'signer-treasury',
  signerEscrow: 'signer-escrow',
  walletFactory: 'wallet-factory',
} as const;

export type ServiceId = typeof SERVICE_IDS[keyof typeof SERVICE_IDS];

// ─── Scopes ───────────────────────────────────────────────────────────────────
// Narrow by intent, not by route. Two routes that can cause the same financial
// effect share a scope; a route that can cause a strictly larger effect gets
// its own.

export const SCOPES = {
  bankingRead: 'banking:read',
  bankingWrite: 'banking:write',
  institutionWrite: 'institution:write',
  customerWrite: 'customer:write',
  wireSimulate: 'wire:simulate',
  treasuryBatchWrite: 'treasury:batch:write',
  escrowAllocationWrite: 'escrow:allocation:write',
  escrowLifecycleWrite: 'escrow:lifecycle:write',
  escrowDeploymentWrite: 'escrow:deployment:write',
  escrowDistributionPreview: 'escrow:distribution:preview',
  escrowDistributionExecute: 'escrow:distribution:execute',
  reconciliationRun: 'reconciliation:run',
  adminRepair: 'admin:repair',
  adminSettlement: 'admin:settlement',
  adminDev: 'admin:dev',
  signerSign: 'signer:sign',
  signerAnchor: 'signer:anchor',
  signerTransact: 'signer:transact',
  walletCreate: 'wallet:create',
} as const;

export type Scope = typeof SCOPES[keyof typeof SCOPES];

/**
 * Scopes granted to a wallet session by resolved role.
 *
 * Roles are resolved from the on-chain role authority registry
 * (InvestmentEscrow.getRoleAuthority) plus the operator/admin wallet allowlists
 * in configuration — see `frontend/src/lib/security/walletAuthority.ts`.
 */
export const ROLE_SCOPES: Record<string, readonly Scope[]> = {
  // Read-only viewer. Every connected wallet gets at least this.
  viewer: [SCOPES.bankingRead],

  // Bank/institution operator: can originate deposits and move their own
  // batches through the normal lifecycle. Cannot repair, cannot finalize.
  operator: [
    SCOPES.bankingRead,
    SCOPES.bankingWrite,
    SCOPES.customerWrite,
    SCOPES.wireSimulate,
    SCOPES.treasuryBatchWrite,
    SCOPES.escrowAllocationWrite,
    SCOPES.escrowLifecycleWrite,
    SCOPES.escrowDeploymentWrite,
    SCOPES.escrowDistributionPreview,
  ],

  // Protocol administrator: everything an operator can do, plus repair,
  // settlement finalization, reconciliation, and distribution execution.
  admin: [
    SCOPES.bankingRead,
    SCOPES.bankingWrite,
    SCOPES.institutionWrite,
    SCOPES.customerWrite,
    SCOPES.wireSimulate,
    SCOPES.treasuryBatchWrite,
    SCOPES.escrowAllocationWrite,
    SCOPES.escrowLifecycleWrite,
    SCOPES.escrowDeploymentWrite,
    SCOPES.escrowDistributionPreview,
    SCOPES.escrowDistributionExecute,
    SCOPES.reconciliationRun,
    SCOPES.adminRepair,
    SCOPES.adminSettlement,
    SCOPES.adminDev,
  ],
};

// ─── Mutation and side-effect classification ─────────────────────────────────

export type MutationClass =
  | 'none'            // read-only
  | 'metadata'        // writes non-financial bookkeeping rows only
  | 'financial'       // creates or alters money-bearing records
  | 'lifecycle'       // advances protocol state machine
  | 'onchain';        // submits a blockchain transaction

export type SideEffect =
  | 'postgres'
  | 'fineract'
  | 'circle'
  | 'rpc'
  | 'chain-tx'
  | 'signer-service'
  | 'wallet-factory'
  | 'banking-api';

// ─── Registry entry ───────────────────────────────────────────────────────────

export interface RouteAuthority {
  /** Uppercase HTTP method. */
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Express-style path template as registered on the owning service. */
  path: string;
  /** Which service actually executes the operation. */
  service: ServiceId;
  /** Who may call it. */
  authority: AuthorityClass;
  /** Scopes the caller must hold. Empty for public and webhook routes. */
  scopes: readonly Scope[];
  /** What the route changes. */
  mutation: MutationClass;
  /** Systems touched beyond this process. */
  sideEffects: readonly SideEffect[];
  /**
   * True when repeated identical calls must not double-apply. Enforced by
   * `idempotencyGuard()`, which requires an Idempotency-Key header and stores
   * the result against a PRIMARY KEY in `request_idempotency`.
   */
  idempotencyRequired: boolean;
  /**
   * The ONLY permitted alternative to `idempotencyRequired` on a financial or
   * on-chain route: an operation whose repeat-safety comes from converging on
   * a target state rather than from a stored key. Requires a written
   * justification, so the exemption is a decision on the record rather than an
   * oversight. The registry invariant test rejects a financial/on-chain write
   * that has neither.
   */
  reentrant?: { justification: string };
  /** True when a redacted audit event must be recorded. */
  auditRequired: boolean;
  /**
   * What a public read exposes. Required on every public GET so the decision is
   * explicit rather than inherited from "it was public during the demo".
   *
   *  'public-reference' — protocol-level facts that are already on-chain or are
   *                       deliberately published. Safe to serve anonymously.
   *  'operational'      — internal state (lifecycle phases, reconciliation
   *                       status). Not secret today, but of no use to the public.
   *  'customer-data'    — institution identity, balances, positions, or
   *                       settlement amounts. MUST move behind an authenticated
   *                       session before real customer records exist; see
   *                       docs/public-read-confidentiality.md.
   */
  confidentiality?: 'public-reference' | 'operational' | 'customer-data';
  /** Returns 404 outside development. */
  devOnly?: boolean;
  /** Why this classification — read before loosening it. */
  notes?: string;
}

// ─── Banking server ───────────────────────────────────────────────────────────

const BANKING_ROUTES: RouteAuthority[] = [
  // ── System / health (public by design, no secrets in responses) ────────────
  { method: 'GET', path: '/healthz', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Fly health check target. Process liveness only — no config, no dependency state.' },
  { method: 'GET', path: '/ready', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false,
    notes: 'Reports security-config completeness as booleans and fingerprints only. Never echoes a secret value.' },
  { method: 'GET', path: '/version', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/system/health', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/system/preflight', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Preflight blockers name env vars and addresses — operational detail, not for anonymous callers.' },

  // ── Read surface (preserved public GETs) ──────────────────────────────────
  { method: 'GET', path: '/banking/state', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres', 'rpc'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/accounts', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/accounts/:id', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/term-positions', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/term-positions/:id', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/wire', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/funding-instructions', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/protection-status', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/settlement-events', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/institutions', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/treasury/lots', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/execution-orders', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/allocation-legs', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/allocation-plans', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/allocation-plans/by-wallet/:walletAddress', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/allocation-plans/:batchId', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/asset-history', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/deployment-records', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/lifecycle', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/lifecycle/list', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/lifecycle/checklist', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/reconciliation-status', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'operational', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/audit-onchain/:escrowBatchId', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/distribution-manifests/:escrowBatchId', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/distribution-rules/active', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/distribution-executions/:escrowBatchId', service: SERVICE_IDS.banking, authority: 'public', confidentiality: 'customer-data', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/banking/escrow/admin/dev/leg-positions/:escrowBatchId', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminDev], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false, devOnly: true },

  // ── Core banking writes ───────────────────────────────────────────────────
  { method: 'POST', path: '/banking/term-positions', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.bankingWrite], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: true, auditRequired: true,
    notes: 'Creates a term deposit — a money-bearing record. Idempotency key required.' },
  { method: 'POST', path: '/banking/term-positions/:id/register-funding', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.bankingWrite], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/deposit', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.bankingWrite], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: true, auditRequired: true,
    notes: 'Alias of POST /banking/term-positions with a different response shape.' },
  { method: 'POST', path: '/banking/funding-instructions', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.bankingRead], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false,
    notes: 'POST but read-only: returns wire instructions. Kept unsafe-classified so it cannot tunnel through the public GET allowlist.' },
  { method: 'POST', path: '/banking/institutions', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.institutionWrite], mutation: 'metadata', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true,
    notes: 'Upserts institution policy — changes allocation policy inputs. Admin, not operator.' },
  { method: 'POST', path: '/banking/institutions/onboard', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.institutionWrite], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: true, auditRequired: true,
    notes: 'Creates a Fineract client + checking account. External ledger side effect.' },
  { method: 'POST', path: '/banking/institutions/repair-payout-destinations', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'financial', sideEffects: ['postgres'], idempotencyRequired: false, reentrant: { justification: 'Repair pass: attaches a deterministic destination only where one is missing. Re-running attaches nothing new.' }, auditRequired: true,
    notes: 'Attaches payout destinations — controls where money is sent. Repair path only.' },
  { method: 'POST', path: '/banking/fineract/reconcile', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.reconciliationRun], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: false, reentrant: { justification: 'Reconciles Fineract balances to the Postgres source of truth. Converges to the same state on every run.' }, auditRequired: true },
  { method: 'POST', path: '/banking/customers/open-account', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.customerWrite], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: true, auditRequired: true },

  // ── Allocation and execution ──────────────────────────────────────────────
  { method: 'POST', path: '/banking/escrow/allocation-legs', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.escrowAllocationWrite], mutation: 'financial', sideEffects: ['postgres'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/allocation-plans/request', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.escrowAllocationWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc'], idempotencyRequired: true, auditRequired: true,
    notes: 'Server-side AAA compute. Reads chain, writes a plan that later gates on-chain attachAllocation.' },
  { method: 'POST', path: '/banking/escrow/allocation-plans/:batchId/validate', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.escrowAllocationWrite], mutation: 'lifecycle', sideEffects: ['postgres', 'rpc'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/allocation-plans', service: SERVICE_IDS.banking, authority: 'internal', scopes: [SCOPES.escrowAllocationWrite], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Permanently disabled — returns 410 before any auth or body processing. Declared so the coverage test accounts for it.' },
  { method: 'POST', path: '/banking/escrow/run-automation', service: SERVICE_IDS.banking, authority: 'internal', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'lifecycle', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: false, auditRequired: true,
    notes: 'Legacy worker route. Internal-service only — never reachable from a browser.' },
  { method: 'POST', path: '/banking/escrow/execution-orders/:batchId/advance-return', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'lifecycle', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true, notes: 'Legacy repair route.' },
  { method: 'POST', path: '/banking/escrow/execution-orders/:batchId/advance-settlement', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'lifecycle', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true, notes: 'Legacy repair route.' },
  { method: 'POST', path: '/banking/escrow/execution-orders/:batchId/advance-deployment', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'lifecycle', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true, notes: 'Legacy repair route.' },
  { method: 'POST', path: '/banking/escrow/execution-orders/:batchId/return-to-bank', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'financial', sideEffects: ['postgres', 'circle'], idempotencyRequired: true, auditRequired: true,
    notes: 'Initiates Circle wire returns — moves real money in a funded environment.' },
  { method: 'POST', path: '/banking/escrow/execution-orders/:batchId/settle-from-lifecycle', service: SERVICE_IDS.banking, authority: 'internal', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'financial', sideEffects: ['postgres'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/deployment-records', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.escrowDeploymentWrite], mutation: 'metadata', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/banking/wires/sandbox/mock', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.wireSimulate], mutation: 'financial', sideEffects: ['postgres', 'circle'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/wires/simulate', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.wireSimulate], mutation: 'financial', sideEffects: ['postgres', 'circle'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/treasury/batches', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.treasuryBatchWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/treasury/vault-batches/register', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.treasuryBatchWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/treasury/vault-batches', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.treasuryBatchWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/banking/batches/bank/create', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.treasuryBatchWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true, notes: 'Alias of POST /banking/treasury/batches.' },
  { method: 'POST', path: '/banking/batches/vault/create', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.treasuryBatchWrite], mutation: 'financial', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true, notes: 'Alias of POST /banking/treasury/vault-batches.' },
  { method: 'POST', path: '/banking/reconcile/circle', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.reconciliationRun], mutation: 'financial', sideEffects: ['postgres', 'circle'], idempotencyRequired: false, reentrant: { justification: 'Reconciles Circle transfer state into local records. Repeat runs re-derive the same result.' }, auditRequired: true },
  { method: 'POST', path: '/banking/reconcile/treasury', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.reconciliationRun], mutation: 'financial', sideEffects: ['postgres', 'rpc'], idempotencyRequired: false, reentrant: { justification: 'Reconciles on-chain Treasury state into local records. Repeat runs re-derive the same result.' }, auditRequired: true },

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  { method: 'POST', path: '/banking/escrow/lifecycle/register-batch', service: SERVICE_IDS.banking, authority: 'internal', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'lifecycle', sideEffects: ['postgres', 'rpc'], idempotencyRequired: true, auditRequired: true,
    notes: 'Finding #4: this route previously invoked no authorization at all. Now mandatory.' },
  { method: 'POST', path: '/banking/escrow/lifecycle/advance', service: SERVICE_IDS.banking, authority: 'internal', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'lifecycle', sideEffects: ['postgres', 'rpc', 'chain-tx', 'signer-service'], idempotencyRequired: true, auditRequired: true,
    notes: 'Finding #4: previously unauthenticated. Advances phases, can submit on-chain transactions via the signer services.' },

  // ── Administration ────────────────────────────────────────────────────────
  { method: 'POST', path: '/banking/escrow/admin/authorize-phase8-retry', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminRepair], mutation: 'lifecycle', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/admin/finalize-settlement', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminSettlement], mutation: 'onchain', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true,
    notes: 'Calls depositReturnForBatch() — mints/moves mUSDC and finalizes settlement on-chain.' },
  { method: 'POST', path: '/banking/escrow/admin/dev/simulate-leg-returns', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminDev], mutation: 'onchain', sideEffects: ['postgres', 'rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true, devOnly: true,
    notes: 'Mints and burns mUSDC. Must 404 in production before body processing.' },
  { method: 'POST', path: '/banking/escrow/admin/dev/demo-20-batches', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.adminDev], mutation: 'financial', sideEffects: ['postgres'], idempotencyRequired: true, auditRequired: true, devOnly: true },
  { method: 'POST', path: '/banking/escrow/reconcile-settlements', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.reconciliationRun], mutation: 'financial', sideEffects: ['postgres', 'fineract'], idempotencyRequired: false, reentrant: { justification: 'Settlement reconciliation worker; postings are keyed on the settlement row and skipped when already posted. Designed to be run repeatedly.' }, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/distribution-manifests/:escrowBatchId/preview', service: SERVICE_IDS.banking, authority: 'user', scopes: [SCOPES.escrowDistributionPreview], mutation: 'metadata', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/banking/escrow/distribution-manifests/:escrowBatchId/execute', service: SERVICE_IDS.banking, authority: 'admin', scopes: [SCOPES.escrowDistributionExecute], mutation: 'financial', sideEffects: ['postgres', 'circle', 'fineract'], idempotencyRequired: true, auditRequired: true,
    notes: 'Executes payouts. Already idempotent on manifest_hash; the guard enforces the declaration.' },

  // ── Webhooks ──────────────────────────────────────────────────────────────
  { method: 'POST', path: '/webhooks/circle', service: SERVICE_IDS.banking, authority: 'webhook', scopes: [], mutation: 'financial', sideEffects: ['postgres'], idempotencyRequired: true, auditRequired: true,
    notes: 'Authenticated by Circle signature over the raw body, not by our credentials. Provider event id deduplicated.' },
];

// ─── Treasury signer ──────────────────────────────────────────────────────────

const SIGNER_TREASURY_ROUTES: RouteAuthority[] = [
  { method: 'GET', path: '/health', service: SERVICE_IDS.signerTreasury, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Minimal by contract: status + version only. Signer address and chain config are NOT exposed.' },
  { method: 'GET', path: '/ready', service: SERVICE_IDS.signerTreasury, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'POST', path: '/request-signature', service: SERVICE_IDS.signerTreasury, authority: 'signer', scopes: [SCOPES.signerSign], mutation: 'metadata', sideEffects: ['rpc'], idempotencyRequired: false, auditRequired: true,
    notes: 'Signature production is privileged: the resulting signature is accepted on-chain as Treasury authority.' },
  { method: 'POST', path: '/deploy-leg', service: SERVICE_IDS.signerTreasury, authority: 'signer', scopes: [SCOPES.signerTransact], mutation: 'onchain', sideEffects: ['rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
];

// ─── Escrow signer ────────────────────────────────────────────────────────────

const SIGNER_ESCROW_ROUTES: RouteAuthority[] = [
  { method: 'GET', path: '/health', service: SERVICE_IDS.signerEscrow, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Minimal by contract: status + version only.' },
  { method: 'GET', path: '/ready', service: SERVICE_IDS.signerEscrow, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'POST', path: '/request-signature', service: SERVICE_IDS.signerEscrow, authority: 'signer', scopes: [SCOPES.signerSign], mutation: 'metadata', sideEffects: ['rpc'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/anchor', service: SERVICE_IDS.signerEscrow, authority: 'signer', scopes: [SCOPES.signerAnchor], mutation: 'onchain', sideEffects: ['rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/attach-allocation', service: SERVICE_IDS.signerEscrow, authority: 'signer', scopes: [SCOPES.signerTransact], mutation: 'onchain', sideEffects: ['rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/confirm-deploy-leg', service: SERVICE_IDS.signerEscrow, authority: 'signer', scopes: [SCOPES.signerTransact], mutation: 'onchain', sideEffects: ['rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true },
];

// ─── Wallet factory ───────────────────────────────────────────────────────────

const WALLET_FACTORY_ROUTES: RouteAuthority[] = [
  { method: 'GET', path: '/health', service: SERVICE_IDS.walletFactory, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/ready', service: SERVICE_IDS.walletFactory, authority: 'public', confidentiality: 'public-reference', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/wallet-binding/:sourceBatchId', service: SERVICE_IDS.walletFactory, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['rpc'], idempotencyRequired: false, auditRequired: false },
  { method: 'POST', path: '/create-batch-wallet', service: SERVICE_IDS.walletFactory, authority: 'signer', scopes: [SCOPES.walletCreate], mutation: 'onchain', sideEffects: ['rpc', 'chain-tx'], idempotencyRequired: true, auditRequired: true,
    notes: 'Deploys a multisig that will custody batch funds. Deterministic per sourceBatchId, but the guard enforces idempotency explicitly.' },
];

// ─── Next.js frontend API ─────────────────────────────────────────────────────
// Paths are Next.js route paths as served, not file paths.

const FRONTEND_ROUTES: RouteAuthority[] = [
  // Wallet session establishment — public by necessity (this is the login).
  { method: 'GET', path: '/api/auth/nonce', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Issues a single-use SIWE nonce bound to a signed, HttpOnly cookie.' },
  { method: 'POST', path: '/api/auth/verify', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['rpc'], idempotencyRequired: false, auditRequired: true,
    notes: 'Verifies the wallet signature and resolves roles from the on-chain role authority registry. Public because it IS the authentication step; rate-limited and nonce-bound.' },
  { method: 'GET', path: '/api/auth/session', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'Returns the current session (address, roles, scopes) or null. Never returns the session secret or the raw cookie value.' },
  { method: 'POST', path: '/api/auth/logout', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: [], idempotencyRequired: false, auditRequired: false,
    notes: 'CSRF-protected cookie clear. Public so an expired session can still log out.' },

  // Read-only passthroughs.
  { method: 'GET', path: '/api/banking/[...path]', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false,
    notes: 'Generic proxy. GET only, and only for paths on PUBLIC_BANKING_GET_ALLOWLIST. All unsafe methods return 405.' },
  { method: 'GET', path: '/api/banking/escrow/lifecycle', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/lifecycle/list', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/lifecycle/checklist', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/reconciliation-status', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/audit-onchain/[escrowBatchId]', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/deployment-approvals', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/deployment-executions', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false },
  { method: 'GET', path: '/api/banking/escrow/admin/dev/leg-positions/[escrowBatchId]', service: SERVICE_IDS.frontend, authority: 'admin', scopes: [SCOPES.adminDev], mutation: 'none', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: false, devOnly: true },
  { method: 'GET', path: '/api/metadata/[tokenId]', service: SERVICE_IDS.frontend, authority: 'public', scopes: [], mutation: 'none', sideEffects: ['rpc'], idempotencyRequired: false, auditRequired: false,
    notes: 'NFT metadata. Public by design — consumed by wallets and marketplaces.' },

  // Unsafe handlers — each mints an internal assertion only after session +
  // scope + CSRF checks pass.
  { method: 'POST', path: '/api/banking/escrow/deployment-approvals', service: SERVICE_IDS.frontend, authority: 'user', scopes: [SCOPES.escrowDeploymentWrite], mutation: 'metadata', sideEffects: ['postgres'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/api/banking/escrow/deployment-executions', service: SERVICE_IDS.frontend, authority: 'user', scopes: [SCOPES.escrowDeploymentWrite], mutation: 'metadata', sideEffects: ['banking-api'], idempotencyRequired: false, auditRequired: true },
  { method: 'POST', path: '/api/banking/escrow/lifecycle/register-batch', service: SERVICE_IDS.frontend, authority: 'user', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'lifecycle', sideEffects: ['banking-api'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/api/banking/escrow/lifecycle/advance', service: SERVICE_IDS.frontend, authority: 'user', scopes: [SCOPES.escrowLifecycleWrite], mutation: 'lifecycle', sideEffects: ['banking-api'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/api/banking/escrow/admin/finalize-settlement', service: SERVICE_IDS.frontend, authority: 'admin', scopes: [SCOPES.adminSettlement], mutation: 'onchain', sideEffects: ['banking-api'], idempotencyRequired: true, auditRequired: true },
  { method: 'POST', path: '/api/banking/escrow/admin/simulate-leg-returns', service: SERVICE_IDS.frontend, authority: 'admin', scopes: [SCOPES.adminDev], mutation: 'onchain', sideEffects: ['banking-api'], idempotencyRequired: true, auditRequired: true, devOnly: true },
  { method: 'POST', path: '/api/banking/escrow/reconcile-settlements', service: SERVICE_IDS.frontend, authority: 'admin', scopes: [SCOPES.reconciliationRun], mutation: 'financial', sideEffects: ['banking-api'], idempotencyRequired: false, reentrant: { justification: 'Forwards to the banking-server reconciliation worker, which is itself convergent.' }, auditRequired: true },
  { method: 'POST', path: '/api/webhooks/circle', service: SERVICE_IDS.frontend, authority: 'webhook', scopes: [], mutation: 'financial', sideEffects: ['banking-api'], idempotencyRequired: true, auditRequired: true,
    notes: 'Forwards the RAW body and Circle signature headers unchanged so the banking server can verify the signature itself.' },
];

// ─── Public export ────────────────────────────────────────────────────────────

export const ROUTE_AUTHORITY_REGISTRY: readonly RouteAuthority[] = Object.freeze([
  ...BANKING_ROUTES,
  ...SIGNER_TREASURY_ROUTES,
  ...SIGNER_ESCROW_ROUTES,
  ...WALLET_FACTORY_ROUTES,
  ...FRONTEND_ROUTES,
]);

export const UNSAFE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.includes(String(method ?? '').toUpperCase());
}

/** All declared routes for one service. */
export function routesForService(service: ServiceId): RouteAuthority[] {
  return ROUTE_AUTHORITY_REGISTRY.filter(r => r.service === service);
}

/** Exact-template lookup. Path must be the registered template, not a live URL. */
export function findRouteAuthority(
  service: ServiceId,
  method: string,
  pathTemplate: string,
): RouteAuthority | undefined {
  const m = String(method ?? '').toUpperCase();
  return ROUTE_AUTHORITY_REGISTRY.find(
    r => r.service === service && r.method === m && r.path === pathTemplate,
  );
}

/**
 * Paths the generic Next.js proxy may forward with GET.
 *
 * Templates use `:param` for a single non-empty segment. Anything not matched
 * here is refused by the proxy — it is an allowlist, not a denylist.
 */
export const PUBLIC_BANKING_GET_ALLOWLIST: readonly string[] = Object.freeze(
  routesForService(SERVICE_IDS.banking)
    .filter(r => r.method === 'GET' && r.authority === 'public' && r.path.startsWith('/banking/'))
    .map(r => r.path.replace(/^\/banking/, '')),
);

/** Match a live path against an allowlist template set. Case-sensitive on params, not on literals. */
export function matchesAllowlist(livePath: string, allowlist: readonly string[] = PUBLIC_BANKING_GET_ALLOWLIST): boolean {
  const liveSegments = String(livePath ?? '').split('?')[0].split('/').filter(Boolean);
  return allowlist.some(template => {
    const templateSegments = template.split('/').filter(Boolean);
    if (templateSegments.length !== liveSegments.length) return false;
    return templateSegments.every((seg, i) => {
      if (seg.startsWith(':')) return liveSegments[i].length > 0;
      return seg.toLowerCase() === liveSegments[i].toLowerCase();
    });
  });
}
