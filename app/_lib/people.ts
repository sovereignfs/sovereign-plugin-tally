import { sdk } from '@sovereignfs/sdk';
import {
  describeExpenseActivity,
  describeSettlementActivity,
  groupActivityByMonth,
  type GroupActivityItem,
  type GroupActivityMonth,
} from './activity';
import {
  computeNetBalances,
  largestMagnitude,
  resolveCounterparties,
  rollupByPerson,
  type CurrencyAmount,
} from './balances';
import { CATEGORY_LABEL_BY_VALUE } from './categories';
import { pushTo } from './collections';
import { getContext } from './context';
import { fetchMyGroupsData, type MemberRow } from './group-data';

/**
 * People (UI-FLOW.md §4) — everyone the current user shares at least one
 * group with, cross-group balance rollup, and a per-person detail view
 * with a filtered activity timeline. Shares `fetchMyGroupsData` and
 * `resolveCounterparties` with `overview.ts`/`groups.ts` (see those
 * files' own doc comments) rather than re-deriving the same balances a
 * third and fourth way.
 */

export interface PersonListItem {
  personKey: string;
  label: string;
  sharedGroupCount: number;
  /** This person's own balance relative to me, one entry per currency —
   *  empty means settled up (or no shared expense history yet). Same
   *  `BalanceChip` sign convention as everywhere else: positive = I owe
   *  them, negative = they owe me. */
  balances: CurrencyAmount[];
}

export interface PeopleData {
  hasGroups: boolean;
  owed: CurrencyAmount[];
  owe: CurrencyAmount[];
  /** Every person sharing at least one group with the user — not just
   *  those with a non-zero balance (contrast with Overview's capped
   *  breakdown). Sorted non-zero-balance first (largest first), settled
   *  people after, alphabetically. */
  people: PersonListItem[];
}

function personKeyFor(groupId: string, member: { id: string; kind: string; userId: string | null }): string {
  return member.kind === 'user' && member.userId ? member.userId : `${groupId}:${member.id}`;
}

