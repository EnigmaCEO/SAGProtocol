export type BankingTheme = 'sagitta' | 'neo' | 'traditional' | 'private' | 'latam';

export interface BankingThemeMeta {
  id: BankingTheme;
  label: string;
  description: string;
  swatch: string;
}

export const BANKING_THEMES: BankingThemeMeta[] = [
  {
    id: 'sagitta',
    label: 'Sagitta',
    description: 'Default dark gold theme',
    swatch: '#D4A830',
  },
  {
    id: 'neo',
    label: 'Neo Bank',
    description: 'Modern fintech - electric blue, minimal surfaces',
    swatch: '#3B82F6',
  },
  {
    id: 'traditional',
    label: 'Traditional',
    description: 'Conservative corporate banking - navy on light',
    swatch: '#1B3A6B',
  },
  {
    id: 'private',
    label: 'Private',
    description: 'Premium wealth management - deep charcoal and champagne',
    swatch: '#C9A056',
  },
  {
    id: 'latam',
    label: 'Regional',
    description: 'Practical consumer banking - warm amber tones',
    swatch: '#F59E0B',
  },
];
