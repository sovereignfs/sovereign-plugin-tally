'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { userSettings } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY } from './currencies';

export type { ActionResult };

const VALID_CURRENCIES = new Set<string>(CURRENCY_OPTIONS.map((c) => c.code));

export interface UserSettingsView {
  primaryCurrency: string;
}

/**
 * Account-level Settings (UI-FLOW.md §8) — a default-currency preference
 * only, backing `user_settings.primary_currency`. Two effects, both
 * cosmetic (SPEC.md §4 — no currency conversion anywhere in v1): pre-fills
 * "New group"'s currency field (`groups/page.tsx`), and decides display
 * order on Overview's per-currency rollups (`overview.ts`). Never applied
 * to an expense's own currency default — that already defaults to its
 * group's `defaultCurrency`, a more relevant signal than a personal
 * preference for an expense being added *into* a specific group's ledger.
 *
 * No row exists until the user explicitly saves once — `getUserSettings`
 * returns the app-wide `DEFAULT_CURRENCY` fallback rather than creating
 * one on read (no side effects on a read path).
 */
export async function getUserSettings(): Promise<UserSettingsView> {
  // `tenantId` deliberately not destructured — this is a single-row
  // lookup keyed by `userId` alone (the table's own primary key).
  const { db, userId } = await getContext();
  const [row] = await db
    .select({ primaryCurrency: userSettings.primaryCurrency })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return { primaryCurrency: row?.primaryCurrency ?? DEFAULT_CURRENCY };
}

export async function updateUserSettingsAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const primaryCurrency = String(formData.get('primaryCurrency') ?? '')
    .trim()
    .toUpperCase();
  if (!VALID_CURRENCIES.has(primaryCurrency)) return { ok: false, error: 'Choose a currency.' };

  await db
    .insert(userSettings)
    .values({ userId, tenantId, primaryCurrency, updatedAt: now() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { primaryCurrency, updatedAt: now() },
    });

  void sdk.activity.log({
    action: 'settings.primary_currency_updated',
    targetType: 'user_settings',
    targetId: userId,
    summary: `Primary currency set to ${primaryCurrency}`,
  });

  revalidatePath('/tally/settings');
  revalidatePath('/tally');
  revalidatePath('/tally/groups');
  return { ok: true, message: 'Saved.' };
}
