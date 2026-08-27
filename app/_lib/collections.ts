/** Get-or-create append into a `Map<string, T[]>` — the bucket-by-key
 *  pattern `overview.ts`/`groups.ts` use to group flat query results by
 *  `groupId` without an `noUncheckedIndexedAccess`-unsafe non-null
 *  assertion at the call site. */
export function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
