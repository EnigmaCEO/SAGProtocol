/**
 * Sagitta Protocol — Custom Icon Set
 * All icons are SVG-based, stroke-first, 24×24 viewBox.
 * Usage:  <PortfolioIcon size={18} className="text-gold-400" />
 */

import { SVGProps } from 'react';

// ─────────────────────────────────────────────────────────────
// BRAND LOGO
// ─────────────────────────────────────────────────────────────

/** Sagitta Shield — brand logo with constellation */
export function SagittaShieldLogo({ size = 40 }: { size?: number }) {
  const id = 'sag-shield';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Deep blue radial fill for shield body */}
        <radialGradient id={`${id}-bg`} cx="45%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#2a4faa" />
          <stop offset="60%" stopColor="#112080" />
          <stop offset="100%" stopColor="#060e3a" />
        </radialGradient>
        {/* Metallic chrome border */}
        <linearGradient id={`${id}-border`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a8c8ff" />
          <stop offset="30%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#5588dd" />
          <stop offset="100%" stopColor="#2255bb" />
        </linearGradient>
        {/* Inner highlight rim */}
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="20" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#cce0ff" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#4477cc" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1133aa" stopOpacity="0.2" />
        </linearGradient>
        {/* Star glow filter */}
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Outer metallic border ── */}
      <path
        d="M20 1.5 L37 7.5 L37 22 Q37 33.5 20 38.5 Q3 33.5 3 22 L3 7.5 Z"
        fill={`url(#${id}-border)`}
      />

      {/* ── Shield body ── */}
      <path
        d="M20 3.5 L35 9 L35 22 Q35 32 20 36.5 Q5 32 5 22 L5 9 Z"
        fill={`url(#${id}-bg)`}
      />

      {/* ── Inner highlight rim ── */}
      <path
        d="M20 5 L33.5 10 L33.5 22 Q33.5 31 20 35 Q6.5 31 6.5 22 L6.5 10 Z"
        fill="none"
        stroke={`url(#${id}-rim)`}
        strokeWidth="1"
        opacity="0.7"
      />

      {/* ── Sagitta constellation (arrow pointing right) ── */}
      {/* Connecting lines first (behind stars) */}
      <g stroke="rgba(160,200,255,0.55)" strokeWidth="0.75" strokeLinecap="round">
        <line x1="9.5" y1="23" x2="14.5" y2="21" />
        <line x1="14.5" y1="21" x2="19.5" y2="19.5" />
        <line x1="19.5" y1="19.5" x2="26" y2="16.5" />
        <line x1="19.5" y1="19.5" x2="26" y2="22.5" />
      </g>

      {/* Stars */}
      <g filter={`url(#${id}-glow)`}>
        {/* Tail star */}
        <circle cx="9.5" cy="23" r="1.4" fill="white" opacity="0.95" />
        <circle cx="9.5" cy="23" r="0.6" fill="white" />

        {/* Mid-left */}
        <circle cx="14.5" cy="21" r="1.1" fill="white" opacity="0.9" />
        <circle cx="14.5" cy="21" r="0.5" fill="white" />

        {/* Center (brightest) */}
        <circle cx="19.5" cy="19.5" r="1.5" fill="white" opacity="1" />
        <circle cx="19.5" cy="19.5" r="0.65" fill="white" />

        {/* Upper arrowhead */}
        <circle cx="26" cy="16.5" r="1.3" fill="white" opacity="0.95" />
        <circle cx="26" cy="16.5" r="0.55" fill="white" />

        {/* Lower arrowhead */}
        <circle cx="26" cy="22.5" r="1.1" fill="white" opacity="0.9" />
        <circle cx="26" cy="22.5" r="0.5" fill="white" />
      </g>
    </svg>
  );
}

export type IconProps = {
  size?: number;
  strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function base(size: number, sw: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION ICONS
// ─────────────────────────────────────────────────────────────

/** Sidebar: Portfolio / User tab */
export function PortfolioIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
      <path d="M16 6.5l1.5-1.5 1.5 1.5" />
      <path d="M17.5 5v4" />
    </svg>
  );
}

/** Sidebar: Vault tab */
export function VaultIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5V10" />
      <path d="M15.5 12H14" />
      <path d="M12 15.5V14" />
      <path d="M8.5 12H10" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M20 7.5h0.01M20 16.5h0.01" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

