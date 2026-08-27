import { and, eq, inArray, isNull } from 'drizzle-orm';
import { expensePayers, expenseSplits, expenses, groupMembers, groups, settlements } from '../_db/schema';
import { pushTo } from './collections';
import type { Db } from './context';

/**
 * Raw fetch-and-bucket-by-group for every group the current user belongs
 * to — the shared first step behind `overview.ts`'s cross-group rollup,
 * `groups.ts`'s `listGroupsForUser` per-group preview, and `people.ts`'s
 * cross-group person rollup. All three used to independently re-fetch and
 * re-bucket the same five tables; extracted here once both the query
 * shape and the bucketing loop are identical across three real call
 * sites, not a hypothetical one. Selects the union of columns any
 * consumer needs — an unused extra column costs nothing at this scale
 * (same reasoning `balances.ts`'s own doc comment gives for not caching
 * balance computations).
 */

export interface MyMembership {
  groupId: string;
  myMemberId: string;
  name: string;
  defaultCurrency: string;
  archivedAt: number | null;
}

export type MemberRow = typeof groupMembers.$inferSelect;

export interface ExpenseRow {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  category: string | null;
  occurredOn: number;
  deletedAt: number | null;
}

export interface PayerRow {
  expenseId: string;
  memberId: string;
  amountCents: number;
}

export interface SplitRow {
  expenseId: string;
  memberId: string;
  shareAmountCents: number;
}

export interface SettlementRow {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
  note: string | null;
  settledOn: number;
  deletedAt: number | null;
}

export interface MyGroupsData {
  myMemberships: MyMembership[];
  membersByGroup: Map<string, MemberRow[]>;
  expensesByGroup: Map<string, ExpenseRow[]>;
  payersByGroup: Map<string, PayerRow[]>;
  splitsByGroup: Map<string, SplitRow[]>;
  settlementsByGroup: Map<string, SettlementRow[]>;
}

const EMPTY_DATA: MyGroupsData = {
  myMemberships: [],
  membersByGroup: new Map(),
  expensesByGroup: new Map(),
  payersByGroup: new Map(),
  splitsByGroup: new Map(),
  settlementsByGroup: new Map(),
};

export async function fetchMyGroupsData(db: Db, userId: string, tenantId: string): Promise<MyGroupsData> {
  const myMemberships = await db
    .select({
      groupId: groupMembers.groupId,
      myMemberId: groupMembers.id,
      name: groups.name,
      defaultCurrency: groups.defaultCurrency,
      archivedAt: groups.archivedAt,
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
      ),
    );

  if (myMemberships.length === 0) return EMPTY_DATA;

  const groupIds = myMemberships.map((m) => m.groupId);

  const allMembers = await db
    .select()
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, groupIds), isNull(groupMembers.leftAt)));

  const allExpenses = await db
    .select({
      id: expenses.id,
      groupId: expenses.groupId,
      description: expenses.description,
      amountCents: expenses.amountCents,
      currency: expenses.currency,
      category: expenses.category,
      occurredOn: expenses.occurredOn,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .where(inArray(expenses.groupId, groupIds));
  const expenseIds = allExpenses.map((e) => e.id);

  const [allPayers, allSplits, allSettlements] = await Promise.all([
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
        groupId: settlements.groupId,
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        currency: settlements.currency,
        note: settlements.note,
        settledOn: settlements.settledOn,
        deletedAt: settlements.deletedAt,
      })
      .from(settlements)
      .where(inArray(settlements.groupId, groupIds)),
  ]);

  const groupIdByExpenseId = new Map(allExpenses.map((e) => [e.id, e.groupId]));
  const membersByGroup = new Map<string, MemberRow[]>();
  const expensesByGroup = new Map<string, ExpenseRow[]>();
  const payersByGroup = new Map<string, PayerRow[]>();
  const splitsByGroup = new Map<string, SplitRow[]>();
  const settlementsByGroup = new Map<string, SettlementRow[]>();
  for (const m of allMembers) {
    pushTo(membersByGroup, m.groupId, m);
  }
  for (const e of allExpenses) {
    pushTo(expensesByGroup, e.groupId, e);
  }
  for (const p of allPayers) {
    const groupId = groupIdByExpenseId.get(p.expenseId);
    if (!groupId) continue;
    pushTo(payersByGroup, groupId, p);
  }
  for (const s of allSplits) {
    const groupId = groupIdByExpenseId.get(s.expenseId);
    if (!groupId) continue;
    pushTo(splitsByGroup, groupId, s);
  }
  for (const s of allSettlements) {
    pushTo(settlementsByGroup, s.groupId, s);
  }

  return { myMemberships, membersByGroup, expensesByGroup, payersByGroup, splitsByGroup, settlementsByGroup };
}
