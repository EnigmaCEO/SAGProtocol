import {
  applyBankingDeposit,
  applyIncomingWire,
  createSeedBankingState,
} from './demoStore';
import type { BankingDashboardState, BankingDepositRequest } from './types';
import { BANKING_THEMES } from './themes';
import {
  buildEnvelope,
  createFundingInstructionRecord,
  getCapitalAccountRecord,
  getTermPositionRecord,
  mapCapitalAccounts,
  mapMaturitySchedule,
  mapProtectionStatus,
  mapSettlementEvent,
  mapTermPosition,
} from './api';

export type BankingViewId = 'accounts' | 'term-deposits' | 'api' | 'docs';

export interface BankingViewOption {
  id: BankingViewId;
  label: string;
  description: string;
}

export interface BankingObjectField {
  name: string;
  type: string;
  description: string;
}

export interface BankingApiObjectDoc {
  id: string;
  name: string;
  description: string;
  fields: BankingObjectField[];
  statuses?: string[];
  example: unknown;
}

export interface BankingApiEndpointDoc {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  description: string;
  requestExample?: unknown;
  responseExample: unknown;
  states?: string[];
}

export interface BankingDocsSection {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
}

export interface BankingFlowStep {
  id: string;
  title: string;
  body: string;
}

export interface BankingWebhookDoc {
  id: string;
  event: string;
  description: string;
  payload: unknown;
}

export const BANKING_VIEW_OPTIONS: BankingViewOption[] = [
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Customer-facing account overview',
  },
  {
    id: 'term-deposits',
    label: 'Term Deposits',
    description: 'Deposit servicing and lifecycle status',
  },
  {
    id: 'api',
    label: 'API',
    description: 'Partner integration objects and endpoints',
  },
  {
    id: 'docs',
    label: 'Docs',
    description: 'Integration model and lifecycle guidance',
  },
];

function buildReferenceState(baseState?: BankingDashboardState): BankingDashboardState {
  const startingState = baseState ?? createSeedBankingState();
  if (startingState.termPositions.length > 0 || startingState.capitalAccount.transactions.length > 0) {
    return startingState;
  }

  const fundedState = applyIncomingWire(startingState, 2500);
  const request: BankingDepositRequest = {
    amountUsd: 1500,
    termYears: 3,
    settlementMode: 'mirrored',
    note: 'Partner sandbox demo flow',
  };
  return applyBankingDeposit(fundedState, request).state;
}

