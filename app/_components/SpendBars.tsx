import { formatMoney } from '../_lib/activity';
import styles from './SpendBars.module.css';

export interface SpendBarItem {
  key: string;
  label: string;
  currency: string;
  amountCents: number;
}

/**
 * Horizontal bars for a small per-currency breakdown (spend by category,
 * monthly trend) — token-styled `div`s, since the platform has no chart
 * primitive and a five-row breakdown doesn't need one. One bar group per
 * currency; bars scale to the largest value within that currency only,
 * so two currencies are never visually compared (SPEC.md §4).
 */
export function SpendBars({ items, emptyLabel }: { items: SpendBarItem[]; emptyLabel: string }) {
  if (items.length === 0) return <p className={styles.placeholder}>{emptyLabel}</p>;
  const currencies = Array.from(new Set(items.map((i) => i.currency)));
  return (
    <div className={styles.groups}>
      {currencies.map((currency) => {
        const rows = items.filter((i) => i.currency === currency);
        const max = Math.max(...rows.map((r) => r.amountCents), 1);
        return (
          <div key={currency} className={styles.group}>
            {currencies.length > 1 && <p className={styles.currencyLabel}>{currency}</p>}
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.key} className={styles.row}>
                  <span className={styles.label}>{row.label}</span>
                  <span className={styles.track} aria-hidden>
                    <span
                      className={styles.bar}
                      style={{ width: `${Math.round((row.amountCents / max) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.value}>{formatMoney(row.amountCents, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
