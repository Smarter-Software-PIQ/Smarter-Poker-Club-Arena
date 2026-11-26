// person-vs-horse-results.mjs reads a day at a time (2026-11-26): a 30-day single read ran past the 60 s statement
// timeout. The person-hand rows of every day are aggregated in JS into the same report row the single read returned.
import { describe, expect, it } from 'vitest';
import {
  PEOPLE_ORDER_SQL,
  READ_CHUNK_HOURS,
  aggregatePersonHands,
  buildPersonHandsSql,
  readResultsChunked,
  resultChunks,
} from '../../scripts/ops/person-vs-horse-results-lib.mjs';

const T0 = Date.parse('2026-11-01T00:00:00Z');
// people as the chunk read sends them: md5(account id) and its first four characters; account-id order apart
const U1 = 'f00d0000000000000000000000000001'; // md5 of an account starting aaaa (first in account-id order)
const U2 = '0bad0000000000000000000000000002'; // md5 of an account starting bbbb
const P4: Record<string, string> = { [U1]: 'aaaa', [U2]: 'bbbb' };
const ORDER = new Map([
  [U1, 1],
  [U2, 2],
]);
const at = (min: number) => new Date(T0 + min * 60_000).toISOString().replace('Z', '000Z');
// [user md5, hand md5, first four, created_at, game, is_cash, n_players, big_blind text, bb, showdown, counted,
//  usable, people_in_hand, in_source, w]
const row = (
  u: string,
  h: string,
  min: number,
  bb: number,
  extra: Partial<Record<string, unknown>> = {}
) => [
  u,
  h,
  P4[u],
  at(min),
  'plo5',
  true,
  6,
  '2',
  bb,
  extra.sd ?? false,
  extra.counted ?? true,
  extra.usable ?? true,
  extra.pih ?? 1,
  extra.src ?? true,
  extra.w ?? 0,
];

describe('person-vs-horse results read a day at a time', () => {
  it('a 30-day range is 30 bounded statements, each one day of hands', () => {
    const plan = {
      sinceMs: T0,
      untilMs: T0 + 30 * 86_400_000,
      splits: [],
      mode: 'all',
      games: null,
      by: null,
    };
    const sqls: string[] = [];
    const row0 = readResultsChunked(plan, (sql: string) => (sqls.push(sql), []), {
      now: () => 'x',
    });
    // the people order first (md5 keys and positions only), then one statement a day
    expect(sqls.shift()).toBe(PEOPLE_ORDER_SQL);
    expect(READ_CHUNK_HOURS).toBe(24);
    expect(sqls).toHaveLength(30);
    expect(sqls[0]).toContain(
      "h.created_at >= TIMESTAMPTZ '2026-11-01T00:00:00Z' AND h.created_at < TIMESTAMPTZ '2026-11-02T00:00:00Z'"
    );
    expect(row0).toMatchObject({ cells: [], hands: [], source: { expected: 0, found: 0 } });
    expect(resultChunks(T0, T0 + 30 * 3600_000).map(([a, b]) => (b - a) / 3600_000)).toEqual([
      24, 6,
    ]);
    // the chunk read keeps the single read's sources and filters, and probes ca_hand_facts by key
    const one = buildPersonHandsSql({ ...plan, mode: 'cash', games: ['plo5'] }, [
      T0,
      T0 + 86_400_000,
    ]);
    expect(one).toContain('AND h.tournament_id IS NULL');
    expect(one).toContain("IN ('plo5')");
    expect(one).toContain('WHERE x.hand_id = s.hand_id AND x.user_id = s.user_id');
    expect(one).toMatch(/^WITH people AS MATERIALIZED/);
    // no account id or hand id leaves the database
    const out = one.slice(one.lastIndexOf('SELECT jsonb_build_array'));
    expect(out).toContain('md5(m.user_id::text), md5(m.hand_id::text), left(m.user_id::text, 4)');
    expect(
      out.replace(/md5\(m\.(user|hand)_id::text\)|left\(m\.user_id::text, 4\)/g, '')
    ).not.toMatch(/m\.(user|hand)_id/);
  });

  it('a session that crosses a day boundary is one session, exactly as in the single read', () => {
    // U1 plays 23:50 and 00:10 (20 min apart: one session), then 01:00 (50 min later: a new session)
    const rows = [
      row(U1, 'h1', 1430, 2),
      row(U1, 'h2', 1450, -1, { sd: true }),
      row(U1, 'h3', 1500, 4),
      row(U2, 'h2', 1450, 3, { pih: 2 }),
      row(U1, 'h4', 1510, 1, { pih: 6 }), // every seat a person: no Horse dealt in
      row(U2, 'h5', 1520, 9, { counted: false }), // a deleted account
      row(U2, 'h6', 1530, 0, { usable: false, src: false }),
    ];
    // h2 now has two people, both rows carry people_in_hand 2
    rows[1]![12] = 2;
    const r = aggregatePersonHands(rows, null, 'now', ORDER);
    const cells = r.cells
      .map((c: Record<string, unknown>) => [c.pn, c.sess, c.n, c.s, c.ss, c.sdn, c.sds, c.p4])
      .sort((a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(cells).toEqual([
      [1, 0, 2, 1, 5, 1, -1, 'aaaa'],
      [1, 1, 1, 4, 16, 0, 0, 'aaaa'],
      [2, 0, 1, 3, 9, 0, 0, 'bbbb'],
    ]);
    expect(r.hands).toEqual([
      { w: 0, g: 'plo5', c: true, d: '', h: 3 },
      { w: 0, g: 'plo5', c: true, d: null, h: 3 },
    ]);
    expect(r.left_out).toEqual({ deleted_accounts: 1, unusable: 1, no_horse: 1 });
    expect(r.source).toEqual({ table: 'ca_hand_facts', expected: 7, found: 6 });
  });

  it('breaks down by day, hour, stake, table size and player like the SQL dimension', () => {
    const rows = [row(U2, 'h1', 1430, 2), row(U1, 'h2', 1450, 1)];
    const d = (by: string) =>
      aggregatePersonHands(rows, by)
        .cells.map((c: { d: string }) => c.d)
        .sort();
    expect(d('day')).toEqual(['2026-11-01', '2026-11-02']);
    expect(d('hour')).toEqual(['2026-11-01 23:00', '2026-11-02 00:00']);
    expect(d('stake')).toEqual(['2', '2']);
    expect(d('table-size')).toEqual(['6', '6']);
    expect(d('player')).toEqual(['1', '2']); // dense rank in account-id order, not md5 order (U2's md5 sorts first)
    const pn = (order: Map<string, number> | null) =>
      aggregatePersonHands(rows, null, null, order)
        .cells.map((c: { p4: string; pn: number }) => `${c.p4}:${c.pn}`)
        .sort();
    expect(pn(ORDER)).toEqual(['aaaa:1', 'bbbb:2']);
    expect(() => aggregatePersonHands(rows, 'nope')).toThrow(/unknown --by/);
  });
});
