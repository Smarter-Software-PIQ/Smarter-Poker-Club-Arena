import { describe, expect, it } from 'vitest';
import {
  PAGE_ROWS,
  keysetSql,
  pageCursor,
  readPaged,
} from '../../scripts/ops/horse-audit-paged-read.mjs';
import {
  CHUNK_HOURS,
  buildHandsSql,
  buildTournamentSql,
  chunks,
} from '../../scripts/ops/horse-hand-audit-holdem-lib.mjs';
import { fetchAll } from '../../scripts/ops/horse-hand-audit-holdem.mjs';
import { auditSql } from '../../scripts/ops/horse-hand-audit-omaha-lib/sql.mjs';

// A busy range: 7,000 hands over 30 hours, many sharing one created_at (ties broken by id).
const T0 = Date.parse('2026-11-25T00:00:00Z');
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ROWS = Array.from({ length: 7000 }, (_, i) => {
  const ms = T0 + Math.floor(i / 3) * 46_000; // three hands per instant
  return { id: uuid(7000 - i), ts: new Date(ms).toISOString().replace('Z', '+00:00'), ms };
}).sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : 1));

/** Serves the real SQL text: its time range, its keyset cursor and its LIMIT, from ROWS. */
function serve(sql: string) {
  const range = [
    ...sql.matchAll(
      /created_at >= '([^']+)'(?:::timestamptz)? (?:AND|and) h\.created_at < '([^']+)'/g
    ),
  ][0]!;
  const since = Date.parse(range[1]!);
  const until = Date.parse(range[2]!);
  const cur = sql.match(/> \('([^']+)'::timestamptz, '([^']+)'::uuid\)/);
  const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? Infinity);
  const after = cur ? { ms: Date.parse(cur[1]!), id: cur[2]! } : null;
  return ROWS.filter(
    (r) =>
      r.ms >= since &&
      r.ms < until &&
      (!after || r.ms > after.ms || (r.ms === after.ms && r.id > after.id))
  ).slice(0, limit);
}

