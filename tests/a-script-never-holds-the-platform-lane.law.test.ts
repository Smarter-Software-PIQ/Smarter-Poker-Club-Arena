import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Incident 075013fd, lane T. On 2026-11-17 the club-create certification job
 * (scripts/ci/certify-club-create.mjs) sent `SELECT public.fn_ca_lock_settlement_lane_global()`
 * to production as postgres, six times: each run held every tournament table
 * and every cash hand on the platform for its whole rolled-back transaction,
 * up to 14.5 s. The post-deploy account cleanup (reserved-terminal-welcome-fixture.mjs)
 * did the same. Owner ruling 2026-11-17: a tournament issue must never affect
 * other tournaments or cash games - and a CI job is not even a tournament.
 *
 * Two guards: the database refuses the platform lane as a postgres script's
 * own top-level statement (migration 20261118171613), and this file refuses
 * any script, workflow or service source that could send it to a real
 * database. A native harness on a throwaway cluster may still call it.
 */
const ROOTS = ['scripts', '.github', 'server/src', 'src'];
// SQL files are function definitions and catalog dumps loaded into throwaway
// clusters; what sends a statement to a database is a script.
const EXT = /\.(mjs|cjs|js|ts|tsx|sh|yml|yaml|py)$/;
const CALL =
  /(SELECT|PERFORM)\s+(public\.)?fn_ca_lock_settlement_lane_global\s*\(|rpc\/fn_ca_lock_settlement_lane_global|rpc\(\s*['"]fn_ca_lock_settlement_lane_global/;
const PRODUCTION = /DATABASE_URL|SUPABASE_URL|SUPABASE_DB_URL|SUPABASE_SERVICE_ROLE_KEY|POSTGRES_URL|supabase\.co/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'fixtures' || name.startsWith('.git') && dir === '.') continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
}
const files: string[] = [];
for (const r of ROOTS) walk(r, files);

describe('A script never holds the platform lane', () => {
  it('no JavaScript/TypeScript source or workflow sends the global lane call', () => {
    const offenders = files.filter(
      (f) =>
        /\.(mjs|cjs|js|ts|tsx|yml|yaml|sh)$/.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        CALL.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('a Python harness that calls it never names a real database', () => {
    const offenders = files.filter((f) => {
      if (!/\.py$/.test(f)) return false;
      const src = readFileSync(f, 'utf8');
      return CALL.test(src) && PRODUCTION.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('the two production scripts that used to take it take their club lane', () => {
    for (const f of ['scripts/ci/certify-club-create.mjs', 'scripts/ci/reserved-terminal-welcome-fixture.mjs']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toContain("SELECT public.fn_ca_lock_settlement_lane_for_club($1::uuid)");
      expect(src).not.toMatch(CALL);
    }
  });

  it('the database refuses the platform lane as a postgres script statement', () => {
    const m = readFileSync(
      'supabase/migrations/20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql',
      'utf8'
    );
    expect(m).toContain('GLOBAL_LANE_IS_NOT_A_SCRIPT_LOCK');
    expect(m).toContain(
      "current_query() ~* '^\\s*select\\s+(public\\.)?fn_ca_lock_settlement_lane_global\\s*\\(\\s*\\)\\s*;?\\s*$'"
    );
    expect(m).toMatch(/IF session_user = 'postgres'\n\s+AND current_query\(\)/);
  });
});
