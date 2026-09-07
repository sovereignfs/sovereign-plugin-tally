import { describe, expect, it } from 'vitest';
import {
  describeExpenseActivity,
  describeMyPosition,
  describeSettlementActivity,
  formatActivityDate,
  formatMoney,
  formatRelativeTime,
  groupActivityByMonth,
  monthLabelFor,
  recentMonthKeys,
  toDateInputValue,
  type GroupActivityItem,
} from '../activity';

describe('formatMoney', () => {
  it('uses the ISO code, thousands separators, and two decimals for a cents currency', () => {
    expect(formatMoney(240_000, 'USD')).toBe('USD 2,400.00');
    expect(formatMoney(5200, 'EUR')).toBe('EUR 52.00');
  });

  it('drops the decimals for a zero-decimal currency', () => {
    expect(formatMoney(150_000, 'JPY')).toBe('JPY 1,500');
  });

  it('falls back to a fixed two-decimal form for an unknown code', () => {
    expect(formatMoney(1234, 'ZZZ')).toBe('ZZZ 12.34');
  });
});

describe('describeMyPosition', () => {
  it('says lent when the reader paid more than their share', () => {
    expect(describeMyPosition({ positionCents: 3900, involved: true, currency: 'USD' })).toBe(
      'You lent USD 39.00',
    );
  });

  it('says borrowed when the reader owes part of it', () => {
    expect(describeMyPosition({ positionCents: -1300, involved: true, currency: 'USD' })).toBe(
      'You borrowed USD 13.00',
    );
  });

  it('distinguishes paying exactly your share from not being involved', () => {
    expect(describeMyPosition({ positionCents: 0, involved: true, currency: 'USD' })).toBe(
      'You paid your share',
    );
    expect(describeMyPosition({ positionCents: 0, involved: false, currency: 'USD' })).toBe(
      'Not involved',
    );
  });
});

describe('toDateInputValue / recentMonthKeys', () => {
  it('renders a UTC epoch as YYYY-MM-DD and blank for null', () => {
    expect(toDateInputValue(1787529600)).toBe('2026-08-24');
    expect(toDateInputValue(null)).toBe('');
  });

  it('lists the last N month keys oldest first, crossing a year boundary', () => {
    // 2026-02-10T00:00:00Z
    expect(recentMonthKeys(Date.UTC(2026, 1, 10) / 1000, 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('describeExpenseActivity', () => {
  it('phrases the reader as "You" when they were the payer', () => {
    expect(
      describeExpenseActivity({
        payerLabel: 'Dev Owner',
        isPayerMe: true,
        amountCents: 5200,
        currency: 'USD',
        description: 'Pizza night',
      }),
    ).toBe('You paid USD 52.00 for Pizza night');
  });

  it('names the payer when it is someone else', () => {
    expect(
      describeExpenseActivity({
        payerLabel: 'Dev Admin',
        isPayerMe: false,
        amountCents: 6000,
        currency: 'USD',
        description: 'Costco membership renewal',
      }),
    ).toBe('Dev Admin paid USD 60.00 for Costco membership renewal');
  });
});

describe('describeSettlementActivity', () => {
  it('capitalizes "You" as the payer subject', () => {
    expect(
      describeSettlementActivity({
        fromLabel: 'Dev Owner',
        isFromMe: true,
        toLabel: 'Alex',
        isToMe: false,
        amountCents: 2000,
        currency: 'EUR',
      }),
    ).toBe('You paid Alex EUR 20.00');
  });

  it('lowercases "you" as the payee object', () => {
    expect(
      describeSettlementActivity({
        fromLabel: 'Alex',
        isFromMe: false,
        toLabel: 'Dev Owner',
        isToMe: true,
        amountCents: 3000,
        currency: 'EUR',
      }),
    ).toBe('Alex paid you EUR 30.00');
  });

  it('names both parties when neither is the reader', () => {
    expect(
      describeSettlementActivity({
        fromLabel: 'Kasun',
        isFromMe: false,
        toLabel: 'Thulana',
        isToMe: false,
        amountCents: 1000,
        currency: 'USD',
      }),
    ).toBe('Kasun paid Thulana USD 10.00');
  });
});

describe('formatActivityDate', () => {
  it('formats a UTC epoch as "Mon D"', () => {
    // 2026-08-24T00:00:00Z
    expect(formatActivityDate(1787529600)).toBe('Aug 24');
  });
});

describe('formatRelativeTime', () => {
  const NOW = 1787529600; // 2026-08-24T00:00:00Z

  it('shows "just now" under a minute', () => {
    expect(formatRelativeTime(NOW - 30, NOW)).toBe('just now');
  });

  it('shows minutes under an hour', () => {
    expect(formatRelativeTime(NOW - 5 * 60, NOW)).toBe('5m ago');
  });

  it('shows hours under a day', () => {
    expect(formatRelativeTime(NOW - 3 * 60 * 60, NOW)).toBe('3h ago');
  });

  it('shows "yesterday" for exactly one day back', () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60, NOW)).toBe('yesterday');
  });

  it('shows days under a week', () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60, NOW)).toBe('3d ago');
  });

  it('falls back to the absolute date at a week or beyond', () => {
    expect(formatRelativeTime(NOW - 10 * 24 * 60 * 60, NOW)).toBe('Aug 14');
  });

  it('adds the year once the entry is from a previous calendar year', () => {
    expect(formatRelativeTime(NOW - 400 * 24 * 60 * 60, NOW)).toBe('Jul 20, 2025');
  });
});

describe('monthLabelFor', () => {
  it('expands a YYYY-MM key to a full month name + year', () => {
    expect(monthLabelFor('2026-08')).toBe('August 2026');
    expect(monthLabelFor('2026-01')).toBe('January 2026');
  });
});

describe('groupActivityByMonth', () => {
  function item(id: string, occurredOn: number): GroupActivityItem {
    return {
      id,
      type: 'expense',
      occurredOn,
      recordedAt: occurredOn,
      categoryLabel: 'General',
      description: 'test',
      note: null,
      amountCents: 100,
      currency: 'USD',
    };
  }

  it('buckets items into months, most recent month first', () => {
    const groups = groupActivityByMonth([
      item('a', 1787529600), // 2026-08-24
      item('b', 1784851200), // 2026-07-24
      item('c', 1787184000), // 2026-08-20
    ]);
    expect(groups.map((g) => g.monthKey)).toEqual(['2026-08', '2026-07']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['b']);
  });
});
