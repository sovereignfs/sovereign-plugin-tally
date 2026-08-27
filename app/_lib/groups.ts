'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
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
  describeSettlementActivity,
  groupActivityByMonth,
  type GroupActivityItem,
  type GroupActivityMonth,
} from './activity';
import {
  computeNetBalances,
  resolveCounterparties,
  type CurrencyAmount,
  type NetBalance,
} from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { pushTo } from './collections';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { fetchMyGroupsData } from './group-data';
import { newId } from './ids';
import { requireGroupMember } from './membership';

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
   *  §4; see `overview.ts`'s `OverviewGroupItem` for why this can't
   *  collapse to a single dominant entry). */
  myBalances: CurrencyAmount[];
  /** Other members with a non-zero balance relative to me, sorted by
   *  |amount| descending — the per-group "who's not settled up" preview
   *  (Splitwise's own Groups list shows the same thing per group tile). */
  counterparties: GroupCounterpartyView[];
}

/**
 * Groups the current user is an active member of, each with their own
 * balance and a preview of which other members aren't settled up with
 * them (SPEC.md §9's group list). Same per-group `computeNetBalances` +
 * `resolveCounterparties` pipeline `overview.ts`'s `getOverviewData` uses,
 * just not rolled up across groups.
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
  const realUserIds = new Set<string>();

  for (const membership of myMemberships) {
    const { groupId, myMemberId } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];

    const netBalances = computeNetBalances({
      expenses: expensesByGroup.get(groupId) ?? [],
      payers: payersByGroup.get(groupId) ?? [],
      splits: splitsByGroup.get(groupId) ?? [],
      settlements: settlementsByGroup.get(groupId) ?? [],
    });

    const myBalances = netBalances
      .filter((b) => b.memberId === myMemberId && b.amountCents !== 0)
      .map((b) => ({ currency: b.currency, amountCents: b.amountCents }))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    myBalancesByGroup.set(groupId, myBalances);

    for (const counterparty of resolveCounterparties(netBalances, myMemberId)) {
      pushTo(rawCounterpartiesByGroup, groupId, counterparty);
      const member = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (member?.kind === 'user' && member.userId) realUserIds.add(member.userId);
    }
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

  return myMemberships.map((m) => ({
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
  }));
}

export interface GroupMemberView {
  memberId: string;
  label: string;
  role: 'owner' | 'member';
  kind: 'user' | 'guest';
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  members: GroupMemberView[];
  balances: NetBalance[];
  /** My own balance summary for this group, one entry per currency (see
   *  `overview.ts`'s `OverviewGroupItem` for why this can't collapse to a
   *  single dominant entry). */
  myBalances: CurrencyAmount[];
  /** Month-grouped, described, merged expense + settlement timeline
   *  (UI-FLOW.md §4). */
  activity: GroupActivityMonth[];
  /** Null if the current user isn't an active `kind = 'user'` member (can't
   *  happen given `requireGroupMember`'s guard above, but a guest-only
   *  caller has no session to begin with). Gates owner-only detail-column
   *  controls (Group settings) without a second query. */
  myRole: 'owner' | 'member' | null;
  /** Set by "Close group" (SPEC.md §7) — null while active. */
  archivedAt: number | null;
  /** True if the group has ever had an expense or settlement row, counting
   *  soft-deleted ones — SPEC.md §7's bright line between "Close" (any
   *  history) and "Delete" (none, ever). Gates which of the two
   *  detail-column lifecycle CTAs renders. */
  hasHistory: boolean;
}

