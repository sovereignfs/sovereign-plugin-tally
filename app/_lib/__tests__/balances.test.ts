import { describe, expect, it } from 'vitest';
import {
  aggregateByCategory,
  aggregateByPeriod,
  computeNetBalances,
  computePairwiseDebts,
  counterpartiesForGroup,
  groupBalancesByCurrency,
  myPositionCents,
  resolveCounterparties,
  resolvePairwiseCounterparties,
  rollupByPerson,
  simplifyDebts,
  suggestedPaymentsForGroup,
} from '../balances';

describe('computeNetBalances', () => {
  it('nets a simple two-person equal split correctly', () => {
    // Alex paid $20, split equally between Alex and Jamie (1000 each).
    const balances = computeNetBalances({
      expenses: [{ id: 'e1', currency: 'USD', deletedAt: null }],
      payers: [{ expenseId: 'e1', memberId: 'alex', amountCents: 2000 }],
      splits: [
        { expenseId: 'e1', memberId: 'alex', shareAmountCents: 1000 },
        { expenseId: 'e1', memberId: 'jamie', shareAmountCents: 1000 },
      ],
      settlements: [],
    });
    const alex = balances.find((b) => b.memberId === 'alex');
    const jamie = balances.find((b) => b.memberId === 'jamie');
    expect(alex?.amountCents).toBe(1000); // paid 2000, owes 1000 -> net +1000
    expect(jamie?.amountCents).toBe(-1000); // paid 0, owes 1000 -> net -1000
  });

  it('keeps currencies separate — never nets USD against EUR', () => {
    const balances = computeNetBalances({
      expenses: [
        { id: 'e1', currency: 'USD', deletedAt: null },
        { id: 'e2', currency: 'EUR', deletedAt: null },
      ],
      payers: [
        { expenseId: 'e1', memberId: 'alex', amountCents: 1000 },
        { expenseId: 'e2', memberId: 'jamie', amountCents: 500 },
      ],
      splits: [
        { expenseId: 'e1', memberId: 'jamie', shareAmountCents: 1000 },
        { expenseId: 'e2', memberId: 'alex', shareAmountCents: 500 },
      ],
      settlements: [],
    });
    expect(balances).toContainEqual({ memberId: 'alex', currency: 'USD', amountCents: 1000 });
    expect(balances).toContainEqual({ memberId: 'jamie', currency: 'USD', amountCents: -1000 });
    expect(balances).toContainEqual({ memberId: 'jamie', currency: 'EUR', amountCents: 500 });
    expect(balances).toContainEqual({ memberId: 'alex', currency: 'EUR', amountCents: -500 });
  });

  it('ignores soft-deleted expenses', () => {
    const balances = computeNetBalances({
      expenses: [{ id: 'e1', currency: 'USD', deletedAt: 1700000000 }],
      payers: [{ expenseId: 'e1', memberId: 'alex', amountCents: 1000 }],
      splits: [{ expenseId: 'e1', memberId: 'jamie', shareAmountCents: 1000 }],
      settlements: [],
    });
    expect(balances).toEqual([]);
  });

  it('ignores soft-deleted settlements', () => {
    const balances = computeNetBalances({
      expenses: [],
      payers: [],
      splits: [],
      settlements: [
        {
          fromMemberId: 'alex',
          toMemberId: 'jamie',
          amountCents: 500,
          currency: 'USD',
          deletedAt: 1700000000,
        },
      ],
    });
    expect(balances).toEqual([]);
  });

  it('a settlement moves the balance toward zero exactly as expected', () => {
    const balances = computeNetBalances({
      expenses: [{ id: 'e1', currency: 'USD', deletedAt: null }],
      payers: [{ expenseId: 'e1', memberId: 'alex', amountCents: 2000 }],
      splits: [
        { expenseId: 'e1', memberId: 'alex', shareAmountCents: 1000 },
        { expenseId: 'e1', memberId: 'jamie', shareAmountCents: 1000 },
      ],
      settlements: [
        {
          fromMemberId: 'jamie',
          toMemberId: 'alex',
          amountCents: 1000,
          currency: 'USD',
          deletedAt: null,
        },
      ],
    });
    const alex = balances.find((b) => b.memberId === 'alex');
    const jamie = balances.find((b) => b.memberId === 'jamie');
    expect(alex?.amountCents).toBe(0);
    expect(jamie?.amountCents).toBe(0);
  });
});