/** Sidebar: Treasury tab */
export function TreasuryIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M3 10l9-7 9 7" />
      <line x1="5" y1="10" x2="5" y2="19" />
      <line x1="9" y1="10" x2="9" y2="19" />
      <line x1="15" y1="10" x2="15" y2="19" />
      <line x1="19" y1="10" x2="19" y2="19" />
      <line x1="2" y1="19" x2="22" y2="19" />
      <line x1="2" y1="21.5" x2="22" y2="21.5" />
    </svg>
  );
}

/** Sidebar: Escrow tab — shield with inner lock */
export function EscrowIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2L4 6v6c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V6L12 2z" />
      <rect x="9" y="12" width="6" height="5" rx="1" />
      <path d="M10 12v-1.5a2 2 0 014 0V12" />
      <circle cx="12" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Sidebar: Reserve tab — gold bar stack */
export function ReserveIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="3" y="7" width="18" height="5" rx="1.2" />
      <rect x="3" y="13" width="18" height="5" rx="1.2" />
      <line x1="9" y1="7" x2="9" y2="12" />
      <line x1="15" y1="7" x2="15" y2="12" />
      <line x1="7.5" y1="13" x2="7.5" y2="18" />
      <line x1="12" y1="13" x2="12" y2="18" />
      <line x1="16.5" y1="13" x2="16.5" y2="18" />
    </svg>
  );
}

/** Sidebar: DAO tab — decentralised node network */
export function DAOIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="4.5" cy="6" r="2" />
      <circle cx="19.5" cy="6" r="2" />
      <circle cx="4.5" cy="18" r="2" />
      <circle cx="19.5" cy="18" r="2" />
      <line x1="6.5" y1="7" x2="10" y2="10.5" />
      <line x1="17.5" y1="7" x2="14" y2="10.5" />
      <line x1="6.5" y1="17" x2="10" y2="13.5" />
      <line x1="17.5" y1="17" x2="14" y2="13.5" />
    </svg>
  );
}

/** Settings gear */
export function SettingsIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93l-1.42 1.42M5.36 17.65l-1.42 1.42M20 12h-2M6 12H4M19.07 19.07l-1.42-1.42M5.36 6.36L3.94 4.93M12 20v-2M12 6V4" />
      <path d="M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  );
}

/** Connect Wallet */
export function ConnectWalletIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5.5A2.5 2.5 0 0013.5 3h-3A2.5 2.5 0 008 5.5V7" />
      <rect x="14.5" y="12" width="6.5" height="4" rx="1.5" />
      <circle cx="17.75" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mint — coin with plus spark */
export function MintIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="11" cy="13" r="7" />
      <path d="M11 10v6M8 13h6" />
      <path d="M17 4l1.2-1.2M17 4l1.2 1.2M17 4h.01" strokeWidth={2} strokeLinecap="round" />
      <path d="M20 7l1-1M20 7l1 1M20 7h.01" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** Add/Switch network */
export function AddNetworkIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="17" cy="6" r="2.5" />
      <circle cx="17" cy="18" r="2.5" />
      <line x1="7.5" y1="11" x2="14.5" y2="7.2" />
      <line x1="7.5" y1="13" x2="14.5" y2="16.8" />
      <line x1="20" y1="6" x2="22" y2="6" />
      <line x1="21" y1="5" x2="21" y2="7" />
    </svg>
  );
}

/** External link */
export function ExternalLinkIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// STATUS & INDICATOR ICONS
// ─────────────────────────────────────────────────────────────

/** Protocol Active — 4-point star with sparkles */
export function ProtocolActiveIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2z" />
      <circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Active / Online indicator */
export function ActiveIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-5" />
    </svg>
  );
}

/** Locked padlock */
export function LockedIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
      <circle cx="12" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="18" x2="12" y2="19" strokeWidth={2} />
    </svg>
  );
}

/** Unlocked padlock */
export function UnlockedIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M16 11V7a4 4 0 00-8 0v1" />
      <circle cx="12" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Maturing — hourglass */
export function MaturingIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <line x1="5" y1="3" x2="19" y2="3" />
      <line x1="5" y1="21" x2="19" y2="21" />
      <path d="M6 3c0 6 12 4.5 12 9S6 18 6 21" />
      <path d="M18 3c0 6-12 4.5-12 9s12 5.5 12 9" />
    </svg>
  );
}

