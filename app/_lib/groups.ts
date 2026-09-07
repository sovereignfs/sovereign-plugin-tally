'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  settlements,
} from '../_db/schema';
import {
  describeExpenseActivity,
  describeMyPosition,
  describeSettlementActivity,
  groupActivityByMonth,
  monthLabelFor,
  recentMonthKeys,
  type GroupActivityItem,
  type GroupActivityMonth,
} from './activity';
import {
  aggregateByCategory,
  aggregateByPeriod,
  computeNetBalances,
  counterpartiesForGroup,
  myPositionCents,
  suggestedPaymentsForGroup,
  type CurrencyAmount,
  type NetBalance,
} from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { pushTo } from './collections';
import type { ActionResult } from './context';
import { getContext, now, revalidateTallyViews } from './context';
import { isSupportedCurrency } from './currencies';
import { fetchMyGroupsData } from './group-data';
import { newId } from './ids';
import { hasOtherActiveOwner, requireGroupMember } from './membership';
import { resolveReceiptUrls } from './receipts';

export type { ActionResult };
export type { CurrencyAmount };

export interface GroupCounterpartyView {
  memberId: string;
  label: string;
  currency: string;
  amountCents: number;
}

export interface GroupListItem {
  id: string;
  name: string;
  defaultCurrency: string;
  archivedAt: number | null;
  memberCount: number;
  /** My own balance(s) in this group — empty means settled up. One entry
   *  per currency, sorted by |amount| descending (never blended — SPEC.md
   *  §4). */
  myBalances: CurrencyAmount[];
  /** Other members with a non-zero balance relative to me, sorted by
   *  |amount| descending — the per-group "who's not settled up" preview,
   *  in the group's own pairwise/simplified mode. */
  counterparties: GroupCounterpartyView[];
  /** Most recent expense or settlement (by entry date), for sorting. */
  lastActivityAt: number | null;
}

/**
 * Groups the current user is an active member of, sorted open-first, then
 * by most recent activity, then by name — never raw database order.
 */
