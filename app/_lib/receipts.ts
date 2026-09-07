import { sdk } from '@sovereignfs/sdk';

const RECEIPT_URL_EXPIRES_SECONDS = 1800;

/** `receipts/<expenseId>/<safe filename>` — the filename is a client-supplied
 *  string, so anything outside a conservative character set is replaced
 *  before it becomes part of a storage key. */
export function receiptStorageKeyFor(expenseId: string, filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'receipt';
  const safe =
    base
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .slice(-80) || 'receipt';
  return `receipts/${expenseId}/${safe}`;
}

/**
 * Batch-resolves a short-lived view URL per expense with an attached
 * receipt (SPEC.md §8) — shared by `groups.ts`'s per-group Activity feed
 * and `people.ts`'s cross-group person timeline, both of which assemble
 * `GroupActivityItem[]` from an already-fetched expense list. A signed URL
 * is generated fresh per page load (never cached — `sdk.storage`'s own
 * short-lived-token design), all in parallel since no batch API exists on
 * `sdk.storage`. An individual failure (e.g. the underlying object was
 * somehow removed after the row's `receiptStorageKey` was set) degrades to
 * "no link for that one row" rather than failing the whole feed.
 */
export async function resolveReceiptUrls(
  expensesWithKeys: { id: string; receiptStorageKey: string | null }[],
): Promise<Map<string, string>> {
  const withReceipts = expensesWithKeys.filter(
    (e): e is { id: string; receiptStorageKey: string } => e.receiptStorageKey !== null,
  );
  if (withReceipts.length === 0) return new Map();

  const entries = await Promise.all(
    withReceipts.map(async (e) => {
      try {
        const url = await sdk.storage.getSignedUrl(e.receiptStorageKey, {
          expiresInSeconds: RECEIPT_URL_EXPIRES_SECONDS,
        });
        return [e.id, url] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e !== null));
}