/** Calendar */
export function CalendarIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="19" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Receipt / document */
export function ReceiptIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M4 3h16v17l-2.5-1.8-2.5 1.8-2.5-1.8L10 20l-2.5-1.8-2.5 1.8L4 20V3z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="14" y2="12" />
      <line x1="8" y1="16" x2="11" y2="16" />
    </svg>
  );
}

/** New Deposit — arrow into container with sparkle */
export function NewDepositIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 3v11" />
      <path d="M8.5 10.5l3.5 3.5 3.5-3.5" />
      <rect x="3" y="17.5" width="14" height="3" rx="1" />
      <path d="M19 5l1.3-1.3M19 5l1.3 1.3M19 5h.01" strokeWidth={2} />
      <path d="M21.5 9l0.8-.8M21.5 9l.8.8M21.5 9h.01" strokeWidth={1.5} />
    </svg>
  );
}

/** Deposit — arrow into tray */
export function DepositIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 3v12" />
      <path d="M8 11.5l4 4 4-4" />
      <rect x="3" y="18" width="18" height="3" rx="1.2" />
    </svg>
  );
}

/** Allocation — pie chart */
export function AllocationIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l7.8 4.5" />
      <path d="M12 12L4.2 16.5" />
    </svg>
  );
}

/** Insurance — shield with heart */
export function InsuranceIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2L4 6v6c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V6L12 2z" />
      <path d="M9.5 11.5c0-1.38 1.12-2 2.5-.8 1.38-1.2 2.5-.58 2.5.8 0 1.4-2.5 3.2-2.5 3.2S9.5 12.9 9.5 11.5z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Return / Payout — circular arrow */
export function ReturnPayoutIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M3 12a9 9 0 109 9" />
      <path d="M3 7.5v5h5" />
      <path d="M14 12l-2 2 2 2" />
      <line x1="12" y1="14" x2="17" y2="14" />
    </svg>
  );
}

/** Completed — filled ring + check */
export function CompletedIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12l3 3 6-6.5" />
    </svg>
  );
}

/** Pending — dashed circle + clock hands */
export function PendingIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3.5 2.5" />
      <path d="M12 7.5v4.5l3 2.5" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// FINANCIAL & VALUE ICONS
// ─────────────────────────────────────────────────────────────

/** USDC — coin with dollar sign */
export function USDCIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v9" />
      <path d="M9.5 9.5c0-1.1 1.12-2 2.5-2s2.5.9 2.5 2-1.12 2-2.5 2-2.5.9-2.5 2 1.12 2 2.5 2 2.5-.9 2.5-2" />
    </svg>
  );
}

/** Gold bar icon */
export function GoldIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="8" y1="8" x2="8" y2="16" />
      <line x1="13" y1="8" x2="13" y2="16" />
      <path d="M3 9.5l2-1.5M21 9.5l-2-1.5" />
    </svg>
  );
}

/** Activity / pulse line */
export function ActivityIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <polyline points="2,12 5,12 7,5 10,19 13,10 15.5,14 17,12 22,12" />
    </svg>
  );
}

/** Balance / scale */
export function ScaleIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M4.5 8.5l7.5-5.5 7.5 5.5" />
      <circle cx="4.5" cy="16" r="3.5" />
      <circle cx="19.5" cy="16" r="3.5" />
      <line x1="3.5" y1="16" x2="5.5" y2="16" />
      <line x1="18.5" y1="16" x2="20.5" y2="16" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// AGENT & SYSTEM ICONS
// ─────────────────────────────────────────────────────────────

/** Autonomous Agent — hexagonal robot */
export function AgentIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2L20 6.5v11L12 22l-8-4.5v-11L12 2z" />
      <circle cx="9.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9.5 14.5c0 0 1.25 1.5 2.5 1.5s2.5-1.5 2.5-1.5" />
      <line x1="12" y1="2" x2="12" y2="5" />
    </svg>
  );
}

/** Strategy — target / crosshair */
export function StrategyIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="3" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="3" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="21" y2="12" />
    </svg>
  );
}

/** AI / Intelligence — neural nodes */
export function AIIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="4" cy="8" r="2" />
      <circle cx="20" cy="8" r="2" />
      <circle cx="4" cy="16" r="2" />
      <circle cx="20" cy="16" r="2" />
      <circle cx="12" cy="3" r="1.5" />
      <circle cx="12" cy="21" r="1.5" />
      <line x1="6" y1="9" x2="9.5" y2="11" />
      <line x1="18" y1="9" x2="14.5" y2="11" />
      <line x1="6" y1="15" x2="9.5" y2="13" />
      <line x1="18" y1="15" x2="14.5" y2="13" />
      <line x1="12" y1="4.5" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="19.5" />
    </svg>
  );
}

