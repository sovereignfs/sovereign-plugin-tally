import type { CurrencyAmount } from './balances';

/**
 * Groups list filter (UI-FLOW.md §4's "All / Outstanding balances / You
 * owe / You're owed", plus Closed). Pure — shared by the server page that
 * applies it and the client control that renders it, keyed off the
 * `?filter=` query param so a filtered list survives a reload and the
 * detail pane's `?g=` selection composes with it.
 */
export const GROUP_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'owe', label: 'You owe' },
  { value: 'owed', label: "You're owed" },
  { value: 'closed', label: 'Closed' },
] as const;

export type GroupFilter = (typeof GROUP_FILTERS)[number]['value'];

export function isGroupFilter(value: string | undefined): value is GroupFilter {
  return GROUP_FILTERS.some((f) => f.value === value);
}

export function applyGroupFilter<
  T extends { archivedAt: number | null; myBalances: CurrencyAmount[] },
>(items: T[], filter: GroupFilter): T[] {
  switch (filter) {
    case 'active':
      return items.filter((g) => g.archivedAt === null);
    case 'closed':
      return items.filter((g) => g.archivedAt !== null);
    case 'outstanding':
      return items.filter((g) => g.myBalances.length > 0);
    case 'owe':
      return items.filter((g) => g.myBalances.some((b) => b.amountCents < 0));
    case 'owed':
      return items.filter((g) => g.myBalances.some((b) => b.amountCents > 0));
  }
}
