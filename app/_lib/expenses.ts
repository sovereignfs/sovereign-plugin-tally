'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { sdk } from '@sovereignfs/sdk';
import { expensePayers, expenseSplits, expenses, groupMembers } from '../_db/schema';
import { formatMoney } from './activity';
import type { ActionResult, Db } from './context';
import { getContext, now, revalidateTallyViews } from './context';
import { MAX_RECEIPT_BYTES, parseExpenseInput, type RawExpenseInput } from './expense-input';
import { newId } from './ids';
import { requireGroupMember, requireGroupOpen, runGuarded } from './membership';
import { receiptStorageKeyFor } from './receipts';

export type { ActionResult };

function readRawInput(formData: FormData): RawExpenseInput {
  const field = (name: string) => String(formData.get(name) ?? '');
  return {
    description: field('description'),
    amountCents: field('amountCents'),
    currency: field('currency'),
    category: field('category'),
    occurredOn: field('occurredOn'),
    notes: field('notes'),
    splitMethod: field('splitMethod'),
    payers: field('payers'),
    participants: field('participants'),
  };
}

async function loadActiveMembers(db: Db, tenantId: string, groupId: string) {
  return db
    .select({ id: groupMembers.id, kind: groupMembers.kind, userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );
}

/**
 * Receipt attach (SPEC.md §8) is optional and best-effort: a storage hiccup
 * surfaces as a warning appended to the success message rather than failing
 * the whole expense — the split data the user just entered is the primary
 * value here, not the attachment. Size is checked *before* the body is read
 * into memory.
 */
async function storeReceipt(
  expenseId: string,
  file: FormDataEntryValue | null,
): Promise<{ key: string | null; warning: string | null }> {
  if (!(file instanceof File) || file.size === 0) return { key: null, warning: null };
  if (!file.type.startsWith('image/')) {
    return { key: null, warning: 'Receipt not attached: only image files are supported.' };
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return {
      key: null,
      warning: `Receipt not attached: images must be under ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB.`,
    };
  }
  try {
    const key = receiptStorageKeyFor(expenseId, file.name);
    await sdk.storage.put({ key, body: await file.arrayBuffer(), contentType: file.type });
    return { key, warning: null };
  } catch (err) {
    return {
      key: null,
      warning: `Receipt not attached: ${err instanceof Error ? err.message : 'upload failed'}.`,
    };
  }
}

async function deleteReceiptQuietly(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await sdk.storage.delete(key);
  } catch {
    // An orphaned object is a storage-quota concern, never a ledger one.
  }
}

/**
 * "Expense added/edited/deleted by someone else" (SPEC.md §6) — every other
 * active user-kind member, never guests (no session to notify). Best-effort:
 * `Promise.allSettled` so one recipient's failure never affects another's,
 * or the already-committed write.
 */
async function notifyOtherMembers(
  members: { kind: string; userId: string | null }[],
  actorUserId: string,
  message: { title: string; body: string; url: string },
): Promise<void> {
  const recipients = members
    .filter((m) => m.kind === 'user' && m.userId && m.userId !== actorUserId)
    .map((m) => m.userId as string);
  if (recipients.length === 0) return;
  const requestHeaders = await headers();
  await Promise.allSettled(
    recipients.map((recipientUserId) =>
      sdk.notifications.send({ recipientUserId, ...message }, requestHeaders),
    ),
  );
}

/**
 * Adds an expense. Payers (one or more) and the resolved per-member split
 * are validated by the pure `parseExpenseInput` against the group's *real*
 * active member set — never trusting client-supplied ids — and every row
 * lands in one transaction, so a failure part-way can't leave a payer
 * credited with a total nobody owes.
 */
export async function createExpenseAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runGuarded(async () => {
    const { db, userId, tenantId } = await getContext();
    const groupId = String(formData.get('groupId') ?? '');
    if (!groupId) return { ok: false, error: 'Missing group.' };
    await requireGroupMember(db, tenantId, userId, groupId);
    await requireGroupOpen(db, tenantId, groupId);

    const activeMembers = await loadActiveMembers(db, tenantId, groupId);
    const parsed = parseExpenseInput(
      readRawInput(formData),
      new Set(activeMembers.map((m) => m.id)),
      now(),
    );
    if (!parsed.ok) return parsed;
    const input = parsed.value;

    const expenseId = newId();
    const timestamp = now();
    const receipt = await storeReceipt(expenseId, formData.get('receipt'));

    await db.transaction(async (tx) => {
      await tx.insert(expenses).values({
        id: expenseId,
        groupId,
        tenantId,
        description: input.description,
        amountCents: input.amountCents,
        currency: input.currency,
        category: input.category,
        occurredOn: input.occurredOn,
        notes: input.notes,
        splitMethod: input.splitMethod,
        createdByUserId: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        receiptStorageKey: receipt.key,
      });
      await tx.insert(expensePayers).values(
        input.payers.map((p) => ({
          id: newId(),
          expenseId,
          memberId: p.memberId,
          amountCents: p.amountCents,
        })),
      );
      await tx.insert(expenseSplits).values(
        input.splits.map((s) => ({
          id: newId(),
          expenseId,
          memberId: s.memberId,
          shareAmountCents: s.shareAmountCents,
          shareUnits: s.shareUnits,
        })),
      );
    });

    void sdk.activity.log({
      action: 'expense.added',
      targetType: 'expense',
      targetId: expenseId,
      summary: `Added "${input.description}" (${formatMoney(input.amountCents, input.currency)})`,
    });

    await notifyOtherMembers(activeMembers, userId, {
      title: 'New expense added',
      body: `${input.description} — ${formatMoney(input.amountCents, input.currency)}`,
      url: `/tally/groups?g=${groupId}`,
    });

    revalidateTallyViews();
    return {
      ok: true,
      message: receipt.warning
        ? `Added "${input.description}". ${receipt.warning}`
        : `Added "${input.description}".`,
    };
  });
}