/** System health — ECG/heartbeat */
export function SystemHealthIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <polyline points="2,12 5.5,12 8,5.5 11,18.5 13.5,9 16,14 18,12 22,12" />
      <circle cx="2" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="22" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Governance — scales/balance hammer */
export function GovernanceIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 3v18" />
      <path d="M5 8h14" />
      <path d="M3 12l2-4h4l2 4-2 4H5l-2-4z" />
      <path d="M13 12l2-4h4l2 4-2 4h-4l-2-4z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// UI & UTILITY ICONS
// ─────────────────────────────────────────────────────────────

/** Refresh */
export function RefreshIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" />
      <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

/** Search / magnifying glass */
export function SearchIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </svg>
  );
}

/** Close / X */
export function CloseIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Check mark */
export function CheckIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M4 12l5 5 11-11" />
    </svg>
  );
}

/** Warning triangle */
export function WarningIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Info circle */
export function InfoIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <circle cx="12" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Copy */
export function CopyIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

/** QR Code */
export function QRCodeIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
      <line x1="14" y1="14" x2="14" y2="14" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="17" y1="14" x2="17" y2="14" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="20" y1="14" x2="20" y2="14" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="14" y1="17" x2="14" y2="17" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="17" y1="17" x2="20" y2="17" strokeWidth={2} strokeLinecap="round" />
      <line x1="20" y1="17" x2="20" y2="21" strokeWidth={2} strokeLinecap="round" />
      <line x1="14" y1="20" x2="17" y2="20" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** Hash / ID */
export function HashIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

/** Package / box */
export function PackageIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

/** Clock */
export function ClockIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 3" />
    </svg>
  );
}

/** Calendar + Clock */
export function CalendarClockIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="2" y="4" width="20" height="18" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="7" y1="2" x2="7" y2="6" />
      <line x1="17" y1="2" x2="17" y2="6" />
      <circle cx="15" cy="16" r="3.5" />
      <path d="M15 14.5v1.5l1 1" />
      <circle cx="7" cy="15" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Arrow down */
export function ArrowDownIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <line x1="12" y1="4" x2="12" y2="20" />
      <polyline points="18 14 12 20 6 14" />
    </svg>
  );
}

/** Arrow right-left / swap */
export function SwapIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

/** Users / multiple people */
export function UsersIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-3.31 2.69-6 6-6s6 2.69 6 6" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M21 19c0-2.76-1.79-5-4-5.5" />
    </svg>
  );
}

/** Layers / stacked */
export function LayersIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 12l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </svg>
  );
}

/** Repeat / auto-return */
export function RepeatIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  );
}

/** Gem / precious stone */
export function GemIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M6 3h12l4 6-10 13L2 9 6 3z" />
      <path d="M2 9h20M6 3l4 6m4-6l4 6m-8 0l2 13" />
    </svg>
  );
}

/** Globe / network */
export function GlobeIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c-2.5 3-4 5.5-4 9s1.5 6 4 9" />
      <path d="M12 3c2.5 3 4 5.5 4 9s-1.5 6-4 9" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  );
}

/** Shield alert */
export function ShieldAlertIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <path d="M12 2L4 6v6c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V6L12 2z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Zap / lightning */
export function ZapIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/** User cog / admin */
export function UserCogIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <circle cx="9" cy="7" r="3.5" />
      <path d="M3 19c0-3.31 2.69-6 6-6" />
      <circle cx="18" cy="16" r="2" />
      <path d="M18 12v2M18 18v2M15 13.27l1 1.73M20 17l1 1.73M15 18.73l1-1.73M20 15l1-1.73" strokeWidth={1.5} />
    </svg>
  );
}

/** Wallet */
export function WalletIcon({ size = 20, strokeWidth = 1.5, ...p }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...p}>
      <rect x="2" y="6" width="20" height="15" rx="2" />
      <path d="M16 6V4.5A2.5 2.5 0 0013.5 2H7A3 3 0 004 5" />
      <rect x="15" y="12" width="6" height="4" rx="1.5" />
      <circle cx="18" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
