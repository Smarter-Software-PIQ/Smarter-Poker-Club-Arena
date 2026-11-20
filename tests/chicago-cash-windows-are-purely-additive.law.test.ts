/**
 * CHICAGO CALENDAR REPORTING WINDOWS NEVER SUBTRACT RAW HANDS FROM UTC ROLLUPS.
 *
 * On 2026-11-19, two live production defects hit Kings Club member Butter
 * (fa407ee1-5473-42ec-a9ac-a1eee50983fe):
 *   1. ca_member_record_chicago_facts subtracted [00:00 UTC, 06:00 UTC) edge
 *      hands from UTC daily rollups, producing hands = -1 when post-commit
 *      rake_attributions resolved to a different club than the union table's
 *      rollup row (#11420).
 *   2. ca_club_member_chicago_today_cash (and its siblings
 *      ca_club_member_chicago_cash and ca_club_members_cash_window) used the
 *      exact same subtractive formula, producing phantom +5.00 Today Cash
 *      win/loss on a day with 0 hands played.
 *
 * This law pins the newest definition of all four Chicago window functions so
 * none can revert to subtracting raw ca_hand_facts from UTC daily rollups.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

function newestDefinition(fnName: string): { name: string; body: string } {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fnName}\\s*\\(`,
    'i'
  );
  const last = migrationCorpus()
    .filter(({ sql }) => re.test(sql))
    .pop();
  expect(last, `no migration defines public.${fnName}`).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(re);
  const tagMatch = sql.slice(start).match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/i);
  expect(tagMatch, `${last!.name}: missing dollar-quoted body for ${fnName}`).toBeTruthy();
  const tag = tagMatch![1];
  const open = sql.indexOf(tag, start);
  const close = sql.indexOf(tag, open + tag.length);
  expect(close, `${last!.name}: unclosed dollar quote for ${fnName}`).toBeGreaterThan(open);
  return { name: last!.name, body: sql.slice(open + tag.length, close) };
}

describe('Chicago calendar reporting windows are purely additive (never subtract edge hands from UTC rollups)', () => {
  it('ca_member_record_chicago_facts uses purely additive partial-day slices', () => {
    const { name, body } = newestDefinition('ca_member_record_chicago_facts');
    expect(body, `${name} must not negate hand counts`).not.toMatch(/-\s*\(\s*1\s*\)/);
    expect(body, `${name} must not negate net`).not.toMatch(/-\s*\(\s*coalesce\s*\(\s*f\.net/i);
    expect(body, `${name} must add interior UTC days and partial slices`).toContain(
      'Purely additive partial-day slices'
    );
  });

  it('ca_club_member_chicago_today_cash reads [chicago_start, chicago_end) directly without daily rollups', () => {
    const { name, body } = newestDefinition('ca_club_member_chicago_today_cash');
    expect(body, `${name} must not read UTC daily rollups`).not.toMatch(
      /member_record_daily_facts/i
    );
    expect(body, `${name} must not subtract edge slices`).not.toMatch(/utc_start|utc_end/i);
    expect(body).toContain('b.chicago_start');
    expect(body).toContain('b.chicago_end');
  });

  it('ca_club_member_chicago_cash adds interior UTC days and partial slices without subtraction', () => {
    const { name, body } = newestDefinition('ca_club_member_chicago_cash');
    expect(body, `${name} must not subtract edge slices`).not.toMatch(/utc_start|utc_end/i);
    expect(body, `${name} must not subtract a subquery`).not.toMatch(/\)\s*-\s*\(\s*SELECT/i);
    expect(body).toContain('p_from + 1, p_to - 1');
    expect(body).toContain('p_to >= p_from + 2');
  });

  it('ca_club_members_cash_window adds interior UTC days and partial slices without subtraction', () => {
    const { name, body } = newestDefinition('ca_club_members_cash_window');
    expect(body, `${name} must keep ca_stats_member_record_daily_facts`).toContain(
      'ca_stats_member_record_daily_facts'
    );
    expect(body, `${name} must not subtract removed edge sums`).not.toMatch(
      /coalesce\s*\(\s*d\.net\s*,\s*0\s*\)\s*-\s*coalesce/i
    );
    expect(body).toMatch(
      /coalesce\s*\(\s*d\.net\s*,\s*0\s*\)\s*\+\s*coalesce\s*\(\s*a\.net\s*,\s*0\s*\)/i
    );
  });
});
