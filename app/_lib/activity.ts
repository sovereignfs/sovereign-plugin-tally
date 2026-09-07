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

const moneyFormatters = new Map<string, Intl.NumberFormat | null>();

/**
 * "USD 2,400.00" / "JPY 1,500" / "BHD 12.340" — `Intl.NumberFormat` with the
 * ISO code (never a symbol: `$` alone is ambiguous across a dozen dollar
 * currencies), thousands separators, and the currency's own minor-unit
 * count. Amounts are always stored as ×100 minor units (`CurrencyInput`'s
 * contract), so `amountCents / 100` is the display value for every
 * currency, including zero-decimal ones. Intl's non-breaking space is
 * normalised to a plain space so string comparisons and wrapping behave.
 * Falls back to the old fixed-two-decimals form for a code Intl rejects.
 */
export function formatMoney(amountCents: number, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (formatter === undefined) {
    try {
      formatter = new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
      });
    } catch {
      formatter = null;
    }
    moneyFormatters.set(currency, formatter);
  }
  if (!formatter) return `${currency} ${(amountCents / 100).toFixed(2)}`;
  return formatter.format(amountCents / 100).replace(/\u00a0/g, ' ');
}

/** "Aug 24" — UTC calendar day, matching this codebase's established
 *  "format dates in UTC server-side, never the server process's local
 *  timezone" convention (see `overview.ts`'s `startOfMonth`). */
export function formatActivityDate(
  occurredOnSeconds: number,
  options: { withYear?: boolean } = {},
): string {
  const date = new Date(occurredOnSeconds * 1000);
  const base = `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return options.withYear ? `${base}, ${date.getUTCFullYear()}` : base;
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
  // A flat feed has no month header to carry the year, so an entry from a
  // previous calendar year says so explicitly rather than reading as recent.
  const sameYear =
    new Date(occurredOnSeconds * 1000).getUTCFullYear() ===
    new Date(nowSeconds * 1000).getUTCFullYear();
  return formatActivityDate(occurredOnSeconds, { withYear: !sameYear });
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

/**
 * "You lent USD 39.00" / "You borrowed USD 13.00" / "You paid your share" /
 * "Not involved" — the reader's own position on one expense, from
 * `balances.ts`'s `myPositionCents`. `involved` is false when the reader
 * neither paid nor had a share, distinguishing that from "lent exactly zero"
 * (paid their own share and nothing more).
 */
export function describeMyPosition(input: {
  positionCents: number;
  involved: boolean;
  currency: string;
}): string {
  if (!input.involved) return 'Not involved';
  if (input.positionCents > 0)
    return `You lent ${formatMoney(input.positionCents, input.currency)}`;
  if (input.positionCents < 0) {
    return `You borrowed ${formatMoney(-input.positionCents, input.currency)}`;
  }
  return 'You paid your share';
}

export interface GroupActivityItem {
  id: string;
  type: 'expense' | 'settlement';
  occurredOn: number;
  /** When the row was recorded (`createdAt`) — distinct from `occurredOn`,
   *  the user-entered date. Inbox sorts and "2h ago"s by this, since a
   *  backdated expense added today is still news today. */
  recordedAt: number;
  /** The reader's own position on an expense (`describeMyPosition`) —
   *  unset for a settlement row, whose description already names the
   *  reader when they're a party. */
  myPosition?: string;
  /** The expense's `notes` field — shown under the description. Unset for
   *  a settlement (whose optional `note` uses the sibling `note` field). */
  notes?: string | null;
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
  /** A short-lived `sdk.storage.getSignedUrl()` link to an expense's
   *  attached receipt image (SPEC.md §8) — generated fresh per page load,
   *  never cached. `null`/unset for a settlement row or an expense with no
   *  receipt attached. */
  receiptUrl?: string | null;
  /** Present only on the group detail's own feed, for the row's Edit
   *  action (`ExpenseEditData`). Absent on cross-group feeds. */
  expense?: ExpenseEditData;
  /** The group this row belongs to — set alongside `expense`/settlement
   *  rows on the group detail feed so row actions (delete) know their
   *  scope without a second lookup. */
  groupId?: string;
}

/**
 * Everything the edit form needs to re-open an expense exactly as it was
 * entered — carried on the group detail's own activity rows so "Edit"
 * needs no second round trip. `shareUnits` is the original percentage /
 * share-count input (SPEC.md §3), never the resolved cents.
 */
export interface ExpenseEditData {
  expenseId: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  category: string | null;
  /** Epoch seconds, UTC midnight — `YYYY-MM-DD` via `toDateInputValue`. */
  occurredOn: number;
  notes: string | null;
  splitMethod: string;
  payers: { memberId: string; amountCents: number }[];
  participants: { memberId: string; shareAmountCents: number; shareUnits: number | null }[];
  hasReceipt: boolean;
}

/** Epoch seconds → the `YYYY-MM-DD` a `<input type="date">` wants, UTC
 *  calendar (the inverse of `expense-input.ts`'s `parseDateInput`). */
export function toDateInputValue(seconds: number | null): string {
  if (seconds === null) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The `count` most recent 'YYYY-MM' keys ending at `nowSeconds`'s month,
 *  oldest first — the x-axis for a monthly trend that must show empty
 *  months as zero rather than skipping them. */
export function recentMonthKeys(nowSeconds: number, count: number): string[] {
  const date = new Date(nowSeconds * 1000);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
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
    .map(([monthKey, monthItems]) => ({
      monthKey,
      monthLabel: monthLabelFor(monthKey),
      items: monthItems,
    }));
}
