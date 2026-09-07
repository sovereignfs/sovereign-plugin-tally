'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Dialog, FormField, Input, Textarea } from '@sovereignfs/ui';
import { createGroupAction, type CreateGroupResult } from '../_lib/groups';
import { DEFAULT_CURRENCY } from '../_lib/currencies';
import { CurrencyPicker } from './CurrencyPicker';
import styles from './DialogForm.module.css';

/**
 * Same shape as Docs' `CreateFolderDialog`/Sheets' `NewWorkbookDialog` —
 * a Dialog + `useActionState`. On success it opens the new group straight
 * away (the detail pane, where "Group settings" adds members), instead of
 * leaving the user to find the new row in the list.
 */
export function CreateGroupDialog({
  defaultCurrency = DEFAULT_CURRENCY,
  variant = 'secondary',
}: {
  defaultCurrency?: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [simplify, setSimplify] = useState(false);
  const [state, formAction, pending] = useActionState<CreateGroupResult | null, FormData>(
    createGroupAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.push(`/tally/groups?g=${state.groupId}`);
    }
  }, [state, router]);

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        New group
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New group">
        <form action={formAction} className={styles.form}>
          {state && !state.ok && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {state.error}
            </p>
          )}
          <FormField label="Name" required>
            {(field) => (
              <Input {...field} name="name" required maxLength={100} placeholder="Roomies" />
            )}
          </FormField>
          <FormField label="Description" hint="Optional">
            {(field) => (
              <Textarea
                {...field}
                name="description"
                rows={2}
                placeholder="Shared apartment expenses"
              />
            )}
          </FormField>
          <FormField label="Default currency" required>
            {() => (
              <CurrencyPicker
                name="defaultCurrency"
                value={currency}
                onChange={setCurrency}
                aria-label="Default currency"
              />
            )}
          </FormField>
          <input type="hidden" name="simplifyDebts" value={simplify ? 'on' : ''} />
          <FormField
            label="Balances"
            hint="Simplifying reduces the number of payments needed, but may suggest paying someone you never split a bill with. You can change this later."
          >
            {() => <Checkbox checked={simplify} onChange={setSimplify} label="Simplify debts" />}
          </FormField>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create group'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
