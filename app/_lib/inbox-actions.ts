'use server';

import { sdk } from '@sovereignfs/sdk';
import { getContext } from './context';

const PLUGIN_ID = 'fs.sovereign.tally';

/**
 * Opening Inbox marks Tally's own unread notifications read — the sidebar
 * badge counts them (`getUnreadInboxCount`), so a visit that showed the
 * activity behind them must clear it, exactly as the platform bell does.
 * Scoped to Tally's `source` only: `markAllRead()` would clear every
 * plugin's notifications, which this page never displayed.
 */
export async function markTallyNotificationsReadAction(): Promise<{ marked: number }> {
  await getContext();
  try {
    const { items } = await sdk.notifications.list({ limit: 100 });
    const unread = items.filter((item) => item.source === PLUGIN_ID && item.readAt === null);
    await Promise.allSettled(unread.map((item) => sdk.notifications.markRead(item.id)));
    return { marked: unread.length };
  } catch {
    return { marked: 0 };
  }
}
