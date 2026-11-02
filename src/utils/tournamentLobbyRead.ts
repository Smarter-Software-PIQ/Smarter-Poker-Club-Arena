export interface TournamentLobbyChange<T> {
  revision: number;
  row: T | null;
  insertOnly?: boolean;
}

/** Preserve changes committed to this browser after the read began. A busy
 * lobby can paint immediately; it never needs a quiet interval or another read.
 */
export function reconcileTournamentLobbyRead<T extends { id: string }>(
  snapshot: readonly T[],
  changes: ReadonlyMap<string, TournamentLobbyChange<T>>,
  revisionAtRead: number
): T[] {
  const rows = new Map(snapshot.map((row) => [row.id, row]));
  for (const [id, change] of changes) {
    if (change.revision <= revisionAtRead) continue;
    if (change.row === null) rows.delete(id);
    else if (change.insertOnly ? !rows.has(id) : rows.has(id)) {
      rows.set(id, { ...rows.get(id), ...change.row });
    }
  }
  return [...rows.values()];
}

/** Complete the finite schedule window without mistaking one API page for it.
 * UUID keysets cannot shift when another tournament is born or removed. Realtime
 * changes are reconciled by the caller from the revision before this chain began.
 * A failed or overlarge chain never replaces the last complete lobby snapshot.
 */
export async function readTournamentLobbyWindow<T extends { id: string }>(
  readPage: (
    after: string | null
  ) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>
): Promise<{ data: T[] | null; error: unknown; count?: number | null }> {
  const rows: T[] = [];
  let after: string | null = null;
  let pageBudget = 21;
  try {
    for (let page = 0; page < pageBudget; page++) {
      const result = await readPage(after);
      if (result.error) return { data: null, error: result.error };
      if (page === 0) {
        if (!Number.isSafeInteger(result.count) || result.count! < 0 || result.count! > 10_000)
          throw new Error('Tournament Schedule Count Exceeds The Complete Read Bound');
        pageBudget = Math.min(21, Math.ceil(result.count! / 500) + 1);
      }
      if (!Array.isArray(result.data) || result.data.length > 500)
        throw new Error('Tournament Schedule Page Is Incomplete');
      if (
        result.count != null &&
        (!Number.isSafeInteger(result.count) ||
          result.count < 0 ||
          result.data.length !== Math.min(500, result.count))
      )
        throw new Error('Tournament Schedule Page Is Incomplete');
      for (const row of result.data) {
        if (
          !row ||
          typeof row.id !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(row.id) ||
          (after !== null && row.id <= after)
        )
          throw new Error('Tournament Schedule Identities Are Inconsistent');
        if (rows.length >= 10_000)
          throw new Error('Tournament Schedule Exceeds The Complete Read Bound');
        rows.push(row);
        after = row.id;
      }
      if (result.data.length < 500) return { data: rows, error: null };
    }
    throw new Error('Tournament Schedule Exceeds The Complete Read Bound');
  } catch (error) {
    return { data: null, error };
  }
}
