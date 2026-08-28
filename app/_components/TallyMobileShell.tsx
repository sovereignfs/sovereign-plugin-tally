'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon, MobileAppsDrawer, MobileFooter } from '@sovereignfs/ui';
import styles from './TallyMobileShell.module.css';

export interface DrawerPlugin {
  id: string;
  name: string;
  routePrefix: string;
  hasIcon: boolean;
}

interface TallyMobileShellProps {
  /** The current section's list (Overview/Groups/People/Inbox/Settings). */
  children: ReactNode;
  /** The `@detail` parallel-route slot's output — real content when a
   *  group/person is selected, an empty render otherwise. Never test this
   *  prop for nullness to decide which to show (see this file's own
   *  `hasDetailSelection` and `TallyResponsiveShell`'s doc comment for why
   *  that's broken) — the URL's `?g=`/`?p=` param is the reliable signal. */
  detail: ReactNode;
  plugins: DrawerPlugin[];
}

/**
 * Mobile half of `TallyResponsiveShell`'s fork (UI-FLOW.md §6). One
 * full-width pane plus a self-rendered `MobileFooter` — `manifest.json`
 * already opts out of the platform's own footer
 * (`shellConfig.mobileFooter: false`, set from scaffold time), so this is
 * what fills that gap. The platform's own mobile *header* is deliberately
 * left alone (not forked) — `MobileHeader`'s API has no slot for
 * Tally-specific actions beyond a title, and self-rendering it would mean
 * rebuilding a working notification bell and account menu from scratch for
 * a benefit (a persistent gear/add-expense icon) the per-screen
 * `MobileSettingsLink` action already gets close enough to, without that
 * cost — a deliberate, discussed scope decision, not an oversight.
 *
 * Footer icons split left/right to match the sidebar's own top-to-bottom
 * order (UI-FLOW.md's own sketch): Overview/Groups left, People/Inbox
 * right. Settings has no footer icon — it moved to a gear action on each
 * of those four screens instead (`MobileSettingsLink`), freeing the footer
 * for exactly the 4 primary sections. Uses `onClick` + `router.push`
 * rather than `FooterIcon`'s `href` (a plain `<a>`, full page reload) —
 * same precedent as the platform's own `MobileNav`'s Home icon, for
 * client-side navigation.
 *
 * The "Apps" launcher opens a real `MobileAppsDrawer` listing every other
 * installed plugin available to the current user (`plugins` prop, fetched
 * server-side in `(home)/layout.tsx` via `sdk.plugins.list()`) — despite
 * UI-FLOW.md's own claim that this was "already exactly what you asked
 * for, not something new to build," there is no platform-level drawer a
 * plugin can reach into; `example-plugins/example-mobile-poc` is the real
 * reference for building one, confirmed by reading it directly rather than
 * trusting that claim.
 */
export function TallyMobileShell({ children, detail, plugins }: TallyMobileShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [appsOpen, setAppsOpen] = useState(false);

  const isOverview = pathname === '/tally';
  const isGroups = pathname.startsWith('/tally/groups');
  const isPeople = pathname.startsWith('/tally/people');
  const isInbox = pathname.startsWith('/tally/inbox');
  const hasDetailSelection =
    (isGroups && searchParams.has('g')) || (isPeople && searchParams.has('p'));

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>{hasDetailSelection ? detail : children}</div>

      <MobileFooter
        onOpenApps={() => setAppsOpen(true)}
        launcherOpen={appsOpen}
        leftIcons={[
          {
            icon: <Icon name="layout-dashboard" size="md" aria-hidden />,
            label: 'Overview',
            active: isOverview,
            onClick: () => router.push('/tally'),
          },
          {
            icon: <Icon name="layers" size="md" aria-hidden />,
            label: 'Groups',
            active: isGroups,
            onClick: () => router.push('/tally/groups'),
          },
        ]}
        rightIcons={[
          {
            icon: <Icon name="users" size="md" aria-hidden />,
            label: 'People',
            active: isPeople,
            onClick: () => router.push('/tally/people'),
          },
          {
            icon: <Icon name="inbox" size="md" aria-hidden />,
            label: 'Inbox',
            active: isInbox,
            onClick: () => router.push('/tally/inbox'),
          },
        ]}
      />

      <MobileAppsDrawer
        open={appsOpen}
        onClose={() => setAppsOpen(false)}
        aria-label="Apps"
        items={plugins.map((plugin) => ({
          key: plugin.id,
          icon: plugin.hasIcon ? (
            <img src={`/plugin-icons/${plugin.id}.svg`} alt="" className={styles.drawerIconImg} />
          ) : (
            <Icon name="package" size="lg" aria-hidden />
          ),
          label: plugin.name,
          href: plugin.routePrefix,
        }))}
      />
    </div>
  );
}