describe('simplifyDebts', () => {
  it('reduces a three-way chain to the minimum number of payments', () => {
    // A owes B $10, B owes C $10 -> should simplify to A pays C $10 directly.
    const balances = new Map([
      ['a', -1000],
      ['b', 0],
      ['c', 1000],
    ]);
    const payments = simplifyDebts(balances);
    expect(payments).toEqual([{ fromMemberId: 'a', toMemberId: 'c', amountCents: 1000 }]);
  });

  it('handles multiple creditors and debtors, conserving the total', () => {
    const balances = new Map([
      ['a', -700],
      ['b', -300],
      ['c', 500],
      ['d', 500],
    ]);
    const payments = simplifyDebts(balances);
    const totalPaid = payments.reduce((sum, p) => sum + p.amountCents, 0);
    expect(totalPaid).toBe(1000);
    // Every payment amount must be positive.
    expect(payments.every((p) => p.amountCents > 0)).toBe(true);
  });

  it('returns no payments when everyone is already settled', () => {
    const balances = new Map([
      ['a', 0],
      ['b', 0],
    ]);
    expect(simplifyDebts(balances)).toEqual([]);
  });
});

describe('groupBalancesByCurrency', () => {
  it('splits a flat balance list into one map per currency', () => {
    const grouped = groupBalancesByCurrency([
      { memberId: 'a', currency: 'USD', amountCents: 100 },
      { memberId: 'b', currency: 'EUR', amountCents: -50 },
    ]);
    expect(grouped.get('USD')?.get('a')).toBe(100);
    expect(grouped.get('EUR')?.get('b')).toBe(-50);
  });
});

describe('rollupByPerson', () => {
  it('sums a person balance across multiple groups, per currency', () => {
    const rollup = rollupByPerson([
      { personKey: 'user-1', currency: 'USD', amountCents: 500 },
      { personKey: 'user-1', currency: 'USD', amountCents: -200 },
      { personKey: 'user-1', currency: 'EUR', amountCents: 100 },
    ]);
    expect(rollup).toContainEqual({ personKey: 'user-1', currency: 'USD', amountCents: 300 });
    expect(rollup).toContainEqual({ personKey: 'user-1', currency: 'EUR', amountCents: 100 });
  });
});

describe('aggregateByCategory', () => {
  it('sums my own share by category, per currency', () => {
    const totals = aggregateByCategory([
      { category: 'groceries', currency: 'USD', shareAmountCents: 1000 },
      { category: 'groceries', currency: 'USD', shareAmountCents: 500 },
      { category: null, currency: 'USD', shareAmountCents: 200 },
    ]);
    expect(totals).toContainEqual({ category: 'groceries', currency: 'USD', amountCents: 1500 });
    expect(totals).toContainEqual({ category: null, currency: 'USD', amountCents: 200 });
  });
});

describe('aggregateByPeriod', () => {
  it('buckets by month and sorts chronologically', () => {
    const totals = aggregateByPeriod(
      [
        { occurredOn: Date.UTC(2026, 0, 15) / 1000, currency: 'USD', shareAmountCents: 100 },
        { occurredOn: Date.UTC(2026, 2, 1) / 1000, currency: 'USD', shareAmountCents: 200 },
        { occurredOn: Date.UTC(2026, 0, 20) / 1000, currency: 'USD', shareAmountCents: 50 },
      ],
      'month',
    );
    expect(totals).toEqual([
      { periodKey: '2026-01', currency: 'USD', amountCents: 150 },
      { periodKey: '2026-03', currency: 'USD', amountCents: 200 },
    ]);
  });

  it('buckets by year', () => {
    const totals = aggregateByPeriod(
      [
        { occurredOn: Date.UTC(2025, 11, 31) / 1000, currency: 'USD', shareAmountCents: 100 },
        { occurredOn: Date.UTC(2026, 0, 1) / 1000, currency: 'USD', shareAmountCents: 200 },
      ],
      'year',
    );
    expect(totals).toEqual([
      { periodKey: '2025', currency: 'USD', amountCents: 100 },
      { periodKey: '2026', currency: 'USD', amountCents: 200 },
    ]);
  });
});

// A owes B 10 (B paid a 20 dinner split A/B), B owes C 10 (C paid a 20
// taxi split B/C). Net: A -10, B 0, C +10.
const CHAIN = {
  expenses: [
    { id: 'dinner', currency: 'USD', deletedAt: null },
    { id: 'taxi', currency: 'USD', deletedAt: null },
  ],
  payers: [
    { expenseId: 'dinner', memberId: 'b', amountCents: 2000 },
    { expenseId: 'taxi', memberId: 'c', amountCents: 2000 },
  ],
  splits: [
    { expenseId: 'dinner', memberId: 'a', shareAmountCents: 1000 },
    { expenseId: 'dinner', memberId: 'b', shareAmountCents: 1000 },
    { expenseId: 'taxi', memberId: 'b', shareAmountCents: 1000 },
    { expenseId: 'taxi', memberId: 'c', shareAmountCents: 1000 },
  ],
  settlements: [],
};

describe('resolveCounterparties (simplified)', () => {
  it('routes the chain so A pays C directly — C never transacted with A', () => {
    const net = computeNetBalances(CHAIN);
    expect(resolveCounterparties(net, 'a')).toEqual([
      { memberId: 'c', currency: 'USD', amountCents: 1000 },
    ]);
    expect(resolveCounterparties(net, 'b')).toEqual([]);
  });
});

