export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Safe chunk size for a `.in("uuid_col", batch)` filter on a SELECT --
// PostgREST/Supabase-js embeds the values straight into the request URL
// (`?uuid_col=in.(id1,id2,...)`), not the body, so a large batch of 36-char
// UUIDs can blow past the ~16KB header limit undici enforces (hit at 500
// UUIDs — a ~19.6KB URL — as `UND_ERR_HEADERS_OVERFLOW`). INSERT/upsert
// payloads go in the request body and aren't subject to this, so they can
// stay at the larger chunk size.
export const ID_FILTER_CHUNK_SIZE = 150;

// PostgREST caps unbounded .select() responses at 1000 rows by default —
// with tables like `people` (4000+ rows and growing), an un-ranged select
// silently returns only a partial table with no error, which then causes
// "existing row not found" bugs downstream (see upsertPeopleByEmailBatch's
// history). Any query meant to read an ENTIRE table must page through it
// explicitly with .range() rather than trust a single .select() call.
export async function fetchAllRows<T>(
  // Loosely typed on purpose: Supabase's PostgrestFilterBuilder.range()
  // returns a builder-shaped thenable, not a plain Promise, which doesn't
  // structurally match a simple interface — callers still get a fully
  // typed T[] back out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryBuilder: () => any,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows: T[] = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Runs async tasks with bounded concurrency instead of either fully
// sequential (slow — one network round trip at a time) or fully parallel
// (risks overwhelming the DB/API with thousands of simultaneous requests).
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
