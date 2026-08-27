import { PageHeader } from '@sovereignfs/ui';
import styles from './page.module.css';

/**
 * Overview (UI-FLOW.md §3) — headline rollup, groups needing attention,
 * spend by category, monthly/yearly trend. Real aggregation queries land
 * in a later task (ROADMAP.md, "Post-MVP-minus-chrome" item 3); this is
 * the routing/layout scaffold only.
 */
export default function OverviewPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Overview" />
      <p className={styles.placeholder}>
        Your balance rollup, spend by category, and recent activity will show up here.
      </p>
    </div>
  );
}
