import { EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { formatMoney, formatRelativeTime } from '../../_lib/activity';
import { getInboxFeed } from '../../_lib/inbox';
import { resendGuestInviteAction } from '../../_lib/group-settings';
import { sendReminderAction } from '../../_lib/reminders';
import { InboxActionButton } from '../../_components/InboxActionButton';
import styles from './page.module.css';

/** Rows shown before the feed is truncated — not the full spec (which has
 *  no cap, since real pagination/notification-center integration was
 *  deferred), just a sane bound so a long-lived account's Inbox doesn't
 *  render unbounded rows. */
const FEED_CAP = 50;

/**
 * Inbox (UI-FLOW.md §5) — the full merged feed as of 2026-08-27: plain
 * activity rows (expenses/settlements, shipped 2026-08-27) plus the two
 * actionable row kinds the spec's mockup shows inline — a bounced guest
 * invite (`[Resend]`, reusing `resendGuestInviteAction`) and an unpaid
 * balance (`[Remind]`, the new `sendReminderAction`) — reusing the exact
 * same description functions as the Group/Person activity feeds so the
 * same event reads identically everywhere. The Notification Center
 * unread-count tie-in and the sidebar's own unread badge are a separate
 * follow-up, not built here — see `app/_lib/inbox.ts`'s own doc comment.
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
            {items.map((item) => {
              if (item.kind === 'bounced_invite') {
                return (
                  <li key={item.id} className={styles.row}>
                    <span className={styles.description}>
                      <Icon
                        name="alert-triangle"
                        size="sm"
                        aria-hidden
                        className={styles.warningIcon}
                      />
                      {item.guestName}&rsquo;s invite email bounced
                      <InboxActionButton
                        label="Resend"
                        pendingLabel="Resending…"
                        action={resendGuestInviteAction.bind(null, item.groupId, item.memberId)}
                      />
                    </span>
                    <span className={styles.meta}>
                      {item.groupName} · {formatRelativeTime(item.occurredOn, now)}
                    </span>
                  </li>
                );
              }
              if (item.kind === 'balance_reminder') {
                return (
                  <li key={item.id} className={styles.row}>
                    <span className={styles.description}>
                      {item.counterpartyLabel} owes you{' '}
                      {formatMoney(item.amountCents, item.currency)}
                      <InboxActionButton
                        label="Remind"
                        pendingLabel="Sending…"
                        action={sendReminderAction.bind(null, item.groupId, item.memberId)}
                      />
                    </span>
                    <span className={styles.meta}>
                      {item.groupName} · {formatRelativeTime(item.occurredOn, now)}
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.id} className={styles.row}>
                  <span className={styles.description}>
                    {item.description}
                    {item.note && <span className={styles.note}> — {item.note}</span>}
                  </span>
                  <span className={styles.meta}>
                    {item.groupName} · {formatRelativeTime(item.occurredOn, now)}
                  </span>
                </li>
              );
            })}
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
