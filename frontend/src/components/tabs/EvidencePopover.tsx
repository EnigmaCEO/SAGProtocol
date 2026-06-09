import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type EvidenceRow = { label: string; value: React.ReactNode };

const POPOVER_WIDTH = 288; // w-72
const CLOSE_DELAY_MS = 120;

export default function EvidencePopover({
  children,
  title,
  rows,
  align = 'left',
}: {
  children: React.ReactNode;
  title: string;
  rows: EvidenceRow[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const computeCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left =
      align === 'right'
        ? Math.max(4, rect.right - POPOVER_WIDTH)
        : Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 4);
    setCoords({ top: rect.bottom + 4, left });
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !popoverRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Clean up timer on unmount
  useEffect(() => () => { cancelClose(); }, []);

  if (rows.length === 0) return <>{children}</>;

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block"
        onMouseEnter={() => { cancelClose(); computeCoords(); setOpen(true); }}
        onMouseLeave={scheduleClose}
      >
        <div onClick={(e) => { e.stopPropagation(); computeCoords(); setOpen((v) => !v); }}>
          {children}
        </div>
      </div>
      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[9999] max-h-80 w-72 overflow-y-auto rounded-lg border border-slate-600/70 bg-[#0d1117] p-3 shadow-2xl"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {title}
            </div>
            <div className="space-y-1.5">
              {rows.map((row, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <span className="shrink-0 text-[11px] text-slate-500">{row.label}</span>
                  <span className="break-all text-right font-mono text-[11px] text-slate-200">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
