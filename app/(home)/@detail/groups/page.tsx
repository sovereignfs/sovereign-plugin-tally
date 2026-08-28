import Link from 'next/link';
import { BalanceChip, Icon } from '@sovereignfs/ui';
import { getGroupDetail } from '../../../_lib/groups';
import { groupBalancesByCurrency, simplifyDebts } from '../../../_lib/balances';
import { GroupAccessError } from '../../../_lib/membership';
import {
  addMemberAction,
  archiveGroupAction,
  deleteGroupAction,
  getGroupSettings,
  removeMemberAction,
  resendGuestInviteAction,
  searchGroupDirectoryUsers,
  updateGroupDetailsAction,
  updateMemberRoleAction,
} from '../../../_lib/group-settings';
import { ActivityFeed } from '../../../_components/ActivityFeed';
import { BalanceChipStack } from '../../../_components/BalanceChipStack';
import { ExpenseForm } from '../../../_components/ExpenseForm';
import { GroupLifecycleActions } from '../../../_components/GroupLifecycleActions';
import { GroupSettingsButton } from '../../../_components/GroupSettingsButton';
import { RecordSettlementDialog } from '../../../_components/RecordSettlementDialog';
import { SettleUpButton } from '../../../_components/SettleUpButton';
import styles from './page.module.css';

/**
 * The `@detail` parallel-route slot for `/tally/groups` — renders `null`
 * (nothing, `ThreeColumnLayout` collapses to 2 columns) unless `?g=<id>`
 * is present, per `app/(home)/layout.tsx`'s doc comment. Reads the *same*
 * `searchParams` the main `groups/page.tsx` reads — both are independent
 * pages matching the identical URL, not a parent/child pair.
 *
 * Activity feed (grouped by month, merged expenses + settlements) added
 * 2026-08-27 in place of the earlier flat "Expenses" list, alongside a
 * balance-summary headline and a general `RecordSettlementDialog` CTA —
 * requested directly against a Splitwise reference screenshot.
 */
export default async function GroupDetailSlot({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g: selectedGroupId } = await searchParams;
  if (!selectedGroupId) return null;

  // `getGroupDetail` throws `GroupAccessError` (not a null return) when the
  // id doesn't resolve to an active membership — the same shape covers "no
  // access" and "deleted" (deleteGroupAction removes group_members too, so
  // a stale `?g=<id>` link to an already-deleted group — a bookmark,
  // browser history, back/forward after the post-delete redirect — hits
  // this exact path). Caught here so a stale link renders nothing, same as
  // an unrecognized id, instead of crashing to Next's generic error
  // boundary; found live testing deleteGroupAction, not anticipated during
  // review.
  let group;
  try {
    group = await getGroupDetail(selectedGroupId);
  } catch (error) {
    if (error instanceof GroupAccessError) return null;
    throw error;
  }
  if (!group) return null;

  const balancesByCurrency = groupBalancesByCurrency(group.balances);
  const labelByMemberId = new Map(group.members.map((m) => [m.memberId, m.label]));
  const memberOptions = group.members.map((m) => ({ memberId: m.memberId, label: m.label }));

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h2 className={styles.title}>{group.name}</h2>
        <div className={styles.headerActions}>
          {group.myRole === 'owner' && (
            <GroupLifecycleActions
              groupName={group.name}
              isArchived={group.archivedAt !== null}
              hasHistory={group.hasHistory}
              hasOutstandingBalance={group.balances.some((b) => b.amountCents !== 0)}
              archiveAction={archiveGroupAction.bind(null, group.id)}
              deleteAction={deleteGroupAction.bind(null, group.id)}
            />
          )}
          {group.myRole === 'owner' && (
            <GroupSettingsButton
              getSettingsAction={getGroupSettings.bind(null, group.id)}
              updateDetailsAction={updateGroupDetailsAction.bind(null, group.id)}
              searchUsersAction={searchGroupDirectoryUsers.bind(null, group.id)}
              addMemberFormAction={addMemberAction.bind(null, group.id)}
              resendInviteAction={resendGuestInviteAction.bind(null, group.id)}
              removeMemberAction={removeMemberAction.bind(null, group.id)}
              updateRoleAction={updateMemberRoleAction.bind(null, group.id)}
            />
          )}
          <Link href="/tally/groups" className={styles.closeLink} aria-label="Back to groups">
            <Icon name="x" size="sm" aria-hidden className={styles.closeIconDesktop} />
            <Icon name="chevron-left" size="sm" aria-hidden className={styles.closeIconMobile} />
            <span className={styles.closeLabelMobile}>Groups</span>
          </Link>
        </div>
      </div>

      <div className={styles.actionsRow}>
        <ExpenseForm
          groupId={group.id}
          defaultCurrency={group.defaultCurrency}
          members={memberOptions}
        />
        <RecordSettlementDialog
          groupId={group.id}
          defaultCurrency={group.defaultCurrency}
          members={memberOptions}
        />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Balance summary</h3>
        {group.myBalances.length === 0 ? (
          <p className={styles.placeholder}>You&rsquo;re settled up in this group.</p>
        ) : (
          <div className={styles.summaryStack}>
            <BalanceChipStack balances={group.myBalances} align="start" />
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Balances</h3>
        {group.members.length === 0 ? (
          <p className={styles.placeholder}>No members yet.</p>
        ) : (
          <ul className={styles.memberList}>
            {group.members.map((member) => {
              const balance = group.balances.find((b) => b.memberId === member.memberId);
              return (
                <li key={member.memberId} className={styles.memberRow}>
                  <span className={styles.memberName}>
                    {member.label}
                    {member.role === 'owner' && <span className={styles.ownerTag}>Owner</span>}
                  </span>
                  <BalanceChip
                    amountCents={balance?.amountCents ?? 0}
                    currency={balance?.currency ?? group.defaultCurrency}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Activity</h3>
        <ActivityFeed months={group.activity} />
      </div>

      {Array.from(balancesByCurrency.entries()).map(([currency, balances]) => {
        const suggestions = simplifyDebts(new Map(balances));
        if (suggestions.length === 0) return null;
        return (
          <div key={currency} className={styles.section}>
            <h3 className={styles.sectionHeading}>Settle up — {currency}</h3>
            <ul className={styles.suggestionList}>
              {suggestions.map((payment, index) => (
                <li key={index} className={styles.suggestionRow}>
                  <span>
                    {labelByMemberId.get(payment.fromMemberId) ?? 'Someone'} owes{' '}
                    {labelByMemberId.get(payment.toMemberId) ?? 'someone'}
                    {/* Plain amount, not BalanceChip — a suggested payment
                        has no "owed to them / they owe" direction of its
                        own to color-code; the prose already states it. */}
                    <span className={styles.suggestionAmount}>
                      {' '}
                      {currency} {(payment.amountCents / 100).toFixed(2)}
                    </span>
                  </span>
                  <SettleUpButton
                    groupId={group.id}
                    fromMemberId={payment.fromMemberId}
                    toMemberId={payment.toMemberId}
                    amountCents={payment.amountCents}
                    currency={currency}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
