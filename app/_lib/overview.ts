import { sdk } from '@sovereignfs/sdk';
import { monthLabelFor, recentMonthKeys } from './activity';
import {
  aggregateByCategory,
  aggregateByPeriod,
  computeNetBalances,
  counterpartiesForGroup,
  largestMagnitude,
  rollupByPerson,
  type CurrencyAmount,
} from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { pushTo } from './collections';
import { getContext } from './context';
import { fetchMyGroupsData } from './group-data';
import { getUserSettings } from './settings';

export type { CurrencyAmount };

/**
 * Cross-group aggregation for the Overview page (UI-FLOW.md §3) — headline
 * owed/owe, key stats, non-zero-balance breakdowns by group and by person,
 * and the personal spend analytics the flow doc always called for (spend
 * by category this month, a six-month trend), rendered as plain token-
 * styled bars since the platform has no chart primitive.
 */

export interface OverviewGroupItem {
  id: string;
  name: string;
  memberCount: number;
  /** My own balance(s) in this group, one entry per currency (never
   *  blended — SPEC.md §4), sorted by |amount| descending. */
  balances: CurrencyAmount[];
}

export interface OverviewPersonItem {
  /** A real user id, or the synthetic `${groupId}:${memberId}` guest key
   *  `rollupByPerson` documents — guests never roll up across groups. */
  personKey: string;
  label: string;
  sharedGroupCount: number;
  /** This *person's* own balance(s) relative to me, one entry per
   *  currency — positive = I owe them, negative = they owe me. */
  balances: CurrencyAmount[];
}

export interface OverviewCategoryItem {
  label: string;
  currency: string;
  amountCents: number;
}

export interface OverviewMonthItem {
  monthKey: string;
  label: string;
  currency: string;
  amountCents: number;
}

export interface OverviewData {
  hasGroups: boolean;
  /** Per-currency, my own net-positive balances across every group. */
  owed: CurrencyAmount[];
  owe: CurrencyAmount[];
  /** My own share (`expense_splits`) of active expenses — "how much did I
   *  spend/consume", not "how much did I front as payer". */
  spentThisMonth: CurrencyAmount[];
  spentAllTime: CurrencyAmount[];
  /** Open groups only — a closed group is finished business. */
  activeGroupCount: number;
  closedGroupCount: number;
  peopleWithBalanceCount: number;
  /** Non-zero-balance groups only, sorted by |amount| descending. */
  groups: OverviewGroupItem[];
  /** Non-zero-balance people only, sorted by |amount| descending. */
  people: OverviewPersonItem[];
  /** My share this month by category, per currency, largest first. */
  spendByCategory: OverviewCategoryItem[];
  /** My share per month for the last six months, per currency, oldest first
   *  — empty months present as zero so the trend never skips a month. */
  monthlyTrend: OverviewMonthItem[];
}

const EMPTY_OVERVIEW: OverviewData = {
  hasGroups: false,
  owed: [],
  owe: [],
  spentThisMonth: [],
  spentAllTime: [],
  activeGroupCount: 0,
  closedGroupCount: 0,
  peopleWithBalanceCount: 0,
  groups: [],
  people: [],
  spendByCategory: [],
  monthlyTrend: [],
};

/** Settings' Primary Currency's second cosmetic effect (UI-FLOW.md §8):
 *  decides which currency renders first/largest when a user holds
 *  balances in more than one — everything else still ranks by |amount|. */
function sortByPrimaryCurrency(
  amounts: CurrencyAmount[],
  primaryCurrency: string,
): CurrencyAmount[] {
  return [...amounts].sort((a, b) => {
    const aPrimary = a.currency === primaryCurrency;
    const bPrimary = b.currency === primaryCurrency;
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return b.amountCents - a.amountCents;
  });
}

function toSortedArray(byCurrency: Map<string, number>, primaryCurrency: string): CurrencyAmount[] {
  const amounts = Array.from(byCurrency.entries()).map(([currency, amountCents]) => ({
    currency,
    amountCents,
  }));
  return sortByPrimaryCurrency(amounts, primaryCurrency);
}

