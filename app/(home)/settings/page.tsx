import { PageHeader } from '@sovereignfs/ui';
import styles from '../page.module.css';

/**
 * Account-level Settings (UI-FLOW.md §8) — Primary Currency, a
 * default-currency + display-order preference only, never a conversion
 * input (SPEC.md §4: no currency conversion anywhere in v1). Real data
 * lands in a later task; this is the routing/layout scaffold only.
 */
export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Settings" />
      <p className={styles.placeholder}>Primary Currency will be set here.</p>
    </div>
  );
}
