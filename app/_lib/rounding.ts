/**
 * Weighted distribution of an integer cents amount across a fixed, stable
 * member order, per SPEC.md §3's rounding rule: compute each member's
 * share via integer division, then distribute the leftover remainder
 * (always < order.length cents) one each to the first members in `order`.
 *
 * Generalizes all three weight-based split methods:
 * - 'equal'      → every weight is 1.
 * - 'percentage' → weight is basis points (2500 = 25.00%).
 * - 'shares'     → weight is the raw share count.
 *
 * ('amount' doesn't call this at all — the caller supplies each member's
 * amount directly and just validates the sum equals the total.)
 *
 * Deterministic and order-stable: the same `order` + `weights` always
 * produces the same result, so re-editing an unchanged split never
 * silently shifts a penny between members.
 */
export function distributeByWeights(
  totalCents: number,
  weights: Map<string, number>,
  order: string[],
): Map<string, number> {
  const totalWeight = order.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
  if (totalWeight <= 0) {
    return new Map(order.map((id) => [id, 0]));
  }

  const rawAmounts = new Map(
    order.map((id) => [id, Math.floor((totalCents * (weights.get(id) ?? 0)) / totalWeight)]),
  );
  let remainder = totalCents - order.reduce((sum, id) => sum + (rawAmounts.get(id) ?? 0), 0);

  const result = new Map<string, number>();
  for (const id of order) {
    let amount = rawAmounts.get(id) ?? 0;
    if (remainder > 0) {
      amount += 1;
      remainder -= 1;
    }
    result.set(id, amount);
  }
  return result;
}

/** 'equal' split — every member gets the same weight. */
export function distributeEvenly(totalCents: number, order: string[]): Map<string, number> {
  const weights = new Map(order.map((id) => [id, 1]));
  return distributeByWeights(totalCents, weights, order);
}
