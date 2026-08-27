import { BalanceChip } from '@sovereignfs/ui';
import type { CurrencyAmount } from '../_lib/balances';
import styles from './BalanceChipStack.module.css';

/** Currency lines/chips shown before "+N more" takes over — a group or
 *  person spanning more than one currency is the normal case (not rare),
 *  so every entry must be reachable, never silently dropped; this is the
 *  safety valve against an unbounded row instead. */
const STACK_CAP = 2;

/**
 * Stacks up to `STACK_CAP` `BalanceChip`s vertically for a breakdown row
 * that may have a balance in more than one currency — Overview's Groups/
 * People breakdown and the Groups list's per-group counterparty preview
 * both hit this (e.g. a person shared across a USD group and a EUR group).
 * Never collapses to one "dominant" currency — found live as a real bug
 * (ROADMAP.md, Overview task) when the first version did exactly that and
 * silently dropped a real balance.
 */
export function BalanceChipStack({
  balances,
  align = 'end',
}: {
  balances: CurrencyAmount[];
  /** 'end' (default) for a row's trailing edge (Overview/Groups list);
   *  'start' for a standalone summary block (`@detail/groups`'s Balance
   *  summary), where right-alignment would read oddly as primary content. */
  align?: 'start' | 'end';
}) {
  const shown = balances.slice(0, STACK_CAP);
  const overflow = balances.length - shown.length;
  return (
    <span className={[styles.stack, align === 'start' ? styles.alignStart : ''].filter(Boolean).join(' ')}>
      {shown.map((balance) => (
        <BalanceChip key={balance.currency} amountCents={balance.amountCents} currency={balance.currency} />
      ))}
      {overflow > 0 && (
        <span className={styles.overflow}>
          +{overflow} more currenc{overflow === 1 ? 'y' : 'ies'}
        </span>
      )}
    </span>
  );
}
