import { useMemo, useState } from 'react';

import type { BankingDashboardState } from '../../lib/banking/types';
import {
  BANKING_DOC_SECTIONS,
  BANKING_INTEGRATION_FLOW,
  BANKING_THEME_DOC,
  BANKING_VIEW_OPTIONS,
  buildBankingApiEndpoints,
  buildBankingApiObjects,
  buildBankingWebhookEvents,
  type BankingViewId,
} from '../../lib/banking/integrationContent';
import { BankingIcon, ClockIcon, DepositIcon, ReceiptIcon } from '../icons/SagittaIcons';
import Button from '../ui/Button';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatUsd(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function formatPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function MethodPill({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span className={`banking-method-pill banking-method-pill--${method.toLowerCase()}`}>
      {method}
    </span>
  );
}

function CopyPayloadButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" className="banking-copy-btn" onClick={handleCopy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function PayloadBlock({
  title,
  payload,
}: {
  title: string;
  payload: unknown;
}) {
  const payloadText = formatPayload(payload);

  return (
    <div className="banking-payload">
      <div className="banking-payload__header">
        <span>{title}</span>
        <CopyPayloadButton text={payloadText} />
      </div>
      <pre className="banking-payload__body">
        <code>{payloadText}</code>
      </pre>
    </div>
  );
}

export function BankingSubnav({
  activeView,
  onChange,
}: {
  activeView: BankingViewId;
  onChange: (view: BankingViewId) => void;
}) {
  return (
    <div className="banking-subnav" role="tablist" aria-label="Banking sections">
      {BANKING_VIEW_OPTIONS.map((view) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={activeView === view.id}
          className={`banking-subnav__button ${activeView === view.id ? 'banking-subnav__button--active' : ''}`}
          onClick={() => onChange(view.id)}
        >
          <span className="banking-subnav__label">{view.label}</span>
          <span className="banking-subnav__description">{view.description}</span>
        </button>
      ))}
    </div>
  );
}

