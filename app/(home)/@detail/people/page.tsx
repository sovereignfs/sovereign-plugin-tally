import Link from 'next/link';
import { EmptyState } from '@sovereignfs/ui';
import { getPersonDetail } from '../../../_lib/people';
import { ActivityFeed } from '../../../_components/ActivityFeed';
import { BalanceChipStack } from '../../../_components/BalanceChipStack';
import { DetailBackLink } from '../../../_components/DetailBackLink';
import styles from './page.module.css';

/**
 * The `@detail` parallel-route slot for `/tally/people` — same "renders
 * `null` unless a selection query param is present" contract as
 * `@detail/groups/page.tsx`, keyed on `?p=<personKey>`. Balance summary +
 * a joint-activity timeline (only expenses/settlements involving both the
 * user and this person, across every shared group).
 */
export default async function PersonDetailSlot({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p: selectedPersonKey } = await searchParams;
  if (!selectedPersonKey) return null;

  const person = await getPersonDetail(selectedPersonKey);
  if (!person) {
    return (
      <div className={styles.detail}>
        <div className={styles.header}>
          <h2 className={styles.title}>Person not found</h2>
          <DetailBackLink href="/tally/people" label="People" />
        </div>
        <EmptyState
          icon="users"
          heading="This person isn't available"
          description="You may no longer share a group with them."
          action={
            <Link href="/tally/people" className={styles.textLink}>
              Back to people
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h2 className={styles.title}>{person.label}</h2>
        <DetailBackLink href="/tally/people" label="People" />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Balance summary</h3>
        {person.balances.length === 0 ? (
          <p className={styles.placeholder}>You&rsquo;re settled up with {person.label}.</p>
        ) : (
          <BalanceChipStack balances={person.balances} align="start" />
        )}
        <p className={styles.sharedGroups}>
          Shared in {person.sharedGroupCount} group{person.sharedGroupCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Activity between you</h3>
        <ActivityFeed months={person.activity} showGroupName />
      </div>
    </div>
  );
}
