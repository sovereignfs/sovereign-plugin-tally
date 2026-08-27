'use client';

import { useActionState } from 'react';
import { Button } from '@sovereignfs/ui';
import { recordSettlementAction, type ActionResult } from '../_lib/settlements';
import styles from './SettleUpButton.module.css';

interface SettleUpButtonProps {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
}

/**
 * One suggested payment (`app/_lib/balances.ts`'s `simplifyDebts`,
 * UI-FLOW.md §4) as a single-click confirm — every field is already
 * resolved by the simplification algorithm, so there's nothing left to
 * fill in, just a real write to confirm.
 */
export function SettleUpButton({
  groupId,
  fromMemberId,
  toMemberId,
  amountCents,
  currency,
}: SettleUpButtonProps) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordSettlementAction,
    null,
  );

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="fromMemberId" value={fromMemberId} />
      <input type="hidden" name="toMemberId" value={toMemberId} />
      <input type="hidden" name="amountCents" value={amountCents} />
      <input type="hidden" name="currency" value={currency} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Settling…' : 'Settle up'}
      </Button>
      {state && !state.ok && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
