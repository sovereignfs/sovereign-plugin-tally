import Link from 'next/link';
import { Icon } from '@sovereignfs/ui';
import { getPersonDetail } from '../../../_lib/people';
import { ActivityFeed } from '../../../_components/ActivityFeed';
import { BalanceChipStack } from '../../../_components/BalanceChipStack';
import styles from './page.module.css';

/**
 * The `@detail` parallel-route slot for `/tally/people` — same
 * "renders `null` unless a selection query param is present" contract as
 * `@detail/groups/page.tsx`, just keyed on `?p=<personKey>` instead of
 * `?g=<groupId>`. Balance summary + a joint-activity timeline (only
 * expenses/settlements involving both the user and this person, across
 * every shared group — see `getPersonDetail`'s own doc comment for why
 * that's narrower than "everything in the groups we share").
 */
export default async function PersonDetailSlot({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p: selectedPersonKey } = await searchParams;
  if (!selectedPersonKey) return null;

  const person = await getPersonDetail(selectedPersonKey);
  if (!person) return null;

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h2 className={styles.title}>{person.label}</h2>
        <Link href="/tally/people" className={styles.closeLink} aria-label="Back to people">
          <Icon name="x" size="sm" aria-hidden className={styles.closeIconDesktop} />
          <Icon name="chevron-left" size="sm" aria-hidden className={styles.closeIconMobile} />
          <span className={styles.closeLabelMobile}>People</span>
        </Link>
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
        <h3 className={styles.sectionHeading}>Activity</h3>
        <ActivityFeed months={person.activity} showGroupName />
      </div>
    </div>
  );
}
