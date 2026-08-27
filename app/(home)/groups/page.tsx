import Link from 'next/link';
import { EmptyState, PageHeader } from '@sovereignfs/ui';
import { CreateGroupDialog } from '../../_components/CreateGroupDialog';
import { listGroupsForUser } from '../../_lib/groups';
import styles from './page.module.css';

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const [{ g: selectedGroupId }, groupList] = await Promise.all([searchParams, listGroupsForUser()]);

  return (
    <div className={styles.page}>
      <PageHeader title="Groups" action={<CreateGroupDialog />} />
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
                {group.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
