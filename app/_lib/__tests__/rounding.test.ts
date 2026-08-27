import { describe, expect, it } from 'vitest';
import { distributeByWeights, distributeEvenly } from '../rounding';

describe('distributeEvenly', () => {
  it('splits evenly with no remainder', () => {
    const result = distributeEvenly(1000, ['a', 'b', 'c', 'd']);
    expect(Array.from(result.values())).toEqual([250, 250, 250, 250]);
  });

  it('assigns the remainder one-each to the first members in order', () => {
    // 1000 / 3 = 333.33... -> 333, 333, 333, remainder 1 cent to the first member.
    const result = distributeByWeights(
      1000,
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
      ['a', 'b', 'c'],
    );
    expect(result.get('a')).toBe(334);
    expect(result.get('b')).toBe(333);
    expect(result.get('c')).toBe(333);
    expect(Array.from(result.values()).reduce((sum, v) => sum + v, 0)).toBe(1000);
  });

  it('is deterministic for the same order — re-splitting never shifts a penny between different members', () => {
    const order = ['a', 'b', 'c'];
    const first = distributeEvenly(1000, order);
    const second = distributeEvenly(1000, order);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
  });

  it('reorders the remainder recipient when member order changes', () => {
    const result = distributeByWeights(
      1000,
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
      ['c', 'a', 'b'],
    );
    expect(result.get('c')).toBe(334);
    expect(result.get('a')).toBe(333);
    expect(result.get('b')).toBe(333);
  });

  it('handles a single member (gets the full amount)', () => {
    const result = distributeEvenly(1000, ['a']);
    expect(result.get('a')).toBe(1000);
  });
});

describe('distributeByWeights', () => {
  it('splits proportionally by percentage (basis points)', () => {
    // 25% / 75% of 1000 cents.
    const result = distributeByWeights(
      1000,
      new Map([
        ['a', 2500],
        ['b', 7500],
      ]),
      ['a', 'b'],
    );
    expect(result.get('a')).toBe(250);
    expect(result.get('b')).toBe(750);
  });

  it('splits proportionally by share count and distributes the remainder', () => {
    // 1000 cents across 3 shares: 333.33 each -> 333, 333, 333 + 1 remainder.
    const result = distributeByWeights(
      1000,
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
      ['a', 'b', 'c'],
    );
    const sum = Array.from(result.values()).reduce((s, v) => s + v, 0);
    expect(sum).toBe(1000);
  });

  it('always conserves the total exactly, across many odd amounts', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const weights = new Map(order.map((id) => [id, 1]));
    for (let total = 1; total < 500; total += 7) {
      const result = distributeByWeights(total, weights, order);
      const sum = Array.from(result.values()).reduce((s, v) => s + v, 0);
      expect(sum).toBe(total);
    }
  });

  it('returns zero for every member when total weight is zero', () => {
    const result = distributeByWeights(1000, new Map(), ['a', 'b']);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBe(0);
  });
});
