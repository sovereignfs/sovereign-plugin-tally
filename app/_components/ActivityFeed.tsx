import { formatActivityDate, formatMoney, type GroupActivityMonth } from '../_lib/activity';
import styles from './ActivityFeed.module.css';

/**
 * Month-grouped, described expense + settlement timeline — shared by
 * `@detail/groups`'s per-group feed and `@detail/people`'s per-person
 * feed rather than duplicating the same list markup twice (found once
 * already worth avoiding: `resolveCounterparties`/`BalanceChipStack`'s
 * own extraction, this session).
 */
export function ActivityFeed({
  months,
  showGroupName = false,
}: {
  months: GroupActivityMonth[];
  /** Append each row's `groupName` after its category — relevant only
   *  when a feed spans more than one group (a person's cross-group
   *  timeline); redundant on a single group's own detail pane. */
  showGroupName?: boolean;
}) {
  if (months.length === 0) {
    return <p className={styles.placeholder}>No activity yet.</p>;
  }
  return (
    <>
      {months.map((month) => (
        <div key={month.monthKey} className={styles.month}>
          <h4 className={styles.monthHeading}>{month.monthLabel}</h4>
          <ul className={styles.list}>
            {month.items.map((item) => (
              <li key={item.id} className={styles.row}>
                <span className={styles.date}>{formatActivityDate(item.occurredOn)}</span>
                <span className={styles.body}>
                  <span className={styles.category}>
                    {item.categoryLabel}
                    {showGroupName && item.groupName ? ` · ${item.groupName}` : ''}
                  </span>
                  <span className={styles.description}>{item.description}</span>
                  {item.note && <span className={styles.note}>{item.note}</span>}
                </span>
                <span className={styles.amount}>{formatMoney(item.amountCents, item.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
