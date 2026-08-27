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
import { computeNetBalances, type NetBalance } from './balances';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { newId } from './ids';
import { requireGroupMember } from './membership';

export type { ActionResult };

export interface GroupListItem {
  id: string;
  name: string;
  defaultCurrency: string;
  archivedAt: number | null;
}

/** Groups the current user is an active member of (SPEC.md §9's group list). */
export async function listGroupsForUser(): Promise<GroupListItem[]> {
  const { db, userId, tenantId } = await getContext();
  return db
    .select({
      id: groups.id,
      name: groups.name,
      defaultCurrency: groups.defaultCurrency,
      archivedAt: groups.archivedAt,
    })
    .from(groups)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    )
    .where(eq(groups.tenantId, tenantId));
}

export interface GroupMemberView {
  memberId: string;
  label: string;
  role: 'owner' | 'member';
  kind: 'user' | 'guest';
}

export interface GroupExpenseListItem {
  id: string;
  description: string;
  amountCents: number;
  currency: string;
  occurredOn: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  members: GroupMemberView[];
  balances: NetBalance[];
  recentExpenses: GroupExpenseListItem[];
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

  const groupExpenses = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amountCents: expenses.amountCents,
      currency: expenses.currency,
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
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        currency: settlements.currency,
        deletedAt: settlements.deletedAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId)),
  ]);

  const balances = computeNetBalances({
    expenses: groupExpenses,
    payers: groupPayers,
    splits: groupSplits,
    settlements: groupSettlements,
  });

  const recentExpenses: GroupExpenseListItem[] = activeExpenses
    .slice()
    .sort((a, b) => b.occurredOn - a.occurredOn)
    .map((e) => ({
      id: e.id,
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      occurredOn: e.occurredOn,
    }));

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    defaultCurrency: group.defaultCurrency,
    members: memberViews,
    balances,
    recentExpenses,
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

  if (!name) return { ok: false, error: 'Enter a group name.' };
  if (!CURRENCY_CODE_RE.test(defaultCurrency)) return { ok: false, error: 'Choose a currency.' };

  const groupId = newId();
  const timestamp = now();

  await db.insert(groups).values({
    id: groupId,
    tenantId,
    name,
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

  revalidatePath('/tally/groups');
  return { ok: true, message: `Created "${name}".` };
}
