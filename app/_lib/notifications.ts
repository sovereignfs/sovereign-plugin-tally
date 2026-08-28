import { sdk } from '@sovereignfs/sdk';

const PLUGIN_ID = 'fs.sovereign.tally';

/**
 * The sidebar/mobile-footer "Inbox" unread badge (UI-FLOW.md §5) — ties
 * into the platform's real Notification Center rather than a Tally-only
 * counter, so the number shown here is consistent with what the platform
 * bell shows for the same notifications. `sdk.notifications.list()` is
 * explicitly **not** scoped to the calling plugin (it's the same
 * cross-plugin inbox the bell reads), so this filters to Tally's own
 * `source` client-side — there is no server-side per-plugin filter on this
 * SDK call today. Capped at the SDK's own max `limit` (100, host-enforced)
 * — a user with a very active cross-plugin inbox could theoretically have
 * more than 100 total notifications with some of Tally's own pushed past
 * that window, undercounting in that edge case; not worth a bigger
 * mechanism for a decorative badge.
 *
 * Deliberately not live-polled — fetched once per server render (same
 * request as the rest of the layout), so the badge is accurate as of the
 * last navigation, not updated in real time the way the platform bell's
 * own poll/SSE loop is. That loop is platform-private state
 * (`runtime/app/(platform)/_components/NotificationBell.tsx`, not
 * reachable from a plugin — importing it would violate the SDK boundary
 * rule), and building an equivalent independent poll loop just for one
 * sidebar badge is disproportionate. "Consistent with the bell" (UI-FLOW.md's
 * own phrasing) means same underlying data, not same refresh cadence.
 */
export async function getUnreadInboxCount(): Promise<number> {
  try {
    const { items } = await sdk.notifications.list({ limit: 100 });
    return items.filter((item) => item.source === PLUGIN_ID && item.readAt === null).length;
  } catch {
    return 0;
  }
}
