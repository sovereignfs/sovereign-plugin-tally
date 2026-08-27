import { EmptyState, PageHeader } from '@sovereignfs/ui';
import { formatRelativeTime } from '../../_lib/activity';
import { getInboxFeed } from '../../_lib/inbox';
import styles from './page.module.css';

/** Rows shown before the feed is truncated — not the full spec (which has
 *  no cap, since real pagination/notification-center integration was
 *  deferred), just a sane bound so a long-lived account's Inbox doesn't
 *  render unbounded rows. */
const FEED_CAP = 50;

/**
 * Inbox (UI-FLOW.md §5, scoped 2026-08-27) — the merged feed's "plain
 * rows" half: every expense/settlement across every group, flattened and
 * sorted most-recent first, reusing the exact same description functions
 * as the Group/Person activity feeds so the same event reads identically
 * everywhere. Actionable rows (`[Resend]`/`[Remind]`) and the Notification
 * Center unread-count tie-in are deliberately deferred — see
 * `app/_lib/inbox.ts`'s own doc comment for why.
 */
export default async function InboxPage() {
  const data = await getInboxFeed();
  const now = Math.floor(Date.now() / 1000);

  if (!data.hasGroups) {
    return (
      <div className={styles.page}>
        <PageHeader title="Inbox" />
        <EmptyState
          icon="inbox"
          heading="Nothing here yet"
          description="Expense activity, settlements, and things needing your attention will show up here."
        />
      </div>
    );
  }

  const items = data.items.slice(0, FEED_CAP);

  return (
    <div className={styles.page}>
      <PageHeader title="Inbox" />
      {items.length === 0 ? (
        <p className={styles.placeholder}>
          Expense activity, settlements, and things needing your attention will show up here.
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.row}>
                <span className={styles.description}>
                  {item.description}
                  {item.note && <span className={styles.note}> — {item.note}</span>}
                </span>
                <span className={styles.meta}>
                  {item.groupName} · {formatRelativeTime(item.occurredOn, now)}
                </span>
              </li>
            ))}
          </ul>
          {data.items.length > FEED_CAP && (
            <p className={styles.placeholder}>
              Showing the {FEED_CAP} most recent. Older activity isn&rsquo;t shown yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
