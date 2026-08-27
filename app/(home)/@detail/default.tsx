/**
 * Fallback for the `@detail` parallel-route slot on every path with no
 * more specific match (Overview, People, Inbox, Settings, and `/tally/
 * groups` itself with no `?g=` selected). Next.js requires this file for
 * a parallel slot that doesn't have a page at every sibling path — without
 * it, navigating to a path this slot has no explicit route for 404s the
 * whole page instead of just rendering nothing for this one slot.
 */
export default function DetailFallback() {
  return null;
}
