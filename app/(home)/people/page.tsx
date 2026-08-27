import { PageHeader } from '@sovereignfs/ui';
import styles from '../page.module.css';

/**
 * People (UI-FLOW.md §4) — a derived cross-group rollup, not its own
 * table (SPEC.md §4's "Cross-group rollups"). Real data lands in a later
 * task (ROADMAP.md, "Post-MVP-minus-chrome" item 2); this is the
 * routing/layout scaffold only.
 */
export default function PeoplePage() {
  return (
    <div className={styles.page}>
      <PageHeader title="People" />
      <p className={styles.placeholder}>
        Everyone you share a group with, and your balance with each, will show up here.
      </p>
    </div>
  );
}
