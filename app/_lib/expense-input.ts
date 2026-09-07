import type { SplitMethod } from '@sovereignfs/ui';
import { CATEGORY_OPTIONS } from './categories';
import { isSupportedCurrency } from './currencies';
import { distributeByWeights } from './rounding';

/**
 * Pure parsing + validation for the add/edit expense form — no DB access,
 * no `'use server'`, so every rule here is unit-testable in isolation
 * (`__tests__/expense-input.test.ts`). `expenses.ts`'s actions call this
 * after resolving the group's active member set and only then touch the
 * database. Every number that reaches the ledger is an integer number of
 * cents, checked here rather than trusted from the client.
 */

const VALID_CATEGORIES = new Set<string>(CATEGORY_OPTIONS.map((c) => c.value));
const SPLIT_METHODS: readonly SplitMethod[] = ['equal', 'amount', 'percentage', 'shares'];
/** Basis points in 100% — a percentage split must sum to exactly this. */
export const FULL_PERCENT_BASIS_POINTS = 10_000;
/** Hard cap on a single expense — guards against a mistyped amount and
 *  keeps every cents figure comfortably inside a Postgres `integer`. */
export const MAX_AMOUNT_CENTS = 2_000_000_000;
/** Client- and server-side cap on an attached receipt image. The platform
 *  enforces its own `SOVEREIGN_STORAGE_MAX_OBJECT_BYTES` too; this smaller
 *  limit fails fast in the form instead of after a full upload. Lives in
 *  this SDK-free module because the client-side form imports it — a
 *  Client Component must never import anything that reaches `next/headers`. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** One payer row as the form serializes it. */
export interface PayerInput {
  memberId: string;
  amountCents: number;
}

/**
 * One participant's raw input, as collected client-side and sent as JSON
 * (a dynamic per-member list doesn't map onto plain FormData field names).
 * - 'equal': `weight` ignored, every participant gets weight 1.
 * - 'percentage': `weight` is a plain 0–100 number (this file converts to
 *   basis points before distributing and before storing `shareUnits`).
 * - 'shares': `weight` is the raw share count (may be fractional).
 * - 'amount': `amountCents` is the participant's exact resolved share.
 */
export interface ParticipantInput {
  memberId: string;
  weight?: number;
  amountCents?: number;
}

export interface RawExpenseInput {
  description: string;
  amountCents: string;
  currency: string;
  category: string;
  occurredOn: string;
  notes: string;
  splitMethod: string;
  /** JSON `PayerInput[]`. */
  payers: string;
  /** JSON `ParticipantInput[]`. */
  participants: string;
}

export interface ParsedExpense {
  description: string;
  amountCents: number;
  currency: string;
  category: string | null;
  occurredOn: number;
  notes: string | null;
  splitMethod: SplitMethod;
  payers: PayerInput[];
  splits: { memberId: string; shareAmountCents: number; shareUnits: number | null }[];
}

export type ParseExpenseResult = { ok: true; value: ParsedExpense } | { ok: false; error: string };

