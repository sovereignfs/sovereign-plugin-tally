'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SegmentedControl, Select, useIsMobile } from '@sovereignfs/ui';
import { GROUP_FILTERS, type GroupFilter } from '../_lib/group-filters';

/**
 * Groups list filter (UI-FLOW.md §4) — `SegmentedControl` on desktop,
 * collapsing to a `Select` on the mobile stack where five labels won't
 * fit. Writes `?filter=` so the choice survives reloads, keeping any
 * `?g=` selection intact.
 */
export function GroupListFilter({ value }: { value: GroupFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  function select(next: GroupFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'active') params.delete('filter');
    else params.set('filter', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  if (isMobile) {
    return (
      <Select
        aria-label="Filter groups"
        size="sm"
        value={value}
        onChange={(e) => select(e.currentTarget.value as GroupFilter)}
      >
        {GROUP_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <SegmentedControl<GroupFilter>
      aria-label="Filter groups"
      size="sm"
      value={value}
      onChange={select}
      options={GROUP_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
    />
  );
}
