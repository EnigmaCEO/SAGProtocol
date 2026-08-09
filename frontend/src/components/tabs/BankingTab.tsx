import { useEffect, useMemo, useRef, useState } from 'react';

import useBankingData, {
  fetchInstitutions,
  onboardInstitution,
  openCustomerAccount,
  readBankingAccount,
  readSelectedBankingInstitutionId,
  saveSelectedBankingInstitutionId,
  type BankInstitution,
  type BankingAccountRecord,
} from '../../hooks/useBankingData';
import type { BankingViewId } from '../../lib/banking/integrationContent';
import type { BankingTheme } from '../../lib/banking/themes';
import { BANKING_THEMES } from '../../lib/banking/themes';
import type {
  BankingAccountSummary,
  BankingDepositRequest,
  SettlementMode,
} from '../../lib/banking/types';
import { emitUiRefresh } from '../../lib/ui-refresh';
import {
  BankingIcon,
  DepositIcon,
  ReceiptIcon,
  WalletIcon,
} from '../icons/SagittaIcons';
import {
  BankingApiView,
  BankingDocsView,
  BankingInstitutionsView,
  BankingSubnav,
  BankingTermDepositsView,
} from './BankingIntegrationViews';
import BankingThemeSwitcher from './BankingThemeSwitcher';
import Button from '../ui/Button';
import PageHeader from '../ui/PageHeader';

const THEME_STORAGE_KEY = 'sagitta:banking-demo-theme';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const activityDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const termOptions = [1, 2, 3, 4, 5];

const bankingViewDescriptions: Record<BankingViewId, string> = {
  accounts: 'Account overview',
  'term-deposits': 'Term deposit servicing',
  institutions: 'Institution policy',
  api: 'Partner integration API',
  docs: 'Integration docs',
};

function isBankingViewId(value: string | null): value is BankingViewId {
  return value === 'accounts' || value === 'term-deposits' || value === 'institutions' || value === 'api' || value === 'docs';
}

function readBankingViewFromLocation(): BankingViewId {
  if (typeof window === 'undefined') return 'accounts';
  const params = new URLSearchParams(window.location.search);
  const view = params.get('bankingView');
  return isBankingViewId(view) ? view : 'accounts';
}

