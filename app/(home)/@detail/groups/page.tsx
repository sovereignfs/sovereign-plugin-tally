import Link from 'next/link';
import { EmptyState, StatusBadge } from '@sovereignfs/ui';
import { formatActivityDate, formatMoney } from '../../../_lib/activity';
import { deleteExpenseAction } from '../../../_lib/expenses';
import { getGroupDetail } from '../../../_lib/groups';
import { GroupAccessError } from '../../../_lib/membership';
import { deleteSettlementAction } from '../../../_lib/settlements';
import {
  addMemberAction,
  archiveGroupAction,
  deleteGroupAction,
  getGroupSettings,
  leaveGroupAction,
  removeMemberAction,
  reopenGroupAction,
  resendGuestInviteAction,
  searchGroupDirectoryUsers,
  updateGroupDetailsAction,
  updateMemberRoleAction,
} from '../../../_lib/group-settings';
import { ActivityFeed } from '../../../_components/ActivityFeed';
import { BalanceChipStack } from '../../../_components/BalanceChipStack';
import { DetailBackLink } from '../../../_components/DetailBackLink';
import { AddExpenseButton } from '../../../_components/ExpenseDialog';
import { GroupLifecycleActions } from '../../../_components/GroupLifecycleActions';
import { GroupSettingsButton } from '../../../_components/GroupSettingsButton';
import { LeaveGroupButton } from '../../../_components/LeaveGroupButton';
import { RecordSettlementDialog } from '../../../_components/RecordSettlementDialog';
import { SettleUpButton } from '../../../_components/SettleUpButton';
import { SpendBars } from '../../../_components/SpendBars';
import styles from './page.module.css';

/**
 * The `@detail` parallel-route slot for `/tally/groups` — renders `null`
 * (nothing; `ThreeColumnLayout` collapses to 2 columns) unless `?g=<id>`
 * is present. Reads the *same* `searchParams` the main `groups/page.tsx`
 * reads — both are independent pages matching the identical URL.
 *
 * Section order follows what a member most often came for: their balance,
 * everyone's balances, the suggested payments, then the (potentially long)
 * activity feed, then analytics.
 */