/**
 * Full detail for the `@detail/groups` slot: the group, its active
 * members (resolved to display names via `sdk.directory`), and real
 * balances (`app/_lib/balances.ts`, SPEC.md §4). Throws `GroupAccessError`
 * if the current user isn't an active member — same guard every
 * group-scoped read/write in this plugin uses.
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

  const memberViews: GroupMemberView[] = members.map((m) => ({
    memberId: m.id,
    label:
      m.kind === 'user'
        ? (nameByUserId.get(m.userId ?? '') ?? 'Unknown member')
        : (m.guestName ?? 'Guest'),
    role: m.role === 'owner' ? 'owner' : 'member',
    kind: m.kind === 'guest' ? 'guest' : 'user',
  }));
  const labelByMemberId = new Map(memberViews.map((m) => [m.memberId, m.label]));
  const myMemberId = members.find((m) => m.kind === 'user' && m.userId === userId)?.id ?? null;

  const groupExpenses = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amountCents: expenses.amountCents,
      currency: expenses.currency,
      category: expenses.category,
      occurredOn: expenses.occurredOn,
      deletedAt: expenses.deletedAt,
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
        deletedAt: settlements.deletedAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId)),
  ]);
  const activeSettlements = groupSettlements.filter((s) => !s.deletedAt);

  const balances = computeNetBalances({
    expenses: groupExpenses,
    payers: groupPayers,
    splits: groupSplits,
    settlements: groupSettlements,
  });
  const myBalances: CurrencyAmount[] = myMemberId
    ? balances
        .filter((b) => b.memberId === myMemberId && b.amountCents !== 0)
        .map((b) => ({ currency: b.currency, amountCents: b.amountCents }))
        .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))
    : [];

  // Single payer per expense in v1 (SPEC.md §3) — the first payer row is
  // always the only one.
  const payerMemberIdByExpenseId = new Map(groupPayers.map((p) => [p.expenseId, p.memberId]));

  const expenseActivity: GroupActivityItem[] = activeExpenses.map((e) => {
    const payerMemberId = payerMemberIdByExpenseId.get(e.id) ?? null;
    const payerLabel = (payerMemberId && labelByMemberId.get(payerMemberId)) ?? 'Someone';
    return {
      id: e.id,
      type: 'expense',
      occurredOn: e.occurredOn,
      categoryLabel: (e.category && CATEGORY_LABEL_BY_VALUE.get(e.category)) ?? 'General',
      description: describeExpenseActivity({
        payerLabel,
        isPayerMe: payerMemberId === myMemberId,
        amountCents: e.amountCents,
        currency: e.currency,
        description: e.description,
      }),
      note: null,
      amountCents: e.amountCents,
      currency: e.currency,
    };
  });

  const settlementActivity: GroupActivityItem[] = activeSettlements.map((s) => ({
    id: s.id,
    type: 'settlement',
    occurredOn: s.settledOn,
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
  }));

  const activity = groupActivityByMonth(
    [...expenseActivity, ...settlementActivity].sort((a, b) => b.occurredOn - a.occurredOn),
  );

  const myRole = myMemberId
    ? (memberViews.find((m) => m.memberId === myMemberId)?.role ?? null)
    : null;

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    defaultCurrency: group.defaultCurrency,
    members: memberViews,
    balances,
    myBalances,
    activity,
    myRole,
    archivedAt: group.archivedAt,
    // groupExpenses/groupSettlements are unfiltered by deletedAt — a
    // soft-deleted row is still real history a "Delete" must never discard.
    hasHistory: groupExpenses.length > 0 || groupSettlements.length > 0,
  };
}

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** Creator becomes the sole `owner` member row (SPEC.md §6). */
export async function createGroupAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  const defaultCurrency = String(formData.get('defaultCurrency') ?? '')
    .trim()
    .toUpperCase();
  const descriptionInput = String(formData.get('description') ?? '').trim();

  if (!name) return { ok: false, error: 'Enter a group name.' };
  if (!CURRENCY_CODE_RE.test(defaultCurrency)) return { ok: false, error: 'Choose a currency.' };

  const groupId = newId();
  const timestamp = now();

  await db.insert(groups).values({
    id: groupId,
    tenantId,
    name,
    description: descriptionInput || null,
    defaultCurrency,
    createdByUserId: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(groupMembers).values({
    id: newId(),
    groupId,
    tenantId,
    kind: 'user',
    userId,
    role: 'owner',
    joinedAt: timestamp,
  });

  void sdk.activity.log({
    action: 'group.created',
    targetType: 'group',
    targetId: groupId,
    summary: `Created "${name}"`,
  });

  revalidatePath('/tally/groups');
  return { ok: true, message: `Created "${name}".` };
}
