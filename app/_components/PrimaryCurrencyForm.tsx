'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, FormField } from '@sovereignfs/ui';
import { updateUserSettingsAction, type ActionResult } from '../_lib/settings';
import { CurrencyPicker } from './CurrencyPicker';
import styles from './DialogForm.module.css';

export function PrimaryCurrencyForm({ primaryCurrency }: { primaryCurrency: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateUserSettingsAction,
    null,
  );
  const [currency, setCurrency] = useState(primaryCurrency);

  // Re-sync with the server-confirmed value after a save (or a refresh), so
  // the picker never shows a value the database doesn't hold.
  useEffect(() => {
    setCurrency(primaryCurrency);
  }, [primaryCurrency]);

  return (
    <form action={formAction} className={styles.form}>
      {state && !state.ok && (
        <p className={styles.feedbackError} role="status" aria-live="polite">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className={styles.feedbackSuccess} role="status" aria-live="polite">
          {state.message}
        </p>
      )}
      <FormField label="Primary currency" required>
        {() => (
          <CurrencyPicker
            name="primaryCurrency"
            value={currency}
            onChange={setCurrency}
            aria-label="Primary currency"
          />
        )}
      </FormField>
      <div className={styles.actions}>
        <Button type="submit" disabled={pending || currency === primaryCurrency}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
