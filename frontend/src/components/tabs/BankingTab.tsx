import { useEffect, useMemo, useRef, useState } from 'react';

import useBankingData from '../../hooks/useBankingData';
import type { BankingViewId } from '../../lib/banking/integrationContent';
import { getContracts, to6 } from '../../lib/ethers';
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
  api: 'Partner integration API',
  docs: 'Integration docs',
};

function isBankingViewId(value: string | null): value is BankingViewId {
  return value === 'accounts' || value === 'term-deposits' || value === 'api' || value === 'docs';
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
  const { state, loading, error, refresh, createDeposit, receiveWire } = useBankingData();
  const [activeView, setActiveView] = useState<BankingViewId>(() => readBankingViewFromLocation());
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState(3);
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReceivingWire, setIsReceivingWire] = useState(false);
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
    () => (state ? state.termPositions.filter((position) => position.status === 'active') : []),
    [state]
  );
  const activeTermCount = activeTerms.length;
  const latestTransfer = useMemo(
    () => state?.capitalAccount.transactions.find((transaction) => transaction.category === 'transfer') ?? null,
    [state]
  );
  const nextMaturingTerm = useMemo(
    () =>
      activeTerms
        .slice()
        .sort((left, right) => new Date(left.maturityDate).getTime() - new Date(right.maturityDate).getTime())[0] ??
      null,
    [activeTerms]
  );

  const parsedAmount = Number(amount);
  const canSubmit =
    !!state &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= state.capitalAccount.availableBalanceUsd;

  const getAccountDetail = (account: BankingAccountSummary): { status: string; detail?: string } => {
    if (account.kind === 'checking') {
      if (latestTransfer) {
        return {
          status: account.currentBalanceUsd > 0 ? 'Available' : 'Funding transfer posted',
          detail: `Last transfer ${formatUsd(Math.abs(latestTransfer.amountUsd))} - ${formatActivityDateTime(latestTransfer.postedAt)}`,
        };
      }
      return { status: account.statusText };
    }

    if (account.kind === 'term-deposit' && nextMaturingTerm) {
      if (activeTermCount > 1) {
        const totalPrincipalUsd = activeTerms.reduce((sum, position) => sum + position.principalUsd, 0);
        return {
          status: `${activeTermCount} active positions`,
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
      receiveWire(1000);
      setStatusTone('success');
      setStatusMessage('Incoming wire received into Checking Account.');
    } finally {
      setIsReceivingWire(false);
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

    let settlementMode: SettlementMode = 'mirrored';
    let txHash: string | undefined;
    let note: string | undefined;

    try {
      const { vault, usdc, A } = await getContracts();
      const amountUsd6 = to6(amount);
      await (await usdc.approve(A.Vault, amountUsd6)).wait();
      const tx = await vault.deposit(A.MockUSDC, amountUsd6);
      await tx.wait();
      settlementMode = 'onchain';
      txHash = tx.hash;
    } catch (err: any) {
      note = String(err?.reason || err?.message || err);
    }

    try {
      const request: BankingDepositRequest = {
        amountUsd: parsedAmount,
        termYears: selectedTerm,
        settlementMode,
        txHash,
        note,
      };

      const result = await createDeposit(request);
      emitUiRefresh(`banking:${result.createdPosition.id}`);
      setAmount('');
      setIsComposerOpen(false);
      setStatusTone(settlementMode === 'onchain' ? 'success' : 'warning');
      setStatusMessage(
        settlementMode === 'onchain'
          ? 'Term deposit created successfully.'
          : 'Term deposit created. Settlement services are still being wired.'
      );
    } catch (err: any) {
      setStatusTone('danger');
      setStatusMessage(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && !state) {
    return (
      <div className="tab-screen">
        <PageHeader
          eyebrow="Banking"
          title="Sagitta Term Deposit Account (White Label)"
          description="Loading account overview."
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
          description="The account overview could not be loaded."
        />
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">
            {error || 'Unable to load banking state.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-screen" data-banking-theme={theme}>
      <PageHeader
        eyebrow="Banking"
        title="Sagitta Term Deposit Account (White Label)"
        description={bankingViewDescriptions[activeView]}
        meta={
          <>
            <span className="data-chip">
              <BankingIcon size={12} /> Retail Banking
            </span>
            <span className="data-chip">
              {activeTermCount > 0
                ? `${activeTermCount} active term deposit${activeTermCount === 1 ? '' : 's'}`
                : 'No active term deposit'}
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <BankingThemeSwitcher themes={BANKING_THEMES} active={theme} onChange={handleThemeChange} />
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
              Receive $1000 Wire
            </Button>
            <Button className="banking-primary-btn" variant="primary" onClick={openDepositDrawer}>
              Create Term Deposit
            </Button>
          </div>
        }
      />

      <section className="sagitta-hero banking-entry" style={{ marginTop: '6px' }}>
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
                  A simple account view with balances and term deposit access.
                </p>
              </div>

              <div className="banking-account-list">
                {state.accounts.map((account) => {
                  const accountDetail = getAccountDetail(account);

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

                      <div className="banking-account-row__balance">{formatUsd(account.currentBalanceUsd)}</div>

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
                    Transactions appear after account actions are created.
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
                    Open a new term deposit using available funds from your Checking Account.
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
                  Open Deposit
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
        <BankingTermDepositsView state={state} onOpenDeposit={openDepositDrawer} />
      ) : null}

      {activeView === 'api' ? <BankingApiView state={state} /> : null}

      {activeView === 'docs' ? <BankingDocsView state={state} /> : null}
    </div>
  );
}
