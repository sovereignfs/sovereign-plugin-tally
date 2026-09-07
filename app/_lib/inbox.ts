import { and, eq, inArray } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import { reminders } from '../_db/schema';
import {
  describeExpenseActivity,
  describeMyPosition,
  describeSettlementActivity,
  type GroupActivityItem,
} from './activity';
import { computeNetBalances, counterpartiesForGroup, myPositionCents } from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { getContext } from './context';
import { fetchMyGroupsData, type MemberRow } from './group-data';

/**
 * Inbox (UI-FLOW.md §5) — one merged, reverse-chronological feed: plain
 * activity rows (every expense/settlement across every group) plus the
 * two actionable row kinds the spec's mockup shows inline — a bounced
 * guest invite (`[Resend]`) and an unpaid balance (`[Remind]`).
 *
 * Every item carries `recordedAt` — when it was *entered*, not the
 * user-chosen expense date — and the feed sorts and "2h ago"s by that: a
 * backdated expense added today is still news today. The row's own
 * description still shows the expense date via the group feed.
 */

const REMINDER_COOLDOWN_SECONDS = 24 * 60 * 60;

export type InboxItem =
  | ({ kind: 'activity' } & GroupActivityItem)
  | {
      kind: 'bounced_invite';
      id: string;
      groupId: string;
      groupName: string;
      memberId: string;
      guestName: string;
      recordedAt: number;
    }
  | {
      kind: 'balance_reminder';
      id: string;
      groupId: string;
      groupName: string;
      memberId: string;
      counterpartyLabel: string;
      amountCents: number;
      currency: string;
      recordedAt: number;
    };

export interface InboxData {
  hasGroups: boolean;
  /** Sorted most-recently-recorded first. Every item's `groupName` is set
   *  (unlike the single-group feed) since this spans every group at once. */
  items: InboxItem[];
}

