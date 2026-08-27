'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import { createGroupAction, type ActionResult } from '../_lib/groups';
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY } from '../_lib/currencies';
import styles from './DialogForm.module.css';

/**
 * Same shape as Docs' `CreateFolderDialog`/Sheets' `NewWorkbookDialog` —
 * a Dialog + `useActionState`, not the dedicated `/groups/new` route this
 * plugin's own `SPEC.md` §9 originally sketched. Corrected to match once
 * the real, validated sibling-plugin pattern was checked directly.
 */
export function CreateGroupDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createGroupAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
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
            {(field) => <Input {...field} name="name" required placeholder="Roomies" />}
          </FormField>
          <FormField label="Default currency" required>
            {(field) => (
              <Select {...field} name="defaultCurrency" defaultValue={DEFAULT_CURRENCY}>
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
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
