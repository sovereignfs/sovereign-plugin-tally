'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { expensePayers, expenseSplits, expenses, groupMembers } from '../_db/schema';
import { CATEGORY_OPTIONS } from './categories';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { newId } from './ids';
import { requireGroupMember } from './membership';
import { distributeByWeights } from './rounding';

const VALID_CATEGORIES = new Set<string>(CATEGORY_OPTIONS.map((c) => c.value));

export type { ActionResult };

/**
 * One participant's raw input, as collected client-side and sent as a
 * JSON blob (see `ExpenseForm`'s doc comment for why: a dynamic per-member
 * weight/amount list doesn't map cleanly onto plain FormData field names).
 *
 * - 'equal': `weight` ignored, every participant gets weight 1.
 * - 'percentage': `weight` is a plain 0–100 number (not yet basis points —
 *   this file multiplies by 100 before calling `distributeByWeights` and
 *   before storing `shareUnits`, matching SPEC.md §3's basis-point convention).
 * - 'shares': `weight` is the raw share count (may be fractional).
 * - 'amount': `amountCents` is the participant's exact resolved share —
 *   no weight-based distribution happens for this method at all.
 */
interface ParticipantInput {
  memberId: string;
  weight?: number;
  amountCents?: number;
}

/**
 * v1 scoping decision, tracked here rather than silently assumed: a
 * single payer per expense. `expense_payers` supports more than one
 * (SPEC.md §3, for a large bill two people split paying), but multi-payer
 * input is a real added form-complexity that doesn't block proving the
 * core split mechanic — a real future addition, not an oversight.
 */
export async function createExpenseAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const groupId = String(formData.get('groupId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const amountCents = Number(formData.get('amountCents') ?? '');
  const currency = String(formData.get('currency') ?? '')
    .trim()
    .toUpperCase();
  const categoryInput = String(formData.get('category') ?? '').trim();
  const category = categoryInput && VALID_CATEGORIES.has(categoryInput) ? categoryInput : null;
  const occurredOnDate = String(formData.get('occurredOn') ?? '');
  const splitMethod = String(formData.get('splitMethod') ?? '');
  const payerMemberId = String(formData.get('payerMemberId') ?? '');
  const participantsRaw = String(formData.get('participants') ?? '[]');

  if (!groupId) return { ok: false, error: 'Missing group.' };
  await requireGroupMember(db, tenantId, userId, groupId);

  if (!description) return { ok: false, error: 'Enter a description.' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'Choose a currency.' };
  if (!['equal', 'amount', 'percentage', 'shares'].includes(splitMethod)) {
    return { ok: false, error: 'Choose a split method.' };
  }
  const occurredOn = occurredOnDate ? Math.floor(new Date(occurredOnDate).getTime() / 1000) : now();
  if (!Number.isFinite(occurredOn)) return { ok: false, error: 'Enter a valid date.' };

  let participants: ParticipantInput[];
  try {
    participants = JSON.parse(participantsRaw);
  } catch {
    return { ok: false, error: 'Invalid split data.' };
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    return { ok: false, error: 'Select at least one person to split with.' };
  }

  // Every referenced member (payer + participants) must be an active
  // member of this group — never trust client-supplied ids without
  // re-checking against the real membership table.
  const activeMembers = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );
  const activeMemberIds = new Set(activeMembers.map((m) => m.id));
  if (!activeMemberIds.has(payerMemberId)) return { ok: false, error: 'Choose who paid.' };
  for (const p of participants) {
    if (!activeMemberIds.has(p.memberId)) return { ok: false, error: 'Invalid participant.' };
  }

  const order = participants.map((p) => p.memberId);
  let splits: { memberId: string; shareAmountCents: number; shareUnits: number | null }[];

  if (splitMethod === 'amount') {
    const sum = participants.reduce((acc, p) => acc + (p.amountCents ?? 0), 0);
    if (sum !== amountCents) {
      return { ok: false, error: `Split amounts (${sum / 100}) must add up to the total (${amountCents / 100}).` };
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
      } else if (splitMethod === 'percentage') {
        const basisPoints = Math.round((p.weight ?? 0) * 100);
        weights.set(p.memberId, basisPoints);
        shareUnitsByMember.set(p.memberId, basisPoints);
      } else {
        // 'shares'
        const shareUnits = Math.round((p.weight ?? 0) * 100);
        weights.set(p.memberId, p.weight ?? 0);
        shareUnitsByMember.set(p.memberId, shareUnits);
      }
    }
    const totalWeight = order.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
    if (totalWeight <= 0) return { ok: false, error: 'Split shares must add up to more than zero.' };

    const resolved = distributeByWeights(amountCents, weights, order);
    splits = order.map((memberId) => ({
      memberId,
      shareAmountCents: resolved.get(memberId) ?? 0,
      shareUnits: shareUnitsByMember.get(memberId) ?? null,
    }));
  }

  const expenseId = newId();
  const timestamp = now();

  await db.insert(expenses).values({
    id: expenseId,
    groupId,
    tenantId,
    description,
    amountCents,
    currency,
    category,
    occurredOn,
    splitMethod,
    createdByUserId: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(expensePayers).values({
    id: newId(),
    expenseId,
    memberId: payerMemberId,
    amountCents,
  });

  await db.insert(expenseSplits).values(
    splits.map((s) => ({
      id: newId(),
      expenseId,
      memberId: s.memberId,
      shareAmountCents: s.shareAmountCents,
      shareUnits: s.shareUnits,
    })),
  );

  revalidatePath('/tally/groups');
  return { ok: true, message: `Added "${description}".` };
}
