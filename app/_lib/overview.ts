import { sdk } from '@sovereignfs/sdk';
import {
  computeNetBalances,
  largestMagnitude,
  resolveCounterparties,
  rollupByPerson,
  type CurrencyAmount,
} from './balances';
import { pushTo } from './collections';
import { getContext } from './context';
import { fetchMyGroupsData } from './group-data';
import { getUserSettings } from './settings';

export type { CurrencyAmount };

/**
 * Cross-group aggregation for the Overview page (UI-FLOW.md §3, redesigned
 * 2026-08-27 — headline owed/owe + key stats + non-zero-balance breakdowns
 * by group and by person; charts and "recent activity" explicitly dropped
 * from this design, see ROADMAP.md). No `'use server'` here — every export
 * is a read, called directly from a Server Component
 * (`app/(home)/page.tsx`), not invoked from a Client Component form the way
 * `groups.ts`'s `createGroupAction` needs to be.
 */

export interface OverviewGroupItem {
  id: string;
  name: string;
  memberCount: number;
  /** My own balance(s) in this group, one entry per currency (never
   *  blended — SPEC.md §4), sorted by |amount| descending. Positive =
   *  I'm owed, negative = I owe, the exact sign `BalanceChip` expects.
   *  A single group is usually single-currency but isn't required to be
   *  (`expenses.currency` is per-expense, not constrained to the group's
   *  `defaultCurrency`) — found live via the seed data below, this can't
   *  be collapsed to one dominant entry without silently dropping a real
   *  balance. */
  balances: CurrencyAmount[];
}

export interface OverviewPersonItem {
  /** A real user id, or the synthetic `${groupId}:${memberId}` guest key
   *  `rollupByPerson` documents — guests never roll up across groups. */
  personKey: string;
  label: string;
  sharedGroupCount: number;
  /** This *person's* own balance(s) relative to me, one entry per
   *  currency — positive = I owe them (they're owed), negative = they owe
   *  me. Same `BalanceChip` sign convention as every other balance in this
   *  app: describes the row's own subject, not "my" gain/loss. Sharing
   *  more than one group in different currencies is the normal case, not
   *  an edge case — e.g. a USD roommate group and a EUR trip group with
   *  the same person produces exactly this. */
  balances: CurrencyAmount[];
}

export interface OverviewData {
  hasGroups: boolean;
  /** Per-currency, my own net-positive balances across every group (never
   *  blended across currencies — SPEC.md §4). */
  owed: CurrencyAmount[];
  owe: CurrencyAmount[];
  /** `owed` and `owe` merged into one magnitude-sorted list — "how much
   *  money is in motion" regardless of direction. */
  netExposure: CurrencyAmount[];
  /** My own share (`expense_splits`) of active expenses — "how much did I
   *  spend/consume", not "how much did I front as payer". */
  spentThisMonth: CurrencyAmount[];
  spentAllTime: CurrencyAmount[];
  activeGroupCount: number;
  peopleWithBalanceCount: number;
  /** Non-zero-balance groups only, sorted by |amount| descending. */
  groups: OverviewGroupItem[];
  /** Non-zero-balance people only, sorted by |amount| descending. */
  people: OverviewPersonItem[];
}

const EMPTY_OVERVIEW: OverviewData = {
  hasGroups: false,
  owed: [],
  owe: [],
  netExposure: [],
  spentThisMonth: [],
  spentAllTime: [],
  activeGroupCount: 0,
  peopleWithBalanceCount: 0,
  groups: [],
  people: [],
};

/** Settings' Primary Currency's second cosmetic effect (UI-FLOW.md §8):
 *  decides which currency renders first/largest when a user holds
 *  balances in more than one — everything else still ranks by |amount|.
 *  Scoped to Overview's own rollups only, not Groups/People's breakdown
 *  rows (the spec names "Overview's per-currency rollup" specifically). */
function sortByPrimaryCurrency(amounts: CurrencyAmount[], primaryCurrency: string): CurrencyAmount[] {
  return [...amounts].sort((a, b) => {
    const aPrimary = a.currency === primaryCurrency;
    const bPrimary = b.currency === primaryCurrency;
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return b.amountCents - a.amountCents;
  });
}

function toSortedArray(byCurrency: Map<string, number>, primaryCurrency: string): CurrencyAmount[] {
  const amounts = Array.from(byCurrency.entries()).map(([currency, amountCents]) => ({ currency, amountCents }));
  return sortByPrimaryCurrency(amounts, primaryCurrency);
}

