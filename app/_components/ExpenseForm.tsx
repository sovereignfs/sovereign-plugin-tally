'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  Button,
  CurrencyInput,
  Dialog,
  FormField,
  Input,
  MemberMultiSelect,
  QuantityStepper,
  Select,
  SplitMethodSelector,
  type SplitMethod,
} from '@sovereignfs/ui';
import { createExpenseAction, type ActionResult } from '../_lib/expenses';
import { CATEGORY_OPTIONS } from '../_lib/categories';
import { CURRENCY_OPTIONS } from '../_lib/currencies';
import styles from './DialogForm.module.css';

export interface ExpenseFormMember {
  memberId: string;
  label: string;
}

interface ExpenseFormProps {
  groupId: string;
  defaultCurrency: string;
  members: ExpenseFormMember[];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Add-expense form. A dynamic per-member weight/amount list doesn't map
 * onto plain FormData field names the way a fixed form does, so the
 * complex parts (resolved `amountCents`, the participant weight list) are
 * tracked in React state and serialized into hidden inputs on submit —
 * `createExpenseAction` (`app/_lib/expenses.ts`) parses them back out
 * server-side and re-validates against the real membership table rather
 * than trusting anything sent from here.
 */
export function ExpenseForm({ groupId, defaultCurrency, members }: ExpenseFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createExpenseAction,
    null,
  );

  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');
  const [payerMemberId, setPayerMemberId] = useState(members[0]?.memberId ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(members.map((m) => m.memberId)));
  const [weights, setWeights] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setAmountCents(null);
      setWeights(new Map());
    }
  }, [state]);

  const participantsJson = useMemo(() => {
    const order = members.filter((m) => selectedIds.has(m.memberId)).map((m) => m.memberId);
    if (splitMethod === 'amount') {
      return JSON.stringify(order.map((memberId) => ({ memberId, amountCents: weights.get(memberId) ?? 0 })));
    }
    if (splitMethod === 'equal') {
      return JSON.stringify(order.map((memberId) => ({ memberId })));
    }
    return JSON.stringify(order.map((memberId) => ({ memberId, weight: weights.get(memberId) ?? 0 })));
  }, [members, selectedIds, splitMethod, weights]);

  function toggleParticipant(memberId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  }

  function setWeight(memberId: string, value: number) {
    setWeights((prev) => new Map(prev).set(memberId, value));
  }

  const memberOptions = members.map((m) => ({ id: m.memberId, label: m.label }));

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add expense
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="md" title="Add expense">
        <form action={formAction} className={styles.form}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="amountCents" value={amountCents ?? ''} />
          <input type="hidden" name="splitMethod" value={splitMethod} />
          <input type="hidden" name="participants" value={participantsJson} />

          {state && !state.ok && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {state.error}
            </p>
          )}

          <FormField label="Description" required>
            {(field) => <Input {...field} name="description" required placeholder="Groceries" />}
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

          <FormField label="Category">
            {(field) => (
              <Select {...field} name="category" defaultValue="general">
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Date" required>
            {(field) => (
              <Input {...field} name="occurredOn" type="date" required defaultValue={todayIsoDate()} />
            )}
          </FormField>

          <FormField label="Paid by" required>
            {(field) => (
              <Select
                {...field}
                name="payerMemberId"
                value={payerMemberId}
                onChange={(e) => setPayerMemberId(e.currentTarget.value)}
              >
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Split method">
            {() => <SplitMethodSelector value={splitMethod} onChange={setSplitMethod} />}
          </FormField>

          <MemberMultiSelect
            label="Split between"
            options={memberOptions}
            selectedIds={selectedIds}
            onToggle={toggleParticipant}
            renderTrailing={
              splitMethod === 'equal'
                ? undefined
                : (memberId) => {
                    if (splitMethod === 'amount') {
                      return (
                        <CurrencyInput
                          aria-label={`Amount for ${memberId}`}
                          valueCents={weights.get(memberId) ?? null}
                          onValueChange={(cents) => setWeight(memberId, cents ?? 0)}
                        />
                      );
                    }
                    if (splitMethod === 'percentage') {
                      return (
                        <QuantityStepper
                          aria-label={`Percentage for ${memberId}`}
                          value={weights.get(memberId) ?? 0}
                          onChange={(value) => setWeight(memberId, value)}
                          min={0}
                          max={100}
                          step={1}
                          unit="%"
                        />
                      );
                    }
                    // 'shares'
                    return (
                      <QuantityStepper
                        aria-label={`Shares for ${memberId}`}
                        value={weights.get(memberId) ?? 1}
                        onChange={(value) => setWeight(memberId, value)}
                        min={0}
                        step={1}
                      />
                    );
                  }
            }
          />

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add expense'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