export async function getPeopleForUser(): Promise<PeopleData> {
  const { db, userId, tenantId } = await getContext();
  const { myMemberships, membersByGroup, expensesByGroup, payersByGroup, splitsByGroup, settlementsByGroup } =
    await fetchMyGroupsData(db, userId, tenantId);

  if (myMemberships.length === 0) {
    return { hasGroups: false, owed: [], owe: [], people: [] };
  }

  const myBalancesByCurrency = new Map<string, number>();
  const personRollupInput: { personKey: string; currency: string; amountCents: number }[] = [];
  const sharedGroupsByPersonKey = new Map<string, Set<string>>();
  const coMemberByPersonKey = new Map<string, MemberRow>();

  for (const membership of myMemberships) {
    const { groupId, myMemberId } = membership;
    const groupMembersList = membersByGroup.get(groupId) ?? [];

    const netBalances = computeNetBalances({
      expenses: expensesByGroup.get(groupId) ?? [],
      payers: payersByGroup.get(groupId) ?? [],
      splits: splitsByGroup.get(groupId) ?? [],
      settlements: settlementsByGroup.get(groupId) ?? [],
    });

    const myBalances = netBalances.filter((b) => b.memberId === myMemberId && b.amountCents !== 0);
    for (const b of myBalances) {
      myBalancesByCurrency.set(b.currency, (myBalancesByCurrency.get(b.currency) ?? 0) + b.amountCents);
    }

    for (const counterparty of resolveCounterparties(netBalances, myMemberId)) {
      const otherMember = groupMembersList.find((m) => m.id === counterparty.memberId);
      if (!otherMember) continue;
      personRollupInput.push({
        personKey: personKeyFor(groupId, otherMember),
        currency: counterparty.currency,
        amountCents: counterparty.amountCents,
      });
    }

    for (const member of groupMembersList) {
      if (member.id === myMemberId) continue;
      const personKey = personKeyFor(groupId, member);
      const set = sharedGroupsByPersonKey.get(personKey) ?? new Set<string>();
      set.add(groupId);
      sharedGroupsByPersonKey.set(personKey, set);
      if (!coMemberByPersonKey.has(personKey)) coMemberByPersonKey.set(personKey, member);
    }
  }

  // No `!== 0` filter here, unlike Overview's People breakdown — a
  // settled person must still appear on the full People page (they're
  // just ranked after everyone with a live balance), matching the page's
  // original "everyone you share a group with" scope.
  const personBalances = rollupByPerson(personRollupInput);
  const balancesByPersonKey = new Map<string, CurrencyAmount[]>();
  for (const p of personBalances) {
    pushTo(balancesByPersonKey, p.personKey, { currency: p.currency, amountCents: p.amountCents });
  }

  const realUserIds = Array.from(
    new Set(
      Array.from(coMemberByPersonKey.values())
        .filter((m) => m.kind === 'user' && m.userId)
        .map((m) => m.userId as string),
    ),
  );
  const resolvedUsers = realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  const people: PersonListItem[] = Array.from(coMemberByPersonKey.entries()).map(([personKey, member]) => {
    const balances = (balancesByPersonKey.get(personKey) ?? [])
      .filter((b) => b.amountCents !== 0)
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    return {
      personKey,
      label:
        member.kind === 'user' ? (nameByUserId.get(member.userId ?? '') ?? 'Unknown member') : (member.guestName ?? 'Guest'),
      sharedGroupCount: sharedGroupsByPersonKey.get(personKey)?.size ?? 0,
      balances,
    };
  });

  people.sort((a, b) => {
    const aMag = a.balances.length > 0 ? Math.abs(largestMagnitude(a.balances).amountCents) : 0;
    const bMag = b.balances.length > 0 ? Math.abs(largestMagnitude(b.balances).amountCents) : 0;
    if (aMag !== bMag) return bMag - aMag;
    return a.label.localeCompare(b.label);
  });

  const owed: CurrencyAmount[] = [];
  const owe: CurrencyAmount[] = [];
  for (const [currency, amountCents] of myBalancesByCurrency) {
    if (amountCents > 0) owed.push({ currency, amountCents });
    else if (amountCents < 0) owe.push({ currency, amountCents: -amountCents });
  }
  owed.sort((a, b) => b.amountCents - a.amountCents);
  owe.sort((a, b) => b.amountCents - a.amountCents);

  return { hasGroups: true, owed, owe, people };
}

export interface PersonDetail {
  personKey: string;
  label: string;
  sharedGroupCount: number;
  balances: CurrencyAmount[];
  /** Only expenses where *both* the user and this person are participants
   *  (payer or split share) and settlements directly between the two —
   *  not every activity in a shared group (a third member's unrelated
   *  expense in a group of four wouldn't belong in "me and this person's"
   *  history). */
  activity: GroupActivityMonth[];
}

/**
 * `personKey` is either a real user id or the synthetic
 * `${groupId}:${memberId}` guest key `rollupByPerson` documents — returns
 * `null` if it doesn't resolve to anyone the current user actually shares
 * a group with (same "not found" contract as `getGroupDetail`).
 */
