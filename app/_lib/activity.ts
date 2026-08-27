import { toPeriodKey } from './balances';

/**
 * The `@detail/groups` activity feed — a merged, described, month-grouped
 * timeline of a group's expenses and settlements (UI-FLOW.md §4,
 * requested directly 2026-08-27 against a Splitwise reference). Pure
 * functions only, same "no DB access, take already-fetched rows" shape as
 * `balances.ts` — unit-testable in isolation.
 */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatMoney(amountCents: number, currency: string): string {
  return `${currency} ${(amountCents / 100).toFixed(2)}`;
}

/** "Aug 24" — UTC calendar day, matching this codebase's established
 *  "format dates in UTC server-side, never the server process's local
 *  timezone" convention (see `overview.ts`'s `startOfMonth`). */
export function formatActivityDate(occurredOnSeconds: number): string {
  const date = new Date(occurredOnSeconds * 1000);
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * "2h ago" / "yesterday" / "3d ago", falling back to `formatActivityDate`
 * beyond a week — Inbox's own flatter, notification-style row (unlike the
 * Group/Person feeds' month-grouped absolute dates, per UI-FLOW.md §5's
 * mockup). Takes `nowSeconds` as a parameter rather than reading
 * `Date.now()` itself, matching this file's "pure function, caller
 * supplies everything" shape — the caller (a Server Component) computes
 * "now" once for the whole page render.
 */
export function formatRelativeTime(occurredOnSeconds: number, nowSeconds: number): string {
  const diffSeconds = Math.max(0, nowSeconds - occurredOnSeconds);
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatActivityDate(occurredOnSeconds);
}

/** "August 2026" from a `toPeriodKey(..., 'month')`-shaped 'YYYY-MM' key. */
export function monthLabelFor(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const monthIndex = Number(monthStr) - 1;
  return `${MONTH_NAMES[monthIndex] ?? monthStr} ${yearStr}`;
}

/**
 * "You paid USD 52.00 for Pizza night" / "Dev Admin paid USD 60.00 for
 * Costco membership renewal" — always phrased as who *fronted* the money
 * (the expense's payer), for the total expense amount, not the reader's
 * own split share (a different, already-shown number).
 */
export function describeExpenseActivity(input: {
  payerLabel: string;
  isPayerMe: boolean;
  amountCents: number;
  currency: string;
  description: string;
}): string {
  const who = input.isPayerMe ? 'You' : input.payerLabel;
  return `${who} paid ${formatMoney(input.amountCents, input.currency)} for ${input.description}`;
}

/**
 * "You paid Alex USD 30.00" / "Alex paid you USD 30.00" / "Alex paid
 * Kasun USD 20.00". Deliberately always "paid", never a "fully settled up
 * with" variant some reference apps use for a settlement that zeroes a
 * pairwise balance — that distinction isn't well-defined here (only a
 * *group's* net position per member is unambiguous; "settled between
 * exactly these two people" would depend on `simplifyDebts`'s own
 * routing, an allocation choice, not a ledger fact) — see
 * `resolveCounterparties`'s own doc comment for the same reasoning.
 */
export function describeSettlementActivity(input: {
  fromLabel: string;
  isFromMe: boolean;
  toLabel: string;
  isToMe: boolean;
  amountCents: number;
  currency: string;
}): string {
  const from = input.isFromMe ? 'You' : input.fromLabel;
  const to = input.isToMe ? 'you' : input.toLabel;
  return `${from} paid ${to} ${formatMoney(input.amountCents, input.currency)}`;
}

export interface GroupActivityItem {
  id: string;
  type: 'expense' | 'settlement';
  occurredOn: number;
  /** The expense's real category label, or `'Settlement'` for a
   *  settlement row — one uniform "what kind of activity" slot rather
   *  than a special case in the UI for settlements having no category. */
  categoryLabel: string;
  description: string;
  /** Settlement's own optional note — never populated for an expense
   *  (`expenses.notes` is a separate, currently-unsurfaced field, not
   *  reused here to avoid conflating two different "note" concepts). */
  note: string | null;
  amountCents: number;
  currency: string;
  /** Which group this happened in — unset for the group detail's own feed
   *  (redundant, the whole page is already scoped to one group), set for
   *  a *person's* cross-group timeline (`people.ts`) where it's shared
   *  across every group in common, so each row needs to say which one. */
  groupName?: string;
}

export interface GroupActivityMonth {
  monthKey: string;
  monthLabel: string;
  items: GroupActivityItem[];
}

/** Buckets an already-sorted-descending activity list into month groups,
 *  months themselves also descending (most recent first). */
export function groupActivityByMonth(items: GroupActivityItem[]): GroupActivityMonth[] {
  const byMonth = new Map<string, GroupActivityItem[]>();
  for (const item of items) {
    const monthKey = toPeriodKey(item.occurredOn, 'month');
    const list = byMonth.get(monthKey);
    if (list) {
      list.push(item);
    } else {
      byMonth.set(monthKey, [item]);
    }
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, monthItems]) => ({ monthKey, monthLabel: monthLabelFor(monthKey), items: monthItems }));
}
