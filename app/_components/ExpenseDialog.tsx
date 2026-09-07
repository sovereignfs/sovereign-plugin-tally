'use client';

import { useActionState, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  CurrencyInput,
  Dialog,
  FileDropzone,
  FormField,
  Input,
  MemberMultiSelect,
  QuantityStepper,
  Select,
  SplitMethodSelector,
  Textarea,
  type SplitMethod,
} from '@sovereignfs/ui';
import { formatMoney, toDateInputValue, type ExpenseEditData } from '../_lib/activity';
import { CATEGORY_OPTIONS } from '../_lib/categories';
import { MAX_RECEIPT_BYTES } from '../_lib/expense-input';
import { createExpenseAction, updateExpenseAction, type ActionResult } from '../_lib/expenses';
import { CurrencyPicker } from './CurrencyPicker';
import styles from './DialogForm.module.css';
import expenseStyles from './ExpenseDialog.module.css';

export interface ExpenseDialogMember {
  memberId: string;
  label: string;
}

/** Everything the form needs about the group it's adding to. */
export interface ExpenseDialogTarget {
  groupId: string;
  defaultCurrency: string;
  members: ExpenseDialogMember[];
  /** The current user's own member row — the default payer. `null` only
   *  in the degenerate case of a caller who isn't a member. */
  myMemberId: string | null;
}

interface ExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  target: ExpenseDialogTarget;
  /** Edit mode — pre-fills every field from the stored expense and submits
   *  to `updateExpenseAction` instead of `createExpenseAction`. */
  initial?: ExpenseEditData;
  /** Rendered above the form — the global launcher's group picker. */
  headerSlot?: ReactNode;
}

/** Today's date in the *browser's* calendar, as `YYYY-MM-DD` — `toISOString()`
 *  would give the UTC date, which is yesterday every morning east of UTC. */
function todayLocalIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSplitMethod(value: string): value is SplitMethod {
  return value === 'equal' || value === 'amount' || value === 'percentage' || value === 'shares';
}

function initialWeights(initial: ExpenseEditData | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!initial) return map;
  for (const p of initial.participants) {
    if (initial.splitMethod === 'amount') map.set(p.memberId, p.shareAmountCents);
    else if (p.shareUnits !== null) map.set(p.memberId, p.shareUnits / 100);
  }
  return map;
}

/**
 * Add/edit expense form (UI-FLOW.md §2/§4). A dynamic per-member weight/
 * amount list doesn't map onto plain FormData field names the way a fixed
 * form does, so the complex parts (resolved `amountCents`, payers, the
 * participant weight list) are tracked in React state and serialized into
 * hidden inputs on submit — `expense-input.ts` parses them back out
 * server-side and re-validates against the real membership table rather
 * than trusting anything sent from here. Every total the server will
 * check is also shown live here (amount left to assign, percentage total,
 * payer total) so a mismatch is caught before submitting.
 */
