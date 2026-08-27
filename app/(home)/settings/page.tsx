import { Card, PageHeader } from '@sovereignfs/ui';
import { PrimaryCurrencyForm } from '../../_components/PrimaryCurrencyForm';
import { getUserSettings } from '../../_lib/settings';
import styles from './page.module.css';

/**
 * Account-level Settings (UI-FLOW.md §8) — Primary Currency only. The
 * disclaimer is required on-screen, per spec, so it's never mistaken for
 * a currency-conversion setting (SPEC.md §4: no conversion anywhere in
 * v1) — carried as `PageHeader`'s own `description`, its intended slot.
 */
export default async function SettingsPage() {
  const { primaryCurrency } = await getUserSettings();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Settings"
        description="Sets your default currency — Tally never converts between currencies."
      />
      <Card padding="md" className={styles.card}>
        <PrimaryCurrencyForm primaryCurrency={primaryCurrency} />
      </Card>
    </div>
  );
}
