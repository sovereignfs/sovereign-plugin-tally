import { PageHeader } from '@sovereignfs/ui';
import styles from '../page.module.css';

/**
 * Inbox (UI-FLOW.md §5) — one merged feed of activity/notifications/
 * actionable items. Deliberately named the same as Docs'/Sheets' own
 * Inbox despite meaning something different — see UI-FLOW.md §5's note.
 * Real data lands in a later task; this is the routing/layout scaffold
 * only.
 */
export default function InboxPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Inbox" />
      <p className={styles.placeholder}>
        Expense activity, settlements, and things needing your attention will show up here.
      </p>
    </div>
  );
}
