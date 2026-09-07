'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { sdk } from '@sovereignfs/sdk';
import { groupMembers, settlements } from '../_db/schema';
import { formatMoney } from './activity';
import type { ActionResult } from './context';
import { getContext, now, revalidateTallyViews } from './context';
import { isSupportedCurrency } from './currencies';
import { parseDateInput } from './expense-input';
import { newId } from './ids';
import { requireGroupMember, requireGroupOpen, runGuarded } from './membership';

export type { ActionResult };

const MAX_AMOUNT_CENTS = 2_000_000_000;

/**
 * Records that a payment already happened outside Tally — no payment
 * rail is ever touched (SPEC.md §3/§4). Pre-filled from a suggested payment
 * (`app/_lib/balances.ts`) in the current UI (UI-FLOW.md §4) —
 * `fromMemberId`/`toMemberId`/`amountCents` arrive already resolved, but
 * are re-validated here rather than trusted, same discipline as
 * `createExpenseAction`.
 */
export async function recordSettlementAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runGuarded(async () => {
    const { db, userId, tenantId } = await getContext();

    const groupId = String(formData.get('groupId') ?? '');
    const fromMemberId = String(formData.get('fromMemberId') ?? '');
    const toMemberId = String(formData.get('toMemberId') ?? '');
    const amountCents = Number(formData.get('amountCents') ?? '');
    const currency = String(formData.get('currency') ?? '')
      .trim()
      .toUpperCase();
    const note = String(formData.get('note') ?? '').trim() || null;
    const settledOnInput = String(formData.get('settledOn') ?? '');

    if (!groupId) return { ok: false, error: 'Missing group.' };
    await requireGroupMember(db, tenantId, userId, groupId);
    await requireGroupOpen(db, tenantId, groupId);

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: 'Enter a valid amount.' };
    }
    if (amountCents > MAX_AMOUNT_CENTS) return { ok: false, error: 'That amount is too large.' };
    // Absent for `SettleUpButton`'s hidden-field form (always "today");
    // present and user-editable for `RecordSettlementDialog`'s general form,
    // so a payment that happened earlier can be backdated.
    const settledOn = parseDateInput(settledOnInput, now());
    if (settledOn === null) return { ok: false, error: 'Enter a valid date.' };
    if (!isSupportedCurrency(currency)) return { ok: false, error: 'Choose a currency.' };
    if (!fromMemberId || !toMemberId || fromMemberId === toMemberId) {
      return { ok: false, error: 'Choose who paid and who received it.' };
    }
    if (note && note.length > 500)
      return { ok: false, error: 'Keep the note under 500 characters.' };

    const activeMembers = await db
      .select({ id: groupMembers.id, kind: groupMembers.kind, userId: groupMembers.userId })
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

    const settlementId = newId();
    await db.insert(settlements).values({
      id: settlementId,
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

    void sdk.activity.log({
      action: 'settlement.recorded',
      targetType: 'settlement',
      targetId: settlementId,
      summary: `Recorded a payment of ${formatMoney(amountCents, currency)}`,
    });

    await notifyCounterparty(activeMembers, userId, fromMemberId, toMemberId, {
      title: 'Settlement recorded',
      body: `A payment of ${formatMoney(amountCents, currency)} was recorded.`,
      url: `/tally/groups?g=${groupId}`,
    });

    revalidateTallyViews();
    return { ok: true, message: 'Settled up.' };
  });
}

/**
 * Soft-deletes a settlement — the undo for a mis-tapped "Settle up". Any
 * active member may do it (same trust model as expenses); the activity log
 * records who.
 */
export async function deleteSettlementAction(
  groupId: string,
  settlementId: string,
): Promise<ActionResult> {
  return runGuarded(async () => {
    const { db, userId, tenantId } = await getContext();
    await requireGroupMember(db, tenantId, userId, groupId);
    await requireGroupOpen(db, tenantId, groupId);

    const [existing] = await db
      .select({
        id: settlements.id,
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        currency: settlements.currency,
      })
      .from(settlements)
      .where(
        and(
          eq(settlements.id, settlementId),
          eq(settlements.groupId, groupId),
          eq(settlements.tenantId, tenantId),
          isNull(settlements.deletedAt),
        ),
      );
    if (!existing) return { ok: true, message: 'Already deleted.' };

    await db.update(settlements).set({ deletedAt: now() }).where(eq(settlements.id, settlementId));

    void sdk.activity.log({
      action: 'settlement.deleted',
      targetType: 'settlement',
      targetId: settlementId,
      summary: `Deleted a payment of ${formatMoney(existing.amountCents, existing.currency)}`,
    });

    const activeMembers = await db
      .select({ id: groupMembers.id, kind: groupMembers.kind, userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.tenantId, tenantId),
          isNull(groupMembers.leftAt),
        ),
      );
    await notifyCounterparty(activeMembers, userId, existing.fromMemberId, existing.toMemberId, {
      title: 'Settlement removed',
      body: `A recorded payment of ${formatMoney(existing.amountCents, existing.currency)} was deleted.`,
      url: `/tally/groups?g=${groupId}`,
    });

    revalidateTallyViews();
    return { ok: true, message: 'Payment deleted.' };
  });
}

/**
 * Notify the counterparty (SPEC.md §6) — whichever side the actor wasn't
 * on. When a third party records (or deletes) a payment between two other
 * members, both of them are told. Guests are skipped — no session.
 */
async function notifyCounterparty(
  activeMembers: { id: string; kind: string; userId: string | null }[],
  actorUserId: string,
  fromMemberId: string,
  toMemberId: string,
  message: { title: string; body: string; url: string },
): Promise<void> {
  const myMemberId =
    activeMembers.find((m) => m.kind === 'user' && m.userId === actorUserId)?.id ?? null;
  const targets = [fromMemberId, toMemberId].filter((id) => id !== myMemberId);
  const recipients = targets
    .map((id) => activeMembers.find((m) => m.id === id))
    .filter((m): m is (typeof activeMembers)[number] => Boolean(m && m.kind === 'user' && m.userId))
    .map((m) => m.userId as string);
  if (recipients.length === 0) return;
  const requestHeaders = await headers();
  await Promise.allSettled(
    recipients.map((recipientUserId) =>
      sdk.notifications.send({ recipientUserId, ...message }, requestHeaders),
    ),
  );
}
