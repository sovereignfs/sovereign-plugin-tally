import Link from 'next/link';
import { Avatar, EmptyState, PageHeader } from '@sovereignfs/ui';
import { BalanceChipStack } from '../../_components/BalanceChipStack';
import { CurrencyStack } from '../../_components/CurrencyStack';
import { MobileSettingsLink } from '../../_components/MobileSettingsLink';
import { getPeopleForUser } from '../../_lib/people';
import styles from './page.module.css';

/**
 * People (UI-FLOW.md §4, built 2026-08-27) — a headline balance summary
 * (same shape as Overview's, scoped to people rather than groups), then
 * every person the user shares a group with, unbalanced contacts first.
 * Each row keeps the name + balance together on the left rather than
 * pushing the balance to a trailing right edge (the Groups/Overview
 * breakdown-row convention) — a deliberate, requested difference for this
 * page's simpler contact-list feel.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const [{ p: selectedPersonKey }, data] = await Promise.all([searchParams, getPeopleForUser()]);

  return (
    <div className={styles.page}>
      <PageHeader title="People" action={<MobileSettingsLink />} />

      {!data.hasGroups ? (
        <EmptyState
          icon="users"
          heading="No one to show yet"
          description="Once you're in a group with other people, everyone you share it with will show up here."
        />
      ) : (
        <>
          <div className={styles.summary}>
            <div>
              <p className={styles.summaryLabel}>You&rsquo;re owed</p>
              <CurrencyStack amounts={data.owed} tone="success" size="lg" />
            </div>
            <div>
              <p className={styles.summaryLabel}>You owe</p>
              <CurrencyStack amounts={data.owe} tone="danger" size="lg" />
            </div>
          </div>

          {data.people.length === 0 ? (
            <p className={styles.placeholder}>
              Everyone you share a group with, and your balance with each, will show up here.
            </p>
          ) : (
            <ul className={styles.list}>
              {data.people.map((person) => (
                <li key={person.personKey}>
                  <Link
                    href={`/tally/people?p=${encodeURIComponent(person.personKey)}`}
                    className={[
                      styles.row,
                      person.personKey === selectedPersonKey ? styles.rowActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Avatar name={person.label} size="sm" />
                    <div className={styles.rowText}>
                      <span className={styles.rowName}>{person.label}</span>
                      {person.balances.length === 0 ? (
                        <span className={styles.settledLabel}>Settled up</span>
                      ) : (
                        <BalanceChipStack balances={person.balances} align="start" />
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
