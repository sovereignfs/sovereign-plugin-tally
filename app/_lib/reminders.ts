'use server';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  reminders,
  settlements,
} from '../_db/schema';
import { formatMoney } from './activity';
import { computeNetBalances, resolveCounterparties } from './balances';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { newId } from './ids';
import { requireGroupMember } from './membership';

export type { ActionResult };

const REMINDER_COOLDOWN_SECONDS = 24 * 60 * 60;

/**
 * Inbox's `[Remind]` action (UI-FLOW.md §5, SPEC.md §6) — nudges a group
 * member who currently owes the actor money. `group-view` gated (any
 * active member, not `group-manage` — matches SPEC.md §6's action table
 * exactly, unlike the owner-only actions in `group-settings.ts`).
 */
export async function sendReminderAction(
  groupId: string,
  targetMemberId: string,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupMember(db, tenantId, userId, groupId);

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  if (!group) return { ok: false, error: 'Group not found.' };

  const [myMembership] = await db
    .select({ id: groupMembers.id })
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
  const myMemberId = myMembership?.id;
  if (!myMemberId) return { ok: false, error: 'You are not a member of this group.' };
  if (myMemberId === targetMemberId) return { ok: false, error: "You can't remind yourself." };

  const [target] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.id, targetMemberId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );
  if (!target) return { ok: false, error: 'Member not found.' };
  if (target.kind !== 'user' || !target.userId) {
    return { ok: false, error: "Guests can't be reminded — they have no account to notify." };
  }

  // Re-derive the real balance server-side rather than trusting the
  // client — same discipline as every other action here (e.g.
  // `createExpenseAction`'s re-checked split sums).
  const groupExpenses = await db
    .select({
      id: expenses.id,
      currency: expenses.currency,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
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

  const netBalances = computeNetBalances({
    expenses: groupExpenses,
    payers: groupPayers,
    splits: groupSplits,
    settlements: groupSettlements,
  });
  const counterparties = resolveCounterparties(netBalances, myMemberId);
  const owedByTarget = counterparties.find((c) => c.memberId === targetMemberId);
  if (!owedByTarget || owedByTarget.amountCents >= 0) {
    return { ok: false, error: 'This member does not currently owe you a balance.' };
  }

  const [lastReminder] = await db
    .select({ sentAt: reminders.sentAt })
    .from(reminders)
    .where(
      and(
        eq(reminders.groupId, groupId),
        eq(reminders.fromMemberId, myMemberId),
        eq(reminders.toMemberId, targetMemberId),
      ),
    )
    .orderBy(desc(reminders.sentAt))
    .limit(1);
  const nowTs = now();
  if (lastReminder && nowTs - lastReminder.sentAt < REMINDER_COOLDOWN_SECONDS) {
    return { ok: false, error: 'You already sent a reminder to this member in the last 24 hours.' };
  }

  await db.insert(reminders).values({
    id: newId(),
    groupId,
    tenantId,
    fromMemberId: myMemberId,
    toMemberId: targetMemberId,
    sentAt: nowTs,
  });

  void sdk.activity.log({
    action: 'group.reminder_sent',
    targetType: 'group',
    targetId: groupId,
    subjectUserId: target.userId,
    summary: `Sent a payment reminder in "${group.name}"`,
  });

  const [actor] = await sdk.directory.resolveUsers({ ids: [userId] });
  const amountOwed = formatMoney(-owedByTarget.amountCents, owedByTarget.currency);
  try {
    await sdk.notifications.send(
      {
        recipientUserId: target.userId,
        title: 'Payment reminder',
        body: `${actor?.name ?? actor?.email ?? 'A group member'} reminded you — you owe ${amountOwed} in "${group.name}".`,
        url: `/tally/groups?g=${groupId}`,
      },
      await headers(),
    );
  } catch {
    // Best-effort — the reminder record + rate limit already succeeded
    // regardless of whether the notification itself lands.
  }

  revalidatePath('/tally/inbox');
  return { ok: true, message: 'Reminder sent.' };
}
