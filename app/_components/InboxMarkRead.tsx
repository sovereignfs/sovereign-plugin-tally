'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { markTallyNotificationsReadAction } from '../_lib/inbox-actions';

/**
 * Mounted by the Inbox page: marks Tally's unread notifications read once
 * the feed has rendered, then refreshes so the sidebar/footer badge (which
 * is computed server-side per render) clears on the same visit.
 */
export function InboxMarkRead() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    markTallyNotificationsReadAction()
      .then(({ marked }) => {
        if (!cancelled && marked > 0) router.refresh();
      })
      .catch(() => {
        // Best-effort; the badge just stays until the next visit.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