/**
 * Edits an expense in place — any active member may edit any expense
 * (Splitwise's trust model, SPEC.md §6), the audit trail is the activity
 * log. Payer and split rows are replaced wholesale inside the same
 * transaction as the expense update. A newly attached receipt replaces
 * (and removes) the previous object; `removeReceipt=on` drops it.
 */
export async function updateExpenseAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runGuarded(async () => {
    const { db, userId, tenantId } = await getContext();
    const groupId = String(formData.get('groupId') ?? '');
    const expenseId = String(formData.get('expenseId') ?? '');
    if (!groupId || !expenseId) return { ok: false, error: 'Missing expense.' };
    await requireGroupMember(db, tenantId, userId, groupId);
    await requireGroupOpen(db, tenantId, groupId);

    const [existing] = await db
      .select({ id: expenses.id, receiptStorageKey: expenses.receiptStorageKey })
      .from(expenses)
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, groupId),
          eq(expenses.tenantId, tenantId),
          isNull(expenses.deletedAt),
        ),
      );
    if (!existing) return { ok: false, error: 'This expense no longer exists.' };

    const activeMembers = await loadActiveMembers(db, tenantId, groupId);
    const parsed = parseExpenseInput(
      readRawInput(formData),
      new Set(activeMembers.map((m) => m.id)),
      now(),
    );
    if (!parsed.ok) return parsed;
    const input = parsed.value;

    let receiptStorageKey = existing.receiptStorageKey;
    let receiptWarning: string | null = null;
    const removeReceipt = String(formData.get('removeReceipt') ?? '') === 'on';
    const uploaded = await storeReceipt(expenseId, formData.get('receipt'));
    receiptWarning = uploaded.warning;
    if (uploaded.key) {
      if (existing.receiptStorageKey && existing.receiptStorageKey !== uploaded.key) {
        await deleteReceiptQuietly(existing.receiptStorageKey);
      }
      receiptStorageKey = uploaded.key;
    } else if (removeReceipt && existing.receiptStorageKey) {
      await deleteReceiptQuietly(existing.receiptStorageKey);
      receiptStorageKey = null;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(expenses)
        .set({
          description: input.description,
          amountCents: input.amountCents,
          currency: input.currency,
          category: input.category,
          occurredOn: input.occurredOn,
          notes: input.notes,
          splitMethod: input.splitMethod,
          receiptStorageKey,
          updatedAt: now(),
        })
        .where(eq(expenses.id, expenseId));
      await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
      await tx.insert(expensePayers).values(
        input.payers.map((p) => ({
          id: newId(),
          expenseId,
          memberId: p.memberId,
          amountCents: p.amountCents,
        })),
      );
      await tx.insert(expenseSplits).values(
        input.splits.map((s) => ({
          id: newId(),
          expenseId,
          memberId: s.memberId,
          shareAmountCents: s.shareAmountCents,
          shareUnits: s.shareUnits,
        })),
      );
    });

    void sdk.activity.log({
      action: 'expense.updated',
      targetType: 'expense',
      targetId: expenseId,
      summary: `Edited "${input.description}" (${formatMoney(input.amountCents, input.currency)})`,
    });

    await notifyOtherMembers(activeMembers, userId, {
      title: 'Expense updated',
      body: `${input.description} — ${formatMoney(input.amountCents, input.currency)}`,
      url: `/tally/groups?g=${groupId}`,
    });

    revalidateTallyViews();
    return {
      ok: true,
      message: receiptWarning
        ? `Saved "${input.description}". ${receiptWarning}`
        : `Saved "${input.description}".`,
    };
  });
}

/** Soft delete (SPEC.md §3) — the row stays for the audit trail and for
 *  "Delete vs. Close" history checks; balances stop counting it at once. */
export async function deleteExpenseAction(
  groupId: string,
  expenseId: string,
): Promise<ActionResult> {
  return runGuarded(async () => {
    const { db, userId, tenantId } = await getContext();
    await requireGroupMember(db, tenantId, userId, groupId);
    await requireGroupOpen(db, tenantId, groupId);

    const [existing] = await db
      .select({
        id: expenses.id,
        description: expenses.description,
        amountCents: expenses.amountCents,
        currency: expenses.currency,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, groupId),
          eq(expenses.tenantId, tenantId),
          isNull(expenses.deletedAt),
        ),
      );
    if (!existing) return { ok: true, message: 'Already deleted.' };

    const timestamp = now();
    await db
      .update(expenses)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(eq(expenses.id, expenseId));

    void sdk.activity.log({
      action: 'expense.deleted',
      targetType: 'expense',
      targetId: expenseId,
      summary: `Deleted "${existing.description}" (${formatMoney(existing.amountCents, existing.currency)})`,
    });

    const activeMembers = await loadActiveMembers(db, tenantId, groupId);
    await notifyOtherMembers(activeMembers, userId, {
      title: 'Expense deleted',
      body: `${existing.description} — ${formatMoney(existing.amountCents, existing.currency)}`,
      url: `/tally/groups?g=${groupId}`,
    });

    revalidateTallyViews();
    return { ok: true, message: `Deleted "${existing.description}".` };
  });
}
