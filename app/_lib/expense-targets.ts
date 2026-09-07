'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import { groupMembers, groups } from '../_db/schema';
import { getContext } from './context';

export interface ExpenseTargetMember {
  memberId: string;
  label: string;
}

/** One open group the current user can add an expense to, with everything
 *  the expense form needs to render — fetched lazily by the global
 *  "Add expense" launcher (UI-FLOW.md §2) when it opens, not on every page. */
export interface ExpenseTarget {
  groupId: string;
  name: string;
  defaultCurrency: string;
  myMemberId: string;
  members: ExpenseTargetMember[];
}

export async function listExpenseTargets(): Promise<ExpenseTarget[]> {
  const { db, userId, tenantId } = await getContext();

  const myMemberships = await db
    .select({
      groupId: groupMembers.groupId,
      myMemberId: groupMembers.id,
      name: groups.name,
      defaultCurrency: groups.defaultCurrency,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
        eq(groups.tenantId, tenantId),
        isNull(groups.archivedAt),
      ),
    );
  if (myMemberships.length === 0) return [];

  const groupIds = myMemberships.map((m) => m.groupId);
  const members = await db
    .select()
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, groupIds), isNull(groupMembers.leftAt)));

  const realUserIds = Array.from(
    new Set(members.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  return myMemberships
    .map((m) => ({
      groupId: m.groupId,
      name: m.name,
      defaultCurrency: m.defaultCurrency,
      myMemberId: m.myMemberId,
      members: members
        .filter((member) => member.groupId === m.groupId)
        .map((member) => ({
          memberId: member.id,
          label:
            member.kind === 'user'
              ? (nameByUserId.get(member.userId ?? '') ?? 'Unknown member')
              : (member.guestName ?? 'Guest'),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
