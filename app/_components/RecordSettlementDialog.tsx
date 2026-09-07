'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  Button,
  CurrencyInput,
  Dialog,
  FormField,
  Icon,
  Input,
  Select,
  Textarea,
} from '@sovereignfs/ui';
import { recordSettlementAction, type ActionResult } from '../_lib/settlements';
import { CurrencyPicker } from './CurrencyPicker';
import styles from './DialogForm.module.css';

export interface RecordSettlementMember {
  memberId: string;
  label: string;
}

interface RecordSettlementDialogProps {
  groupId: string;
  defaultCurrency: string;
  members: RecordSettlementMember[];
  /** The current user's member row — defaults "Paid by" to them. */
  myMemberId: string | null;
  disabled?: boolean;
}

function todayLocalIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * General-purpose "record a payment" — complements the suggested
 * `SettleUpButton`s rather than replacing them: a suggestion covers the
 * common case, this covers a partial payment, a payment between two
 * members no suggestion paired up, or backdating one that happened
 * earlier (UI-FLOW.md §4).
 */
export function RecordSettlementDialog({
  groupId,
  defaultCurrency,
  members,
  myMemberId,
  disabled,
}: RecordSettlementDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordSettlementAction,
    null,
  );
  const defaultFrom = myMemberId ?? members[0]?.memberId ?? '';
  const defaultTo = members.find((m) => m.memberId !== defaultFrom)?.memberId ?? '';
  const [fromMemberId, setFromMemberId] = useState(defaultFrom);
  const [toMemberId, setToMemberId] = useState(defaultTo);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [currency, setCurrency] = useState(defaultCurrency);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setAmountCents(null);
    }
  }, [state]);

  function memberLabel(m: RecordSettlementMember): string {
    return m.memberId === myMemberId ? `${m.label} (you)` : m.label;
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <Icon name="arrow-left-right" size="sm" aria-hidden />
        Record payment
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Record a payment">
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
                    {memberLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            label="Received by"
            required
            hint={fromMemberId === toMemberId ? 'Choose two different people.' : undefined}
          >
            {(field) => (
              <Select
                {...field}
                name="toMemberId"
                value={toMemberId}
                onChange={(e) => setToMemberId(e.currentTarget.value)}
              >
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {memberLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Amount" required>
            {(field) => (
              <CurrencyInput
                {...field}
                valueCents={amountCents}
                onValueChange={setAmountCents}
                required
              />
            )}
          </FormField>

          <FormField label="Currency" required>
            {() => (
              <CurrencyPicker
                name="currency"
                value={currency}
                onChange={setCurrency}
                aria-label="Currency"
              />
            )}
          </FormField>

          <FormField label="Date" required>
            {(field) => (
              <Input
                {...field}
                name="settledOn"
                type="date"
                required
                defaultValue={todayLocalIsoDate()}
              />
            )}
          </FormField>

          <FormField label="Note" hint="Optional">
            {(field) => (
              <Textarea
                {...field}
                name="note"
                rows={2}
                maxLength={500}
                placeholder="Bank transfer"
              />
            )}
          </FormField>

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || fromMemberId === toMemberId}>
              {pending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
