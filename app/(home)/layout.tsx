import type { ReactNode } from 'react';
import { ThreeColumnLayout } from '@sovereignfs/ui';
import { TallySidebar } from '../_components/TallySidebar';
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
 */
export default function TallyHomeLayout({
  children,
  detail,
}: {
  children: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className={styles.homeFrame} data-plugin-fullbleed>
      <ThreeColumnLayout sidebarWidth={240} detailWidth={360}>
        <TallySidebar />
        {children}
        {detail}
      </ThreeColumnLayout>
    </div>
  );
}
