import { formatMoney } from '../_lib/activity';
import type { CurrencyAmount } from '../_lib/balances';
import styles from './CurrencyStack.module.css';

/** Currency lines shown before "+N more" takes over — same safety valve
 *  as `BalanceChipStack`'s `STACK_CAP`, for the same reason (a headline
 *  or stat card spanning more than one currency is the normal case). */
const STACK_CAP = 2;

/**
 * Plain-text stacked currency amounts for a headline/stat card — Overview
 * and the People page's summary block both need "You're owed X / You owe
 * Y" rendered the same way. `BalanceChipStack` is the sibling component
 * for a breakdown row's trailing `BalanceChip`(s); this one is for a
 * card's own big number, no chip styling.
 */
export function CurrencyStack({
  amounts,
  tone,
  size = 'lg',
}: {
  amounts: CurrencyAmount[];
  tone: 'success' | 'danger' | 'neutral';
  size?: 'lg' | 'sm';
}) {
  if (amounts.length === 0) {
    return <p className={styles.empty}>—</p>;
  }
  const shown = amounts.slice(0, STACK_CAP);
  const overflow = amounts.length - shown.length;
  const lineClass = size === 'lg' ? styles.lineLg : styles.lineSm;
  const toneClass = { success: styles.toneSuccess, danger: styles.toneDanger, neutral: '' }[tone];
  return (
    <>
      {shown.map((amount) => (
        <p key={amount.currency} className={[lineClass, toneClass].filter(Boolean).join(' ')}>
          {formatMoney(amount.amountCents, amount.currency)}
        </p>
      ))}
      {overflow > 0 && (
        <p className={styles.overflow}>
          +{overflow} more currenc{overflow === 1 ? 'y' : 'ies'}
        </p>
      )}
    </>
  );
}
