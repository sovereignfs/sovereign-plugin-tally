'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@sovereignfs/ui';
import styles from './TallySidebar.module.css';

const NAV = [
  { href: '/tally', label: 'Overview', icon: 'layout-dashboard' as const },
  { href: '/tally/groups', label: 'Groups', icon: 'layers' as const },
  { href: '/tally/people', label: 'People', icon: 'users' as const },
  { href: '/tally/inbox', label: 'Inbox', icon: 'inbox' as const },
];

interface TallySidebarProps {
  /** Unread Tally notifications in the platform's own Notification Center
   *  (UI-FLOW.md §5, `getUnreadInboxCount()`) — shown as a trailing badge
   *  on the Inbox row, `0` renders no badge. */
  unreadCount: number;
}

/**
 * Persistent secondary nav — same precedent as Sheets'/Docs' own
 * `SheetsSidebar`/`DocsSidebar`, scoped to `app/(home)/layout.tsx` so it
 * stays mounted across navigation between Overview/Groups/People/Inbox
 * (UI-FLOW.md §2). Settings is pinned to the bottom, visually separated by
 * a spacer + divider — it's account-level (`user_settings`), not ledger
 * content, so it doesn't belong in the same nav block.
 */
export function TallySidebar({ unreadCount }: TallySidebarProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return href === '/tally' ? pathname === '/tally' : pathname.startsWith(href);
  }

  return (
    <nav className={styles.nav} aria-label="Tally sections">
      <div className={styles.group}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          const isInboxWithUnread = item.href === '/tally/inbox' && unreadCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[styles.link, active ? styles.linkActive : ''].filter(Boolean).join(' ')}
              aria-current={active ? 'page' : undefined}
              aria-label={isInboxWithUnread ? `Inbox (${unreadCount} unread)` : undefined}
            >
              <Icon name={item.icon} size="sm" aria-hidden />
              {item.label}
              {isInboxWithUnread && (
                <span className={styles.unreadBadge} aria-hidden>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className={styles.spacer} />

      <div className={styles.divider} />
      <Link
        href="/tally/settings"
        className={[styles.link, isActive('/tally/settings') ? styles.linkActive : '']
          .filter(Boolean)
          .join(' ')}
        aria-current={isActive('/tally/settings') ? 'page' : undefined}
      >
        <Icon name="settings" size="sm" aria-hidden />
        Settings
      </Link>
    </nav>
  );
}
