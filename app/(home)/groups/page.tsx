import Link from 'next/link';
import { BalanceChip, EmptyState, PageHeader } from '@sovereignfs/ui';
import { BalanceChipStack } from '../../_components/BalanceChipStack';
import { CreateGroupDialog } from '../../_components/CreateGroupDialog';
import { listGroupsForUser } from '../../_lib/groups';
import { getUserSettings } from '../../_lib/settings';
import styles from './page.module.css';

/** Counterparty preview lines shown per group before "+N more" — a
 *  compact "who's not settled up" glance (Splitwise's own Groups list
 *  shows the same thing per group tile), not the full per-member list
 *  `@detail/groups/page.tsx`'s Balances section already renders. */
const COUNTERPARTY_CAP = 3;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const [{ g: selectedGroupId }, groupList, { primaryCurrency }] = await Promise.all([
    searchParams,
    listGroupsForUser(),
    getUserSettings(),
  ]);

  return (
    <div className={styles.page}>
      <PageHeader title="Groups" action={<CreateGroupDialog defaultCurrency={primaryCurrency} />} />
      {groupList.length === 0 ? (
        <EmptyState
          icon="layers"
          heading="No groups yet"
          description="Create a group to start splitting expenses with roommates, a trip, or any shared cost."
        />
      ) : (
        <ul className={styles.list}>
          {groupList.map((group) => (
            <li key={group.id}>
              <Link
                href={`/tally/groups?g=${group.id}`}
                className={[styles.row, group.id === selectedGroupId ? styles.rowActive : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.rowHeader}>
                  <span className={styles.rowName}>{group.name}</span>
                  {group.myBalances.length === 0 ? (
                    <span className={styles.settledLabel}>Settled up</span>
                  ) : (
                    <BalanceChipStack balances={group.myBalances} />
                  )}
                </div>
                {group.counterparties.length > 0 && (
                  <ul className={styles.counterpartyList}>
                    {group.counterparties.slice(0, COUNTERPARTY_CAP).map((counterparty) => (
                      <li key={counterparty.memberId} className={styles.counterpartyRow}>
                        <span className={styles.counterpartyName}>{counterparty.label}</span>
                        <BalanceChip amountCents={counterparty.amountCents} currency={counterparty.currency} />
                      </li>
                    ))}
                    {group.counterparties.length > COUNTERPARTY_CAP && (
                      <li className={styles.counterpartyMore}>
                        +{group.counterparties.length - COUNTERPARTY_CAP} more
                      </li>
                    )}
                  </ul>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
