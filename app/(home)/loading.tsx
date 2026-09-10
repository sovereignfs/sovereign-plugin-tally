import { Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * Every Tally view under this route group blocks on the database before it
 * can render (Overview/Groups/People/Inbox/Settings all `await` their data)
 * — without this the sidebar shell mounts first and the content column
 * stays blank until the fetch resolves.
 */
export default function TallyLoading() {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
