import { useEffect, useMemo, useState } from 'react';
import {
  ApiLogEntry,
  clearApiLogEntries,
  getApiLogEntries,
  installApiLogger,
  subscribeToApiLog,
} from '../lib/apiLogger';

function formatTime(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatPayload(value: unknown) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin === window.location.origin ? '' : url.origin}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export default function ApiLogPanel() {
  const [entries, setEntries] = useState<ApiLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  useEffect(() => {
    installApiLogger();
    setEntries(getApiLogEntries());
    return subscribeToApiLog((next) => {
      setEntries(next);
      setSelectedId((current) => current || next[0]?.id || '');
    });
  }, []);

  const failureCount = entries.filter((entry) => entry.error || entry.responseOk === false).length;
  const visibleEntries = useMemo(
    () => errorsOnly ? entries.filter((entry) => entry.error || entry.responseOk === false) : entries,
    [entries, errorsOnly],
  );
  const selected = useMemo(
    () => visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0],
    [visibleEntries, selectedId],
  );

  return (
    <section className={`api-log-panel ${expanded ? 'api-log-panel--expanded' : ''}`}>
      <div className="api-log-panel__header">
        <button
          type="button"
          className="api-log-panel__toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          API Log
          <span className="api-log-panel__count">{entries.length}</span>
          {failureCount > 0 ? <span className="api-log-panel__failures">{failureCount} failed</span> : null}
        </button>
        <div className="api-log-panel__actions">
          <button
            type="button"
            className={errorsOnly ? 'api-log-panel__filter--active' : ''}
            onClick={() => setErrorsOnly((value) => !value)}
          >
            Errors
          </button>
          <button type="button" onClick={() => clearApiLogEntries()}>Clear</button>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="api-log-panel__body">
          <div className="api-log-panel__list">
            {visibleEntries.length === 0 ? (
              <div className="api-log-panel__empty">
                {entries.length === 0 ? 'No API calls captured yet.' : 'No failed API calls captured.'}
              </div>
            ) : null}
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`api-log-panel__row ${selected?.id === entry.id ? 'api-log-panel__row--active' : ''}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="api-log-panel__time">{formatTime(entry.startedAt)}</span>
                <span className="api-log-panel__method">{entry.method}</span>
                <span className="api-log-panel__url">{shortUrl(entry.url)}</span>
                <span className={`api-log-panel__status ${entry.error || entry.responseOk === false ? 'api-log-panel__status--bad' : ''}`}>
                  {entry.error ? 'ERR' : entry.responseStatus ?? '...'}
                </span>
                <span className="api-log-panel__duration">{entry.durationMs ?? 0}ms</span>
              </button>
            ))}
          </div>

          <div className="api-log-panel__detail">
            {selected ? (
              <>
                <div className="api-log-panel__detail-head">
                  <span>{selected.method}</span>
                  <span>{shortUrl(selected.url)}</span>
                  <span>{selected.error ? 'ERR' : selected.responseStatus}</span>
                </div>
                <div className="api-log-panel__detail-grid">
                  <div>
                    <h4>Request Payload</h4>
                    <pre>{formatPayload(selected.requestPayload)}</pre>
                  </div>
                  <div>
                    <h4>Result</h4>
                    <pre>{selected.error ?? formatPayload(selected.responsePayload)}</pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="api-log-panel__empty">Select an API call.</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
