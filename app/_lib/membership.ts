import { and, eq, isNull } from 'drizzle-orm';
import { expensePayers, expenseSplits, expenses, groupMembers, settlements } from '../_db/schema';
import { computeNetBalances } from './balances';
import type { Db } from './context';
import { canManageGroup, isGroupMemberRole, type GroupMemberRole } from './group-rules';

/**
 * Group authorization (SPEC.md §5). Real precedent check before building
 * this: neither Docs nor Sheets uses `sdk.authz`'s resource-grant
 * mechanism at all — both instead resolve a role via a direct query
 * against their own membership table (`resolveDocumentRole`/
 * `resolveFolderRole` in `documents.ts`) and check it inline in each
 * server action. This file follows that same proven pattern rather than
 * `sdk.authz.provide()`/`hasGrant()`, which — while a real, implemented
 * SDK surface — has no actual usage anywhere in this app family to
 * validate against.
 */

export class GroupAccessError extends Error {
  constructor(message = 'You do not have access to this group.') {
    super(message);
    this.name = 'GroupAccessError';
  }
}

/** Resolves the current user's role via an active (not-left) `group_members` row. */
export async function resolveGroupRole(
  db: Db,
  tenantId: string,
  userId: string,
  groupId: string,
): Promise<GroupMemberRole | null> {
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    );
  if (!membership || !isGroupMemberRole(membership.role)) return null;
  return membership.role;
}

/** Throws unless the user is an active member of the group (any role). Returns the role. */
export async function requireGroupMember(
  db: Db,
  tenantId: string,
  userId: string,
  groupId: string,
): Promise<GroupMemberRole> {
  const role = await resolveGroupRole(db, tenantId, userId, groupId);
  if (!role) throw new GroupAccessError();
  return role;
}

/** Throws unless the user is the group's owner. */
export async function requireGroupManage(
  db: Db,
  tenantId: string,
  userId: string,
  groupId: string,
): Promise<void> {
  const role = await resolveGroupRole(db, tenantId, userId, groupId);
  if (!canManageGroup(role)) {
    throw new GroupAccessError('Only the group owner can do this.');
  }
}

/**
 * True if at least one *other* active owner exists besides
 * `excludeMemberId` — the last-owner protection required before removing
 * or demoting an owner (SPEC.md §5).
 */
export async function hasOtherActiveOwner(
  db: Db,
  tenantId: string,
  groupId: string,
  excludeMemberId: string,
): Promise<boolean> {
  const owners = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.role, 'owner'),
        isNull(groupMembers.leftAt),
      ),
    );
  return owners.some((owner) => owner.id !== excludeMemberId);
}

/**
 * True if `memberId` has any non-zero balance, in any currency, within
 * this group — blocks leaving/removing a member with an outstanding
 * balance (SPEC.md §5). Deliberately scoped to just this member's own
 * payer/split/settlement rows rather than the whole group's, since
 * `computeNetBalances` only ever produces an entry for members present in
 * its input.
 */
export async function hasNonZeroBalance(db: Db, groupId: string, memberId: string): Promise<boolean> {
  const [groupExpenses, memberPayers, memberSplits, groupSettlements] = await Promise.all([
    db
      .select({ id: expenses.id, currency: expenses.currency, deletedAt: expenses.deletedAt })
      .from(expenses)
      .where(eq(expenses.groupId, groupId)),
    db
      .select({
        expenseId: expensePayers.expenseId,
        memberId: expensePayers.memberId,
        amountCents: expensePayers.amountCents,
      })
      .from(expensePayers)
      .where(eq(expensePayers.memberId, memberId)),
    db
      .select({
        expenseId: expenseSplits.expenseId,
        memberId: expenseSplits.memberId,
        shareAmountCents: expenseSplits.shareAmountCents,
      })
      .from(expenseSplits)
      .where(eq(expenseSplits.memberId, memberId)),
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
    payers: memberPayers,
    splits: memberSplits,
    settlements: groupSettlements.filter(
      (s) => s.fromMemberId === memberId || s.toMemberId === memberId,
    ),
  });
  return balances.some((b) => b.memberId === memberId && b.amountCents !== 0);
}
