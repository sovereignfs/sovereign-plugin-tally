'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/context';
import styles from '../(home)/inbox/page.module.css';

interface InboxActionButtonProps {
  label: string;
  pendingLabel: string;
  action: () => Promise<ActionResult>;
}

/**
 * Shared Resend/Remind trigger for Inbox's actionable rows (UI-FLOW.md §5)
 * — `useTransition` + `router.refresh()` on success, same shape as
 * `GroupLifecycleActions`' plain (non-form) action calls. No local
 * "resolved" state needed: a successful action changes the underlying
 * data (invite status flips to `'sent'`, or the reminder goes on
 * cooldown), so the row simply isn't in the feed anymore once
 * `router.refresh()` re-fetches it server-side.
 */
export function InboxActionButton({ label, pendingLabel, action }: InboxActionButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className={styles.actionWrapper}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await action();
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {error && (
        <span className={styles.actionError} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
