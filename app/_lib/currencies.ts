/**
 * A small curated ISO 4217 list for v1's currency pickers (group default
 * currency, expense currency, primary currency) — not the full ~180-code
 * standard. Expand this list as real usage demands rather than shipping
 * an exhaustive picker nobody asked for.
 */
export const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
] as const;

export const DEFAULT_CURRENCY = 'USD';