export async function getPersonDetail(personKey: string): Promise<PersonDetail | null> {
  const { db, userId, tenantId } = await getContext();
  const { myMemberships, membersByGroup, expensesByGroup, payersByGroup, splitsByGroup, settlementsByGroup } =
    await fetchMyGroupsData(db, userId, tenantId);

  if (myMemberships.length === 0) return null;

  const targetMemberIdByGroup = new Map<string, string>();
  let isGuest = false;
  let guestLabel = 'Guest';
  for (const membership of myMemberships) {
    const groupId = membership.groupId;
    const match = (membersByGroup.get(groupId) ?? []).find((m) =>
      m.kind === 'user' ? m.userId === personKey : `${groupId}:${m.id}` === personKey,
    );
    if (!match) continue;
    targetMemberIdByGroup.set(groupId, match.id);
    if (match.kind === 'guest') {
      isGuest = true;
      guestLabel = match.guestName ?? 'Guest';
    }
  }
  if (targetMemberIdByGroup.size === 0) return null;

  // Every real-user label across just the shared groups — a third member
  // can still be an expense's payer even when the expense qualifies as
  // "joint" via splits (see the participation filter below), so this
  // can't be scoped to just me + the target person.
  const sharedGroupIds = Array.from(targetMemberIdByGroup.keys());
  const relevantMembers = sharedGroupIds.flatMap((groupId) => membersByGroup.get(groupId) ?? []);
  const realUserIds = Array.from(
    new Set(relevantMembers.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers = realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));
  function labelForMember(member: MemberRow): string {
    if (member.kind === 'user') return nameByUserId.get(member.userId ?? '') ?? 'Unknown member';
    return member.guestName ?? 'Guest';
  }

  const label = isGuest ? guestLabel : (nameByUserId.get(personKey) ?? 'Unknown member');
  const myMemberIdByGroup = new Map(myMemberships.map((m) => [m.groupId, m.myMemberId]));

  const balancesByCurrency = new Map<string, number>();
  const allActivity: GroupActivityItem[] = [];

  for (const [groupId, targetMemberId] of targetMemberIdByGroup) {
    const myMemberId = myMemberIdByGroup.get(groupId);
    if (!myMemberId) continue;
    const membership = myMemberships.find((m) => m.groupId === groupId);
    if (!membership) continue;

    const groupExpenses = expensesByGroup.get(groupId) ?? [];
    const groupPayers = payersByGroup.get(groupId) ?? [];
    const groupSplits = splitsByGroup.get(groupId) ?? [];
    const groupSettlements = settlementsByGroup.get(groupId) ?? [];
    const groupMembersList = membersByGroup.get(groupId) ?? [];
    const labelByMemberId = new Map(groupMembersList.map((m) => [m.id, labelForMember(m)]));

    const netBalances = computeNetBalances({
      expenses: groupExpenses,
      payers: groupPayers,
      splits: groupSplits,
      settlements: groupSettlements,
    });
    for (const counterparty of resolveCounterparties(netBalances, myMemberId)) {
      if (counterparty.memberId !== targetMemberId) continue;
      balancesByCurrency.set(
        counterparty.currency,
        (balancesByCurrency.get(counterparty.currency) ?? 0) + counterparty.amountCents,
      );
    }

    const participantsByExpenseId = new Map<string, Set<string>>();
    for (const p of groupPayers) {
      const set = participantsByExpenseId.get(p.expenseId) ?? new Set<string>();
      set.add(p.memberId);
      participantsByExpenseId.set(p.expenseId, set);
    }
    for (const s of groupSplits) {
      const set = participantsByExpenseId.get(s.expenseId) ?? new Set<string>();
      set.add(s.memberId);
      participantsByExpenseId.set(s.expenseId, set);
    }
    const payerMemberIdByExpenseId = new Map(groupPayers.map((p) => [p.expenseId, p.memberId]));

    for (const e of groupExpenses) {
      if (e.deletedAt) continue;
      const participants = participantsByExpenseId.get(e.id);
      if (!participants || !participants.has(myMemberId) || !participants.has(targetMemberId)) continue;
      const payerMemberId = payerMemberIdByExpenseId.get(e.id) ?? null;
      const payerLabel = (payerMemberId && labelByMemberId.get(payerMemberId)) ?? 'Someone';
      allActivity.push({
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
        groupName: membership.name,
      });
    }

    for (const s of groupSettlements) {
      if (s.deletedAt) continue;
      const isBetweenUs =
        (s.fromMemberId === myMemberId && s.toMemberId === targetMemberId) ||
        (s.fromMemberId === targetMemberId && s.toMemberId === myMemberId);
      if (!isBetweenUs) continue;
      allActivity.push({
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
        groupName: membership.name,
      });
    }
  }

  const balances: CurrencyAmount[] = Array.from(balancesByCurrency.entries())
    .filter(([, amountCents]) => amountCents !== 0)
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));

  const activity = groupActivityByMonth(allActivity.sort((a, b) => b.occurredOn - a.occurredOn));

  return {
    personKey,
    label,
    sharedGroupCount: targetMemberIdByGroup.size,
    balances,
    activity,
  };
}
