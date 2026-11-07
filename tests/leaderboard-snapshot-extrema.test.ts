import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261107084902_leaderboard_snapshot_extrema_stop_at_first_eligible_date.sql',
  'utf8'
);
const before = sql.match(/v_old text := \$old\$([\s\S]*?)\$old\$;/)![1];
const after = sql.match(/v_new text := \$new\$([\s\S]*?)\$new\$;/)![1];
describe('leaderboard snapshot extrema', () => {
  it('bounds the three union-scope filtered date lookups without changing the filtered view or ranking', () => {
    expect(after.match(/ORDER BY (?:s\.)?snapshot_date (?:DESC|ASC) LIMIT 1/g)).toHaveLength(3);
    const normalize = (text: string) =>
      text
        .replace(/(?:max|min)\(((?:s\.)?snapshot_date)\)/g, '$1')
        .replace(/ ORDER BY (?:s\.)?snapshot_date (?:DESC|ASC) LIMIT 1/g, '');
    expect(normalize(after)).toBe(normalize(before));
    expect(after).toContain('public.ca_stats_player_stats_snapshots_real');
  });
  it('refuses source drift and installs transactionally without changing privileges', () => {
    expect(sql).toContain('v_actual IS DISTINCT FROM v_old');
    expect(sql).toContain('v_actual IS DISTINCT FROM v_new');
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).not.toMatch(/GRANT |REVOKE |ALTER |INSERT |DELETE |UPDATE /);
  });
  it('runs the exact candidate in the maintained native database job', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('python3 -B scripts/ci/test-leaderboard-extrema-postgres.py --scratch');
    const fixture = readFileSync('scripts/ci/test-leaderboard-extrema-postgres.py', 'utf8');
    expect(fixture).toContain('migration=candidate.read_text()');
    expect(fixture).toContain("ON_ERROR_STOP=1'],migration");
    expect(fixture).toContain('EXCEPT ALL');
  });
});
