'use client';

import Link from 'next/link';
import { Icon, useIsMobile } from '@sovereignfs/ui';
import { AddExpenseLauncher } from './AddExpenseLauncher';
import styles from './MobilePageActions.module.css';

/**
 * The trailing actions for the 4 mobile drill-down screens (Overview,
 * Groups, People, Inbox): the persistent "Add expense" action UI-FLOW.md §2
 * wants one tap away everywhere, and the Settings gear (§6 — no footer
 * slot is free for it). Renders nothing on desktop, where the sidebar
 * carries both; passed into `PageHeader`'s `action` slot, which renders on
 * both breakpoints, so responsive behavior is this component's job.
 */
export function MobilePageActions() {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <span className={styles.actions}>
      <AddExpenseLauncher variant="icon" />
      <Link href="/tally/settings" aria-label="Settings" className={styles.link}>
        <Icon name="settings" size="md" aria-hidden />
      </Link>
    </span>
  );
}
