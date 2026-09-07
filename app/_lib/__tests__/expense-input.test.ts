import { describe, expect, it } from 'vitest';
import { parseDateInput, parseExpenseInput, type RawExpenseInput } from '../expense-input';

const MEMBERS = new Set(['a', 'b', 'c']);
const NOW = 1_787_529_600;

function raw(overrides: Partial<RawExpenseInput> = {}): RawExpenseInput {
  return {
    description: 'Groceries',
    amountCents: '3000',
    currency: 'USD',
    category: 'groceries',
    occurredOn: '2026-08-24',
    notes: '',
    splitMethod: 'equal',
    payers: JSON.stringify([{ memberId: 'a' }]),
    participants: JSON.stringify([{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }]),
    ...overrides,
  };
}

describe('parseExpenseInput', () => {
  it('resolves an equal split with the single payer covering the total', () => {
    const result = parseExpenseInput(raw(), MEMBERS, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payers).toEqual([{ memberId: 'a', amountCents: 3000 }]);
    expect(result.value.splits.map((s) => s.shareAmountCents)).toEqual([1000, 1000, 1000]);
    expect(result.value.occurredOn).toBe(Date.UTC(2026, 7, 24) / 1000);
    expect(result.value.category).toBe('groceries');
  });

  it('rejects a percentage split that does not total 100%', () => {
    const result = parseExpenseInput(
      raw({
        splitMethod: 'percentage',
        participants: JSON.stringify([
          { memberId: 'a', weight: 40 },
          { memberId: 'b', weight: 20 },
          { memberId: 'c', weight: 20 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: 'Percentages add up to 80% — they need to total 100%.',
    });
  });

  it('accepts a percentage split that totals exactly 100% and stores basis points', () => {
    const result = parseExpenseInput(
      raw({
        splitMethod: 'percentage',
        participants: JSON.stringify([
          { memberId: 'a', weight: 50 },
          { memberId: 'b', weight: 25 },
          { memberId: 'c', weight: 25 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.splits).toEqual([
      { memberId: 'a', shareAmountCents: 1500, shareUnits: 5000 },
      { memberId: 'b', shareAmountCents: 750, shareUnits: 2500 },
      { memberId: 'c', shareAmountCents: 750, shareUnits: 2500 },
    ]);
  });

  it('rejects negative and fractional exact amounts, and a sum that misses the total', () => {
    const negative = parseExpenseInput(
      raw({
        splitMethod: 'amount',
        participants: JSON.stringify([
          { memberId: 'a', amountCents: 4000 },
          { memberId: 'b', amountCents: -1000 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(negative.ok).toBe(false);
    const fractional = parseExpenseInput(
      raw({
        splitMethod: 'amount',
        participants: JSON.stringify([
          { memberId: 'a', amountCents: 1500.5 },
          { memberId: 'b', amountCents: 1499.5 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(fractional.ok).toBe(false);
    const short = parseExpenseInput(
      raw({
        splitMethod: 'amount',
        participants: JSON.stringify([
          { memberId: 'a', amountCents: 1000 },
          { memberId: 'b', amountCents: 1000 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(short).toEqual({
      ok: false,
      error: 'Split amounts (20.00) must add up to the total (30.00).',
    });
  });

  it('rejects a participant listed twice and a participant outside the group', () => {
    expect(
      parseExpenseInput(
        raw({ participants: JSON.stringify([{ memberId: 'a' }, { memberId: 'a' }]) }),
        MEMBERS,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'A participant is listed twice.' });
    expect(
      parseExpenseInput(
        raw({ participants: JSON.stringify([{ memberId: 'a' }, { memberId: 'zzz' }]) }),
        MEMBERS,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'Invalid participant.' });
  });

  it('rejects negative share weights and an all-zero share split', () => {
    expect(
      parseExpenseInput(
        raw({
          splitMethod: 'shares',
          participants: JSON.stringify([
            { memberId: 'a', weight: 2 },
            { memberId: 'b', weight: -1 },
          ]),
        }),
        MEMBERS,
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      parseExpenseInput(
        raw({
          splitMethod: 'shares',
          participants: JSON.stringify([
            { memberId: 'a', weight: 0 },
            { memberId: 'b', weight: 0 },
          ]),
        }),
        MEMBERS,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'Split shares must add up to more than zero.' });
  });

  it('accepts fractional share counts and stores them ×100', () => {
    const result = parseExpenseInput(
      raw({
        amountCents: '900',
        splitMethod: 'shares',
        participants: JSON.stringify([
          { memberId: 'a', weight: 1.5 },
          { memberId: 'b', weight: 1.5 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.splits).toEqual([
      { memberId: 'a', shareAmountCents: 450, shareUnits: 150 },
      { memberId: 'b', shareAmountCents: 450, shareUnits: 150 },
    ]);
  });

  it('requires multi-payer amounts to sum to the total and rejects zero payers', () => {
    const ok = parseExpenseInput(
      raw({
        payers: JSON.stringify([
          { memberId: 'a', amountCents: 2000 },
          { memberId: 'b', amountCents: 1000 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.payers).toEqual([
        { memberId: 'a', amountCents: 2000 },
        { memberId: 'b', amountCents: 1000 },
      ]);
    }
    const short = parseExpenseInput(
      raw({
        payers: JSON.stringify([
          { memberId: 'a', amountCents: 2000 },
          { memberId: 'b', amountCents: 500 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(short).toEqual({
      ok: false,
      error: 'Payer amounts (25.00) must add up to the total (30.00).',
    });
    const zero = parseExpenseInput(
      raw({
        payers: JSON.stringify([
          { memberId: 'a', amountCents: 3000 },
          { memberId: 'b', amountCents: 0 },
        ]),
      }),
      MEMBERS,
      NOW,
    );
    expect(zero).toEqual({ ok: false, error: 'Remove payers who paid nothing.' });
  });

  it('rejects a non-integer total, an unsupported currency, and a malformed date', () => {
    expect(parseExpenseInput(raw({ amountCents: '12.5' }), MEMBERS, NOW).ok).toBe(false);
    expect(parseExpenseInput(raw({ currency: 'ABC' }), MEMBERS, NOW)).toEqual({
      ok: false,
      error: 'Choose a currency.',
    });
    expect(parseExpenseInput(raw({ occurredOn: '24/08/2026' }), MEMBERS, NOW)).toEqual({
      ok: false,
      error: 'Enter a valid date.',
    });
  });

  it('keeps an unknown category as null and trims notes to null when blank', () => {
    const result = parseExpenseInput(raw({ category: 'yachts', notes: '   ' }), MEMBERS, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBeNull();
    expect(result.value.notes).toBeNull();
  });
});

describe('parseDateInput', () => {
  it('returns the fallback for blank, UTC midnight for a valid date, null otherwise', () => {
    expect(parseDateInput('', 42)).toBe(42);
    expect(parseDateInput('2026-01-01', 42)).toBe(Date.UTC(2026, 0, 1) / 1000);
    expect(parseDateInput('not a date', 42)).toBeNull();
  });
});