export function BankingTermDepositsView({
  state,
  onOpenDeposit,
}: {
  state: BankingDashboardState;
  onOpenDeposit: () => void;
}) {
  const activePositions = useMemo(
    () => state.termPositions.filter((position) => position.status === 'active'),
    [state.termPositions]
  );

  return (
    <>
      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <ClockIcon size={14} /> Term Deposits
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Servicing view for active positions, maturity timing, and settlement updates.
            </p>
          </div>

          {activePositions.length === 0 ? (
            <div className="banking-empty-state">
              <div>
                <div className="banking-empty-state__title">No active term deposits</div>
                <div className="banking-empty-state__copy">
                  Open a term deposit after funds are available in Checking Account.
                </div>
              </div>
              <Button className="banking-primary-btn" onClick={onOpenDeposit}>
                Create Term Deposit
              </Button>
            </div>
          ) : (
            <div className="banking-detail-list">
              {activePositions.map((position) => (
                <div key={position.id} className="banking-detail-row banking-detail-row--stacked">
                  <div>
                    <div className="banking-detail-row__title">{position.label}</div>
                    <div className="banking-detail-row__meta">
                      {position.termYears} year term | Opened {formatDateTime(position.openedAt)}
                    </div>
                    <div className="banking-detail-row__meta">
                      Status {position.status} | Matures {formatDateTime(position.maturityDate)}
                    </div>
                  </div>
                  <div className="banking-detail-row__value-group">
                    <div className="banking-detail-row__value">{formatUsd(position.principalUsd)}</div>
                    <div className="banking-detail-row__meta">{position.rateLabel}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <DepositIcon size={14} /> Funding Setup
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Partner-facing funding instructions shown in banking language.
            </p>
          </div>

          <div className="banking-detail-list">
            {state.fundingInstructions.map((instruction) => (
              <div key={instruction.id} className="banking-detail-row">
                <div>
                  <div className="banking-detail-row__title">{instruction.destinationLabel}</div>
                  <div className="banking-detail-row__meta">
                    {instruction.transferRail} | {instruction.processingWindow}
                  </div>
                </div>
                <div className="banking-detail-row__value-group">
                  <div className="banking-detail-row__value">{instruction.status}</div>
                  <div className="banking-detail-row__meta">Cutoff {instruction.cutoffTime}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <ReceiptIcon size={14} /> Settlement Activity
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Posted product-layer settlement updates.
            </p>
          </div>

          {state.settlementEvents.length === 0 ? (
            <div className="banking-empty-state banking-empty-state--quiet">
              <div>
                <div className="banking-empty-state__title">No settlement activity yet</div>
                <div className="banking-empty-state__copy">
                  Settlement events appear after a funded term deposit is created.
                </div>
              </div>
            </div>
          ) : (
            <div className="banking-detail-list">
              {state.settlementEvents.map((event) => (
                <div key={event.id} className="banking-detail-row">
                  <div>
                    <div className="banking-detail-row__title">{event.description}</div>
                    <div className="banking-detail-row__meta">
                      {event.status} | {formatDateTime(event.occurredAt)}
                    </div>
                  </div>
                  <div className="banking-detail-row__value-group">
                    <div className="banking-detail-row__value">{formatUsd(event.amountUsd)}</div>
                    <div className="banking-detail-row__meta">{event.reference}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export function BankingApiView({ state }: { state: BankingDashboardState }) {
  const objectDocs = useMemo(() => buildBankingApiObjects(state), [state]);
  const endpointDocs = useMemo(() => buildBankingApiEndpoints(state), [state]);

  return (
    <>
      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <BankingIcon size={14} /> Banking API
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Product-layer endpoints for partner banks, embedded platforms, and white-label account programs.
            </p>
          </div>

          <div className="banking-endpoint-grid">
            {endpointDocs.map((endpoint) => (
              <article key={endpoint.id} className="banking-api-card">
                <div className="banking-api-card__header">
                  <div className="banking-api-card__path">
                    <MethodPill method={endpoint.method} />
                    <span>{endpoint.path}</span>
                  </div>
                  {endpoint.states?.length ? (
                    <div className="banking-chip-row">
                      {endpoint.states.map((stateLabel) => (
                        <span key={stateLabel} className="banking-chip">
                          {stateLabel}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="banking-api-card__copy">{endpoint.description}</p>
                {endpoint.requestExample ? (
                  <PayloadBlock title="Example request" payload={endpoint.requestExample} />
                ) : null}
                <PayloadBlock title="Example response" payload={endpoint.responseExample} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <DepositIcon size={14} /> Core Objects
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Banking-layer resources that can later be backed by real servicing and settlement systems.
            </p>
          </div>

          <div className="banking-object-grid">
            {objectDocs.map((objectDoc) => (
              <article key={objectDoc.id} className="banking-api-card">
                <div className="banking-api-card__header">
                  <div className="banking-object-title">{objectDoc.name}</div>
                  {objectDoc.statuses?.length ? (
                    <div className="banking-chip-row">
                      {objectDoc.statuses.map((status) => (
                        <span key={status} className="banking-chip">
                          {status}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="banking-api-card__copy">{objectDoc.description}</p>
                <div className="banking-field-list">
                  {objectDoc.fields.map((field) => (
                    <div key={`${objectDoc.id}-${field.name}`} className="banking-field-list__row">
                      <div className="banking-field-list__name">
                        {field.name}
                        <span>{field.type}</span>
                      </div>
                      <div className="banking-field-list__description">{field.description}</div>
                    </div>
                  ))}
                </div>
                <PayloadBlock title="Example payload" payload={objectDoc.example} />
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function BankingDocsView({ state }: { state: BankingDashboardState }) {
  const webhookDocs = useMemo(() => buildBankingWebhookEvents(state), [state]);

  return (
    <>
      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <ReceiptIcon size={14} /> Banking Docs
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              In-product integration guidance for banks, platforms, and partner implementation teams.
            </p>
          </div>

          <div className="banking-flow-grid">
            {BANKING_INTEGRATION_FLOW.map((step) => (
              <div key={step.id} className="banking-doc-card">
                <div className="banking-doc-card__title">{step.title}</div>
                <div className="banking-doc-card__copy">{step.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-doc-section-list">
            {BANKING_DOC_SECTIONS.map((section) => (
              <article key={section.id} className="banking-doc-card">
                <div className="banking-doc-card__title">{section.title}</div>
                <div className="banking-doc-card__copy">{section.body}</div>
                {section.bullets?.length ? (
                  <ul className="banking-doc-card__list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <ClockIcon size={14} /> Webhooks and Events
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">
              Partner systems can subscribe to product events instead of polling for every lifecycle change.
            </p>
          </div>

          <div className="banking-webhook-grid">
            {webhookDocs.map((eventDoc) => (
              <article key={eventDoc.id} className="banking-api-card">
                <div className="banking-api-card__header">
                  <div className="banking-object-title">{eventDoc.event}</div>
                </div>
                <p className="banking-api-card__copy">{eventDoc.description}</p>
                <PayloadBlock title="Example event payload" payload={eventDoc.payload} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sagitta-hero banking-entry">
        <div className="sagitta-cell banking-entry__surface">
          <div className="banking-entry__heading">
            <h3 className="section-title !mb-0">
              <BankingIcon size={14} /> {BANKING_THEME_DOC.title}
            </h3>
            <p className="section-subtitle !mt-2 !mb-0">{BANKING_THEME_DOC.body}</p>
          </div>

          <div className="banking-theme-doc-grid">
            <div className="banking-doc-card">
              <div className="banking-doc-card__title">Supported themes</div>
              <ul className="banking-doc-card__list">
                {BANKING_THEME_DOC.supportedThemes.map((theme) => (
                  <li key={theme.id}>
                    <strong>{theme.label}</strong>: {theme.description}
                  </li>
                ))}
              </ul>
            </div>
            <div className="banking-doc-card">
              <div className="banking-doc-card__title">Example configuration</div>
              <PayloadBlock title="Theme payload" payload={BANKING_THEME_DOC.example} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
