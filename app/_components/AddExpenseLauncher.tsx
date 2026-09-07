'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, Icon, Select, Spinner } from '@sovereignfs/ui';
import { listExpenseTargets, type ExpenseTarget } from '../_lib/expense-targets';
import { ExpenseDialog } from './ExpenseDialog';
import styles from './AddExpenseLauncher.module.css';

interface AddExpenseLauncherProps {
  /** `'sidebar'`: a full-width primary button (desktop sidebar header).
   *  `'icon'`: a bare icon button for a mobile page header. */
  variant: 'sidebar' | 'icon';
}

/**
 * The persistent "Add expense" entry point UI-FLOW.md §2 calls for — an
 * action, not a destination, reachable from every section. Opens straight
 * to a group picker (the user's open groups, fetched on open rather than
 * on every render) and then the same `ExpenseDialog` the group detail
 * uses. With exactly one open group the picker is skipped.
 */
export function AddExpenseLauncher({ variant }: AddExpenseLauncherProps) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ExpenseTarget[] | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTargets(null);
      setSelectedGroupId(null);
      setError(null);
      return;
    }
    let cancelled = false;
    listExpenseTargets()
      .then((list) => {
        if (cancelled) return;
        setTargets(list);
        setSelectedGroupId(list[0]?.groupId ?? null);
      })
      .catch(() => {
        if (!cancelled) setError('Your groups could not be loaded. Try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = targets?.find((t) => t.groupId === selectedGroupId) ?? null;

  const trigger =
    variant === 'sidebar' ? (
      <Button
        type="button"
        variant="primary"
        onClick={() => setOpen(true)}
        className={styles.sidebarButton}
      >
        <Icon name="plus" size="sm" aria-hidden />
        Add expense
      </Button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Add expense"
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size="md" aria-hidden />
      </Button>
    );

  if (!open) return trigger;

  // While loading, or with no open group, render a lightweight state inside
  // the same dialog chrome rather than a separate modal.
  if (!selected) {
    return (
      <>
        {trigger}
        <LoadingOrEmpty targets={targets} error={error} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      {trigger}
      <ExpenseDialog
        open={open}
        onClose={() => setOpen(false)}
        target={{
          groupId: selected.groupId,
          defaultCurrency: selected.defaultCurrency,
          members: selected.members,
          myMemberId: selected.myMemberId,
        }}
        headerSlot={
          targets && targets.length > 1 ? (
            <div className={styles.groupPicker}>
              <FormField label="Group" required>
                {(field) => (
                  <Select
                    {...field}
                    value={selected.groupId}
                    onChange={(e) => setSelectedGroupId(e.currentTarget.value)}
                  >
                    {targets.map((t) => (
                      <option key={t.groupId} value={t.groupId}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
          ) : undefined
        }
      />
    </>
  );
}

function LoadingOrEmpty({
  targets,
  error,
  onClose,
}: {
  targets: ExpenseTarget[] | null;
  error: string | null;
  onClose: () => void;
}) {
  // Reuses ExpenseDialog's Dialog chrome indirectly is overkill here — a
  // small inline panel is enough for the two transient states.
  return (
    <div className={styles.transient} role="status" aria-live="polite">
      {error ? (
        <p className={styles.transientText}>{error}</p>
      ) : targets === null ? (
        <Spinner />
      ) : (
        <p className={styles.transientText}>
          You&rsquo;re not in any open group yet. Create one from Groups first.
        </p>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
