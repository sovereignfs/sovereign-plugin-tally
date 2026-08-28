import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import { TallyResponsiveShell } from '../_components/TallyResponsiveShell';
import { getUnreadInboxCount } from '../_lib/notifications';
import { registerPortabilityHandlers } from '../_lib/portability';
import styles from './layout.module.css';

/**
 * Route-group layout for every view that keeps the persistent sidebar:
 * Overview (`/tally`), Groups (`/tally/groups`), People (`/tally/people`),
 * Inbox (`/tally/inbox`), Settings (`/tally/settings`). Same "shared
 * ancestor layout isn't re-fetched on client-side navigation between
 * sibling routes" precedent as Docs'/Sheets' own `(home)/layout.tsx` — the
 * sidebar stays mounted with no flash moving between any of these views.
 *
 * `detail` is a parallel route (`@detail`), the mechanism that makes
 * Tally's 3-column design possible at all: `ThreeColumnLayout` is
 * instantiated once, here, with fixed JSX children — a page rendered into
 * `children` has no way to inject a sibling third child into its own
 * ancestor's element tree, so the selected-group/-person detail pane
 * can't come from the same route tree `children` does. `@detail/
 * default.tsx` renders `null` when nothing is selected, and
 * `ThreeColumnLayout`'s own `Children.toArray` drops falsy children, so
 * passing `{detail}` as the third child correctly collapses to 2 columns
 * whenever nothing is selected. This is the one place Tally's layout
 * genuinely departs from the Docs/Sheets precedent (UI-FLOW.md §2) — no
 * sibling plugin does this. ✅ Verified live (dev server + browser,
 * ROADMAP.md task 5): selecting a group shows the detail column, list
 * stays visible; switching selection updates the detail column in place;
 * closing collapses back to 2 columns; zero console errors.
 *
 * Below `TallyResponsiveShell`'s mobile breakpoint, the desktop
 * `ThreeColumnLayout` tree above is never mounted at all — `ResponsiveSurface`
 * forks to a completely different, drill-down single-pane tree instead
 * (UI-FLOW.md §6; `TallyResponsiveShell.tsx`/`TallyMobileShell.tsx` own the
 * details). That mobile tree self-renders its own `MobileFooter` with a real
 * "Apps" drawer, which needs the installed-plugin list `sdk.plugins.list()`
 * provides — fetched here, server-side, once per request (no manifest
 * permission required — `sdk.plugins` isn't gated, confirmed against
 * `docs/plugin-development.md`'s full permissions table) and passed down as
 * a plain, serializable prop rather than fetched client-side.
 *
 * `unreadCount` (`getUnreadInboxCount()`) is the sidebar/mobile-footer
 * Inbox unread badge (UI-FLOW.md §5) — ties into the platform's real
 * Notification Center rather than a Tally-only counter; see that
 * function's own doc comment for the scope this deliberately does and
 * doesn't cover (accurate per-render, not live-polled).
 */
export default async function TallyHomeLayout({
  children,
  detail,
}: {
  children: ReactNode;
  detail: ReactNode;
}) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches Docs' `app/layout.tsx` precedent exactly).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  const [availablePlugins, unreadCount] = await Promise.all([
    sdk.plugins.list(),
    getUnreadInboxCount(),
  ]);
  const drawerPlugins = availablePlugins
    .filter((p) => p.availableToUser && p.id !== 'fs.sovereign.tally')
    .map((p) => ({ id: p.id, name: p.name, routePrefix: p.routePrefix, hasIcon: Boolean(p.icon) }));

  return (
    <div className={styles.homeFrame} data-plugin-fullbleed>
      <TallyResponsiveShell plugins={drawerPlugins} unreadCount={unreadCount} detail={detail}>
        {children}
      </TallyResponsiveShell>
    </div>
  );
}
