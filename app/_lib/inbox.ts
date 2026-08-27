import { sdk } from '@sovereignfs/sdk';
import { describeExpenseActivity, describeSettlementActivity, type GroupActivityItem } from './activity';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { getContext } from './context';
import { fetchMyGroupsData, type MemberRow } from './group-data';

/**
 * Inbox (UI-FLOW.md §5) — scoped 2026-08-27 to the "plain rows" half of
 * the spec'd merged feed: every expense/settlement across every group the
 * user belongs to, flattened (not month-grouped like Group/Person's own
 * feed — see `formatRelativeTime`'s doc comment) and sorted most-recent
 * first. The spec's other half — actionable rows (`[Resend]` a bounced
 * guest invite, `[Remind]` an unpaid balance) and Notification Center
 * unread-count integration — depends on features that don't exist yet
 * (guest email invites, a remind action, and no mutating action in this
 * plugin calls `sdk.activity.log()`/`sdk.notifications.send()` today) and
 * is deliberately deferred, not built here.
 */

export interface InboxData {
  hasGroups: boolean;
  /** Sorted most-recent first. Every item's `groupName` is set (unlike
   *  the single-group feed) since this spans every group at once. */
  items: GroupActivityItem[];
}

export async function getInboxFeed(): Promise<InboxData> {
  const { db, userId, tenantId } = await getContext();
  const { myMemberships, membersByGroup, expensesByGroup, payersByGroup, settlementsByGroup } =
    await fetchMyGroupsData(db, userId, tenantId);

  if (myMemberships.length === 0) return { hasGroups: false, items: [] };

  const allMembers = Array.from(membersByGroup.values()).flat();
  const realUserIds = Array.from(
    new Set(allMembers.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers = realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));
  function labelForMember(member: MemberRow): string {
    if (member.kind === 'user') return nameByUserId.get(member.userId ?? '') ?? 'Unknown member';
    return member.guestName ?? 'Guest';
  }

  const items: GroupActivityItem[] = [];

  for (const membership of myMemberships) {
    const { groupId, myMemberId, name } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const labelByMemberId = new Map(groupMembersList.map((m) => [m.id, labelForMember(m)]));

    const groupExpenses = expensesByGroup.get(groupId) ?? [];
    const groupPayers = payersByGroup.get(groupId) ?? [];
    const payerMemberIdByExpenseId = new Map(groupPayers.map((p) => [p.expenseId, p.memberId]));

    for (const e of groupExpenses) {
      if (e.deletedAt) continue;
      const payerMemberId = payerMemberIdByExpenseId.get(e.id) ?? null;
      const payerLabel = (payerMemberId && labelByMemberId.get(payerMemberId)) ?? 'Someone';
      items.push({
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

    for (const s of settlementsByGroup.get(groupId) ?? []) {
      if (s.deletedAt) continue;
      items.push({
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
  }

  items.sort((a, b) => b.occurredOn - a.occurredOn);

  return { hasGroups: true, items };
}
