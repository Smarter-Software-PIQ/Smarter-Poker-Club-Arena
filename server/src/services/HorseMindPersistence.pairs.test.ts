/**
 * The boot pair hydrate pages horse_mind_pairs by keyset on a TOTAL order.
 *
 * It used to page with .range(offset) on `opps desc, attacker_id`, which is
 * not unique (2,161 tie groups in production's top 20,000 on 2026-11-08), so a
 * tie group straddling a page boundary could be skipped or read twice, and
 * every deeper page made Postgres re-read and discard the pages before it.
 * Pinned here: the pager returns every row of a tied fixture exactly once,
 * stops at the cap, and the query uses the total order with a keyset seek.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { horsePairSeekFilter, pageHorsePairs, type HorsePairCursor } from './HorseMindPersistence.js';

type Row = {
  attacker_id: string;
  victim_id: string;
  n3: number;
  opp3: number;
  n_r: number;
  opp_r: number;
  opps: number;
};

/** opps DESC, attacker_id ASC, victim_id ASC; plain code-unit compare for the fixture. */
const cmp = (a: Row, b: Row) =>
  b.opps - a.opps ||
  (a.attacker_id < b.attacker_id ? -1 : a.attacker_id > b.attacker_id ? 1 : 0) ||
  (a.victim_id < b.victim_id ? -1 : a.victim_id > b.victim_id ? 1 : 0);

const after = (r: Row, c: HorsePairCursor) =>
  r.opps < c.opps ||
  (r.opps === c.opps &&
    (r.attacker_id > c.attackerId || (r.attacker_id === c.attackerId && r.victim_id > c.victimId)));

/** A fake table that answers exactly what the keyset query asks for. */
function fakeTable(rows: Row[]) {
  const sorted = [...rows].sort(cmp);
  const calls: Array<{ cursor: HorsePairCursor | null; limit: number }> = [];
  const fetchPage = async (cursor: HorsePairCursor | null, limit: number) => {
    calls.push({ cursor, limit });
    return sorted.filter((r) => !cursor || after(r, cursor)).slice(0, limit);
  };
  return { sorted, calls, fetchPage };
}

/** Large tie groups that straddle every page boundary, same attacker repeated. */
function tiedFixture(n: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      attacker_id: `a${i % 3}`,
      victim_id: `v${String(i).padStart(4, '0')}`,
      n3: 1,
      opp3: 1,
      n_r: 0,
      opp_r: 0,
      // only four distinct opps values: every group is far larger than a page
      opps: 100 - (Math.floor(i / 7) % 4),
    });
  }
  return out;
}

describe('pair hydrate keyset pager', () => {
  it('returns every row of a tied-boundary fixture exactly once, in total order', async () => {
    const t = fakeTable(tiedFixture(53));
    const seen: Row[] = [];
    const read = await pageHorsePairs(t.fetchPage, (rows) => seen.push(...(rows as Row[])), 1000, 5);
    expect(read).toBe(53);
    const keys = seen.map((r) => `${r.attacker_id}|${r.victim_id}`);
    expect(new Set(keys).size).toBe(53);
    expect(seen).toEqual(t.sorted);
    // first page from the top, every later page seeks from the previous last row
    expect(t.calls[0].cursor).toBeNull();
    for (let i = 1; i < t.calls.length; i++) {
      const prevLast = t.sorted[i * 5 - 1];
      expect(t.calls[i].cursor).toEqual({
        opps: prevLast.opps,
        attackerId: prevLast.attacker_id,
        victimId: prevLast.victim_id,
      });
    }
  });

  it('stops at the cap and never asks for more than the cap', async () => {
    const t = fakeTable(tiedFixture(53));
    const seen: Row[] = [];
    const read = await pageHorsePairs(t.fetchPage, (rows) => seen.push(...(rows as Row[])), 12, 5);
    expect(read).toBe(12);
    expect(seen).toEqual(t.sorted.slice(0, 12));
    expect(t.calls.map((c) => c.limit)).toEqual([5, 5, 2]);
  });

  it('stops on an exact multiple of the page with one empty probe, and on an empty table', async () => {
    const t = fakeTable(tiedFixture(10));
    expect(await pageHorsePairs(t.fetchPage, () => {}, 1000, 5)).toBe(10);
    expect(t.calls.length).toBe(3);
    const empty = fakeTable([]);
    expect(await pageHorsePairs(empty.fetchPage, () => {}, 1000, 5)).toBe(0);
    expect(empty.calls.length).toBe(1);
  });

  it('the seek filter is strictly after the cursor on the total order, with quoted keys', () => {
    expect(horsePairSeekFilter({ opps: 152, attackerId: 'a-1', victimId: 'v"2' })).toBe(
      'opps.lt.152,' +
        'and(opps.eq.152,attacker_id.gt."a-1"),' +
        'and(opps.eq.152,attacker_id.eq."a-1",victim_id.gt."v\\"2")'
    );
  });

  it('the query uses the total order, a keyset seek beside a plain opps bound, and no OFFSET', () => {
    const src = readFileSync(join(__dirname, 'HorseMindPersistence.ts'), 'utf8');
    const at = src.indexOf('async function fetchHorsePairPage');
    const block = src.slice(at, src.indexOf('\n}\n', at));
    expect(block).toContain(".from('horse_mind_pairs')");
    expect(block).not.toMatch(/\.range\(/);
    expect(block).toMatch(/select\('[^']*\bopps\b[^']*'\)/);
    expect(block).toContain(".lte('opps', cursor.opps).or(horsePairSeekFilter(cursor))");
    const orders = [...block.matchAll(/\.order\('(\w+)', \{ ascending: (true|false) \}\)/g)].map(
      (m) => `${m[1]}:${m[2]}`
    );
    expect(orders).toEqual(['opps:false', 'attacker_id:true', 'victim_id:true']);
    expect(block).toContain('.limit(limit)');
  });
});
