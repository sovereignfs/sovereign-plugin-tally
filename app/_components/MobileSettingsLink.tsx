'use client';

import Link from 'next/link';
import { Icon, useIsMobile } from '@sovereignfs/ui';
import styles from './MobileSettingsLink.module.css';

/**
 * Settings entry point for the 4 mobile drill-down screens (Overview,
 * Groups, People, Inbox) — on mobile there's no persistent sidebar to pin
 * "Settings" to the bottom of (`TallySidebar`, desktop-only), and the
 * self-rendered `MobileFooter`'s 4 icons are already spoken for by the
 * primary sections (UI-FLOW.md §6's own footer sketch deliberately moved
 * Settings out to free those slots). Renders nothing on desktop — passed
 * into `PageHeader`'s `action` slot, which renders on both breakpoints
 * unchanged by design, so responsive behavior is the action content's own
 * responsibility (`PageHeader`'s own doc comment, matching Shopper's
 * `ListHeaderActions` precedent).
 */
export function MobileSettingsLink() {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <Link href="/tally/settings" aria-label="Settings" className={styles.link}>
      <Icon name="settings" size="md" aria-hidden />
    </Link>
  );
}
