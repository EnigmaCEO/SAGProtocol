import { ReactNode } from 'react';

interface MetricCardProps {
  title?: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}

const toneConfig = {
  neutral: {
    value:      'var(--text-100)',
    ruleFrom:   'rgba(255,255,255,0.12)',
    ruleTo:     'rgba(255,255,255,0.0)',
    border:     'rgba(255,255,255,0.07)',
    leftAccent: 'rgba(255,255,255,0.15)',
    circleBg:   'rgba(100,62,200,0.12)',
    circleBdr:  'rgba(148,98,232,0.22)',
    iconColor:  'var(--purple-400)',
    glow:       'rgba(90,50,190,0.1)',
  },
  success: {
    value:      'var(--gold-300)',
    ruleFrom:   'rgba(212,168,48,0.38)',
    ruleTo:     'rgba(212,168,48,0.0)',
    border:     'rgba(212,168,48,0.14)',
    leftAccent: 'rgba(212,168,48,0.45)',
    circleBg:   'rgba(100,66,8,0.38)',
    circleBdr:  'rgba(212,168,48,0.28)',
    iconColor:  'var(--gold-300)',
    glow:       'rgba(180,140,20,0.1)',
  },
  warning: {
    value:      'var(--gold-300)',
    ruleFrom:   'rgba(212,168,48,0.42)',
    ruleTo:     'rgba(212,168,48,0.0)',
    border:     'rgba(212,168,48,0.16)',
    leftAccent: 'rgba(212,168,48,0.55)',
    circleBg:   'rgba(100,66,8,0.45)',
    circleBdr:  'rgba(240,186,60,0.32)',
    iconColor:  'var(--gold-300)',
    glow:       'rgba(212,168,48,0.1)',
  },
  danger: {
    value:      '#fca5a5',
    ruleFrom:   'rgba(236,86,86,0.38)',
    ruleTo:     'rgba(236,86,86,0.0)',
    border:     'rgba(236,86,86,0.14)',
    leftAccent: 'rgba(236,86,86,0.5)',
    circleBg:   'rgba(80,20,20,0.45)',
    circleBdr:  'rgba(230,100,100,0.3)',
    iconColor:  '#fca5a5',
    glow:       'rgba(236,86,86,0.1)',
  },
};

export default function MetricCard({ title, value, hint, tone = 'neutral', icon }: MetricCardProps) {
  const cfg = toneConfig[tone];

  return (
    <div
      className="group relative overflow-hidden rounded-xl p-4 transition-all duration-200 hover:translate-y-[-1px]"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%),
        linear-gradient(180deg, #10152f 0%, #0d1228 100%)`,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 20px 42px rgba(1,1,12,0.62), inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.2)`,
      }}
    >
      {/* Top gradient rule */}
      <div
        className="absolute left-3 right-3 top-0 h-px"
        style={{ background: `linear-gradient(90deg, ${cfg.ruleFrom} 0%, ${cfg.ruleTo} 100%)` }}
      />

      {/* Left accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full"
        style={{ background: `linear-gradient(180deg, transparent, ${cfg.leftAccent}, transparent)` }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pl-2">
          {title && (
            <div
              className="text-[9.5px] uppercase tracking-[0.22em] font-bold mb-3 leading-none"
              style={{ color: 'var(--text-500)', letterSpacing: '0.22em' }}
            >
              {title}
            </div>
          )}

          <div
            className="text-[1.9rem] leading-none font-bold kpi-value"
            style={{ color: cfg.value }}
          >
            {value}
          </div>

          {hint && (
            <div
              className="text-[10px] uppercase tracking-[0.16em] font-semibold mt-2"
              style={{ color: 'var(--text-500)' }}
            >
              {hint}
            </div>
          )}
        </div>

        {icon && (
          <div
            className="flex shrink-0 items-center justify-center rounded-full mt-0.5 transition-all duration-200 group-hover:scale-105"
            style={{
              width: '2.4rem',
              height: '2.4rem',
              background: cfg.circleBg,
              border: `1px solid ${cfg.circleBdr}`,
              boxShadow: `0 0 14px ${cfg.glow}`,
              color: cfg.iconColor,
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
