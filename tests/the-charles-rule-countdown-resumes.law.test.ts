/**
 * THE CHARLES RULE COUNTDOWN RESUMES, IT DOES NOT RESTART.
 *
 * Owner, 2026-11-13 23:04 America/Chicago: "IF YOU GO INTO PROFIT, AND YOUR 10
 * HANDS STARTS... THEN YOU FALL BELOW PROFIT AT LETS SAY THE 7 HANDS LEFT
 * MARK... BUT THEN GO BACK INTO PROFIT. IT NEEDS TO PICK BACK UP WHERE YOU LEFT
 * OFF AT THE 7 HANDS, NOT RESTART THE 10 BACK OVER." And at 23:40: keep the
 * doubling baseline from before the pause.
 *
 * The behaviour is proven on PostgreSQL in tests/unit/charlesRuleBigWin.pg.test.ts.
 * This law reads the SQL: whichever migration last defines
 * fn_cash_session_evaluate must pause on losing the profit and resume on its
 * return, touching nothing but the start stamp in either branch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FIRST = '20261114050737_charles_rule_countdown_resumes_where_it_left_off.sql';

/** Every migration from the ruling onward that installs the function. */
function images(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && f >= FIRST)
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }))
    .filter(({ sql }) =>
      /CREATE OR REPLACE FUNCTION public\.fn_cash_session_evaluate\s*\(/.test(sql)
    );
}

/** The statements of one ELSIF branch, comments removed. */
function branch(sql: string, opens: string, closes: string): string {
  const start = sql.indexOf(opens);
  const end = sql.indexOf(closes, start + opens.length);
  expect(start, opens).toBeGreaterThan(0);
  expect(end, closes).toBeGreaterThan(start);
  return sql
    .slice(start + opens.length, end)
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join(' ');
}

describe('the Charles Rule countdown resumes where it left off', () => {
  it('the migration that made the ruling is on main', () => {
    expect(images().map((i) => i.file)).toContain(FIRST);
  });

  it('every image from the ruling onward pauses and resumes, and resets nothing', () => {
    for (const { file, sql } of images()) {
      const paused = branch(
        sql,
        'ELSIF v_stack <= v_s.baseline THEN',
        'ELSIF v_started IS NULL THEN'
      );
      expect(paused, file).toBe('v_started := NULL;');
      const resumed = branch(sql, 'ELSIF v_started IS NULL THEN', 'ELSE');
      expect(resumed, file).toBe('v_started := v_now;');
      // Losing the profit never clears the count, the doubles or the reference.
      expect(paused + resumed, file).not.toMatch(/v_req|v_played|v_ref|v_dbl/);
    }
  });

  it('a double is still judged against the reference the countdown holds', () => {
    for (const { file, sql } of images()) {
      expect(sql, file).toContain('v_stack + coalesce(v_take, 0) >= 2 * v_ref');
      expect(sql, file).toContain(
        'v_req := v_req + v_hr_hands; v_ref := v_stack; v_dbl := v_dbl + 1;'
      );
    }
  });
});