export async function getInboxFeed(): Promise<InboxData> {
  const { db, userId, tenantId } = await getContext();
  const {
    myMemberships,
    membersByGroup,
    expensesByGroup,
    payersByGroup,
    splitsByGroup,
    settlementsByGroup,
  } = await fetchMyGroupsData(db, userId, tenantId);

  if (myMemberships.length === 0) return { hasGroups: false, items: [] };

  const allMembers = Array.from(membersByGroup.values()).flat();
  const realUserIds = Array.from(
    new Set(allMembers.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));
  function labelForMember(member: MemberRow): string {
    if (member.kind === 'user') return nameByUserId.get(member.userId ?? '') ?? 'Unknown member';
    return member.guestName ?? 'Guest';
  }

  // My own member id, per group I'm active in — every reminder I've ever
  // sent has `fromMemberId` in this set (a `group_members.id` belongs to
  // exactly one group, so no need to also key the cooldown lookup by
  // group id).
  const myMemberIds = myMemberships.map((m) => m.myMemberId);
  const recentReminderRows =
    myMemberIds.length > 0
      ? await db
          .select({ toMemberId: reminders.toMemberId, sentAt: reminders.sentAt })
          .from(reminders)
          .where(
            and(eq(reminders.tenantId, tenantId), inArray(reminders.fromMemberId, myMemberIds)),
          )
      : [];
  const lastReminderSentAtByTarget = new Map<string, number>();
  for (const row of recentReminderRows) {
    const existing = lastReminderSentAtByTarget.get(row.toMemberId);
    if (!existing || row.sentAt > existing)
      lastReminderSentAtByTarget.set(row.toMemberId, row.sentAt);
  }
  const nowTs = Math.floor(Date.now() / 1000);
  function onReminderCooldown(targetMemberId: string): boolean {
    const lastSentAt = lastReminderSentAtByTarget.get(targetMemberId);
    return lastSentAt !== undefined && nowTs - lastSentAt < REMINDER_COOLDOWN_SECONDS;
  }

  const items: InboxItem[] = [];

  for (const membership of myMemberships) {
    const { groupId, myMemberId, name, myRole, simplifyDebts } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const labelByMemberId = new Map(groupMembersList.map((m) => [m.id, labelForMember(m)]));

    const groupExpenses = expensesByGroup.get(groupId) ?? [];
    const groupPayers = payersByGroup.get(groupId) ?? [];
    const groupSplits = splitsByGroup.get(groupId) ?? [];
    const groupSettlements = settlementsByGroup.get(groupId) ?? [];
    const payersByExpenseId = new Map<string, { memberId: string; amountCents: number }[]>();
    for (const p of groupPayers) {
      const list = payersByExpenseId.get(p.expenseId);
      if (list) list.push(p);
      else payersByExpenseId.set(p.expenseId, [p]);
    }
    const splitsByExpenseId = new Map<string, { memberId: string; shareAmountCents: number }[]>();
    for (const s of groupSplits) {
      const list = splitsByExpenseId.get(s.expenseId);
      if (list) list.push(s);
      else splitsByExpenseId.set(s.expenseId, [s]);
    }

    let latestRecordedInGroup = membership.createdAt;

    for (const e of groupExpenses) {
      if (e.deletedAt) continue;
      latestRecordedInGroup = Math.max(latestRecordedInGroup, e.createdAt);
      const payers = payersByExpenseId.get(e.id) ?? [];
      const splits = splitsByExpenseId.get(e.id) ?? [];
      const payerLabels = payers.map((p) =>
        p.memberId === myMemberId ? 'You' : (labelByMemberId.get(p.memberId) ?? 'Someone'),
      );
      const payerLabel =
        payerLabels.length <= 1
          ? (payerLabels[0] ?? 'Someone')
          : payerLabels.length === 2
            ? `${payerLabels[0]} and ${payerLabels[1]}`
            : `${payerLabels[0]} and ${payerLabels.length - 1} others`;
      const myPaid = payers
        .filter((p) => p.memberId === myMemberId)
        .reduce((sum, p) => sum + p.amountCents, 0);
      const mySplit = splits.find((s) => s.memberId === myMemberId);
      items.push({
        kind: 'activity',
        id: e.id,
        type: 'expense',
        occurredOn: e.occurredOn,
        recordedAt: e.createdAt,
        categoryLabel: (e.category && CATEGORY_LABEL_BY_VALUE.get(e.category)) ?? 'General',
        description: describeExpenseActivity({
          payerLabel,
          isPayerMe: payers.length === 1 && payers[0]?.memberId === myMemberId,
          amountCents: e.amountCents,
          currency: e.currency,
          description: e.description,
        }),
        myPosition: describeMyPosition({
          positionCents: myPositionCents(myPaid, mySplit?.shareAmountCents ?? 0),
          involved: myPaid > 0 || mySplit !== undefined,
          currency: e.currency,
        }),
        note: null,
        notes: e.notes,
        amountCents: e.amountCents,
        currency: e.currency,
        groupName: name,
        groupId,
      });
    }

    for (const s of groupSettlements) {
      if (s.deletedAt) continue;
      latestRecordedInGroup = Math.max(latestRecordedInGroup, s.createdAt);
      items.push({
        kind: 'activity',
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
        groupName: name,
        groupId,
      });
    }

    // Bounced guest invites — `[Resend]` (SPEC.md §8). Only surfaced for a
    // group the user actually manages, matching `resendGuestInviteAction`'s
    // own `requireGroupManage` gate exactly.
    if (myRole === 'owner') {
      for (const member of groupMembersList) {
        if (member.kind !== 'guest' || member.guestInviteStatus !== 'bounced') continue;
        items.push({
          kind: 'bounced_invite',
          id: `bounced:${member.id}`,
          groupId,
          groupName: name,
          memberId: member.id,
          guestName: member.guestName ?? 'Guest',
          // No dedicated "when did this bounce" timestamp exists on
          // `group_members` — `joinedAt` is the closest available proxy.
          recordedAt: member.joinedAt,
        });
      }
    }

    // Unpaid balances — `[Remind]` (SPEC.md §6). Only real users (a guest
    // has no session to notify) who currently owe *me* under the group's
    // own pairwise/simplified mode, and not already reminded within the
    // last 24h. Skipped for closed groups — nothing is owed in a group
    // that could only be closed once fully settled.
    if (membership.archivedAt !== null) continue;
    const ledger = {
      expenses: groupExpenses,
      payers: groupPayers,
      splits: groupSplits,
      settlements: groupSettlements,
    };
    const counterparties = counterpartiesForGroup(
      { ...ledger, simplifyDebts, netBalances: computeNetBalances(ledger) },
      myMemberId,
    );
    for (const counterparty of counterparties) {
      if (counterparty.amountCents >= 0) continue; // they owe me only when negative
      const member = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (!member || member.kind !== 'user' || !member.userId) continue;
      if (onReminderCooldown(counterparty.memberId)) continue;

      // "When did this become relevant" — the most recently recorded
      // expense/settlement directly involving both of us, falling back to
      // the group's latest activity.
      let lastJointActivity = 0;
      for (const e of groupExpenses) {
        if (e.deletedAt) continue;
        const involved = new Set([
          ...(payersByExpenseId.get(e.id) ?? []).map((p) => p.memberId),
          ...(splitsByExpenseId.get(e.id) ?? []).map((s) => s.memberId),
        ]);
        if (involved.has(myMemberId) && involved.has(counterparty.memberId)) {
          lastJointActivity = Math.max(lastJointActivity, e.createdAt);
        }
      }
      for (const s of groupSettlements) {
        if (s.deletedAt) continue;
        const isBetweenUs =
          (s.fromMemberId === myMemberId && s.toMemberId === counterparty.memberId) ||
          (s.fromMemberId === counterparty.memberId && s.toMemberId === myMemberId);
        if (isBetweenUs) lastJointActivity = Math.max(lastJointActivity, s.createdAt);
      }

      items.push({
        kind: 'balance_reminder',
        // Keyed per currency — one person can owe in two currencies within
        // one group, which must be two rows with two distinct keys.
        id: `reminder:${counterparty.memberId}:${counterparty.currency}`,
        groupId,
        groupName: name,
        memberId: counterparty.memberId,
        counterpartyLabel: labelForMember(member),
        amountCents: -counterparty.amountCents,
        currency: counterparty.currency,
        recordedAt: lastJointActivity || latestRecordedInGroup,
      });
    }
  }

  items.sort((a, b) => b.recordedAt - a.recordedAt);

  return { hasGroups: true, items };
}
