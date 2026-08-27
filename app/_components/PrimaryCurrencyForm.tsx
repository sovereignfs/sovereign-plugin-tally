'use client';

import { useActionState } from 'react';
import { Button, FormField, Select } from '@sovereignfs/ui';
import { updateUserSettingsAction, type ActionResult } from '../_lib/settings';
import { CURRENCY_OPTIONS } from '../_lib/currencies';
import styles from './DialogForm.module.css';

export function PrimaryCurrencyForm({ primaryCurrency }: { primaryCurrency: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateUserSettingsAction,
    null,
  );

  return (
    <form action={formAction} className={styles.form}>
      {state && !state.ok && (
        <p className={styles.feedbackError} role="status" aria-live="polite">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" aria-live="polite">
          {state.message}
        </p>
      )}
      <FormField label="Primary currency" required>
        {(field) => (
          // `key` forces a remount when the server-confirmed value changes
          // after a save — otherwise this uncontrolled `<select>` keeps
          // showing whatever it displayed before submission (its
          // `defaultValue` only applies on first mount; a prop update
          // alone doesn't touch its live DOM value). Found live: saved
          // "EUR" successfully (confirmed in the database) but the
          // dropdown kept showing "USD" until this fix.
          <Select {...field} key={primaryCurrency} name="primaryCurrency" defaultValue={primaryCurrency}>
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <div className={styles.actions}>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
