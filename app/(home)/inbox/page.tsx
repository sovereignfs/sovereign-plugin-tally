import { EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { formatMoney, formatRelativeTime } from '../../_lib/activity';
import { getInboxFeed } from '../../_lib/inbox';
import { resendGuestInviteAction } from '../../_lib/group-settings';
import { sendReminderAction } from '../../_lib/reminders';
import { InboxActionButton } from '../../_components/InboxActionButton';
import { InboxMarkRead } from '../../_components/InboxMarkRead';
import { MobilePageActions } from '../../_components/MobilePageActions';
import styles from './page.module.css';

/** Rows shown before the feed is truncated — a sane bound so a long-lived
 *  account's Inbox doesn't render unbounded rows. */
const FEED_CAP = 50;

/**
 * Inbox (UI-FLOW.md §5) — one merged feed: plain activity rows plus the two
 * actionable row kinds the spec's mockup shows inline — a bounced guest
 * invite (`[Resend]`) and an unpaid balance (`[Remind]`). Rows are ordered
 * and time-stamped by when they were *recorded*, so a backdated expense
 * added today still reads as today's news. Visiting marks Tally's unread
 * notifications read, clearing the sidebar/footer badge (`InboxMarkRead`).
 */
export default async function InboxPage() {
  const data = await getInboxFeed();
  const now = Math.floor(Date.now() / 1000);

  if (!data.hasGroups) {
    return (
      <div className={styles.page}>
        <PageHeader title="Inbox" action={<MobilePageActions />} />
        <InboxMarkRead />
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
      <PageHeader title="Inbox" action={<MobilePageActions />} />
      <InboxMarkRead />
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
                      {item.groupName} · {formatRelativeTime(item.recordedAt, now)}
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
                        icon="send"
                        action={sendReminderAction.bind(null, item.groupId, item.memberId)}
                      />
                    </span>
                    <span className={styles.meta}>
                      {item.groupName} · {formatRelativeTime(item.recordedAt, now)}
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.id} className={styles.row}>
                  <span className={styles.body}>
                    <span className={styles.description}>
                      {item.description}
                      {item.note && <span className={styles.note}> — {item.note}</span>}
                    </span>
                    {item.myPosition && <span className={styles.position}>{item.myPosition}</span>}
                  </span>
                  <span className={styles.meta}>
                    {item.groupName} · {formatRelativeTime(item.recordedAt, now)}
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