describe('bounded reads for the Horse hand audits (scripts/ops/horse-audit-paged-read.mjs)', () => {
  it('reads a long busy range in pages of at most PAGE_ROWS, every row exactly once, in order', () => {
    const seen: number[] = [];
    const out = readPaged({
      chunks: chunks(T0, T0 + 30 * 3600_000, CHUNK_HOURS),
      sqlFor: (
        [a, b]: [number, number],
        after: { ts: string; id: string } | null,
        limit: number
      ) => {
        const k = keysetSql(after, { limit });
        return `SELECT * FROM hand_history h WHERE h.created_at >= '${new Date(a).toISOString()}' AND h.created_at < '${new Date(b).toISOString()}' ${k.where} ${k.order}`;
      },
      query: serve,
      keyOf: (r: { ts: string; id: string }) => r,
      pageRows: 500,
      onPage: ({ rows }: { rows: number }) => seen.push(rows),
    });
    expect(out.map((r: { id: string }) => r.id)).toEqual(ROWS.map((r) => r.id));
    expect(Math.max(...seen)).toBeLessThanOrEqual(500);
    expect(seen.length).toBeGreaterThan(14); // 7,000 rows cannot come back in a few statements
  });

  it("the hold'em audit's read is paged: every statement is bounded and the rows are the rows of the range", () => {
    const sqls: string[] = [];
    const raw = fetchAll(
      { since: T0, until: T0 + 30 * 3600_000, mode: 'tournament', peopleOnly: false },
      (sql: string) => {
        sqls.push(sql);
        if (sql.includes('tournament_players')) return [];
        return serve(sql).map((r) => ({ hand: { id: r.id, ts: r.ts, tid: null } }));
      },
      { pageRows: 400 }
    );
    expect(raw.hands.map((r: { hand: { id: string } }) => r.hand.id)).toEqual(
      ROWS.map((r) => r.id)
    );
    const reads = sqls.filter((s) => s.includes('FROM public.hand_history h'));
    for (const s of reads) expect(s).toMatch(/ORDER BY h\.created_at, h\.id LIMIT 400\b/);
    expect(reads.length).toBeGreaterThanOrEqual(Math.ceil(7000 / 400));
  });

  it('the default page is PAGE_ROWS and the Omaha read uses the same keyset page', () => {
    expect(PAGE_ROWS).toBe(1000);
    const first = auditSql({ from: T0, to: T0 + 6 * 3600_000, limit: PAGE_ROWS });
    expect(first).toMatch(/ORDER BY h\.created_at, h\.id LIMIT 1000$/);
    expect(first).not.toContain('::uuid)');
    const next = auditSql({
      from: T0,
      to: T0 + 6 * 3600_000,
      limit: 10,
      after: { ts: ROWS[9]!.ts, id: ROWS[9]!.id },
    });
    expect(next).toContain(
      `AND (h.created_at, h.id) > ('${ROWS[9]!.ts}'::timestamptz, '${ROWS[9]!.id}'::uuid)`
    );
    // without a limit the statement is the one it was before paging
    expect(auditSql({ from: T0, to: T0 + 3600_000 })).toMatch(/order by h\.created_at$/);
  });

  it('a page that runs past the statement timeout is asked again at half the size; other errors and the floor still fail', () => {
    const sqlFor = (
      [a, b]: [number, number],
      after: { ts: string; id: string } | null,
      limit: number
    ) => {
      const k = keysetSql(after, { limit });
      return `SELECT * FROM hand_history h WHERE h.created_at >= '${new Date(a).toISOString()}' AND h.created_at < '${new Date(b).toISOString()}' ${k.where} ${k.order}`;
    };
    const limits: number[] = [];
    const slow = (sql: string) => {
      const limit = Number(sql.match(/LIMIT (\d+)/)![1]);
      limits.push(limit);
      if (limit > 300)
        throw new Error('ERROR:  57014: canceling statement due to statement timeout');
      return serve(sql);
    };
    const out = readPaged({
      chunks: [[T0, T0 + 30 * 3600_000]],
      sqlFor,
      query: slow,
      keyOf: (r: { ts: string; id: string }) => r,
    });
    expect(out.map((r: { id: string }) => r.id)).toEqual(ROWS.map((r) => r.id));
    expect(limits.slice(0, 3)).toEqual([1000, 500, 250]);
    expect(Math.max(...limits.slice(3))).toBe(250);
    expect(() =>
      readPaged({
        chunks: [[T0, T0 + 3600_000]],
        sqlFor,
        query: () => {
          throw new Error('permission denied');
        },
        keyOf: (r: never) => r,
      })
    ).toThrow(/permission denied/);
    expect(() =>
      readPaged({
        chunks: [[T0, T0 + 3600_000]],
        sqlFor,
        query: () => {
          throw new Error('unexpected status 502');
        },
        keyOf: (r: never) => r,
      })
    ).toThrow(/502/);
  });

  it('every profile lookup goes by the uuid primary key, never id::text (6.7 s -> 0.9 s a page)', () => {
    const sqls = [
      buildHandsSql({ since: T0, until: T0 + 3600_000, mode: 'all', peopleOnly: true, limit: 10 }),
      buildTournamentSql({ since: T0, until: T0 + 3600_000 }),
      auditSql({ from: T0, to: T0 + 3600_000, peopleOnly: true, limit: 10 }),
    ];
    for (const sql of sqls) {
      expect(sql).not.toMatch(/id::text\s*=/);
      expect(sql).toMatch(/pr2?\.id = \(CASE WHEN p2?->>'userId' ~ '\^\[0-9a-f\]\{8\}/);
    }
  });

  it('refuses a cursor that is not a timestamp and a uuid (they go into SQL), a page over its limit, and a cursor that does not move', () => {
    expect(() => pageCursor("2026-11-25T00:00:00Z'; DROP", uuid(1))).toThrow(/not a timestamp/);
    expect(() => pageCursor('2026-11-25 00:00:00.123456+00', 'x')).toThrow(/not a uuid/);
    expect(pageCursor('2026-11-25 00:00:00.123456+00', uuid(1)).ts).toBe(
      '2026-11-25 00:00:00.123456+00'
    );
    const base = {
      chunks: [[0, 1]],
      sqlFor: () => 'q',
      keyOf: () => ({ ts: '2026-11-25T00:00:00Z', id: uuid(1) }),
    };
    expect(() => readPaged({ ...base, pageRows: 2, query: () => [1, 2, 3] })).toThrow(
      /over its limit/
    );
    expect(() => readPaged({ ...base, pageRows: 2, query: () => [1, 2] })).toThrow(/did not move/);
  });
});