export function buildBankingApiObjects(state: BankingDashboardState): BankingApiObjectDoc[] {
  const referenceState = buildReferenceState(state);
  const checkingAccount = getCapitalAccountRecord(referenceState, referenceState.capitalAccount.id);
  const termPosition = referenceState.termPositions[0]
    ? mapTermPosition(referenceState.termPositions[0])
    : null;
  const settlementEvent = referenceState.settlementEvents[0]
    ? mapSettlementEvent(referenceState.settlementEvents[0])
    : null;
  const maturitySchedule = referenceState.maturitySchedules[2]
    ? mapMaturitySchedule(referenceState.maturitySchedules[2])
    : null;
  const fundingInstruction = createFundingInstructionRecord(referenceState, {
    amount_usd: 1000,
    rail: 'wire',
  });
  const protectionStatus = mapProtectionStatus(referenceState);

  return [
    {
      id: 'capital-account',
      name: 'CapitalAccount',
      description: 'Represents the bank-facing account ledger used for customer balances, funding, and servicing state.',
      fields: [
        { name: 'id', type: 'string', description: 'Stable partner-facing account identifier.' },
        { name: 'kind', type: 'checking | savings | term_deposit', description: 'Product bucket for the account record.' },
        { name: 'account_name', type: 'string', description: 'Human-readable account label shown in banking UX.' },
        { name: 'current_balance_usd', type: 'number', description: 'Current product-layer balance in USD.' },
        { name: 'available_balance_usd', type: 'number', description: 'Spendable balance, when applicable.' },
        { name: 'recent_transactions', type: 'array', description: 'Latest posted transactions for servicing views.' },
      ],
      statuses: ['available', 'awaiting_funding', 'active', 'active_multi_position'],
      example: checkingAccount,
    },
    {
      id: 'funding-instruction',
      name: 'FundingInstruction',
      description: 'Describes how a partner bank or platform funds the Banking layer before a term deposit is opened.',
      fields: [
        { name: 'capital_account_id', type: 'string', description: 'Account that will receive or source the incoming funds.' },
        { name: 'rail', type: 'wire | ach | internal_transfer', description: 'Funding rail presented to the partner.' },
        { name: 'amount_usd', type: 'number', description: 'Expected incoming funding amount.' },
        { name: 'status', type: 'created | available | completed', description: 'Instruction lifecycle state.' },
        { name: 'reference', type: 'string', description: 'Partner-safe payment reference.' },
      ],
      statuses: ['created', 'available', 'completed'],
      example: fundingInstruction,
    },
    {
      id: 'term-position',
      name: 'TermPosition',
      description: 'Represents an opened Sagitta term deposit position from the Banking product layer.',
      fields: [
        { name: 'id', type: 'string', description: 'Stable term position identifier.' },
        { name: 'principal_usd', type: 'number', description: 'Funded principal amount.' },
        { name: 'term_years', type: 'number', description: 'Selected customer term length.' },
        { name: 'status', type: 'active | processing | matured', description: 'Lifecycle status for the term position.' },
        { name: 'maturity_date', type: 'string', description: 'Scheduled maturity timestamp.' },
        { name: 'settlement_reference', type: 'string', description: 'Reference tying the product object to settlement records.' },
      ],
      statuses: ['processing', 'active', 'matured'],
      example: termPosition,
    },
    {
      id: 'maturity-schedule',
      name: 'MaturitySchedule',
      description: 'Defines the product-approved term options and review windows available in the banking experience.',
      fields: [
        { name: 'term_years', type: 'number', description: 'Supported term length.' },
        { name: 'label', type: 'string', description: 'Short label used in UI and partner tools.' },
        { name: 'description', type: 'string', description: 'Partner-readable description of the term.' },
        { name: 'review_window', type: 'string', description: 'Operational review period near maturity.' },
      ],
      example: maturitySchedule,
    },
    {
      id: 'settlement-event',
      name: 'SettlementEvent',
      description: 'Tracks posted banking-layer settlement updates for funding, activation, and maturity servicing.',
      fields: [
        { name: 'id', type: 'string', description: 'Settlement event identifier.' },
        { name: 'amount_usd', type: 'number', description: 'USD amount associated with the settlement update.' },
        { name: 'status', type: 'completed | processing | mirrored', description: 'Settlement status visible to partner systems.' },
        { name: 'mode', type: 'onchain | mirrored', description: 'Settlement source mode exposed at the product layer.' },
        { name: 'reference', type: 'string', description: 'Shared reconciliation reference.' },
      ],
      statuses: ['processing', 'mirrored', 'completed'],
      example: settlementEvent,
    },
    {
      id: 'protection-status',
      name: 'ProtectionStatus',
      description: 'Summarizes how protection and reserve servicing status should be presented back into the banking layer.',
      fields: [
        { name: 'status', type: 'protected | reserved | monitoring', description: 'Top-line protection tone for customer servicing.' },
        { name: 'protected_capital_usd', type: 'number', description: 'Total principal currently reflected as protected.' },
        { name: 'reserve_coverage_label', type: 'string', description: 'Partner-readable reserve label.' },
        { name: 'active_term_positions', type: 'number', description: 'Count of active term positions in scope.' },
        { name: 'as_of', type: 'string', description: 'Timestamp for the latest protection snapshot.' },
      ],
      statuses: ['monitoring', 'reserved', 'protected'],
      example: protectionStatus,
    },
  ];
}

