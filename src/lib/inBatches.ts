/**
 * PostgREST filters travel in the request URL. Past ~25KB the database gateway
 * answers a plain 400 Bad Request (measured 2026-11-06: 25.0KB answered 200,
 * 26.5KB answered 400). An `.in('id', ids)` over a club's whole roster crossed
 * it: the Agent Dashboard asked for all 817 KINGS CLUB profiles in one
 * request (32KB) and got 400 six times that day, so every player rendered
 * without a name or avatar.
 *
 * Every caller-sized `.in()` list goes through here: 100 UUIDs is ~3.7KB of
 * URL, far from the limit whatever else the query carries. Same approach as
 * World Hub idBatches (Smarter-Poker-World-Hub #2684).
 */
export const IN_BATCH_SIZE = 100;

export function idBatches<T>(ids: readonly T[], size = IN_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Batch size must be a positive integer');
  const unique = [...new Set(ids)];
  const batches: T[][] = [];
  for (let start = 0; start < unique.length; start += size) {
    batches.push(unique.slice(start, start + size));
  }
  return batches;
}

type BatchResult<R> = { data: R[] | null; error: unknown };

/**
 * Runs `query` once per batch, sequentially, and concatenates the rows. The
 * first error stops the read and is returned in the same `{ data, error }`
 * shape a single query would give, so call sites keep their error handling.
 * An empty id list makes no request.
 */
export async function selectInBatches<T, R>(
  ids: readonly T[],
  query: (batch: T[]) => PromiseLike<BatchResult<R>>,
  size = IN_BATCH_SIZE
): Promise<{ data: R[]; error: unknown }> {
  const rows: R[] = [];
  for (const batch of idBatches(ids, size)) {
    const { data, error } = await query(batch);
    if (error) return { data: rows, error };
    if (Array.isArray(data)) rows.push(...data);
  }
  return { data: rows, error: null };
}