function formatUsd(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatActivityDateTime(value: string): string {
  return activityDateTimeFormatter.format(new Date(value));
}

function formatShortDate(value: string): string {
  return shortDateFormatter.format(new Date(value));
}

function accountIcon(account: BankingAccountSummary) {
  if (account.kind === 'term-deposit') return <DepositIcon size={15} />;
  if (account.kind === 'savings') return <ReceiptIcon size={15} />;
  return <WalletIcon size={15} />;
}

export default function BankingTab() {
  const initialSelectedInstitutionId = readSelectedBankingInstitutionId();
  const initialBankingAccount = readBankingAccount(initialSelectedInstitutionId) ?? readBankingAccount();

  // ── Account record (persisted in localStorage) ─────────────────────────────
  const [bankingAccount, setBankingAccount] = useState<BankingAccountRecord | null>(initialBankingAccount);

  // ── Open-account flow ──────────────────────────────────────────────────────
  const [openAccountInstitutionId, setOpenAccountInstitutionId] = useState<string>('');
  const [openAccountTypes, setOpenAccountTypes] = useState<string[]>(['checking', 'term-deposit']);
  const [isOpeningAccount, setIsOpeningAccount] = useState(false);
  const [openAccountError, setOpenAccountError] = useState<string | null>(null);

  const toggleOpenAccountType = (type: string) => {
    setOpenAccountTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleOpenAccount = async () => {
    if (!openAccountInstitutionId) { setOpenAccountError('Please select a bank to open your account.'); return; }
    setIsOpeningAccount(true);
    setOpenAccountError(null);
    try {
      const customerRef = `cust-${Date.now().toString(36).toUpperCase()}`;
      const record = await openCustomerAccount(openAccountInstitutionId, customerRef, openAccountTypes);
      setBankingAccount(record);
      setSelectedInstitutionId(record.institutionId);
      setCustomerRef(record.customerRef);
      setCustomerRefInput(record.customerRef);
    } catch (err: any) {
      setOpenAccountError(err?.message ?? 'Failed to open account. Please try again.');
    } finally {
      setIsOpeningAccount(false);
    }
  };

  // ── Institution / bank selector ────────────────────────────────────────────
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | undefined>(
    initialSelectedInstitutionId ?? initialBankingAccount?.institutionId
  );
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardName, setOnboardName] = useState('');
  const [onboardId, setOnboardId] = useState('');
  const [showOnboardForm, setShowOnboardForm] = useState(false);

  useEffect(() => {
    fetchInstitutions().then((list) => {
      setInstitutions(list);
      if (!selectedInstitutionId && list.length > 0) {
        const onboarded = list.find((i) => i.fineractOnboarded);
        const first = onboarded?.institutionId ?? list[0].institutionId;
        setSelectedInstitutionId(first);
        // Pre-select in the open-account flow if nothing chosen yet
        if (!openAccountInstitutionId) setOpenAccountInstitutionId(first);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOnboard = async () => {
    if (!onboardId.trim()) return;
    setIsOnboarding(true);
    try {
      const result = await onboardInstitution(onboardId.trim(), onboardName.trim() || onboardId.trim());
      const updated = await fetchInstitutions();
      setInstitutions(updated);
      setSelectedInstitutionId(result.institutionId);
      setShowOnboardForm(false);
      setOnboardId('');
      setOnboardName('');
    } catch (err: any) {
      alert(`Onboarding failed: ${err?.message ?? err}`);
    } finally {
      setIsOnboarding(false);
    }
  };

  // ── Customer reference (opaque ID supplied by the bank, never PII) ──────────
  const [customerRef, setCustomerRef] = useState(() => initialBankingAccount?.customerRef ?? 'demo-customer-001');
  const [customerRefInput, setCustomerRefInput] = useState(() => initialBankingAccount?.customerRef ?? 'demo-customer-001');

  const handleCustomerRefChange = () => {
    const trimmed = customerRefInput.trim();
    if (trimmed) setCustomerRef(trimmed);
  };

  // ── Banking data (filtered by selected institution + customer ref) ──────────
  useEffect(() => {
    if (!selectedInstitutionId) return;

    saveSelectedBankingInstitutionId(selectedInstitutionId);
    setOpenAccountInstitutionId((current) => (
      current === selectedInstitutionId ? current : selectedInstitutionId
    ));

    const record = readBankingAccount(selectedInstitutionId);
    if (!record) {
      setBankingAccount((current) => (
        current?.institutionId === selectedInstitutionId ? current : null
      ));
      return;
    }

    setBankingAccount((current) => (
      current?.institutionId === record.institutionId && current?.customerRef === record.customerRef
        ? current
        : record
    ));
    setCustomerRef((current) => (current === record.customerRef ? current : record.customerRef));
    setCustomerRefInput((current) => (current === record.customerRef ? current : record.customerRef));
  }, [selectedInstitutionId]);

  const { state, loading, error, refresh, createDeposit, receiveWire, simulateCheckingWire, retryCircleFunding } = useBankingData(selectedInstitutionId, customerRef);
  const [activeView, setActiveView] = useState<BankingViewId>(() => readBankingViewFromLocation());
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState(3);
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReceivingWire, setIsReceivingWire] = useState(false);
  const [retryingTermId, setRetryingTermId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'success' | 'warning' | 'danger'>('success');
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<BankingTheme>(
    () => (localStorage.getItem(THEME_STORAGE_KEY) as BankingTheme | null) ?? 'sagitta'
  );

  const handleThemeChange = (next: BankingTheme) => {
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  };

  const activeTerms = useMemo(
    () => (state ? state.termPositions.filter((position) => position.status !== 'not_funded') : []),
    [state]
  );
  const openTerms = useMemo(
    () => activeTerms.filter((position) => position.status !== 'matured' && !position.returnedAmountUsd),
    [activeTerms]
  );
  const activeTermCount = activeTerms.length;
  const openTermCount = openTerms.length;
  const latestIncomingWire = useMemo(
    () => state?.capitalAccount.transactions.find((transaction) => transaction.category === 'credit') ?? null,
    [state]
  );
  const nextMaturingTerm = useMemo(
    () =>
      openTerms
        .slice()
        .sort((left, right) => new Date(left.maturityDate).getTime() - new Date(right.maturityDate).getTime())[0] ??
      null,
    [openTerms]
  );

  const parsedAmount = Number(amount);
  const canSubmit =
    !!state &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= state.capitalAccount.availableBalanceUsd;

  const getAccountDetail = (account: BankingAccountSummary): { status: string; detail?: string } => {
    if (account.kind === 'checking') {
      if (latestIncomingWire) {
        return {
          status: account.currentBalanceUsd > 0 ? 'Funds available' : 'Wire received',
          detail: `Last wire ${formatUsd(Math.abs(latestIncomingWire.amountUsd))} - ${formatActivityDateTime(latestIncomingWire.postedAt)}`,
        };
      }
      return { status: account.statusText };
    }

    if (account.kind === 'term-deposit') {
      const returnedTotalUsd = activeTerms.reduce((sum, position) => sum + (position.returnedAmountUsd || 0), 0);
      if (activeTermCount > 0 && openTermCount === 0) {
        return {
          status: 'Closed, returned to Checking',
          detail: returnedTotalUsd > 0 ? `${formatUsd(returnedTotalUsd)} returned` : 'Term deposit completed',
        };
      }
      if (!nextMaturingTerm) return { status: account.statusText };

      const awaitingTreasuryCount = openTerms.filter((position) => !position.treasuryOriginLotId).length;
      if (awaitingTreasuryCount === openTermCount) {
        const totalPrincipalUsd = openTerms.reduce((sum, position) => sum + position.principalUsd, 0);
        return {
          status: 'Funded, awaiting Treasury allocation',
          detail: `${formatUsd(totalPrincipalUsd)} funded in product account`,
        };
      }

      if (openTermCount > 1) {
        const totalPrincipalUsd = openTerms.reduce((sum, position) => sum + position.principalUsd, 0);
        return {
          status: `${openTermCount} active positions`,
          detail: `Next maturity ${formatShortDate(nextMaturingTerm.maturityDate)} - ${formatUsd(totalPrincipalUsd)} total`,
        };
      }
      return {
        status: `Active ${nextMaturingTerm.termYears}-year term`,
        detail: `Matures ${formatShortDate(nextMaturingTerm.maturityDate)}`,
      };
    }

    return { status: account.statusText };
  };

  const handleReceiveWire = async () => {
    try {
      setIsReceivingWire(true);
      const instructions = await receiveWire();
      setStatusTone('success');
      const first = Array.isArray(instructions) ? instructions[0] : instructions?.data?.[0];
      setStatusMessage(
        first?.tracking_ref
          ? `Checking Account wire instructions ready. Tracking ref: ${first.tracking_ref}.`
          : 'Checking Account wire instructions loaded.'
      );
    } catch (err: any) {
      setStatusTone('danger');
      setStatusMessage(String(err?.message || err));
    } finally {
      setIsReceivingWire(false);
    }
  };

  const handleSimulateMockWire = async () => {
    try {
      setIsReceivingWire(true);
      await simulateCheckingWire(1000);
      setStatusTone('success');
      setStatusMessage('$1,000 wire received into Checking Account. Funds are available for a term deposit.');
    } catch (err: any) {
      setStatusTone('danger');
      setStatusMessage(String(err?.message || err));
    } finally {
      setIsReceivingWire(false);
    }
  };

  const handleRetryCircleFunding = async (termPositionId: string) => {
    try {
      setRetryingTermId(termPositionId);
      setStatusMessage(null);
      const nextState = await retryCircleFunding(termPositionId);
      const position = nextState.termPositions.find((item) => item.id === termPositionId);
      if (position?.treasuryOriginLotId) {
        setStatusTone('success');
        setStatusMessage(`USDC conversion completed. Treasury lot #${position.treasuryOriginLotId} is registered.`);
      } else {
        setStatusTone('warning');
        setStatusMessage('USDC conversion submitted. Treasury allocation is still pending.');
      }
    } catch (err: any) {
      setStatusTone('danger');
      setStatusMessage(String(err?.message || err));
    } finally {
      setRetryingTermId(null);
    }
  };

  const openDepositDrawer = () => {
    if (state && state.capitalAccount.availableBalanceUsd > 0) {
      setAmount(state.capitalAccount.availableBalanceUsd.toFixed(2));
    } else {
      setAmount('');
    }
    setIsComposerOpen(true);
    setStatusMessage(null);
  };

  const closeDepositDrawer = () => {
    setIsComposerOpen(false);
  };

  const handleViewChange = (nextView: BankingViewId) => {
    setActiveView(nextView);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (nextView === 'accounts') {
      url.searchParams.delete('bankingView');
    } else {
      url.searchParams.set('bankingView', nextView);
    }
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    if (!isComposerOpen) return;
    const timer = window.setTimeout(() => {
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [isComposerOpen]);

  useEffect(() => {
    const syncView = () => setActiveView(readBankingViewFromLocation());
    window.addEventListener('popstate', syncView);
    return () => window.removeEventListener('popstate', syncView);
  }, []);

  const handleDeposit = async () => {
    if (!state || !canSubmit) {
      setStatusTone('danger');
      setStatusMessage('Enter an amount within the available checking balance.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const settlementMode: SettlementMode = 'mirrored';

    try {
      const request: BankingDepositRequest = {
        amountUsd: parsedAmount,
        termYears: selectedTerm,
        settlementMode,
      };

      const result = await createDeposit(request);
      emitUiRefresh(`banking:${result.createdPosition.id}`);
      setAmount('');
      setIsComposerOpen(false);
      setStatusTone('success');
      setStatusMessage(
        result.createdPosition.treasuryOriginLotId
          ? `Term deposit funded. Preparing protocol allocation #${result.createdPosition.treasuryOriginLotId}.`
          : 'Term deposit funded from Checking. Treasury allocation has not started yet.'
      );
    } catch (err: any) {
      setStatusTone('danger');
      setStatusMessage(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── No account yet — show bank-selection onboarding ───────────────────────
  if (!bankingAccount) {
    return (
      <div className="tab-screen" data-banking-theme={theme}>
        <PageHeader
          eyebrow="Banking"
          title="Open a New Bank Account"
          description="Choose your bank and account services to get started."
        />
        <div className="sagitta-hero" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem' }}>

          {/* Bank picker */}
          <div className="sagitta-cell" style={{ marginBottom: '1rem', padding: '1.25rem 1.5rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.5, marginBottom: '0.875rem' }}>
              Choose Your Bank
            </div>
            {institutions.length === 0 ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Institution ID (e.g. first-national-bank)"
                  value={openAccountInstitutionId}
                  onChange={(e) => setOpenAccountInstitutionId(e.target.value)}
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color, #ccc)', background: 'transparent', color: 'inherit', flex: '1 1 260px' }}
                />
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>No banks onboarded yet — enter an institution ID</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.625rem' }}>
                {institutions.map((inst) => {
                  const selected = openAccountInstitutionId === inst.institutionId;
                  return (
                    <button
                      key={inst.institutionId}
                      onClick={() => setOpenAccountInstitutionId(inst.institutionId)}
                      style={{
                        textAlign: 'left',
                        padding: '0.875rem 1rem',
                        borderRadius: '8px',
                        border: selected ? '2px solid var(--accent-color, #4f8ef7)' : '1px solid var(--border-color, rgba(128,128,128,0.25))',
                        background: selected ? 'var(--accent-subtle, rgba(79,142,247,0.08))' : 'transparent',
                        cursor: 'pointer',
                        color: 'inherit',
                        transition: 'border 0.15s, background 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                        {inst.displayName}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.55 }}>
                        {inst.fineractOnboarded ? '✓ Fineract Connected' : 'Demo Bank'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Account types */}
          <div className="sagitta-cell" style={{ marginBottom: '1rem', padding: '1.25rem 1.5rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.5, marginBottom: '0.875rem' }}>
              Account Services
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                { id: 'checking', label: 'Checking Account', description: 'Your primary account for wire deposits and outgoing transfers' },
                { id: 'term-deposit', label: 'Term Deposit', description: 'Lock in competitive fixed rates for 1–5 years' },
              ].map((acct) => {
                const checked = openAccountTypes.includes(acct.id);
                return (
                  <label
                    key={acct.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOpenAccountType(acct.id)}
                      style={{ marginTop: '2px', accentColor: 'var(--accent-color, #4f8ef7)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{acct.label}</div>
                      <div style={{ fontSize: '0.75rem', opacity: 0.55, marginTop: '1px' }}>{acct.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Error */}
          {openAccountError && (
            <div className="sagitta-cell status-banner status-banner--danger" style={{ marginBottom: '1rem' }}>
              {openAccountError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.45 }}>
              {institutions.length > 0 && openAccountInstitutionId
                ? `Opening at ${institutions.find((i) => i.institutionId === openAccountInstitutionId)?.displayName ?? openAccountInstitutionId}`
                : 'Select a bank above'}
            </span>
            <Button
              variant="primary"
              className="banking-primary-btn"
              onClick={handleOpenAccount}
              loading={isOpeningAccount}
              disabled={!openAccountInstitutionId || openAccountTypes.length === 0}
            >
              Open Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !state) {
    return (
      <div className="tab-screen">
        <PageHeader
          eyebrow="Banking"
          title="Sagitta Term Deposit Account (White Label)"
          description="Loading checking and term deposit accounts."
        />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="tab-screen">
        <PageHeader
          eyebrow="Banking"
          title="Sagitta Term Deposit Account (White Label)"
          description="The checking and term deposit account overview could not be loaded."
        />
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">
            {error || 'Unable to load banking state.'}
          </div>
        </div>
      </div>
    );
  }

  const selectedInstitution = institutions.find((i) => i.institutionId === selectedInstitutionId);
  const institutionLabel = selectedInstitution?.displayName ?? selectedInstitutionId ?? 'All Accounts';

  return (
    <div className="tab-screen" data-banking-theme={theme}>
      <PageHeader
        eyebrow={selectedInstitution ? `${institutionLabel} / Customer Account` : bankingAccount ? `${bankingAccount.institutionId} / Customer Account` : 'Banking'}
        title="Sagitta Term Deposit Account"
        description={bankingViewDescriptions[activeView]}
        meta={
          <>
            {/* Bank selector */}
            {institutions.length > 0 && (
              <span className="data-chip" style={{ padding: 0, overflow: 'hidden' }}>
                <select
                  value={selectedInstitutionId ?? ''}
                  onChange={(e) => setSelectedInstitutionId(e.target.value || undefined)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    font: 'inherit',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.5rem',
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: '220px',
                  }}
                  title="Select bank"
                >
                  {institutions.map((inst) => (
                    <option key={inst.institutionId} value={inst.institutionId}>
                      {inst.displayName}{inst.fineractOnboarded ? ' ✓' : ' (not onboarded)'}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="data-chip">
              <BankingIcon size={12} /> Retail Banking
            </span>
            <span className="data-chip">
              {activeTermCount > 0
                ? `${activeTermCount} funded term deposit${activeTermCount === 1 ? '' : 's'}`
                : 'No funded term deposit'}
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <BankingThemeSwitcher themes={BANKING_THEMES} active={theme} onChange={handleThemeChange} />
            <Button
              variant="ghost"
              className="banking-ghost-btn"
              onClick={() => setShowOnboardForm((v) => !v)}
            >
              + Onboard Bank
            </Button>
            <Button
              variant="ghost"
              className="banking-ghost-btn"
              onClick={() => refresh()}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              className="banking-primary-btn"
              onClick={handleReceiveWire}
              loading={isReceivingWire}
            >
              Wire Instructions
            </Button>
            <Button
              className="banking-primary-btn"
              onClick={handleSimulateMockWire}
              loading={isReceivingWire}
            >
              Simulate $1,000 Wire
            </Button>
            <Button className="banking-primary-btn" variant="primary" onClick={openDepositDrawer}>
              Create Term Deposit
            </Button>
          </div>
        }
      />

      {/* Onboard form — shown inline below header when toggled */}
      {showOnboardForm && (
        <section className="sagitta-hero" style={{ marginTop: '4px' }}>
          <div className="sagitta-cell" style={{ padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.8 }}>Onboard bank into Fineract:</span>
              <input
                type="text"
                placeholder="Institution ID (e.g. first-national-bank)"
                value={onboardId}
                onChange={(e) => setOnboardId(e.target.value)}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)', background: 'transparent', color: 'inherit', width: '220px' }}
              />
              <input
                type="text"
                placeholder="Display name (e.g. First National Bank)"
                value={onboardName}
                onChange={(e) => setOnboardName(e.target.value)}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)', background: 'transparent', color: 'inherit', width: '220px' }}
              />
              <Button
                className="banking-primary-btn"
                onClick={handleOnboard}
                loading={isOnboarding}
                disabled={!onboardId.trim()}
              >
                Onboard
              </Button>
              <Button variant="ghost" className="banking-ghost-btn" onClick={() => setShowOnboardForm(false)}>
                Cancel
              </Button>
            </div>
            <p style={{ fontSize: '0.72rem', opacity: 0.55, marginTop: '0.35rem', marginBottom: 0 }}>
              Creates a Fineract client + checking account for this bank. The bank selector will update automatically.
            </p>
          </div>
        </section>
      )}

      {/* Customer account context bar */}
      <section className="sagitta-hero banking-entry" style={{ marginTop: '4px' }}>
        <div className="sagitta-cell" style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', borderLeft: '2px solid rgba(212,168,48,0.35)' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', opacity: 0.5, textTransform: 'uppercase' }}>
            Account holder
          </span>
          <span style={{ fontSize: '0.85rem', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, color: 'var(--gold-300, #f0c040)' }}>
            {customerRef}
          </span>
          <span style={{ fontSize: '0.7rem', opacity: 0.4 }}>
            — customer reference managed by {selectedInstitution?.displayName ?? 'the bank'}, not stored as PII
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="text"
              value={customerRefInput}
              onChange={(e) => setCustomerRefInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomerRefChange()}
              placeholder="customer ref"
              style={{
                fontSize: '0.75rem',
                fontFamily: '"IBM Plex Mono", monospace',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: 'inherit',
                width: '160px',
              }}
            />
            <Button
              variant="ghost"
              className="banking-ghost-btn"
              onClick={handleCustomerRefChange}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}
            >
              Switch
            </Button>
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry" style={{ marginTop: '4px' }}>
        <div className="sagitta-cell banking-entry__surface" style={{ padding: '0.45rem 0.6rem' }}>
          <BankingSubnav activeView={activeView} onChange={handleViewChange} />
        </div>
      </section>

      {error ? (
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">{error}</div>
        </div>
      ) : null}

      {statusMessage ? (
        <section className="sagitta-hero banking-entry">
          <div className="sagitta-cell banking-entry__surface">
            <div
              className={`status-banner ${
                statusTone === 'danger'
                  ? 'status-banner--danger'
                  : statusTone === 'warning'
                    ? 'status-banner--warning'
                    : 'status-banner--success'
              }`}
            >
              {statusMessage}
            </div>
          </div>
        </section>
      ) : null}

      {activeView === 'accounts' ? (
        <>
          <section className="sagitta-hero banking-entry">
            <div className="sagitta-cell banking-entry__surface">
              <div className="banking-entry__heading">
                <h3 className="section-title !mb-0">
                  <BankingIcon size={14} /> Accounts
                </h3>
                <p className="section-subtitle !mt-2 !mb-0">
                  Checking receives incoming wires. Term deposits are funded from available checking balance.
                </p>
              </div>

              <div className="banking-account-list">
                {state.accounts.map((account) => {
                  const accountDetail = getAccountDetail(account);
                  const displayBalance = account.kind === 'term-deposit'
                    ? openTerms.reduce((sum, position) => sum + position.principalUsd, 0)
                    : account.currentBalanceUsd;

                  return (
                    <div key={account.id} className="banking-account-row">
                      <div className="banking-account-row__identity">
                        <div className="banking-account-row__icon">{accountIcon(account)}</div>
                        <div className="banking-account-row__copy">
                          <div className="banking-account-row__name">{account.accountName}</div>
                          <div className="banking-account-row__number">{account.accountNumberMasked}</div>
                        </div>
                      </div>

                      <div className="banking-account-row__details">
                        <div className="banking-account-row__status">{accountDetail.status}</div>
                        {accountDetail.detail ? (
                          <div className="banking-account-row__detail">{accountDetail.detail}</div>
                        ) : null}
                      </div>

                      <div className="banking-account-row__balance">{formatUsd(displayBalance)}</div>

                      <div className="banking-account-row__action">
                        {account.kind === 'term-deposit' ? (
                          <span className="banking-account-row__pill">Product account</span>
                        ) : (
                          <span className="banking-account-row__pill">Read-only</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {state.capitalAccount.transactions.length > 0 ? (
            <section className="sagitta-hero banking-entry">
              <div className="sagitta-cell banking-entry__surface">
                <div className="banking-entry__heading">
                  <h3 className="section-title !mb-0">
                    <ReceiptIcon size={14} /> Recent Activity
                  </h3>
                  <p className="section-subtitle !mt-2 !mb-0">
                    Incoming wires and term deposit funding movements post to Checking Account.
                  </p>
                </div>

                <div className="banking-detail-list">
                  {state.capitalAccount.transactions.map((transaction) => (
                    <div key={transaction.id} className="banking-detail-row">
                      <div>
                        <div className="banking-detail-row__title">{transaction.description}</div>
                        <div className="banking-detail-row__meta">
                          {transaction.status} - {formatActivityDateTime(transaction.postedAt)}
                        </div>
                      </div>
                      <div className="banking-detail-row__value">{formatUsd(transaction.amountUsd)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {isComposerOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(2, 5, 12, 0.68)',
            backdropFilter: 'blur(5px)',
          }}
          onClick={closeDepositDrawer}
        >
          <aside
            style={{
              width: '380px',
              maxWidth: '100%',
              height: '100%',
              padding: '1.1rem',
              borderLeft: '1px solid rgba(212, 168, 48, 0.14)',
              background: 'linear-gradient(180deg, rgba(10, 12, 32, 0.98) 0%, rgba(8, 10, 18, 0.98) 100%)',
              boxShadow: '-18px 0 40px rgba(0, 0, 0, 0.42)',
              overflowY: 'auto',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="banking-inline-panel" style={{ marginTop: 0, minHeight: 'calc(100vh - 2.2rem)' }}>
              <div
                className="banking-inline-panel__header"
                style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}
              >
                <div>
                  <div className="section-title !mb-0">
                    <DepositIcon size={14} /> Sagitta Term Deposit Account
                  </div>
                  <p className="section-subtitle !mt-2 !mb-0">
                    Create a term deposit using available funds from your Checking Account.
                  </p>
                </div>
                <Button variant="ghost" className="banking-ghost-btn" onClick={closeDepositDrawer}>
                  Close
                </Button>
              </div>

              <div className="banking-inline-panel__field">
                <span className="ud-field-label">Deposit amount</span>
                <div className="relative mt-1.5">
                  <input
                    ref={amountInputRef}
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="ud-input w-full pr-16"
                    placeholder="0.00"
                  />
                  <span
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold tracking-widest"
                    style={{ color: 'var(--gold-500)' }}
                  >
                    USD
                  </span>
                </div>
              </div>

              <div className="banking-inline-panel__field banking-inline-panel__field--tight">
                <span className="ud-field-label">Term length</span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                    gap: '0.45rem',
                    marginTop: '0.75rem',
                  }}
                >
                  {termOptions.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setSelectedTerm(term)}
                      style={{
                        minHeight: '3rem',
                        borderRadius: '0.55rem',
                        border:
                          selectedTerm === term
                            ? '1px solid rgba(212, 168, 48, 0.42)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                        background:
                          selectedTerm === term
                            ? 'linear-gradient(180deg, rgba(50, 36, 8, 0.55) 0%, rgba(18, 16, 10, 0.4) 100%)'
                            : 'rgba(8, 10, 18, 0.58)',
                        color: selectedTerm === term ? 'var(--gold-300)' : 'var(--text-300)',
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '0.95rem',
                        fontWeight: 700,
                        transition: 'border-color 160ms ease, background-color 160ms ease, color 160ms ease, transform 160ms ease',
                      }}
                    >
                      {term}Y
                    </button>
                  ))}
                </div>
              </div>

              <div className="banking-inline-panel__footer banking-inline-panel__footer--stacked">
                <div className="banking-inline-panel__note">
                  <span>Available to fund</span>
                  <strong>{formatUsd(state.capitalAccount.availableBalanceUsd)}</strong>
                </div>
                <Button
                  className="banking-primary-btn"
                  onClick={handleDeposit}
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  Create Term Deposit
                </Button>
                {!canSubmit ? (
                  <div className="banking-zero-note" style={{ marginTop: 0 }}>
                    {state.capitalAccount.availableBalanceUsd <= 0
                      ? 'Receive a deposit into Checking to continue.'
                      : 'Enter an amount within the available checking balance.'}
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {activeView === 'term-deposits' ? (
        <BankingTermDepositsView
          state={state}
          onOpenDeposit={openDepositDrawer}
          onRetryCircleFunding={handleRetryCircleFunding}
          retryingTermId={retryingTermId}
        />
      ) : null}

      {activeView === 'institutions' ? <BankingInstitutionsView state={state} /> : null}

      {activeView === 'api' ? <BankingApiView state={state} /> : null}

      {activeView === 'docs' ? <BankingDocsView state={state} /> : null}
    </div>
  );
}
