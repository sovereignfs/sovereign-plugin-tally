import Link from 'next/link';
import { Icon } from '@sovereignfs/ui';
import styles from './DetailBackLink.module.css';

/**
 * The detail pane's close/back affordance, shared by the group and person
 * panes. Desktop: a trailing X. Mobile: a leading "‹ Groups"-style back
 * button (UI-FLOW.md §6, `MobileStackedDemo`'s `backLink` pattern). The one
 * CSS breakpoint this plugin declares lives in this component's module —
 * it must match `@sovereignfs/ui`'s `MOBILE_BREAKPOINT_PX` (768).
 */
export function DetailBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={styles.link} aria-label={`Back to ${label.toLowerCase()}`}>
      <Icon name="x" size="sm" aria-hidden className={styles.iconDesktop} />
      <Icon name="chevron-left" size="sm" aria-hidden className={styles.iconMobile} />
      <span className={styles.labelMobile}>{label}</span>
    </Link>
  );
}
