'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, CurrencyInput, Dialog, FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { recordSettlementAction, type ActionResult } from '../_lib/settlements';
import { CURRENCY_OPTIONS } from '../_lib/currencies';
import styles from './DialogForm.module.css';

export interface RecordSettlementMember {
  memberId: string;
  label: string;
}

interface RecordSettlementDialogProps {
  groupId: string;
  defaultCurrency: string;
  members: RecordSettlementMember[];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * General-purpose "record a payment" — complements the auto-suggested,
 * one-click `SettleUpButton`s (`app/_lib/balances.ts`'s `simplifyDebts`)
 * rather than replacing them: a suggestion covers the common case (pay
 * off exactly what the algorithm proposes), this covers everything else
 * — a partial payment, a payment between two members the simplification
 * didn't happen to pair up, or backdating a payment that happened earlier
 * (UI-FLOW.md §4, requested directly 2026-08-27). Same Dialog +
 * `useActionState` shape as `ExpenseForm`/`CreateGroupDialog`, submitting
 * to the identical `recordSettlementAction` the suggestion buttons use.
 */
export function RecordSettlementDialog({ groupId, defaultCurrency, members }: RecordSettlementDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordSettlementAction,
    null,
  );
  const [fromMemberId, setFromMemberId] = useState(members[0]?.memberId ?? '');
  const [toMemberId, setToMemberId] = useState(members[1]?.memberId ?? members[0]?.memberId ?? '');
  const [amountCents, setAmountCents] = useState<number | null>(null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setAmountCents(null);
    }
  }, [state]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Record settlement
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Record settlement">
        <form action={formAction} className={styles.form}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="amountCents" value={amountCents ?? ''} />

          {state && !state.ok && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {state.error}
            </p>
          )}

          <FormField label="Paid by" required>
            {(field) => (
              <Select
                {...field}
                name="fromMemberId"
                value={fromMemberId}
                onChange={(e) => setFromMemberId(e.currentTarget.value)}
              >
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Received by" required>
            {(field) => (
              <Select
                {...field}
                name="toMemberId"
                value={toMemberId}
                onChange={(e) => setToMemberId(e.currentTarget.value)}
              >
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Amount" required>
            {(field) => (
              <CurrencyInput {...field} valueCents={amountCents} onValueChange={setAmountCents} required />
            )}
          </FormField>

          <FormField label="Currency" required>
            {(field) => (
              <Select {...field} name="currency" defaultValue={defaultCurrency}>
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Date" required>
            {(field) => (
              <Input {...field} name="settledOn" type="date" required defaultValue={todayIsoDate()} />
            )}
          </FormField>

          <FormField label="Note" hint="Optional">
            {(field) => <Textarea {...field} name="note" rows={2} placeholder="Venmo transfer" />}
          </FormField>

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || fromMemberId === toMemberId}>
              {pending ? 'Recording…' : 'Record settlement'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
