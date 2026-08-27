/**
 * `crypto.randomUUID()` — text primary keys. The platform schema's own
 * comment says "IDs are ULIDs," but no `ulid` package exists anywhere in
 * this workspace's dependency tree; every real ID-generation call site
 * found uses `crypto.randomUUID()` (SPEC.md §3).
 */
export function newId(): string {
  return crypto.randomUUID();
}
