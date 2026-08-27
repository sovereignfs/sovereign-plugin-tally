/**
 * Fixed application-level enum, not its own table — matches CONCEPT.md
 * §4's "small fixed set" scope. A per-group custom-category table is a
 * real future feature, not a v1 concern.
 *
 * Deliberately its own file, not co-located with `expenses.ts`: that file
 * has `'use server'` at the top, and a "use server" module may only
 * export async functions — a plain constant export from it silently
 * fails to cross into a Client Component (found live: `CATEGORY_OPTIONS`
 * came through as `undefined` in `ExpenseForm.tsx`, throwing
 * `CATEGORY_OPTIONS.map is not a function`).
 */
export const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'rent', label: 'Rent' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'transport', label: 'Transport' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
] as const;

/** Shared value→label lookup — `groups.ts`/`people.ts`/`inbox.ts` each
 *  build a `GroupActivityItem.categoryLabel` from a stored `category`
 *  value and previously each redefined this map locally. */
export const CATEGORY_LABEL_BY_VALUE = new Map<string, string>(CATEGORY_OPTIONS.map((c) => [c.value, c.label]));
