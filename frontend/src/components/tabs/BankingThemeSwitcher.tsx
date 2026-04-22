import type { BankingTheme, BankingThemeMeta } from '../../lib/banking/themes';

interface Props {
  themes: BankingThemeMeta[];
  active: BankingTheme;
  onChange: (theme: BankingTheme) => void;
}

export default function BankingThemeSwitcher({ themes, active, onChange }: Props) {
  return (
    <div className="banking-theme-switcher">
      <span className="banking-theme-switcher__label">Theme</span>
      <div className="banking-theme-switcher__options">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.description}
            onClick={() => onChange(t.id)}
            className={`banking-theme-switcher__option${active === t.id ? ' banking-theme-switcher__option--active' : ''}`}
          >
            <span
              className="banking-theme-switcher__swatch"
              style={{ background: t.swatch }}
            />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