export function buildBankingApiEndpoints(state: BankingDashboardState): BankingApiEndpointDoc[] {
  const referenceState = buildReferenceState(state);
  const accounts = mapCapitalAccounts(referenceState);
  const checkingAccount = getCapitalAccountRecord(referenceState, referenceState.capitalAccount.id);
  const fundingInstruction = createFundingInstructionRecord(referenceState, {
    amount_usd: 1000,
    rail: 'wire',
  });
  const termPosition = referenceState.termPositions[0]
    ? mapTermPosition(referenceState.termPositions[0])
    : null;
  const settlementEvents = referenceState.settlementEvents.map(mapSettlementEvent);
  const protectionStatus = mapProtectionStatus(referenceState);

  return [
    {
      id: 'get-accounts',
      method: 'GET',
      path: '/api/banking/accounts',
      description: 'List product-layer banking accounts available to the authenticated partner or tenant.',
      responseExample: buildEnvelope(accounts),
      states: ['200 OK'],
    },
    {
      id: 'get-account',
      method: 'GET',
      path: '/api/banking/accounts/:id',
      description: 'Fetch a single CapitalAccount record with balance and recent servicing activity.',
      responseExample: buildEnvelope(checkingAccount),
      states: ['200 OK', '404 Not Found'],
    },
    {
      id: 'post-funding-instruction',
      method: 'POST',
      path: '/api/banking/funding-instructions',
      description: 'Create a funding instruction for a pending bank transfer or internal account movement.',
      requestExample: {
        capital_account_id: referenceState.capitalAccount.id,
        amount_usd: 1000,
        rail: 'wire',
      },
      responseExample: buildEnvelope(fundingInstruction),
      states: ['201 Created', '400 Bad Request'],
    },
    {
      id: 'post-term-position',
      method: 'POST',
      path: '/api/banking/term-positions',
      description: 'Open a new term deposit position after funds are available in the Banking layer.',
      requestExample: {
        amountUsd: 1500,
        termYears: 3,
        settlementMode: 'mirrored',
      },
      responseExample: buildEnvelope(termPosition),
      states: ['200 OK', '400 Bad Request'],
    },
    {
      id: 'get-term-position',
      method: 'GET',
      path: '/api/banking/term-positions/:id',
      description: 'Retrieve a single term position for servicing, maturity, or customer support workflows.',
      responseExample: buildEnvelope(
        termPosition ? getTermPositionRecord(referenceState, termPosition.id) : null
      ),
      states: ['200 OK', '404 Not Found'],
    },
    {
      id: 'get-settlement-events',
      method: 'GET',
      path: '/api/banking/settlement-events',
      description: 'Return posted settlement updates that should flow back into the banking product layer.',
      responseExample: buildEnvelope(settlementEvents),
      states: ['200 OK'],
    },
    {
      id: 'get-protection-status',
      method: 'GET',
      path: '/api/banking/protection-status',
      description: 'Return the latest protection summary for partner servicing and customer status displays.',
      responseExample: buildEnvelope(protectionStatus),
      states: ['200 OK'],
    },
  ];
}

export const BANKING_DOC_SECTIONS: BankingDocsSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: 'Banking wraps the Sagitta capital engine in a partner-ready product layer. Banks and platforms integrate against banking objects, account ledgers, and servicing events instead of protocol contracts.',
    bullets: [
      'Customer balances live in product-layer account objects.',
      'Term deposits are opened through Banking APIs and servicing flows.',
      'Settlement and protection updates flow back into partner systems as banking events.',
    ],
  },
  {
    id: 'integration-flow',
    title: 'Integration Flow',
    body: 'A partner integrates three surfaces: account funding, term deposit initiation, and event/webhook handling. The customer experience stays bank-first while Banking manages the capital-engine handoff under the hood.',
    bullets: [
      'Create or map CapitalAccount records for each customer account product.',
      'Create FundingInstruction records when external funds are expected.',
      'Open TermPosition objects only after funds are available to the product layer.',
      'Subscribe to status events to keep partner ledgers and servicing UIs current.',
    ],
  },
  {
    id: 'core-objects',
    title: 'Core Objects',
    body: 'CapitalAccount, FundingInstruction, TermPosition, MaturitySchedule, SettlementEvent, and ProtectionStatus are the core Banking resources. These objects keep the integration legible to banks without exposing protocol-native terminology.',
  },
  {
    id: 'deposit-lifecycle',
    title: 'Deposit Lifecycle',
    body: 'Customer funds enter a checking account first. The Banking layer records the funding movement, posts the balance, and only then allows a term deposit to be opened from available funds.',
    bullets: [
      'Funding instruction created',
      'Incoming funds posted to checking',
      'Available balance updated',
      'Customer eligible to open a term deposit',
    ],
  },
  {
    id: 'term-deposit-lifecycle',
    title: 'Term Deposit Lifecycle',
    body: 'When a customer opens a term deposit, Banking creates the term position, records the settlement intent, and updates the product account state. As the term matures, servicing updates return through the same product objects.',
    bullets: [
      'TermPosition created',
      'Settlement processing or mirror update posted',
      'TermPosition becomes active',
      'Maturity servicing and settlement events continue through Banking',
    ],
  },
  {
    id: 'settlement-model',
    title: 'Settlement Model',
    body: 'Settlement is reported as a banking-layer event stream. Partners can treat mirrored and completed settlement modes as product states without coupling customer workflows to underlying protocol mechanics.',
    bullets: [
      'Mirrored settlement supports sandbox and staged backend wiring.',
      'Completed settlement reflects a finalized product update.',
      'Shared references let partner ledgers reconcile funding, activation, and maturity events.',
    ],
  },
  {
    id: 'notes',
    title: 'Notes on Product Architecture',
    body: 'Banking is designed to sit cleanly beside existing Sagitta protocol views. The partner integration model can later be backed by Postgres, indexers, custody rails, and settlement services without changing the Banking product contract.',
    bullets: [
      'Keep account state API-backed instead of rebuilding UI state from direct contract reads.',
      'Treat term positions and settlement events as append-only servicing records.',
      'Use a tenant-safe theming layer to support multiple bank brands on one shared engine.',
    ],
  },
];

