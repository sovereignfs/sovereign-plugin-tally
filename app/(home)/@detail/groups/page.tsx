import Link from 'next/link';
import { BalanceChip, Icon } from '@sovereignfs/ui';
import { getGroupDetail } from '../../../_lib/groups';
import { groupBalancesByCurrency, simplifyDebts } from '../../../_lib/balances';
import { ExpenseForm } from '../../../_components/ExpenseForm';
import { SettleUpButton } from '../../../_components/SettleUpButton';
import styles from './page.module.css';

/**
 * The `@detail` parallel-route slot for `/tally/groups` — renders `null`
 * (nothing, `ThreeColumnLayout` collapses to 2 columns) unless `?g=<id>`
 * is present, per `app/(home)/layout.tsx`'s doc comment. Reads the *same*
 * `searchParams` the main `groups/page.tsx` reads — both are independent
 * pages matching the identical URL, not a parent/child pair.
 *
 * Full Balances/Activity/Analytics tabs (UI-FLOW.md §4) are a follow-up —
 * this ships Balances + a plain expense list, the slice ROADMAP.md tasks
 * 6–7 scope to.
 */
export default async function GroupDetailSlot({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g: selectedGroupId } = await searchParams;
  if (!selectedGroupId) return null;

  const group = await getGroupDetail(selectedGroupId);
  if (!group) return null;

  const balancesByCurrency = groupBalancesByCurrency(group.balances);
  const labelByMemberId = new Map(group.members.map((m) => [m.memberId, m.label]));

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h2 className={styles.title}>{group.name}</h2>
        <Link href="/tally/groups" className={styles.closeLink} aria-label="Close detail">
          <Icon name="x" size="sm" aria-hidden />
        </Link>
      </div>

      <ExpenseForm
        groupId={group.id}
        defaultCurrency={group.defaultCurrency}
        members={group.members.map((m) => ({ memberId: m.memberId, label: m.label }))}
      />

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
        <h3 className={styles.sectionHeading}>Expenses</h3>
        {group.recentExpenses.length === 0 ? (
          <p className={styles.placeholder}>No expenses yet.</p>
        ) : (
          <ul className={styles.suggestionList}>
            {group.recentExpenses.map((expense) => (
              <li key={expense.id} className={styles.suggestionRow}>
                <span>{expense.description}</span>
                <span className={styles.suggestionAmount}>
                  {expense.currency} {(expense.amountCents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
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