export default async function GroupDetailSlot({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; filter?: string }>;
}) {
  const { g: selectedGroupId, filter } = await searchParams;
  if (!selectedGroupId) return null;
  const backHref = filter ? `/tally/groups?filter=${encodeURIComponent(filter)}` : '/tally/groups';

  // `getGroupDetail` throws `GroupAccessError` when the id doesn't resolve
  // to an active membership — covers "no access", "deleted", and "left".
  // A stale link (bookmark, history, a notification about a group you've
  // since left) renders a small not-found state with a way back, instead
  // of a blank pane — on mobile, a blank pane is a dead end.
  let group;
  try {
    group = await getGroupDetail(selectedGroupId);
  } catch (error) {
    if (!(error instanceof GroupAccessError)) throw error;
    group = null;
  }
  if (!group) {
    return (
      <div className={styles.detail}>
        <div className={styles.header}>
          <h2 className={styles.title}>Group not found</h2>
          <DetailBackLink href={backHref} label="Groups" />
        </div>
        <EmptyState
          icon="layers"
          heading="This group isn't available"
          description="It may have been deleted, or you may no longer be a member."
          action={
            <Link href={backHref} className={styles.textLink}>
              Back to groups
            </Link>
          }
        />
      </div>
    );
  }

  const isClosed = group.archivedAt !== null;
  const labelByMemberId = new Map(group.members.map((m) => [m.memberId, m.label]));
  const memberOptions = group.members.map((m) => ({ memberId: m.memberId, label: m.label }));
  const target = {
    groupId: group.id,
    defaultCurrency: group.defaultCurrency,
    members: memberOptions,
    myMemberId: group.myMemberId,
  };
  const dateRange =
    group.startDate || group.endDate
      ? [
          group.startDate ? formatActivityDate(group.startDate, { withYear: true }) : null,
          group.endDate ? formatActivityDate(group.endDate, { withYear: true }) : null,
        ]
          .filter(Boolean)
          .join(' – ')
      : null;

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h2 className={styles.title}>{group.name}</h2>
        <div className={styles.headerActions}>
          {group.myRole === 'owner' && (
            <GroupLifecycleActions
              groupName={group.name}
              isArchived={isClosed}
              hasHistory={group.hasHistory}
              hasOutstandingBalance={group.hasOutstandingBalance}
              archiveAction={archiveGroupAction.bind(null, group.id)}
              reopenAction={reopenGroupAction.bind(null, group.id)}
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
          <DetailBackLink href={backHref} label="Groups" />
        </div>
      </div>

      {(group.description || dateRange || isClosed) && (
        <div className={styles.about}>
          {group.description && <p className={styles.description}>{group.description}</p>}
          <p className={styles.meta}>
            {[
              dateRange,
              `${group.members.length} member${group.members.length === 1 ? '' : 's'}`,
              `Default currency ${group.defaultCurrency}`,
              isClosed ? 'Closed — read-only until reopened' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}

      <div className={styles.actionsRow}>
        <AddExpenseButton target={target} disabled={isClosed} />
        <RecordSettlementDialog
          groupId={group.id}
          defaultCurrency={group.defaultCurrency}
          members={memberOptions}
          myMemberId={group.myMemberId}
          disabled={isClosed}
        />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Your balance</h3>
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
            {group.members.map((member) => (
              <li key={member.memberId} className={styles.memberRow}>
                <span className={styles.memberName}>
                  {member.label}
                  {member.memberId === group.myMemberId && (
                    <span className={styles.memberTag}>you</span>
                  )}
                  {member.role === 'owner' && <span className={styles.memberTag}>Owner</span>}
                  {member.kind === 'guest' && <span className={styles.memberTag}>Guest</span>}
                </span>
                {member.balances.length === 0 ? (
                  <StatusBadge status="unmodified">Settled up</StatusBadge>
                ) : (
                  <BalanceChipStack balances={member.balances} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {group.suggestions.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionHeading}>
            Settle up
            <span className={styles.sectionHint}>
              {group.simplifyDebts ? 'Simplified — fewest payments' : 'Who owes whom, per person'}
            </span>
          </h3>
          <ul className={styles.suggestionList}>
            {group.suggestions.map((payment) => {
              const fromLabel = labelByMemberId.get(payment.fromMemberId) ?? 'Someone';
              const toLabel = labelByMemberId.get(payment.toMemberId) ?? 'someone';
              return (
                <li
                  key={`${payment.fromMemberId}:${payment.toMemberId}:${payment.currency}`}
                  className={styles.suggestionRow}
                >
                  <span>
                    {payment.fromMemberId === group.myMemberId ? 'You owe' : `${fromLabel} owes`}{' '}
                    {payment.toMemberId === group.myMemberId ? 'you' : toLabel}
                    <span className={styles.suggestionAmount}>
                      {' '}
                      {formatMoney(payment.amountCents, payment.currency)}
                    </span>
                  </span>
                  {!isClosed && (
                    <SettleUpButton
                      groupId={group.id}
                      fromMemberId={payment.fromMemberId}
                      fromLabel={fromLabel}
                      toMemberId={payment.toMemberId}
                      toLabel={toLabel}
                      amountCents={payment.amountCents}
                      currency={payment.currency}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Activity</h3>
        <ActivityFeed
          months={group.activity}
          editContext={{
            target,
            canEdit: !isClosed,
            deleteExpense: deleteExpenseAction,
            deleteSettlement: deleteSettlementAction,
          }}
        />
      </div>

      {group.analytics.byCategory.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionHeading}>Spend by category</h3>
          <SpendBars
            items={group.analytics.byCategory.map((c) => ({
              key: `${c.currency}:${c.label}`,
              label: c.label,
              currency: c.currency,
              amountCents: c.amountCents,
            }))}
            emptyLabel="No expenses yet."
          />
        </div>
      )}

      {group.analytics.byMonth.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionHeading}>Last six months</h3>
          <SpendBars
            items={group.analytics.byMonth.map((m) => ({
              key: `${m.currency}:${m.monthKey}`,
              label: m.label,
              currency: m.currency,
              amountCents: m.amountCents,
            }))}
            emptyLabel="No expenses in the last six months."
          />
        </div>
      )}

      {group.myMemberId && (
        <div className={styles.footerActions}>
          <LeaveGroupButton
            groupName={group.name}
            blockedReason={group.leaveBlockedReason}
            leaveAction={leaveGroupAction.bind(null, group.id)}
          />
        </div>
      )}
    </div>
  );
}