export async function listGroupsForUser(): Promise<GroupListItem[]> {
  const { db, userId, tenantId } = await getContext();
  const {
    myMemberships,
    membersByGroup,
    expensesByGroup,
    payersByGroup,
    splitsByGroup,
    settlementsByGroup,
  } = await fetchMyGroupsData(db, userId, tenantId);

  if (myMemberships.length === 0) return [];

  const myBalancesByGroup = new Map<string, CurrencyAmount[]>();
  const rawCounterpartiesByGroup = new Map<
    string,
    { memberId: string; currency: string; amountCents: number }[]
  >();
  const lastActivityByGroup = new Map<string, number>();
  const realUserIds = new Set<string>();

  for (const membership of myMemberships) {
    const { groupId, myMemberId } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const ledger = {
      expenses: expensesByGroup.get(groupId) ?? [],
      payers: payersByGroup.get(groupId) ?? [],
      splits: splitsByGroup.get(groupId) ?? [],
      settlements: settlementsByGroup.get(groupId) ?? [],
    };

    const netBalances = computeNetBalances(ledger);
    const myBalances = netBalances
      .filter((b) => b.memberId === myMemberId && b.amountCents !== 0)
      .map((b) => ({ currency: b.currency, amountCents: b.amountCents }))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    myBalancesByGroup.set(groupId, myBalances);

    const counterparties = counterpartiesForGroup(
      { ...ledger, simplifyDebts: membership.simplifyDebts, netBalances },
      myMemberId,
    );
    for (const counterparty of counterparties) {
      pushTo(rawCounterpartiesByGroup, groupId, counterparty);
      const member = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (member?.kind === 'user' && member.userId) realUserIds.add(member.userId);
    }

    let latest = 0;
    for (const e of ledger.expenses) if (!e.deletedAt) latest = Math.max(latest, e.createdAt);
    for (const s of ledger.settlements) if (!s.deletedAt) latest = Math.max(latest, s.createdAt);
    if (latest > 0) lastActivityByGroup.set(groupId, latest);
  }

  const resolvedUsers =
    realUserIds.size > 0 ? await sdk.directory.resolveUsers({ ids: Array.from(realUserIds) }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  function labelForMember(groupId: string, memberId: string): string {
    const member = (membersByGroup.get(groupId) ?? []).find((m) => m.id === memberId);
    if (!member) return 'Unknown member';
    if (member.kind === 'user' && member.userId)
      return nameByUserId.get(member.userId) ?? 'Unknown member';
    return member.guestName ?? 'Guest';
  }

  const items: GroupListItem[] = myMemberships.map((m) => ({
    id: m.groupId,
    name: m.name,
    defaultCurrency: m.defaultCurrency,
    archivedAt: m.archivedAt,
    memberCount: (membersByGroup.get(m.groupId) ?? []).length,
    myBalances: myBalancesByGroup.get(m.groupId) ?? [],
    counterparties: (rawCounterpartiesByGroup.get(m.groupId) ?? [])
      .map((c) => ({
        memberId: c.memberId,
        label: labelForMember(m.groupId, c.memberId),
        currency: c.currency,
        amountCents: c.amountCents,
      }))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
    lastActivityAt: lastActivityByGroup.get(m.groupId) ?? null,
  }));

  const createdAtByGroup = new Map(myMemberships.map((m) => [m.groupId, m.createdAt]));
  items.sort((a, b) => {
    const aClosed = a.archivedAt !== null ? 1 : 0;
    const bClosed = b.archivedAt !== null ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    const aActivity = a.lastActivityAt ?? createdAtByGroup.get(a.id) ?? 0;
    const bActivity = b.lastActivityAt ?? createdAtByGroup.get(b.id) ?? 0;
    if (aActivity !== bActivity) return bActivity - aActivity;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export interface GroupMemberView {
  memberId: string;
  label: string;
  role: 'owner' | 'member';
  kind: 'user' | 'guest';
  /** Every currency this member has a non-zero balance in — never
   *  collapsed to one (a multi-currency group is the normal case). */
  balances: CurrencyAmount[];
}

export interface SuggestedPaymentView {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
}

export interface CategoryTotalView {
  label: string;
  currency: string;
  amountCents: number;
}

export interface MonthTotalView {
  monthKey: string;
  label: string;
  currency: string;
  amountCents: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  /** Epoch seconds, date-only semantics — null when unset (SPEC.md §3). */
  startDate: number | null;
  endDate: number | null;
  /** The group's "Simplify debts" setting — labels the Settle up section. */
  simplifyDebts: boolean;
  members: GroupMemberView[];
  balances: NetBalance[];
  /** My own balance summary for this group, one entry per currency. */
  myBalances: CurrencyAmount[];
  /** My active membership row's id — the expense form's default payer. */
  myMemberId: string | null;
  /** Suggested payments under the group's own mode (`suggestedPaymentsForGroup`). */
  suggestions: SuggestedPaymentView[];
  /** Month-grouped, described, merged expense + settlement timeline (UI-FLOW.md §4). */
  activity: GroupActivityMonth[];
  /** This group's own spend, per category and per month (last 6), per currency. */
  analytics: { byCategory: CategoryTotalView[]; byMonth: MonthTotalView[] };
  myRole: 'owner' | 'member' | null;
  /** Set by "Close group" (SPEC.md §7) — null while active. */
  archivedAt: number | null;
  /** True if the group has ever had an expense or settlement row, counting
   *  soft-deleted ones — SPEC.md §7's bright line between "Close" (any
   *  history) and "Delete" (none, ever). */
  hasHistory: boolean;
  hasOutstandingBalance: boolean;
  /** Why "Leave group" is disabled for the current user, or null if allowed. */
  leaveBlockedReason: string | null;
}

/**
 * Full detail for the `@detail/groups` slot. Throws `GroupAccessError` if
 * the current user isn't an active member — same guard every group-scoped
 * read/write in this plugin uses.
 */
export async function getGroupDetail(groupId: string): Promise<GroupDetail | null> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupMember(db, tenantId, userId, groupId);

  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  if (!group) return null;

  const members = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );

  const realUserIds = members
    .filter((m) => m.kind === 'user' && m.userId)
    .map((m) => m.userId)
    .filter((id): id is string => id !== null);
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  const labelByMemberId = new Map(
    members.map((m) => [
      m.id,
      m.kind === 'user'
        ? (nameByUserId.get(m.userId ?? '') ?? 'Unknown member')
        : (m.guestName ?? 'Guest'),
    ]),
  );
  const myMembership = members.find((m) => m.kind === 'user' && m.userId === userId) ?? null;
  const myMemberId = myMembership?.id ?? null;

  const groupExpenses = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amountCents: expenses.amountCents,
      currency: expenses.currency,
      category: expenses.category,
      occurredOn: expenses.occurredOn,
      createdAt: expenses.createdAt,
      notes: expenses.notes,
      splitMethod: expenses.splitMethod,
      deletedAt: expenses.deletedAt,
      receiptStorageKey: expenses.receiptStorageKey,
    })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
  const activeExpenses = groupExpenses.filter((e) => !e.deletedAt);
  const expenseIds = groupExpenses.map((e) => e.id);

  const [groupPayers, groupSplits, groupSettlements] = await Promise.all([
    expenseIds.length > 0
      ? db
          .select({
            expenseId: expensePayers.expenseId,
            memberId: expensePayers.memberId,
            amountCents: expensePayers.amountCents,
          })
          .from(expensePayers)
          .where(inArray(expensePayers.expenseId, expenseIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db
          .select({
            expenseId: expenseSplits.expenseId,
            memberId: expenseSplits.memberId,
            shareAmountCents: expenseSplits.shareAmountCents,
            shareUnits: expenseSplits.shareUnits,
          })
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, expenseIds))
      : Promise.resolve([]),
    db
      .select({
        id: settlements.id,
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        currency: settlements.currency,
        note: settlements.note,
        settledOn: settlements.settledOn,
        createdAt: settlements.createdAt,
        deletedAt: settlements.deletedAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId)),
  ]);
  const activeSettlements = groupSettlements.filter((s) => !s.deletedAt);

  const ledger = {
    expenses: groupExpenses,
    payers: groupPayers,
    splits: groupSplits,
    settlements: groupSettlements,
  };
  const balances = computeNetBalances(ledger);
  const balancesByMember = new Map<string, CurrencyAmount[]>();
  for (const b of balances) {
    if (b.amountCents === 0) continue;
    pushTo(balancesByMember, b.memberId, { currency: b.currency, amountCents: b.amountCents });
  }
  for (const list of balancesByMember.values()) {
    list.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
  }

  const memberViews: GroupMemberView[] = members.map((m) => ({
    memberId: m.id,
    label: labelByMemberId.get(m.id) ?? 'Unknown member',
    role: m.role === 'owner' ? 'owner' : 'member',
    kind: m.kind === 'guest' ? 'guest' : 'user',
    balances: balancesByMember.get(m.id) ?? [],
  }));
  const myBalances = myMemberId ? (balancesByMember.get(myMemberId) ?? []) : [];

  const suggestions = suggestedPaymentsForGroup({
    ...ledger,
    simplifyDebts: group.simplifyDebts,
    netBalances: balances,
  });

  const payersByExpenseId = new Map<string, { memberId: string; amountCents: number }[]>();
  for (const p of groupPayers) pushTo(payersByExpenseId, p.expenseId, p);
  const splitsByExpenseId = new Map<
    string,
    { memberId: string; shareAmountCents: number; shareUnits: number | null }[]
  >();
  for (const s of groupSplits) pushTo(splitsByExpenseId, s.expenseId, s);

  const receiptUrlByExpenseId = await resolveReceiptUrls(
    activeExpenses.map((e) => ({ id: e.id, receiptStorageKey: e.receiptStorageKey })),
  );

  const expenseActivity: GroupActivityItem[] = activeExpenses.map((e) => {
    const payers = payersByExpenseId.get(e.id) ?? [];
    const splits = splitsByExpenseId.get(e.id) ?? [];
    const myPaid = payers
      .filter((p) => p.memberId === myMemberId)
      .reduce((sum, p) => sum + p.amountCents, 0);
    const mySplit = splits.find((s) => s.memberId === myMemberId);
    const involved = myPaid > 0 || mySplit !== undefined;
    return {
      id: e.id,
      type: 'expense',
      occurredOn: e.occurredOn,
      recordedAt: e.createdAt,
      categoryLabel: (e.category && CATEGORY_LABEL_BY_VALUE.get(e.category)) ?? 'General',
      description: describeExpenseActivity({
        payerLabel: describePayers(payers, labelByMemberId, myMemberId),
        isPayerMe: payers.length === 1 && payers[0]?.memberId === myMemberId,
        amountCents: e.amountCents,
        currency: e.currency,
        description: e.description,
      }),
      myPosition: describeMyPosition({
        positionCents: myPositionCents(myPaid, mySplit?.shareAmountCents ?? 0),
        involved,
        currency: e.currency,
      }),
      note: null,
      notes: e.notes,
      amountCents: e.amountCents,
      currency: e.currency,
      receiptUrl: receiptUrlByExpenseId.get(e.id) ?? null,
      groupId,
      expense: {
        expenseId: e.id,
        groupId,
        description: e.description,
        amountCents: e.amountCents,
        currency: e.currency,
        category: e.category,
        occurredOn: e.occurredOn,
        notes: e.notes,
        splitMethod: e.splitMethod,
        payers: payers.map((p) => ({ memberId: p.memberId, amountCents: p.amountCents })),
        participants: splits.map((s) => ({
          memberId: s.memberId,
          shareAmountCents: s.shareAmountCents,
          shareUnits: s.shareUnits,
        })),
        hasReceipt: e.receiptStorageKey !== null,
      },
    };
  });

  const settlementActivity: GroupActivityItem[] = activeSettlements.map((s) => ({
    id: s.id,
    type: 'settlement',
    occurredOn: s.settledOn,
    recordedAt: s.createdAt,
    categoryLabel: 'Settlement',
    description: describeSettlementActivity({
      fromLabel: labelByMemberId.get(s.fromMemberId) ?? 'Someone',
      isFromMe: s.fromMemberId === myMemberId,
      toLabel: labelByMemberId.get(s.toMemberId) ?? 'someone',
      isToMe: s.toMemberId === myMemberId,
      amountCents: s.amountCents,
      currency: s.currency,
    }),
    note: s.note,
    amountCents: s.amountCents,
    currency: s.currency,
    groupId,
  }));

  const activity = groupActivityByMonth(
    [...expenseActivity, ...settlementActivity].sort(
      (a, b) => b.occurredOn - a.occurredOn || b.recordedAt - a.recordedAt,
    ),
  );

  // Group-level analytics: the whole group's spend (expense totals), not
  // the reader's share — Overview owns the personal "my share" view.
  const nowTs = now();
  const monthKeys = recentMonthKeys(nowTs, 6);
  const monthWindowStart =
    Date.UTC(Number(monthKeys[0]?.slice(0, 4)), Number(monthKeys[0]?.slice(5, 7)) - 1, 1) / 1000;
  const byCategory = aggregateByCategory(
    activeExpenses.map((e) => ({
      category: e.category,
      currency: e.currency,
      shareAmountCents: e.amountCents,
    })),
  )
    .map((t) => ({
      label: (t.category && CATEGORY_LABEL_BY_VALUE.get(t.category)) ?? 'General',
      currency: t.currency,
      amountCents: t.amountCents,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
  const byPeriod = aggregateByPeriod(
    activeExpenses
      .filter((e) => e.occurredOn >= monthWindowStart)
      .map((e) => ({
        occurredOn: e.occurredOn,
        currency: e.currency,
        shareAmountCents: e.amountCents,
      })),
    'month',
  );
  const currenciesInWindow = Array.from(new Set(byPeriod.map((p) => p.currency)));
  const byMonth: MonthTotalView[] = currenciesInWindow.flatMap((currency) =>
    monthKeys.map((monthKey) => ({
      monthKey,
      label: monthLabelFor(monthKey),
      currency,
      amountCents:
        byPeriod.find((p) => p.periodKey === monthKey && p.currency === currency)?.amountCents ?? 0,
    })),
  );

  const myRole: GroupDetail['myRole'] = myMembership
    ? myMembership.role === 'owner'
      ? 'owner'
      : 'member'
    : null;
  const hasOutstandingBalance = balances.some((b) => b.amountCents !== 0);

  let leaveBlockedReason: string | null = null;
  if (!myMemberId) {
    leaveBlockedReason = 'You are not a member of this group.';
  } else if (myBalances.length > 0) {
    leaveBlockedReason = 'Settle up your balance before leaving this group.';
  } else if (
    myRole === 'owner' &&
    !(await hasOtherActiveOwner(db, tenantId, groupId, myMemberId))
  ) {
    leaveBlockedReason = 'Make someone else an owner before leaving.';
  }

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    defaultCurrency: group.defaultCurrency,
    startDate: group.startDate,
    endDate: group.endDate,
    simplifyDebts: group.simplifyDebts,
    members: memberViews,
    balances,
    myBalances,
    myMemberId,
    suggestions,
    activity,
    analytics: { byCategory, byMonth },
    myRole,
    archivedAt: group.archivedAt,
    // groupExpenses/groupSettlements are unfiltered by deletedAt — a
    // soft-deleted row is still real history a "Delete" must never discard.
    hasHistory: groupExpenses.length > 0 || groupSettlements.length > 0,
    hasOutstandingBalance,
    leaveBlockedReason,
  };
}

/** "Alex", "You and Alex", "Alex and 2 others" — the payer phrase for a
 *  single- or multi-payer expense. */
function describePayers(
  payers: { memberId: string }[],
  labelByMemberId: Map<string, string>,
  myMemberId: string | null,
): string {
  const labels = payers.map((p) =>
    p.memberId === myMemberId ? 'You' : (labelByMemberId.get(p.memberId) ?? 'Someone'),
  );
  if (labels.length === 0) return 'Someone';
  if (labels.length === 1) return labels[0] ?? 'Someone';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]} and ${labels.length - 1} others`;
}

export type CreateGroupResult =
  { ok: true; message: string; groupId: string } | { ok: false; error: string };

/** Creator becomes the sole `owner` member row (SPEC.md §6) — both rows in
 *  one transaction, so a group can never exist without an owner. */
export async function createGroupAction(
  _prevState: CreateGroupResult | null,
  formData: FormData,
): Promise<CreateGroupResult> {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  const defaultCurrency = String(formData.get('defaultCurrency') ?? '')
    .trim()
    .toUpperCase();
  const descriptionInput = String(formData.get('description') ?? '').trim();
  const simplifyDebts = String(formData.get('simplifyDebts') ?? '') === 'on';

  if (!name) return { ok: false, error: 'Enter a group name.' };
  if (name.length > 100) return { ok: false, error: 'Keep the group name under 100 characters.' };
  if (!isSupportedCurrency(defaultCurrency)) return { ok: false, error: 'Choose a currency.' };

  const groupId = newId();
  const timestamp = now();

  await db.transaction(async (tx) => {
    await tx.insert(groups).values({
      id: groupId,
      tenantId,
      name,
      description: descriptionInput || null,
      defaultCurrency,
      simplifyDebts,
      createdByUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(groupMembers).values({
      id: newId(),
      groupId,
      tenantId,
      kind: 'user',
      userId,
      role: 'owner',
      joinedAt: timestamp,
    });
  });

  void sdk.activity.log({
    action: 'group.created',
    targetType: 'group',
    targetId: groupId,
    summary: `Created "${name}"`,
  });

  revalidateTallyViews();
  return { ok: true, message: `Created "${name}".`, groupId };
}
