'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, StatusBadge, Tooltip } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/group-settings';

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
  deleteAction: () => Promise<ActionResult>;
}

/**
 * The detail column header's owner-only "Close group"/"Delete" CTA
 * (UI-FLOW.md §4), mutually exclusive per SPEC.md §7: a group with any
 * expense/settlement history — even soft-deleted — can only ever be
 * closed, never hard-deleted; a group with none can only be deleted (there
 * is nothing yet to "close"). Once closed, a status badge replaces the
 * button entirely — there's no "reopen" action to route to.
 *
 * `ConfirmDialog` + `useTransition` mirrors kanban's `ManageProjectDialog`
 * DangerZone, the codebase's one established pattern for a destructive
 * server-action confirm; adapted for a compact header row rather than a
 * boxed "danger zone" section, since UI-FLOW.md places these as peer
 * header CTAs, not a separate settings-screen block.
 */
export function GroupLifecycleActions({
  groupName,
  isArchived,
  hasHistory,
  hasOutstandingBalance,
  archiveAction,
  deleteAction,
}: GroupLifecycleActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<'close' | 'delete' | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isArchived) {
    return <StatusBadge status="unmodified">Closed</StatusBadge>;
  }

  function closeConfirm() {
    setConfirming(null);
    setError(null);
  }

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveAction();
      if (result.ok) setConfirming(null);
      else setError(result.error);
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAction();
      if (result.ok) router.replace('/tally/groups');
      else setError(result.error);
    });
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
    return (
      <>
        {hasOutstandingBalance ? (
          <Tooltip content="This group has an outstanding balance and can't be closed yet.">
            <span>{closeButton}</span>
          </Tooltip>
        ) : (
          closeButton
        )}
        <ConfirmDialog
          open={confirming === 'close'}
          onClose={closeConfirm}
          title={`Close "${groupName}"?`}
          message="This marks the group as closed. Its expenses, settlements, and balances stay intact and visible."
          confirmLabel={pending ? 'Closing…' : 'Close group'}
          pending={pending}
          error={error}
          onConfirm={handleArchive}
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
        onConfirm={handleDelete}
      />
    </>
  );
}