describe('computePairwiseDebts', () => {
  it('keeps the chain as two pairwise debts between people who actually split a bill', () => {
    const debts = computePairwiseDebts(CHAIN);
    expect(debts).toContainEqual({
      fromMemberId: 'a',
      toMemberId: 'b',
      currency: 'USD',
      amountCents: 1000,
    });
    expect(debts).toContainEqual({
      fromMemberId: 'b',
      toMemberId: 'c',
      currency: 'USD',
      amountCents: 1000,
    });
    expect(debts).toHaveLength(2);
  });

  it('nets both directions between a pair and applies settlements', () => {
    const debts = computePairwiseDebts({
      expenses: [
        { id: 'e1', currency: 'USD', deletedAt: null },
        { id: 'e2', currency: 'USD', deletedAt: null },
      ],
      payers: [
        { expenseId: 'e1', memberId: 'a', amountCents: 3000 },
        { expenseId: 'e2', memberId: 'b', amountCents: 1000 },
      ],
      splits: [
        { expenseId: 'e1', memberId: 'a', shareAmountCents: 1500 },
        { expenseId: 'e1', memberId: 'b', shareAmountCents: 1500 },
        { expenseId: 'e2', memberId: 'a', shareAmountCents: 500 },
        { expenseId: 'e2', memberId: 'b', shareAmountCents: 500 },
      ],
      settlements: [
        { fromMemberId: 'b', toMemberId: 'a', amountCents: 400, currency: 'USD', deletedAt: null },
      ],
    });
    // b owes a 1500, a owes b 500, b paid a 400 → b owes a 600.
    expect(debts).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', currency: 'USD', amountCents: 600 },
    ]);
  });

  it('attributes a multi-payer expense proportionally and conserves the net balances', () => {
    const ledger = {
      expenses: [{ id: 'e1', currency: 'USD', deletedAt: null }],
      payers: [
        { expenseId: 'e1', memberId: 'a', amountCents: 6000 },
        { expenseId: 'e1', memberId: 'b', amountCents: 3000 },
      ],
      splits: [
        { expenseId: 'e1', memberId: 'a', shareAmountCents: 3000 },
        { expenseId: 'e1', memberId: 'b', shareAmountCents: 3000 },
        { expenseId: 'e1', memberId: 'c', shareAmountCents: 3000 },
      ],
      settlements: [],
    };
    const debts = computePairwiseDebts(ledger);
    const net = computeNetBalances(ledger);
    for (const member of ['a', 'b', 'c']) {
      const owedToMember = debts
        .filter((d) => d.toMemberId === member)
        .reduce((s, d) => s + d.amountCents, 0);
      const owedByMember = debts
        .filter((d) => d.fromMemberId === member)
        .reduce((s, d) => s + d.amountCents, 0);
      expect(owedToMember - owedByMember).toBe(
        net.find((b) => b.memberId === member)?.amountCents ?? 0,
      );
    }
  });

  it('is empty when everyone is settled', () => {
    expect(
      computePairwiseDebts({
        expenses: [{ id: 'e1', currency: 'USD', deletedAt: null }],
        payers: [{ expenseId: 'e1', memberId: 'a', amountCents: 1000 }],
        splits: [{ expenseId: 'e1', memberId: 'a', shareAmountCents: 1000 }],
        settlements: [],
      }),
    ).toEqual([]);
  });
});

describe('counterpartiesForGroup / suggestedPaymentsForGroup', () => {
  it('dispatch on the simplifyDebts flag', () => {
    expect(counterpartiesForGroup({ ...CHAIN, simplifyDebts: false }, 'a')).toEqual([
      { memberId: 'b', currency: 'USD', amountCents: 1000 },
    ]);
    expect(counterpartiesForGroup({ ...CHAIN, simplifyDebts: true }, 'a')).toEqual([
      { memberId: 'c', currency: 'USD', amountCents: 1000 },
    ]);
    expect(suggestedPaymentsForGroup({ ...CHAIN, simplifyDebts: true })).toEqual([
      { fromMemberId: 'a', toMemberId: 'c', amountCents: 1000, currency: 'USD' },
    ]);
    expect(suggestedPaymentsForGroup({ ...CHAIN, simplifyDebts: false })).toHaveLength(2);
  });

  it('pairwise counterparties use the same sign convention as simplified ones', () => {
    expect(resolvePairwiseCounterparties(CHAIN, 'c')).toEqual([
      { memberId: 'b', currency: 'USD', amountCents: -1000 },
    ]);
  });
});

describe('myPositionCents', () => {
  it('is paid minus share', () => {
    expect(myPositionCents(5200, 1300)).toBe(3900);
    expect(myPositionCents(0, 1300)).toBe(-1300);
    expect(myPositionCents(1300, 1300)).toBe(0);
  });
});