function isSplitMethod(value: string): value is SplitMethod {
  return (SPLIT_METHODS as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseJsonArray(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` from a `<input type="date">` → epoch seconds at UTC midnight
 *  (date-only semantics; the same UTC-calendar convention every date in
 *  this plugin renders through). `fallback` is used for a blank value. */
export function parseDateInput(value: string, fallback: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = Math.floor(new Date(`${trimmed}T00:00:00Z`).getTime() / 1000);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseExpenseInput(
  raw: RawExpenseInput,
  activeMemberIds: ReadonlySet<string>,
  nowSeconds: number,
): ParseExpenseResult {
  const description = raw.description.trim();
  if (!description) return { ok: false, error: 'Enter a description.' };
  if (description.length > 200) {
    return { ok: false, error: 'Keep the description under 200 characters.' };
  }

  const amountCents = Number(raw.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  if (amountCents > MAX_AMOUNT_CENTS) return { ok: false, error: 'That amount is too large.' };

  const currency = raw.currency.trim().toUpperCase();
  if (!isSupportedCurrency(currency)) return { ok: false, error: 'Choose a currency.' };

  const categoryInput = raw.category.trim();
  const category = categoryInput && VALID_CATEGORIES.has(categoryInput) ? categoryInput : null;

  const occurredOn = parseDateInput(raw.occurredOn, nowSeconds);
  if (occurredOn === null) return { ok: false, error: 'Enter a valid date.' };

  const notes = raw.notes.trim() || null;
  if (notes && notes.length > 2000) {
    return { ok: false, error: 'Keep the note under 2000 characters.' };
  }

  const splitMethod = raw.splitMethod.trim();
  if (!isSplitMethod(splitMethod)) return { ok: false, error: 'Choose a split method.' };

  // ---- Payers (one or more; amounts must sum to the total) ----
  const payersRaw = parseJsonArray(raw.payers);
  if (!payersRaw) return { ok: false, error: 'Invalid payer data.' };
  if (payersRaw.length === 0) return { ok: false, error: 'Choose who paid.' };
  const payers: PayerInput[] = [];
  const seenPayers = new Set<string>();
  for (const entry of payersRaw) {
    const p = entry as Partial<PayerInput>;
    if (typeof p.memberId !== 'string' || !activeMemberIds.has(p.memberId)) {
      return { ok: false, error: 'Choose who paid.' };
    }
    if (seenPayers.has(p.memberId)) return { ok: false, error: 'A payer is listed twice.' };
    seenPayers.add(p.memberId);
    // A single payer always covers the whole amount — the form sends no
    // per-payer figure in that case.
    const paid = payersRaw.length === 1 ? amountCents : p.amountCents;
    if (!isNonNegativeInteger(paid)) {
      return { ok: false, error: 'Enter a valid amount for each payer.' };
    }
    payers.push({ memberId: p.memberId, amountCents: paid });
  }
  const paidTotal = payers.reduce((sum, p) => sum + p.amountCents, 0);
  if (paidTotal !== amountCents) {
    return {
      ok: false,
      error: `Payer amounts (${(paidTotal / 100).toFixed(2)}) must add up to the total (${(amountCents / 100).toFixed(2)}).`,
    };
  }
  if (payers.length > 1 && payers.some((p) => p.amountCents === 0)) {
    return { ok: false, error: 'Remove payers who paid nothing.' };
  }

  // ---- Participants ----
  const participantsRaw = parseJsonArray(raw.participants);
  if (!participantsRaw) return { ok: false, error: 'Invalid split data.' };
  if (participantsRaw.length === 0) {
    return { ok: false, error: 'Select at least one person to split with.' };
  }
  const participants: ParticipantInput[] = [];
  const seenParticipants = new Set<string>();
  for (const entry of participantsRaw) {
    const p = entry as Partial<ParticipantInput>;
    if (typeof p.memberId !== 'string' || !activeMemberIds.has(p.memberId)) {
      return { ok: false, error: 'Invalid participant.' };
    }
    if (seenParticipants.has(p.memberId)) {
      return { ok: false, error: 'A participant is listed twice.' };
    }
    seenParticipants.add(p.memberId);
    participants.push({ memberId: p.memberId, weight: p.weight, amountCents: p.amountCents });
  }
  const order = participants.map((p) => p.memberId);

  let splits: ParsedExpense['splits'];
  if (splitMethod === 'amount') {
    for (const p of participants) {
      if (!isNonNegativeInteger(p.amountCents ?? 0)) {
        return { ok: false, error: 'Enter a valid amount for each person.' };
      }
    }
    const sum = participants.reduce((acc, p) => acc + (p.amountCents ?? 0), 0);
    if (sum !== amountCents) {
      return {
        ok: false,
        error: `Split amounts (${(sum / 100).toFixed(2)}) must add up to the total (${(amountCents / 100).toFixed(2)}).`,
      };
    }
    splits = participants.map((p) => ({
      memberId: p.memberId,
      shareAmountCents: p.amountCents ?? 0,
      shareUnits: null,
    }));
  } else {
    const weights = new Map<string, number>();
    const shareUnitsByMember = new Map<string, number>();
    for (const p of participants) {
      if (splitMethod === 'equal') {
        weights.set(p.memberId, 1);
        continue;
      }
      if (!isFiniteNonNegative(p.weight)) {
        return {
          ok: false,
          error:
            splitMethod === 'percentage'
              ? 'Enter a percentage for each person.'
              : 'Enter a share count for each person.',
        };
      }
      if (splitMethod === 'percentage') {
        const basisPoints = Math.round(p.weight * 100);
        weights.set(p.memberId, basisPoints);
        shareUnitsByMember.set(p.memberId, basisPoints);
      } else {
        weights.set(p.memberId, p.weight);
        shareUnitsByMember.set(p.memberId, Math.round(p.weight * 100));
      }
    }
    const totalWeight = order.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
    if (splitMethod === 'percentage' && totalWeight !== FULL_PERCENT_BASIS_POINTS) {
      const shown = (totalWeight / 100).toFixed(totalWeight % 100 === 0 ? 0 : 2);
      return { ok: false, error: `Percentages add up to ${shown}% — they need to total 100%.` };
    }
    if (totalWeight <= 0) {
      return { ok: false, error: 'Split shares must add up to more than zero.' };
    }

    const resolved = distributeByWeights(amountCents, weights, order);
    splits = order.map((memberId) => ({
      memberId,
      shareAmountCents: resolved.get(memberId) ?? 0,
      shareUnits: shareUnitsByMember.get(memberId) ?? null,
    }));
  }

  return {
    ok: true,
    value: {
      description,
      amountCents,
      currency,
      category,
      occurredOn,
      notes,
      splitMethod,
      payers,
      splits,
    },
  };
}