export async function getOverviewData(): Promise<OverviewData> {
  const { db, userId, tenantId } = await getContext();
  const [{ myMemberships, membersByGroup, expensesByGroup, payersByGroup, splitsByGroup, settlementsByGroup }, { primaryCurrency }] =
    await Promise.all([fetchMyGroupsData(db, userId, tenantId), getUserSettings()]);

  if (myMemberships.length === 0) return EMPTY_OVERVIEW;

  const allMembers = Array.from(membersByGroup.values()).flat();
  const allSplits = Array.from(splitsByGroup.values()).flat();
  const allExpenses = Array.from(expensesByGroup.values()).flat();

  const myBalancesByCurrency = new Map<string, number>();
  const groupItems: OverviewGroupItem[] = [];
  const personRollupInput: { personKey: string; currency: string; amountCents: number }[] = [];
  const sharedGroupsByPersonKey = new Map<string, Set<string>>();

  function personKeyFor(groupId: string, member: { id: string; kind: string; userId: string | null }) {
    return member.kind === 'user' && member.userId ? member.userId : `${groupId}:${member.id}`;
  }

  for (const membership of myMemberships) {
    const { groupId, myMemberId, name } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];

    const netBalances = computeNetBalances({
      expenses: expensesByGroup.get(groupId) ?? [],
      payers: payersByGroup.get(groupId) ?? [],
      splits: splitsByGroup.get(groupId) ?? [],
      settlements: settlementsByGroup.get(groupId) ?? [],
    });

    // My own position in this group — feeds both the headline rollup and
    // this group's row in the Groups breakdown.
    const myBalances = netBalances
      .filter((b) => b.memberId === myMemberId && b.amountCents !== 0)
      .map((b) => ({ currency: b.currency, amountCents: b.amountCents }));
    for (const b of myBalances) {
      myBalancesByCurrency.set(b.currency, (myBalancesByCurrency.get(b.currency) ?? 0) + b.amountCents);
    }
    if (myBalances.length > 0) {
      groupItems.push({
        id: groupId,
        name,
        memberCount: groupMembersList.length,
        balances: myBalances.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
      });
    }

    // Pairwise-with-me balances, for the People breakdown.
    for (const counterparty of resolveCounterparties(netBalances, myMemberId)) {
      const otherMember = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (!otherMember) continue;
      personRollupInput.push({
        personKey: personKeyFor(groupId, otherMember),
        currency: counterparty.currency,
        amountCents: counterparty.amountCents,
      });
    }

    // Shared-group counts, independent of how `simplifyDebts` happens to
    // route any given group's payments.
    for (const member of groupMembersList) {
      if (member.id === myMemberId) continue;
      const personKey = personKeyFor(groupId, member);
      const set = sharedGroupsByPersonKey.get(personKey) ?? new Set<string>();
      set.add(groupId);
      sharedGroupsByPersonKey.set(personKey, set);
    }
  }

  const personBalances = rollupByPerson(personRollupInput).filter((p) => p.amountCents !== 0);

  const realUserIds = Array.from(new Set(personBalances.map((p) => p.personKey).filter((key) => !key.includes(':'))));
  const resolvedUsers = realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));
  const guestNameByKey = new Map(
    allMembers
      .filter((m) => m.kind === 'guest')
      .map((m) => [`${m.groupId}:${m.id}`, m.guestName ?? 'Guest']),
  );

  const balancesByPersonKey = new Map<string, CurrencyAmount[]>();
  for (const p of personBalances) {
    pushTo(balancesByPersonKey, p.personKey, { currency: p.currency, amountCents: p.amountCents });
  }
  const peopleItems: OverviewPersonItem[] = Array.from(balancesByPersonKey.entries()).map(
    ([personKey, amounts]) => ({
      personKey,
      label: personKey.includes(':')
        ? (guestNameByKey.get(personKey) ?? 'Guest')
        : (nameByUserId.get(personKey) ?? 'Unknown member'),
      sharedGroupCount: sharedGroupsByPersonKey.get(personKey)?.size ?? 0,
      balances: amounts.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
    }),
  );

  const owed: CurrencyAmount[] = [];
  const owe: CurrencyAmount[] = [];
  for (const [currency, amountCents] of myBalancesByCurrency) {
    if (amountCents > 0) owed.push({ currency, amountCents });
    else if (amountCents < 0) owe.push({ currency, amountCents: -amountCents });
  }
  const sortedOwed = sortByPrimaryCurrency(owed, primaryCurrency);
  const sortedOwe = sortByPrimaryCurrency(owe, primaryCurrency);

  // "Spent" = my own share of active expenses (what I consumed), not what
  // I fronted as payer — SPEC.md's `aggregateByCategory`/`aggregateByPeriod`
  // scope "spend" the same way, for the same reason (no currency
  // conversion needed for a purely personal figure).
  const myMemberIds = new Set(myMemberships.map((m) => m.myMemberId));
  const activeExpenseById = new Map(allExpenses.filter((e) => !e.deletedAt).map((e) => [e.id, e]));
  const startOfMonth = (() => {
    const d = new Date();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  })();
  const spentThisMonthByCurrency = new Map<string, number>();
  const spentAllTimeByCurrency = new Map<string, number>();
  for (const split of allSplits) {
    if (!myMemberIds.has(split.memberId)) continue;
    const expense = activeExpenseById.get(split.expenseId);
    if (!expense) continue;
    spentAllTimeByCurrency.set(
      expense.currency,
      (spentAllTimeByCurrency.get(expense.currency) ?? 0) + split.shareAmountCents,
    );
    if (expense.occurredOn >= startOfMonth) {
      spentThisMonthByCurrency.set(
        expense.currency,
        (spentThisMonthByCurrency.get(expense.currency) ?? 0) + split.shareAmountCents,
      );
    }
  }

  groupItems.sort(
    (a, b) => Math.abs(largestMagnitude(b.balances).amountCents) - Math.abs(largestMagnitude(a.balances).amountCents),
  );
  peopleItems.sort(
    (a, b) => Math.abs(largestMagnitude(b.balances).amountCents) - Math.abs(largestMagnitude(a.balances).amountCents),
  );

  return {
    hasGroups: true,
    owed: sortedOwed,
    owe: sortedOwe,
    netExposure: sortByPrimaryCurrency([...sortedOwed, ...sortedOwe], primaryCurrency),
    spentThisMonth: toSortedArray(spentThisMonthByCurrency, primaryCurrency),
    spentAllTime: toSortedArray(spentAllTimeByCurrency, primaryCurrency),
    activeGroupCount: myMemberships.length,
    peopleWithBalanceCount: peopleItems.length,
    groups: groupItems,
    people: peopleItems,
  };
}
