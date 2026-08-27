'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { groupMembers, settlements } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { newId } from './ids';
import { requireGroupMember } from './membership';

export type { ActionResult };

/**
 * Records that a payment already happened outside Tally — no payment
 * rail is ever touched (SPEC.md §3/§4). Pre-filled from a debt-
 * simplification suggestion (`app/_lib/balances.ts`'s `simplifyDebts`) in
 * the current UI (UI-FLOW.md §4) — `fromMemberId`/`toMemberId`/
 * `amountCents` arrive already resolved, but are re-validated here rather
 * than trusted, same discipline as `createExpenseAction`.
 */
export async function recordSettlementAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const groupId = String(formData.get('groupId') ?? '');
  const fromMemberId = String(formData.get('fromMemberId') ?? '');
  const toMemberId = String(formData.get('toMemberId') ?? '');
  const amountCents = Number(formData.get('amountCents') ?? '');
  const currency = String(formData.get('currency') ?? '')
    .trim()
    .toUpperCase();
  const note = String(formData.get('note') ?? '').trim() || null;
  const settledOnDate = String(formData.get('settledOn') ?? '');

  if (!groupId) return { ok: false, error: 'Missing group.' };
  await requireGroupMember(db, tenantId, userId, groupId);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  // Absent for `SettleUpButton`'s hidden-field form (always "now"); present
  // and user-editable for `RecordSettlementDialog`'s general form, so a
  // payment that happened earlier can be backdated (SPEC.md §3 —
  // `settledOn` is "when the real-world payment happened", distinct from
  // `createdAt`).
  const settledOn = settledOnDate ? Math.floor(new Date(settledOnDate).getTime() / 1000) : now();
  if (!Number.isFinite(settledOn)) return { ok: false, error: 'Enter a valid date.' };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'Choose a currency.' };
  if (!fromMemberId || !toMemberId || fromMemberId === toMemberId) {
    return { ok: false, error: 'Choose who paid and who received it.' };
  }

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
  if (!activeMemberIds.has(fromMemberId) || !activeMemberIds.has(toMemberId)) {
    return { ok: false, error: 'Invalid participant.' };
  }

  await db.insert(settlements).values({
    id: newId(),
    groupId,
    tenantId,
    fromMemberId,
    toMemberId,
    amountCents,
    currency,
    note,
    settledOn,
    createdByUserId: userId,
    createdAt: now(),
  });

  revalidatePath('/tally/groups');
  return { ok: true, message: 'Settled up.' };
}
