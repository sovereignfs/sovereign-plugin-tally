import Link from 'next/link';
import { Avatar, Card, EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { BalanceChipStack } from '../_components/BalanceChipStack';
import { CreateGroupDialog } from '../_components/CreateGroupDialog';
import { CurrencyStack } from '../_components/CurrencyStack';
import { MobilePageActions } from '../_components/MobilePageActions';
import { SpendBars } from '../_components/SpendBars';
import { getOverviewData } from '../_lib/overview';
import { getUserSettings } from '../_lib/settings';
import styles from './page.module.css';

/** Rows shown per breakdown list before "View all" takes over. */
const LIST_CAP = 5;

/**
 * Overview (UI-FLOW.md §3) — headline owed/owe, key stats, non-zero-balance
 * breakdowns by group and by person, and the personal spend analytics the
 * flow doc calls for: spend by category this month and a six-month trend,
 * as token-styled bars (no chart primitive exists in the design system).
 */
export default async function OverviewPage() {
  const [data, { primaryCurrency }] = await Promise.all([getOverviewData(), getUserSettings()]);

  if (!data.hasGroups) {
    return (
      <div className={styles.page}>
        <PageHeader title="Overview" action={<MobilePageActions />} />
        <EmptyState
          icon="layers"
          heading="Create your first group"
          description="Once you're in a group, your balance rollup and spend breakdown will show up here."
          action={<CreateGroupDialog defaultCurrency={primaryCurrency} variant="primary" />}
        />
      </div>
    );
  }

  const settledUp = data.owed.length === 0 && data.owe.length === 0;

  return (
    <div className={styles.page}>
      <PageHeader title="Overview" action={<MobilePageActions />} />

      {settledUp ? (
        <p className={styles.placeholder}>You&rsquo;re all settled up.</p>
      ) : (
        <div className={styles.headlineGrid}>
          <Card padding="md">
            <p className={styles.headlineLabel}>You&rsquo;re owed</p>
            <CurrencyStack amounts={data.owed} tone="success" size="lg" />
          </Card>
          <Card padding="md">
            <p className={styles.headlineLabel}>You owe</p>
            <CurrencyStack amounts={data.owe} tone="danger" size="lg" />
          </Card>
        </div>
      )}

      <div className={styles.statsGrid}>
        <Card padding="md">
          <Icon name="calendar" size="sm" className={styles.statIcon} aria-hidden />
          <p className={styles.statLabel}>Spent this month</p>
          <CurrencyStack amounts={data.spentThisMonth} tone="neutral" size="sm" />
        </Card>
        <Card padding="md">
          <Icon name="history" size="sm" className={styles.statIcon} aria-hidden />
          <p className={styles.statLabel}>Spent all-time</p>
          <CurrencyStack amounts={data.spentAllTime} tone="neutral" size="sm" />
        </Card>
        <Card padding="md">
          <Icon name="layers" size="sm" className={styles.statIcon} aria-hidden />
          <p className={styles.statLabel}>Open groups</p>
          <p className={styles.statNumber}>{data.activeGroupCount}</p>
          {data.closedGroupCount > 0 && (
            <p className={styles.statFootnote}>{data.closedGroupCount} closed</p>
          )}
        </Card>
        <Card padding="md">
          <Icon name="users" size="sm" className={styles.statIcon} aria-hidden />
          <p className={styles.statLabel}>People with balances</p>
          <p className={styles.statNumber}>{data.peopleWithBalanceCount}</p>
        </Card>
      </div>

      <div className={styles.breakdownGrid}>
        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Groups</h2>
            {data.groups.length > LIST_CAP && (
              <Link href="/tally/groups?filter=outstanding" className={styles.viewAllLink}>
                View all {data.groups.length}
              </Link>
            )}
          </div>
          {data.groups.length === 0 ? (
            <p className={styles.placeholder}>You&rsquo;re all settled up in every group.</p>
          ) : (
            <ul className={styles.breakdownList}>
              {data.groups.slice(0, LIST_CAP).map((group) => (
                <li key={group.id}>
                  <Link href={`/tally/groups?g=${group.id}`} className={styles.breakdownRow}>
                    <span className={styles.badge} aria-hidden>
                      <Icon name="layers" size="sm" aria-hidden />
                    </span>
                    <span className={styles.breakdownText}>
                      <span className={styles.breakdownName}>{group.name}</span>
                      <span className={styles.breakdownSubtitle}>
                        {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    <BalanceChipStack balances={group.balances} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>People</h2>
            {data.people.length > LIST_CAP && (
              <Link href="/tally/people" className={styles.viewAllLink}>
                View all {data.people.length}
              </Link>
            )}
          </div>
          {data.people.length === 0 ? (
            <p className={styles.placeholder}>No outstanding balances with anyone.</p>
          ) : (
            <ul className={styles.breakdownList}>
              {data.people.slice(0, LIST_CAP).map((person) => (
                <li key={person.personKey}>
                  <Link
                    href={`/tally/people?p=${encodeURIComponent(person.personKey)}`}
                    className={styles.breakdownRow}
                  >
                    <Avatar name={person.label} size="sm" />
                    <span className={styles.breakdownText}>
                      <span className={styles.breakdownName}>{person.label}</span>
                      <span className={styles.breakdownSubtitle}>
                        Shared in {person.sharedGroupCount} group
                        {person.sharedGroupCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    <BalanceChipStack balances={person.balances} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Your spend this month</h2>
          </div>
          <Card padding="md">
            <SpendBars
              items={data.spendByCategory.map((c) => ({
                key: `${c.currency}:${c.label}`,
                label: c.label,
                currency: c.currency,
                amountCents: c.amountCents,
              }))}
              emptyLabel="Nothing split with you yet this month."
            />
          </Card>
        </section>

        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Last six months</h2>
          </div>
          <Card padding="md">
            <SpendBars
              items={data.monthlyTrend.map((m) => ({
                key: `${m.currency}:${m.monthKey}`,
                label: m.label,
                currency: m.currency,
                amountCents: m.amountCents,
              }))}
              emptyLabel="No expenses in the last six months."
            />
          </Card>
        </section>
      </div>
    </div>
  );
}
