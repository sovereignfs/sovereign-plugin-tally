import { and, eq, inArray } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import { reminders } from '../_db/schema';
import {
  describeExpenseActivity,
  describeSettlementActivity,
  type GroupActivityItem,
} from './activity';
import { computeNetBalances, resolveCounterparties } from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { getContext } from './context';
import { fetchMyGroupsData, type MemberRow } from './group-data';

/**
 * Inbox (UI-FLOW.md §5) — the full merged feed as of 2026-08-27: plain
 * activity rows (every expense/settlement across every group, as shipped
 * 2026-08-27) plus the two actionable row kinds the spec's mockup shows
 * inline — a bounced guest invite (`[Resend]`) and an unpaid balance
 * (`[Remind]`) — now buildable since both prerequisites shipped
 * (guest invites, Post-MVP item 1; `sdk.notifications.send()`/
 * `sdk.activity.log()` wiring, Post-MVP item 7). The Notification Center
 * unread-count tie-in and the sidebar's own unread badge are still not
 * built — a separate UI surface (`TallySidebar.tsx`), not this feed.
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
      occurredOn: number;
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
      occurredOn: number;
    };

export interface InboxData {
  hasGroups: boolean;
  /** Sorted most-recent first. Every item's `groupName` is set (unlike
   *  the single-group feed) since this spans every group at once. */
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
    const { groupId, myMemberId, name } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const labelByMemberId = new Map(groupMembersList.map((m) => [m.id, labelForMember(m)]));

    const groupExpenses = expensesByGroup.get(groupId) ?? [];
    const groupPayers = payersByGroup.get(groupId) ?? [];
    const groupSplits = splitsByGroup.get(groupId) ?? [];
    const groupSettlements = settlementsByGroup.get(groupId) ?? [];
    const payerMemberIdByExpenseId = new Map(groupPayers.map((p) => [p.expenseId, p.memberId]));

    let latestActivityInGroup = 0;

    for (const e of groupExpenses) {
      if (e.deletedAt) continue;
      latestActivityInGroup = Math.max(latestActivityInGroup, e.occurredOn);
      const payerMemberId = payerMemberIdByExpenseId.get(e.id) ?? null;
      const payerLabel = (payerMemberId && labelByMemberId.get(payerMemberId)) ?? 'Someone';
      items.push({
        kind: 'activity',
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
        groupName: name,
      });
    }

    for (const s of groupSettlements) {
      if (s.deletedAt) continue;
      latestActivityInGroup = Math.max(latestActivityInGroup, s.settledOn);
      items.push({
        kind: 'activity',
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
        groupName: name,
      });
    }

    // Bounced guest invites — `[Resend]` (SPEC.md §8). Only surfaced for a
    // group the user actually manages, matching `resendGuestInviteAction`'s
    // own `requireGroupManage` gate exactly (no point offering a button
    // that would just fail).
    const myRole = groupMembersList.find((m) => m.id === myMemberId)?.role;
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
          // `group_members` — `joinedAt` (when the guest was added, close
          // to when the invite attempt happened) is the closest available
          // proxy rather than adding a column for one row's display order.
          occurredOn: member.joinedAt,
        });
      }
    }

    // Unpaid balances — `[Remind]` (SPEC.md §6). Only real users (a guest
    // has no session to notify) who currently owe *me*, and not already
    // reminded within the last 24h (matches `sendReminderAction`'s own
    // rate limit — a row with nothing new to do isn't worth showing).
    const netBalances = computeNetBalances({
      expenses: groupExpenses,
      payers: groupPayers,
      splits: groupSplits,
      settlements: groupSettlements,
    });
    for (const counterparty of resolveCounterparties(netBalances, myMemberId)) {
      if (counterparty.amountCents >= 0) continue; // they owe me only when negative
      const member = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (!member || member.kind !== 'user' || !member.userId) continue;
      if (onReminderCooldown(counterparty.memberId)) continue;

      // "When did this become relevant" — the most recent expense/
      // settlement directly involving both of us, matching `people.ts`'s
      // own joint-participation definition; falls back to the group's
      // latest activity if the debt only exists via `simplifyDebts`'s
      // allocation with no single directly-shared transaction.
      let lastJointActivity = 0;
      const participantsByExpenseId = new Map<string, Set<string>>();
      for (const p of groupPayers) {
        const set = participantsByExpenseId.get(p.expenseId) ?? new Set<string>();
        set.add(p.memberId);
        participantsByExpenseId.set(p.expenseId, set);
      }
      for (const sp of groupSplits) {
        const set = participantsByExpenseId.get(sp.expenseId) ?? new Set<string>();
        set.add(sp.memberId);
        participantsByExpenseId.set(sp.expenseId, set);
      }
      for (const e of groupExpenses) {
        if (e.deletedAt) continue;
        const participants = participantsByExpenseId.get(e.id);
        if (participants?.has(myMemberId) && participants?.has(counterparty.memberId)) {
          lastJointActivity = Math.max(lastJointActivity, e.occurredOn);
        }
      }
      for (const s of groupSettlements) {
        if (s.deletedAt) continue;
        const isBetweenUs =
          (s.fromMemberId === myMemberId && s.toMemberId === counterparty.memberId) ||
          (s.fromMemberId === counterparty.memberId && s.toMemberId === myMemberId);
        if (isBetweenUs) lastJointActivity = Math.max(lastJointActivity, s.settledOn);
      }

      items.push({
        kind: 'balance_reminder',
        id: `reminder:${counterparty.memberId}`,
        groupId,
        groupName: name,
        memberId: counterparty.memberId,
        counterpartyLabel: labelForMember(member),
        amountCents: -counterparty.amountCents,
        currency: counterparty.currency,
        occurredOn: lastJointActivity || latestActivityInGroup,
      });
    }
  }

  items.sort((a, b) => b.occurredOn - a.occurredOn);

  return { hasGroups: true, items };
}
