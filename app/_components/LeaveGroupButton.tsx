'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, Tooltip } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/group-settings';

interface LeaveGroupButtonProps {
  groupName: string;
  /** Why leaving is currently blocked (SPEC.md §5: outstanding balance,
   *  last owner) — shown as a tooltip on the disabled button. */
  blockedReason: string | null;
  leaveAction: () => Promise<ActionResult>;
}

/**
 * "Leave group" — available to every member, since anyone can be added to a
 * group without being asked. Same guards as an owner removing them, checked
 * server-side; the tooltip just explains the disabled state up front.
 */
export function LeaveGroupButton({ groupName, blockedReason, leaveAction }: LeaveGroupButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={blockedReason !== null}
      onClick={() => setConfirming(true)}
    >
      Leave group
    </Button>
  );

  return (
    <>
      {blockedReason ? (
        <Tooltip content={blockedReason} side="right">
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
        title={`Leave "${groupName}"?`}
        message="You'll stop seeing this group and its activity. Your past expenses stay attributed to you in the group's history. An owner can add you back later."
        destructive
        confirmLabel={pending ? 'Leaving…' : 'Leave group'}
        pending={pending}
        error={error}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const result = await leaveAction();
            if (result.ok) router.replace('/tally/groups');
            else setError(result.error);
          });
        }}
      />
    </>
  );
}
