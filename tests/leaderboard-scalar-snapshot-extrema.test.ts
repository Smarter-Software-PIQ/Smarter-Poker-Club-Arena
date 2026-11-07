import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Root cause of the post-deploy Leaderboards timeout (run 42349055319): the
// scalar max()/min(snapshot_date) lookups through the filtered snapshot view
// cannot use PostgreSQL's min/max optimization and walked the whole club
// (3,999 ms measured for KINGS CLUB). The migration bounds each one to the
// first eligible row in date order, the same answer, without touching the view.

const sibling = readFileSync(
  'supabase/migrations/20261107084902_leaderboard_snapshot_extrema_stop_at_first_eligible_date.sql',
  'utf8'
);
const sql = readFileSync(
  'supabase/migrations/20261107125004_leaderboard_scalar_snapshot_extrema_stop_at_first_eligible_date.sql',
  'utf8'
);
const fixture = readFileSync('scripts/ci/fixtures/leaderboard-extrema-preimage.sql', 'utf8');
const md5 = (text: string) => createHash('md5').update(text).digest('hex');
const pair = (source: string, tag: string, i: number) => {
  const read = (kind: string) =>
    source.match(new RegExp(`\\$${tag}${kind}${i}\\$([\\s\\S]*?)\\$${tag}${kind}${i}\\$`))![1];
  return [read('old'), read('new')] as const;
};
const count = (text: string, part: string) => text.split(part).length - 1;

// The live period function is the sibling's postimage of the measured fixture.
let livePeriod = fixture;
for (let i = 1; i <= 3; i++) {
  const [o, n] = pair(sibling, '', i);
  livePeriod = livePeriod.replace(o, n);
}

describe('leaderboard scalar snapshot extrema', () => {
  it('starts from the exact live period preimage and lands on the declared postimage', () => {
    expect(md5(livePeriod)).toBe('1aafb566857b993ba7b51c6cf19814cc');
    let after = livePeriod;
    for (let i = 1; i <= 3; i++) {
      const [o, n] = pair(sql, 'p', i);
      expect(count(after, o)).toBe(1);
      after = after.replace(o, n);
    }
    expect(md5(after)).toBe('3a785f72cee6dee70a792d4dcb9a13e2');
    expect(sql).toContain("'1aafb566857b993ba7b51c6cf19814cc'");
    expect(sql).toContain("'3a785f72cee6dee70a792d4dcb9a13e2'");
    // No aggregate date lookup through the filtered view remains.
    expect(after).not.toMatch(/(?:max|min)\((?:s\.)?snapshot_date\)/);
    // Every change is aggregate -> first row in date order; nothing else moves.
    const normalize = (text: string) =>
      text
        .replace(/SELECT (?:max|min)\(snapshot_date\) INTO/g, 'SELECT snapshot_date INTO')
        .replace(/ ORDER BY (?:s\.)?snapshot_date (?:DESC|ASC) LIMIT 1/g, '')
        .replace(/(?:max|min)\(((?:s\.)?snapshot_date)\)/g, '$1');
    expect(normalize(after)).toBe(normalize(livePeriod));
    expect(after).toContain('public.ca_stats_player_stats_snapshots_real');
  });

  it('pairs each aggregate with the matching direction', () => {
    for (const tag of ['p', 'd']) {
      for (let i = 1; i <= 3; i++) {
        const [o, n] = pair(sql, tag, i);
        const direction = o.includes('min(snapshot_date)') ? 'ASC' : 'DESC';
        expect(o).toMatch(/SELECT (?:max|min)\(snapshot_date\) INTO/);
        expect(n).toBe(
          o.replace(/SELECT (?:max|min)\(snapshot_date\) INTO/, 'SELECT snapshot_date INTO').replace(
            /;$/,
            ` ORDER BY snapshot_date ${direction} LIMIT 1;`
          )
        );
        expect(o).toContain('public.ca_stats_player_stats_snapshots_real');
      }
    }
  });

  it('guards both functions by measured hashes and installs in one transaction without privilege changes', () => {
    expect(sql).toContain("'c8d939f6f8612a91f98a7f997c15f048'");
    expect(sql).toContain("'9162b850276ce59bc83c5ad598687eeb'");
    expect(sql).toContain('LEADERBOARD_SCALAR_EXTREMA_PREIMAGE');
    expect(sql).toContain('LEADERBOARD_SCALAR_EXTREMA_POSTIMAGE');
    expect(count(sql, 'EXECUTE v_def;')).toBe(2);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).not.toMatch(/GRANT |REVOKE |ALTER |INSERT |DELETE |UPDATE |TRUNCATE /);
    expect(sql).toMatch(/^-- @live-proof: md5\(pg_get_functiondef\('public\.fn_club_leaderboard_period_v2/m);
  });
});
