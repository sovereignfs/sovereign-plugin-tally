import Link from 'next/link';
import { BalanceChip, EmptyState, PageHeader, StatusBadge } from '@sovereignfs/ui';
import { BalanceChipStack } from '../../_components/BalanceChipStack';
import { CreateGroupDialog } from '../../_components/CreateGroupDialog';
import { GroupListFilter } from '../../_components/GroupListFilter';
import { MobilePageActions } from '../../_components/MobilePageActions';
import { applyGroupFilter, isGroupFilter, type GroupFilter } from '../../_lib/group-filters';
import { listGroupsForUser } from '../../_lib/groups';
import { getUserSettings } from '../../_lib/settings';
import styles from './page.module.css';

/** Counterparty preview lines shown per group before "+N more". */
const COUNTERPARTY_CAP = 3;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; filter?: string }>;
}) {
  const [{ g: selectedGroupId, filter: filterParam }, groupList, { primaryCurrency }] =
    await Promise.all([searchParams, listGroupsForUser(), getUserSettings()]);
  const filter: GroupFilter = isGroupFilter(filterParam) ? filterParam : 'active';
  const visible = applyGroupFilter(groupList, filter);
  const hasClosed = groupList.some((g) => g.archivedAt !== null);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Groups"
        action={
          <>
            <CreateGroupDialog defaultCurrency={primaryCurrency} />
            <MobilePageActions />
          </>
        }
      />
      {groupList.length === 0 ? (
        <EmptyState
          icon="layers"
          heading="No groups yet"
          description="Create a group to start splitting expenses with roommates, a trip, or any shared cost."
          action={<CreateGroupDialog defaultCurrency={primaryCurrency} variant="primary" />}
        />
      ) : (
        <>
          <GroupListFilter value={filter} />
          {visible.length === 0 ? (
            <p className={styles.placeholder}>
              {filter === 'closed'
                ? 'No closed groups.'
                : filter === 'active' && hasClosed
                  ? 'Every group is closed. Switch the filter to see them.'
                  : 'No groups match this filter.'}
            </p>
          ) : (
            <ul className={styles.list}>
              {visible.map((group) => {
                const query = new URLSearchParams({ g: group.id });
                if (filter !== 'active') query.set('filter', filter);
                return (
                  <li key={group.id}>
                    <Link
                      href={`/tally/groups?${query.toString()}`}
                      className={[styles.row, group.id === selectedGroupId ? styles.rowActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-current={group.id === selectedGroupId ? 'true' : undefined}
                    >
                      <div className={styles.rowHeader}>
                        <span className={styles.rowTitle}>
                          <span className={styles.rowName}>{group.name}</span>
                          {group.archivedAt !== null && (
                            <StatusBadge status="unmodified">Closed</StatusBadge>
                          )}
                        </span>
                        {group.myBalances.length === 0 ? (
                          <span className={styles.settledLabel}>Settled up</span>
                        ) : (
                          <BalanceChipStack balances={group.myBalances} />
                        )}
                      </div>
                      <span className={styles.rowMeta}>
                        {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                      </span>
                      {group.counterparties.length > 0 && (
                        <ul className={styles.counterpartyList}>
                          {group.counterparties.slice(0, COUNTERPARTY_CAP).map((counterparty) => (
                            <li
                              key={`${counterparty.memberId}:${counterparty.currency}`}
                              className={styles.counterpartyRow}
                            >
                              <span className={styles.counterpartyName}>{counterparty.label}</span>
                              <BalanceChip
                                amountCents={counterparty.amountCents}
                                currency={counterparty.currency}
                              />
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
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
