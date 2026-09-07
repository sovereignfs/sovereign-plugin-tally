'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, StatusBadge, Tooltip } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/group-settings';
import styles from './GroupLifecycleActions.module.css';

interface GroupLifecycleActionsProps {
  groupName: string;
  isArchived: boolean;
  /** Whether the group has ever had an expense or settlement — decides
   *  which of the two mutually-exclusive CTAs renders (SPEC.md §7). */
  hasHistory: boolean;
  /** Whether any active member currently has a non-zero balance — disables
   *  "Close group" with an explanatory tooltip while true (UI-FLOW.md §4). */
  hasOutstandingBalance: boolean;
  archiveAction: () => Promise<ActionResult>;
  reopenAction: () => Promise<ActionResult>;
  deleteAction: () => Promise<ActionResult>;
}

/**
 * The detail column header's owner-only lifecycle CTA (UI-FLOW.md §4),
 * mutually exclusive per SPEC.md §7: a group with any expense/settlement
 * history can only be closed, never hard-deleted; a group with none can
 * only be deleted. A closed group shows its badge plus "Reopen" — closing
 * is reversible, deleting is not.
 */
export function GroupLifecycleActions({
  groupName,
  isArchived,
  hasHistory,
  hasOutstandingBalance,
  archiveAction,
  reopenAction,
  deleteAction,
}: GroupLifecycleActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<'close' | 'delete' | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function closeConfirm() {
    setConfirming(null);
    setError(null);
  }

  function run(action: () => Promise<ActionResult>, onOk: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onOk();
      else setError(result.error);
    });
  }

  if (isArchived) {
    return (
      <span className={styles.closedRow}>
        <StatusBadge status="unmodified">Closed</StatusBadge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(reopenAction, () => router.refresh())}
        >
          {pending ? 'Reopening…' : 'Reopen'}
        </Button>
        {error && (
          <span className={styles.inlineError} role="alert">
            {error}
          </span>
        )}
      </span>
    );
  }

  if (hasHistory) {
    const closeButton = (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={hasOutstandingBalance}
        onClick={() => setConfirming('close')}
      >
        Close group
      </Button>
    );
    // `side="left"`: the button sits at the pane's right edge, so a top- or
    // right-anchored tip would extend past it and give the mobile pane a
    // horizontal scrollbar.
    return (
      <>
        {hasOutstandingBalance ? (
          <Tooltip
            content="This group has an outstanding balance and can't be closed yet."
            side="left"
          >
            <span>{closeButton}</span>
          </Tooltip>
        ) : (
          closeButton
        )}
        <ConfirmDialog
          open={confirming === 'close'}
          onClose={closeConfirm}
          title={`Close "${groupName}"?`}
          message="This marks the group as closed and read-only. Its expenses, settlements, and balances stay intact and visible, and an owner can reopen it at any time."
          confirmLabel={pending ? 'Closing…' : 'Close group'}
          pending={pending}
          error={error}
          onConfirm={() => run(archiveAction, () => setConfirming(null))}
        />
      </>
    );
  }

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming('delete')}>
        Delete
      </Button>
      <ConfirmDialog
        open={confirming === 'delete'}
        onClose={closeConfirm}
        title={`Delete "${groupName}"?`}
        message="This group has no expenses or settlements, so it can be deleted completely. This can't be undone."
        destructive
        confirmLabel={pending ? 'Deleting…' : 'Delete group'}
        pending={pending}
        error={error}
        onConfirm={() => run(deleteAction, () => router.replace('/tally/groups'))}
      />
    </>
  );
}
