'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, Icon, Menu } from '@sovereignfs/ui';
import {
  formatActivityDate,
  formatMoney,
  type GroupActivityItem,
  type GroupActivityMonth,
} from '../_lib/activity';
import type { ActionResult } from '../_lib/context';
import { ExpenseDialog, type ExpenseDialogTarget } from './ExpenseDialog';
import styles from './ActivityFeed.module.css';

/** Rows shown before "Show all" — keeps the detail pane's Settle up section
 *  reachable on a long-lived group without paging the feed server-side. */
const INITIAL_ROW_CAP = 20;

/** What a feed needs to offer Edit/Delete on its rows — only the group
 *  detail passes this; cross-group feeds (a person's timeline) are read-only. */
export interface ActivityEditContext {
  target: ExpenseDialogTarget;
  /** Closed groups render the feed read-only. */
  canEdit: boolean;
  deleteExpense: (groupId: string, expenseId: string) => Promise<ActionResult>;
  deleteSettlement: (groupId: string, settlementId: string) => Promise<ActionResult>;
}

/**
 * Month-grouped, described expense + settlement timeline — shared by
 * `@detail/groups`'s per-group feed and `@detail/people`'s per-person
 * feed. Each expense row carries the reader's own position ("You lent…"),
 * the expense's note, a receipt link, and — on the group's own feed — an
 * Edit/Delete menu.
 */
export function ActivityFeed({
  months,
  showGroupName = false,
  editContext,
}: {
  months: GroupActivityMonth[];
  /** Append each row's `groupName` after its category — relevant only
   *  when a feed spans more than one group (a person's cross-group
   *  timeline); redundant on a single group's own detail pane. */
  showGroupName?: boolean;
  editContext?: ActivityEditContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalRows = months.reduce((sum, m) => sum + m.items.length, 0);

  if (months.length === 0) {
    return <p className={styles.placeholder}>No activity yet.</p>;
  }

  let remaining = expanded ? Number.POSITIVE_INFINITY : INITIAL_ROW_CAP;
  const visibleMonths: GroupActivityMonth[] = [];
  for (const month of months) {
    if (remaining <= 0) break;
    const items = month.items.slice(0, remaining);
    remaining -= items.length;
    visibleMonths.push({ ...month, items });
  }

  return (
    <>
      {visibleMonths.map((month) => (
        <div key={month.monthKey} className={styles.month}>
          <h4 className={styles.monthHeading}>{month.monthLabel}</h4>
          <ul className={styles.list}>
            {month.items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                showGroupName={showGroupName}
                editContext={editContext}
              />
            ))}
          </ul>
        </div>
      ))}
      {!expanded && totalRows > INITIAL_ROW_CAP && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Show all {totalRows} entries
        </Button>
      )}
    </>
  );
}

function ActivityRow({
  item,
  showGroupName,
  editContext,
}: {
  item: GroupActivityItem;
  showGroupName: boolean;
  editContext?: ActivityEditContext;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canAct = editContext?.canEdit && item.groupId;

  function handleDelete() {
    if (!editContext || !item.groupId) return;
    const groupId = item.groupId;
    setError(null);
    startTransition(async () => {
      const result =
        item.type === 'expense'
          ? await editContext.deleteExpense(groupId, item.id)
          : await editContext.deleteSettlement(groupId, item.id);
      if (result.ok) {
        setConfirmingDelete(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li className={styles.row}>
      <span className={styles.date}>{formatActivityDate(item.occurredOn)}</span>
      <span className={styles.body}>
        <span className={styles.category}>
          {item.categoryLabel}
          {showGroupName && item.groupName ? ` · ${item.groupName}` : ''}
        </span>
        <span className={styles.description}>
          {item.description}
          {item.receiptUrl && (
            <a
              href={item.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.receiptLink}
              aria-label="View receipt"
            >
              <Icon name="file" size="sm" aria-hidden />
            </a>
          )}
        </span>
        {item.myPosition && (
          <span
            className={[
              styles.position,
              item.myPosition.startsWith('You lent') ? styles.positionLent : '',
              item.myPosition.startsWith('You borrowed') ? styles.positionBorrowed : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {item.myPosition}
          </span>
        )}
        {item.notes && <span className={styles.note}>{item.notes}</span>}
        {item.note && <span className={styles.note}>{item.note}</span>}
      </span>
      <span className={styles.amount}>{formatMoney(item.amountCents, item.currency)}</span>
      {canAct && editContext && (
        <span className={styles.actions}>
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            aria-label={`Actions for ${item.description}`}
            align="right"
            width={180}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Actions for ${item.description}`}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Icon name="ellipsis-vertical" size="sm" aria-hidden />
              </Button>
            }
            items={[
              ...(item.type === 'expense' && item.expense
                ? [{ label: 'Edit', icon: 'pencil' as const, onSelect: () => setEditing(true) }]
                : []),
              {
                label: 'Delete',
                icon: 'trash-2' as const,
                destructive: true,
                onSelect: () => setConfirmingDelete(true),
              },
            ]}
          />
          {editing && item.expense && (
            <ExpenseDialog
              open={editing}
              onClose={() => setEditing(false)}
              target={editContext.target}
              initial={item.expense}
            />
          )}
          <ConfirmDialog
            open={confirmingDelete}
            onClose={() => {
              setConfirmingDelete(false);
              setError(null);
            }}
            title={item.type === 'expense' ? 'Delete this expense?' : 'Delete this payment?'}
            message={
              item.type === 'expense'
                ? `"${item.description}" will be removed from everyone's balances. The group's history keeps a record of it.`
                : `"${item.description}" will no longer count toward anyone's balance.`
            }
            destructive
            confirmLabel={pending ? 'Deleting…' : 'Delete'}
            pending={pending}
            error={error}
            onConfirm={handleDelete}
          />
        </span>
      )}
    </li>
  );
}
