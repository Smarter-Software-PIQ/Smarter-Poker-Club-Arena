// scripts/ops/horse-audit-paged-read.mjs
// BOUNDED READS FOR THE HORSE HAND AUDITS (2026-11-26, PLO-OWNER lead-7, lane HARDENING).
//
// WHY. scripts/ops/horse-hand-audit-holdem.mjs read each 6-hour chunk of hand_history in ONE statement. A 6-hour
// chunk of NLH tournaments holds about 21,000 hands (2026-11-25), and building their JSON took longer than the 60 s
// statement timeout: "canceling statement due to statement timeout", exit 70, for any tournament range over a few
// hours and for --mode all over about a day. A time chunk bounds the TIME a statement covers, not the ROWS it reads,
// so it fails as soon as traffic grows.
//
// WHAT. Every read is a keyset page: inside each time chunk, rows in (created_at, id) order after the last row read,
// at most PAGE_ROWS of them (ORDER BY created_at, id LIMIT n; the btree on created_at serves it). The next page
// starts strictly after the last (created_at, id) of the page before, so a row is read exactly once even when many
// share one created_at, and the chunk ends at the first short page. So no statement reads more than PAGE_ROWS
// hands, however long the range or busy the hour, and the rows are the same rows the chunk read before, in the same
// created_at order (ties now in id order).
//
// A page that still runs past the timeout (a slow moment of the database) is asked again at half the size, down to
// MIN_PAGE_ROWS hands, and the chunk goes on at that size; past that the read fails as before.
//
// Pure: no I/O. The caller gives the SQL builder and the query function.

/** At most this many hands in one statement (a 1,500-hand NLH tournament page took 6.8 s on 2026-11-26). */
export const PAGE_ROWS = 1000;
/** A page that times out (or meets a gateway error) is asked again at half the size, down to this many hands. */
export const MIN_PAGE_ROWS = 50;
/** The errors a smaller page can get past: the statement timeout, and a gateway that gave up on a long call. */
export const RETRYABLE_READ = /statement timeout|57014|status 50[234]|ETIMEDOUT|ECONNRESET/i;
/** A chunk that needs more pages than this has a cursor that does not move: stop instead of looping. */
export const MAX_PAGES_PER_CHUNK = 100000;

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page cursor from a row's created_at text and id (validated: they are placed in SQL as literals). */
export function pageCursor(ts, id) {
  const t = String(ts ?? '');
  const i = String(id ?? '');
  if (!TS_RE.test(t))
    throw new Error(`paged read: the last row's created_at is not a timestamp: ${t.slice(0, 40)}`);
  if (!UUID_RE.test(i))
    throw new Error(`paged read: the last row's id is not a uuid: ${i.slice(0, 40)}`);
  return { ts: t, id: i };
}

/**
 * The SQL that keeps a page after the cursor and bounds it: `AND (<ts>, <id>) > (cursor)` (empty for the first
 * page) and `ORDER BY <ts>, <id> LIMIT <n>`.
 */
export function keysetSql(
  after,
  { tsCol = 'h.created_at', idCol = 'h.id', limit = PAGE_ROWS } = {}
) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('paged read: limit must be a positive whole number');
  const where = after
    ? `AND (${tsCol}, ${idCol}) > ('${pageCursor(after.ts, after.id).ts}'::timestamptz, '${after.id}'::uuid)`
    : '';
  return { where, order: `ORDER BY ${tsCol}, ${idCol} LIMIT ${limit}` };
}

/**
 * Reads every row of every [since, until) chunk in keyset pages. `sqlFor(chunk, after, limit)` builds one page's
 * SELECT; `query(sql)` returns its rows; `keyOf(row)` gives the row's { ts, id }. Returns the rows in chunk order,
 * then (created_at, id) order. `onPage({ chunk, page, rows })` is told about each page.
 */
export function readPaged({
  chunks,
  sqlFor,
  query,
  keyOf,
  pageRows = PAGE_ROWS,
  minPageRows = MIN_PAGE_ROWS,
  onPage = null,
}) {
  const out = [];
  for (const chunk of chunks) {
    let after = null;
    let limit = pageRows;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES_PER_CHUNK)
        throw new Error(
          `paged read: over ${MAX_PAGES_PER_CHUNK} pages in one chunk (the cursor does not move)`
        );
      let rows;
      for (;;) {
        try {
          rows = query(sqlFor(chunk, after, limit));
          break;
        } catch (e) {
          const msg = String(e?.message ?? e);
          if (!RETRYABLE_READ.test(msg) || limit <= minPageRows) throw e;
          limit = Math.max(minPageRows, Math.floor(limit / 2));
          if (onPage) onPage({ chunk, page, rows: 0, retry: limit, error: msg.slice(0, 120) });
        }
      }
      if (!Array.isArray(rows)) throw new Error('paged read: the query did not return rows');
      if (rows.length > limit)
        throw new Error(`paged read: a page returned ${rows.length} rows, over its limit ${limit}`);
      if (onPage) onPage({ chunk, page, rows: rows.length, limit });
      out.push(...rows);
      if (rows.length < limit) break;
      const k = keyOf(rows[rows.length - 1]);
      const next = pageCursor(k?.ts, k?.id);
      if (after && next.ts === after.ts && next.id === after.id)
        throw new Error('paged read: the cursor did not move');
      after = next;
    }
  }
  return out;
}