export const BANKING_INTEGRATION_FLOW: BankingFlowStep[] = [
  {
    id: 'fund',
    title: '1. Fund checking',
    body: 'Customer funds a checking account through a bank-managed transfer rail.',
  },
  {
    id: 'record',
    title: '2. Post banking objects',
    body: 'Banking creates or updates CapitalAccount and FundingInstruction records.',
  },
  {
    id: 'open',
    title: '3. Open term deposit',
    body: 'A TermPosition is created from available checking funds and begins servicing.',
  },
  {
    id: 'sync',
    title: '4. Sync servicing updates',
    body: 'Settlement and protection updates flow back into the banking layer and partner UI.',
  },
];

export const BANKING_THEME_DOC = {
  title: 'White-Label Theme Support',
  body: 'Presentation can be re-skinned per partner bank without changing Banking objects, endpoint behavior, or settlement handling.',
  supportedThemes: BANKING_THEMES.map((theme) => ({
    id: theme.id,
    label: theme.label,
    description: theme.description,
  })),
  example: {
    tenant_id: 'bank_demo_001',
    banking_theme: 'traditional',
    logo_lockup: 'partner-bank-wordmark',
    accent_mode: 'brand-controlled',
    behavior_profile: 'default',
  },
};

export function buildBankingWebhookEvents(state: BankingDashboardState): BankingWebhookDoc[] {
  const referenceState = buildReferenceState(state);
  const fundingInstruction = createFundingInstructionRecord(referenceState, {
    amount_usd: 1000,
    rail: 'wire',
  });
  const termPosition = referenceState.termPositions[0]
    ? mapTermPosition(referenceState.termPositions[0])
    : null;
  const settlementEvent = referenceState.settlementEvents[0]
    ? mapSettlementEvent(referenceState.settlementEvents[0])
    : null;
  const protectionStatus = mapProtectionStatus(referenceState);

  return [
    {
      id: 'funding-created',
      event: 'funding_instruction.created',
      description: 'Sent when a partner creates a pending funding instruction.',
      payload: {
        id: 'evt_funding_created',
        type: 'funding_instruction.created',
        created_at: fundingInstruction.created_at,
        data: fundingInstruction,
      },
    },
    {
      id: 'funding-completed',
      event: 'funding_instruction.completed',
      description: 'Sent when incoming funds are posted and available in the Banking layer.',
      payload: {
        id: 'evt_funding_completed',
        type: 'funding_instruction.completed',
        created_at: referenceState.capitalAccount.lastUpdatedAt,
        data: {
          ...fundingInstruction,
          status: 'completed',
        },
      },
    },
    {
      id: 'term-created',
      event: 'term_position.created',
      description: 'Sent immediately after a term position is opened in Banking.',
      payload: {
        id: 'evt_term_created',
        type: 'term_position.created',
        created_at: termPosition?.opened_at,
        data: termPosition,
      },
    },
    {
      id: 'term-activated',
      event: 'term_position.activated',
      description: 'Sent when the term position is marked active for customer servicing.',
      payload: {
        id: 'evt_term_activated',
        type: 'term_position.activated',
        created_at: termPosition?.opened_at,
        data: termPosition,
      },
    },
    {
      id: 'term-matured',
      event: 'term_position.matured',
      description: 'Sent when a term reaches maturity and servicing shifts to settlement and payout handling.',
      payload: {
        id: 'evt_term_matured',
        type: 'term_position.matured',
        created_at: termPosition?.maturity_date,
        data: termPosition
          ? {
              ...termPosition,
              status: 'matured',
            }
          : null,
      },
    },
    {
      id: 'settlement-posted',
      event: 'settlement_event.posted',
      description: 'Sent whenever a posted settlement update should be reflected back to partner systems.',
      payload: {
        id: 'evt_settlement_posted',
        type: 'settlement_event.posted',
        created_at: settlementEvent?.occurred_at,
        data: settlementEvent,
      },
    },
    {
      id: 'protection-updated',
      event: 'protection_status.updated',
      description: 'Sent when the partner-facing protection summary changes.',
      payload: {
        id: 'evt_protection_updated',
        type: 'protection_status.updated',
        created_at: protectionStatus.as_of,
        data: protectionStatus,
      },
    },
  ];
}
