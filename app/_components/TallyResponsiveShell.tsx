'use client';

import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ThreeColumnLayout, useIsMobile } from '@sovereignfs/ui';
import { TallySidebar } from './TallySidebar';
import { TallyMobileShell, type DrawerPlugin } from './TallyMobileShell';

interface TallyResponsiveShellProps {
  children: ReactNode;
  detail: ReactNode;
  plugins: DrawerPlugin[];
  unreadCount: number;
}

/**
 * Forks `(home)/layout.tsx`'s tree between the desktop `ThreeColumnLayout`
 * (unchanged from before this component existed) and a completely different
 * mobile presentation (UI-FLOW.md §6) — `ThreeColumnLayout` has no
 * responsive behavior of its own by design (see its own precedent in
 * `example-plugins/example-layouts`), so fitting a fixed sidebar + fixed
 * detail column on a phone-width screen is this plugin's decision, not the
 * layout primitive's. Plain `useIsMobile()` + early return rather than
 * `<ResponsiveSurface web mobile/>` — no real difference here, just
 * marginally simpler for a two-branch JSX fork with no shared prep work.
 *
 * Deliberately does **not** decide "show `detail` or `children`" here via
 * `detail ?? children` — found live that this is broken, not just
 * stylistically worse: `detail` is a Next.js parallel-route slot, and even
 * when its resolved page (`@detail/default.tsx`) renders nothing, the
 * `detail` *prop value* reaching this client component is never the literal
 * JS `null` — it's a real, non-nullish React/RSC reference (confirmed live:
 * `detail === null` printed `false` on `/tally`, a route with nothing
 * selected). `??` only treats `null`/`undefined` as absent, so it always
 * picked `detail` — which then correctly rendered as empty, silently
 * blanking the whole mobile pane on every route with no group/person
 * selected. `ThreeColumnLayout`'s own desktop-side comment about
 * `Children.toArray` dropping "falsy children" is doing more work than a
 * plain `??` can: `Children.toArray` treats `null`/`undefined`/`false`/etc.
 * as droppable at *render* time, after React has actually resolved the
 * slot — not before, from plain client-side JS. `TallyMobileShell` decides
 * the same thing correctly instead, from real, synchronously-known client
 * state (the URL's `?g=`/`?p=` param), passing both `children` and `detail`
 * down and picking one — never testing an unrendered RSC prop for nullness.
 */
export function TallyResponsiveShell({
  children,
  detail,
  plugins,
  unreadCount,
}: TallyResponsiveShellProps) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Same URL-driven test `TallyMobileShell` uses: the `detail` slot's
  // resolved output can't be inspected for emptiness from here (see the
  // doc comment above), but whether a group/person is selected can. Without
  // this the desktop layout kept an empty 360px third column on every
  // route — visible as a bordered blank pane.
  const hasDetailSelection =
    (pathname.startsWith('/tally/groups') && searchParams.has('g')) ||
    (pathname.startsWith('/tally/people') && searchParams.has('p'));

  if (isMobile) {
    return (
      <TallyMobileShell plugins={plugins} unreadCount={unreadCount} detail={detail}>
        {children}
      </TallyMobileShell>
    );
  }

  return (
    <ThreeColumnLayout sidebarWidth={240} detailWidth={400}>
      <TallySidebar unreadCount={unreadCount} />
      {children}
      {hasDetailSelection ? detail : null}
    </ThreeColumnLayout>
  );
}