export function ExpenseDialog({ open, onClose, target, initial, headerSlot }: ExpenseDialogProps) {
  const { groupId, members, myMemberId } = target;
  const isEdit = initial !== undefined;
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    isEdit ? updateExpenseAction : createExpenseAction,
    null,
  );

  const [amountCents, setAmountCents] = useState<number | null>(initial?.amountCents ?? null);
  const [currency, setCurrency] = useState(initial?.currency ?? target.defaultCurrency);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(
    initial && isSplitMethod(initial.splitMethod) ? initial.splitMethod : 'equal',
  );
  const [multiPayer, setMultiPayer] = useState((initial?.payers.length ?? 0) > 1);
  const [payerMemberId, setPayerMemberId] = useState(
    initial?.payers[0]?.memberId ?? myMemberId ?? members[0]?.memberId ?? '',
  );
  const [payerAmounts, setPayerAmounts] = useState<Map<string, number>>(
    () => new Map(initial?.payers.map((p) => [p.memberId, p.amountCents]) ?? []),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () =>
      new Set(
        initial ? initial.participants.map((p) => p.memberId) : members.map((m) => m.memberId),
      ),
  );
  const [weights, setWeights] = useState<Map<string, number>>(() => initialWeights(initial));
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [closingMessage, setClosingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.ok) return;
    // A success that carries a warning (receipt not attached) stays open so
    // the warning is actually read; a clean success just closes.
    if (state.message?.includes('Receipt not attached')) setClosingMessage(state.message);
    else onClose();
  }, [state, onClose]);

  const labelByMemberId = useMemo(
    () => new Map(members.map((m) => [m.memberId, m.label])),
    [members],
  );
  const order = useMemo(
    () => members.filter((m) => selectedIds.has(m.memberId)).map((m) => m.memberId),
    [members, selectedIds],
  );

  const participantsJson = useMemo(() => {
    if (splitMethod === 'amount') {
      return JSON.stringify(
        order.map((memberId) => ({ memberId, amountCents: weights.get(memberId) ?? 0 })),
      );
    }
    if (splitMethod === 'equal') return JSON.stringify(order.map((memberId) => ({ memberId })));
    // Shares default to 1 per person, percentages to 0 — exactly what the
    // steppers display, so what's submitted is always what's on screen.
    const fallback = splitMethod === 'shares' ? 1 : 0;
    return JSON.stringify(
      order.map((memberId) => ({ memberId, weight: weights.get(memberId) ?? fallback })),
    );
  }, [order, splitMethod, weights]);

  const payersJson = useMemo(() => {
    if (!multiPayer) return JSON.stringify(payerMemberId ? [{ memberId: payerMemberId }] : []);
    return JSON.stringify(
      Array.from(payerAmounts.entries())
        .filter(([, cents]) => cents > 0)
        .map(([memberId, cents]) => ({ memberId, amountCents: cents })),
    );
  }, [multiPayer, payerMemberId, payerAmounts]);

  const assignedCents = order.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
  const percentTotal = order.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
  const sharesTotal = order.reduce((sum, id) => sum + (weights.get(id) ?? 1), 0);
  const paidTotal = Array.from(payerAmounts.values()).reduce((sum, c) => sum + c, 0);
  const total = amountCents ?? 0;

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

  function onReceiptSelect(file: File | null) {
    if (file && file.size > MAX_RECEIPT_BYTES) {
      setReceiptError(`Receipts must be under ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB.`);
      setReceiptFile(null);
      return;
    }
    if (file && !file.type.startsWith('image/')) {
      setReceiptError('Only image files can be attached.');
      setReceiptFile(null);
      return;
    }
    setReceiptError(null);
    setReceiptFile(file);
  }

  const memberOptions = members.map((m) => ({ id: m.memberId, label: m.label }));
  const splitHint =
    splitMethod === 'amount'
      ? total - assignedCents === 0
        ? 'Fully assigned'
        : total - assignedCents > 0
          ? `${formatMoney(total - assignedCents, currency)} left to assign`
          : `${formatMoney(assignedCents - total, currency)} over the total`
      : splitMethod === 'percentage'
        ? percentTotal === 100
          ? '100% assigned'
          : `${percentTotal}% assigned — needs to total 100%`
        : splitMethod === 'shares'
          ? `${sharesTotal} share${sharesTotal === 1 ? '' : 's'} in total`
          : undefined;

  return (
    <Dialog open={open} onClose={onClose} size="md" title={isEdit ? 'Edit expense' : 'Add expense'}>
      {headerSlot}
      <form action={formAction} className={styles.form} key={groupId}>
        <input type="hidden" name="groupId" value={groupId} />
        {initial && <input type="hidden" name="expenseId" value={initial.expenseId} />}
        <input type="hidden" name="amountCents" value={amountCents ?? ''} />
        <input type="hidden" name="splitMethod" value={splitMethod} />
        <input type="hidden" name="participants" value={participantsJson} />
        <input type="hidden" name="payers" value={payersJson} />

        {state && !state.ok && (
          <p className={styles.feedbackError} role="status" aria-live="polite">
            {state.error}
          </p>
        )}
        {closingMessage && (
          <p className={styles.feedbackWarning} role="status" aria-live="polite">
            {closingMessage}
          </p>
        )}

        <FormField label="Description" required>
          {(field) => (
            <Input
              {...field}
              name="description"
              required
              maxLength={200}
              placeholder="Groceries"
              defaultValue={initial?.description ?? ''}
            />
          )}
        </FormField>

        <div className={expenseStyles.twoUp}>
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
        </div>

        <div className={expenseStyles.twoUp}>
          <FormField label="Category">
            {(field) => (
              <Select {...field} name="category" defaultValue={initial?.category ?? 'general'}>
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
              <Input
                {...field}
                name="occurredOn"
                type="date"
                required
                defaultValue={initial ? toDateInputValue(initial.occurredOn) : todayLocalIsoDate()}
              />
            )}
          </FormField>
        </div>

        <FormField
          label="Paid by"
          required
          hint={
            multiPayer
              ? paidTotal === total
                ? 'Payments match the total'
                : `${formatMoney(paidTotal, currency)} of ${formatMoney(total, currency)} accounted for`
              : undefined
          }
        >
          {(field) =>
            multiPayer ? (
              <div className={expenseStyles.payerList}>
                {members.map((m) => (
                  <div key={m.memberId} className={expenseStyles.payerRow}>
                    <span className={expenseStyles.payerName}>{m.label}</span>
                    <CurrencyInput
                      aria-label={`Amount paid by ${m.label}`}
                      valueCents={payerAmounts.get(m.memberId) ?? null}
                      onValueChange={(cents) =>
                        setPayerAmounts((prev) => new Map(prev).set(m.memberId, cents ?? 0))
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Select
                {...field}
                value={payerMemberId}
                onChange={(e) => setPayerMemberId(e.currentTarget.value)}
              >
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.memberId === myMemberId ? `${m.label} (you)` : m.label}
                  </option>
                ))}
              </Select>
            )
          }
        </FormField>
        <div className={expenseStyles.inlineToggle}>
          <Checkbox
            checked={multiPayer}
            onChange={(checked) => {
              setMultiPayer(checked);
              if (checked && payerAmounts.size === 0 && payerMemberId) {
                setPayerAmounts(new Map([[payerMemberId, total]]));
              }
            }}
            label="More than one person paid"
          />
        </div>

        <FormField label="Split method">
          {() => <SplitMethodSelector value={splitMethod} onChange={setSplitMethod} />}
        </FormField>

        <MemberMultiSelect
          label="Split between"
          hint={splitHint}
          options={memberOptions}
          selectedIds={selectedIds}
          onToggle={toggleParticipant}
          renderTrailing={
            splitMethod === 'equal'
              ? undefined
              : (memberId) => {
                  const label = labelByMemberId.get(memberId) ?? 'member';
                  if (!selectedIds.has(memberId)) return null;
                  if (splitMethod === 'amount') {
                    return (
                      <CurrencyInput
                        aria-label={`Amount for ${label}`}
                        valueCents={weights.get(memberId) ?? null}
                        onValueChange={(cents) => setWeight(memberId, cents ?? 0)}
                      />
                    );
                  }
                  if (splitMethod === 'percentage') {
                    return (
                      <QuantityStepper
                        aria-label={`Percentage for ${label}`}
                        value={weights.get(memberId) ?? 0}
                        onChange={(value) => setWeight(memberId, value)}
                        min={0}
                        max={100}
                        step={1}
                        unit="%"
                      />
                    );
                  }
                  return (
                    <QuantityStepper
                      aria-label={`Shares for ${label}`}
                      value={weights.get(memberId) ?? 1}
                      onChange={(value) => setWeight(memberId, value)}
                      min={0}
                      step={0.5}
                    />
                  );
                }
          }
        />

        <FormField label="Notes" hint="Optional">
          {(field) => (
            <Textarea
              {...field}
              name="notes"
              rows={2}
              maxLength={2000}
              placeholder="Anything worth remembering about this expense"
              defaultValue={initial?.notes ?? ''}
            />
          )}
        </FormField>

        <FormField label="Receipt" hint="Optional — image only, up to 10 MB">
          {() => (
            <>
              {initial?.hasReceipt && !receiptFile && (
                <div className={expenseStyles.inlineToggle}>
                  <input type="hidden" name="removeReceipt" value={removeReceipt ? 'on' : ''} />
                  <Checkbox
                    checked={removeReceipt}
                    onChange={setRemoveReceipt}
                    label="Remove the attached receipt"
                  />
                </div>
              )}
              <FileDropzone
                name="receipt"
                accept="image/*"
                label={
                  receiptFile
                    ? receiptFile.name
                    : initial?.hasReceipt
                      ? 'Replace the receipt'
                      : 'Attach a receipt'
                }
                hint={
                  receiptFile
                    ? `${(receiptFile.size / 1024).toFixed(0)} KB`
                    : 'or drag and drop here'
                }
                onFileSelect={onReceiptSelect}
                ariaLabel="Attach a receipt image"
              />
              {receiptError && (
                <p className={styles.feedbackError} role="alert">
                  {receiptError}
                </p>
              )}
            </>
          )}
        </FormField>

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {closingMessage ? 'Done' : 'Cancel'}
          </Button>
          {!closingMessage && (
            <Button type="submit" disabled={pending || receiptError !== null}>
              {pending ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? 'Save changes' : 'Add expense'}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/** The group detail's own "Add expense" button — owns the open state for
 *  one `ExpenseDialog` bound to that group. */
export function AddExpenseButton({
  target,
  disabled,
}: {
  target: ExpenseDialogTarget;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)} disabled={disabled}>
        Add expense
      </Button>
      {open && <ExpenseDialog open={open} onClose={() => setOpen(false)} target={target} />}
    </>
  );
}