export async function getOverviewData(): Promise<OverviewData> {
  const { db, userId, tenantId } = await getContext();
  const [
    {
      myMemberships,
      membersByGroup,
      expensesByGroup,
      payersByGroup,
      splitsByGroup,
      settlementsByGroup,
    },
    { primaryCurrency },
  ] = await Promise.all([fetchMyGroupsData(db, userId, tenantId), getUserSettings()]);

  if (myMemberships.length === 0) return EMPTY_OVERVIEW;

  const allMembers = Array.from(membersByGroup.values()).flat();
  const allSplits = Array.from(splitsByGroup.values()).flat();
  const allExpenses = Array.from(expensesByGroup.values()).flat();

  const myBalancesByCurrency = new Map<string, number>();
  const groupItems: OverviewGroupItem[] = [];
  const personRollupInput: { personKey: string; currency: string; amountCents: number }[] = [];
  const sharedGroupsByPersonKey = new Map<string, Set<string>>();

  function personKeyFor(
    groupId: string,
    member: { id: string; kind: string; userId: string | null },
  ) {
    return member.kind === 'user' && member.userId ? member.userId : `${groupId}:${member.id}`;
  }

  for (const membership of myMemberships) {
    const { groupId, myMemberId, name } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const ledger = {
      expenses: expensesByGroup.get(groupId) ?? [],
      payers: payersByGroup.get(groupId) ?? [],
      splits: splitsByGroup.get(groupId) ?? [],
      settlements: settlementsByGroup.get(groupId) ?? [],
    };
    const netBalances = computeNetBalances(ledger);

    // My own position in this group — feeds both the headline rollup and
    // this group's row in the Groups breakdown.
    const myBalances = netBalances
      .filter((b) => b.memberId === myMemberId && b.amountCents !== 0)
      .map((b) => ({ currency: b.currency, amountCents: b.amountCents }));
    for (const b of myBalances) {
      myBalancesByCurrency.set(
        b.currency,
        (myBalancesByCurrency.get(b.currency) ?? 0) + b.amountCents,
      );
    }
    if (myBalances.length > 0) {
      groupItems.push({
        id: groupId,
        name,
        memberCount: groupMembersList.length,
        balances: myBalances.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
      });
    }

    // Pairwise-with-me balances (in the group's own mode), for the People breakdown.
    const counterparties = counterpartiesForGroup(
      { ...ledger, simplifyDebts: membership.simplifyDebts, netBalances },
      myMemberId,
    );
    for (const counterparty of counterparties) {
      const otherMember = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (!otherMember) continue;
      personRollupInput.push({
        personKey: personKeyFor(groupId, otherMember),
        currency: counterparty.currency,
        amountCents: counterparty.amountCents,
      });
    }

    // Shared-group counts, independent of how debts are routed.
    for (const member of groupMembersList) {
      if (member.id === myMemberId) continue;
      const personKey = personKeyFor(groupId, member);
      const set = sharedGroupsByPersonKey.get(personKey) ?? new Set<string>();
      set.add(groupId);
      sharedGroupsByPersonKey.set(personKey, set);
    }
  }

  const personBalances = rollupByPerson(personRollupInput).filter((p) => p.amountCents !== 0);

  const realUserIds = Array.from(
    new Set(personBalances.map((p) => p.personKey).filter((key) => !key.includes(':'))),
  );
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
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

  // "Spent" = my own share of active expenses (what I consumed), not what
  // I fronted as payer — no currency conversion needed for a purely
  // personal figure (SPEC.md §4, "Aggregation views").
  const myMemberIds = new Set(myMemberships.map((m) => m.myMemberId));
  const activeExpenseById = new Map(allExpenses.filter((e) => !e.deletedAt).map((e) => [e.id, e]));
  const nowTs = Math.floor(Date.now() / 1000);
  const nowDate = new Date(nowTs * 1000);
  const startOfMonth = Math.floor(
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1) / 1000,
  );
  const monthKeys = recentMonthKeys(nowTs, 6);
  const trendStart = Math.floor(
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 5, 1) / 1000,
  );

  const spentThisMonthByCurrency = new Map<string, number>();
  const spentAllTimeByCurrency = new Map<string, number>();
  const mySplitsThisMonth: {
    category: string | null;
    currency: string;
    shareAmountCents: number;
  }[] = [];
  const mySplitsInTrend: { occurredOn: number; currency: string; shareAmountCents: number }[] = [];
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
      mySplitsThisMonth.push({
        category: expense.category,
        currency: expense.currency,
        shareAmountCents: split.shareAmountCents,
      });
    }
    if (expense.occurredOn >= trendStart) {
      mySplitsInTrend.push({
        occurredOn: expense.occurredOn,
        currency: expense.currency,
        shareAmountCents: split.shareAmountCents,
      });
    }
  }

  const spendByCategory: OverviewCategoryItem[] = aggregateByCategory(mySplitsThisMonth)
    .map((t) => ({
      label: (t.category && CATEGORY_LABEL_BY_VALUE.get(t.category)) ?? 'General',
      currency: t.currency,
      amountCents: t.amountCents,
    }))
    .sort((a, b) => {
      const aPrimary = a.currency === primaryCurrency ? 0 : 1;
      const bPrimary = b.currency === primaryCurrency ? 0 : 1;
      return (
        aPrimary - bPrimary || a.currency.localeCompare(b.currency) || b.amountCents - a.amountCents
      );
    });

  const byPeriod = aggregateByPeriod(mySplitsInTrend, 'month');
  const trendCurrencies = Array.from(new Set(byPeriod.map((p) => p.currency))).sort((a, b) => {
    const aPrimary = a === primaryCurrency ? 0 : 1;
    const bPrimary = b === primaryCurrency ? 0 : 1;
    return aPrimary - bPrimary || a.localeCompare(b);
  });
  const monthlyTrend: OverviewMonthItem[] = trendCurrencies.flatMap((currency) =>
    monthKeys.map((monthKey) => ({
      monthKey,
      label: monthLabelFor(monthKey),
      currency,
      amountCents:
        byPeriod.find((p) => p.periodKey === monthKey && p.currency === currency)?.amountCents ?? 0,
    })),
  );

  groupItems.sort(
    (a, b) =>
      Math.abs(largestMagnitude(b.balances).amountCents) -
      Math.abs(largestMagnitude(a.balances).amountCents),
  );
  peopleItems.sort(
    (a, b) =>
      Math.abs(largestMagnitude(b.balances).amountCents) -
      Math.abs(largestMagnitude(a.balances).amountCents),
  );

  return {
    hasGroups: true,
    owed: sortByPrimaryCurrency(owed, primaryCurrency),
    owe: sortByPrimaryCurrency(owe, primaryCurrency),
    spentThisMonth: toSortedArray(spentThisMonthByCurrency, primaryCurrency),
    spentAllTime: toSortedArray(spentAllTimeByCurrency, primaryCurrency),
    activeGroupCount: myMemberships.filter((m) => m.archivedAt === null).length,
    closedGroupCount: myMemberships.filter((m) => m.archivedAt !== null).length,
    peopleWithBalanceCount: peopleItems.length,
    groups: groupItems,
    people: peopleItems,
    spendByCategory,
    monthlyTrend,
  };
}
