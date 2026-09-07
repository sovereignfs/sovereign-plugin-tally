'use client';

import { useState, useTransition } from 'react';
import { Button, ConfirmDialog, Icon } from '@sovereignfs/ui';
import { formatMoney } from '../_lib/activity';
import { recordSettlementAction } from '../_lib/settlements';

interface SettleUpButtonProps {
  groupId: string;
  fromMemberId: string;
  fromLabel: string;
  toMemberId: string;
  toLabel: string;
  amountCents: number;
  currency: string;
}

/**
 * One suggested payment (`app/_lib/balances.ts`, UI-FLOW.md §4) as a
 * confirm-then-record button — every field is already resolved, but a
 * recorded payment changes balances for two people, so it asks first. A
 * mistake is still reversible from the Activity feed's Delete.
 */
export function SettleUpButton({
  groupId,
  fromMemberId,
  fromLabel,
  toMemberId,
  toLabel,
  amountCents,
  currency,
}: SettleUpButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('groupId', groupId);
      formData.set('fromMemberId', fromMemberId);
      formData.set('toMemberId', toMemberId);
      formData.set('amountCents', String(amountCents));
      formData.set('currency', currency);
      const result = await recordSettlementAction(null, formData);
      if (result.ok) setConfirming(false);
      else setError(result.error);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(true)}>
        <Icon name="arrow-left-right" size="sm" aria-hidden />
        Settle up
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
        title="Record this payment?"
        message={`This records that ${fromLabel} paid ${toLabel} ${formatMoney(amountCents, currency)} outside Tally. It can be deleted from the Activity feed if it was a mistake.`}
        confirmLabel={pending ? 'Recording…' : 'Record payment'}
        pending={pending}
        error={error}
        onConfirm={handleConfirm}
      />
    </>
  );
}
